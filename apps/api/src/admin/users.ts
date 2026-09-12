import type { User, UserRoleRef, UserStatus } from '@treerepro/contracts';
import { and, asc, desc, eq, inArray, lt, type SQL, sql } from 'drizzle-orm';
import { assertNotLastAdmin, setUserRoles } from '../access/roles.ts';
import { recordAudit } from '../audit/audit.ts';
import type { AuthContext, RequestMeta } from '../auth/context.ts';
import { inviteUser } from '../auth/flows/invitation.ts';
import { findUserById, updateName } from '../auth/users.ts';
import type { DbExecutor } from '../db/client.ts';
import { roles } from '../db/schema/roles.ts';
import { userRoles } from '../db/schema/user-roles.ts';
import { type UserRow, users } from '../db/schema/users.ts';
import { decodeCursor, encodeCursor } from '../http/cursor.ts';
import { AppError } from '../http/errors.ts';

/** The administrator performing an action and the request it came from. */
export interface AdminActor extends RequestMeta {
  actorUserId: string;
}

const notFound = () => new AppError('USER_NOT_FOUND', 'User not found');
const invalidStatus = (message: string) => new AppError('USER_INVALID_STATUS', message);

/** @rfc RFC-50 R1 */
export function toUser(row: UserRow, roleRefs: UserRoleRef[]): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
    totpEnabled: row.totpEnabledAt !== null,
    roles: roleRefs,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
  };
}

/** Roles of each user, by name case-insensitively. @rfc RFC-50 R1 */
async function rolesOf(db: DbExecutor, userIds: string[]): Promise<Map<string, UserRoleRef[]>> {
  const byUser = new Map<string, UserRoleRef[]>();
  if (userIds.length === 0) return byUser;
  const rows = await db
    .select({ userId: userRoles.userId, id: roles.id, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(inArray(userRoles.userId, userIds))
    .orderBy(asc(sql`lower(${roles.name})`));
  for (const r of rows) {
    byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), { id: r.id, name: r.name }]);
  }
  return byUser;
}

async function withRoles(db: DbExecutor, row: UserRow): Promise<User> {
  return toUser(row, (await rolesOf(db, [row.id])).get(row.id) ?? []);
}

/** Loads the row locked for the rest of the transaction. */
async function lockUser(tx: DbExecutor, id: string): Promise<UserRow> {
  const [row] = await tx.select().from(users).where(eq(users.id, id)).limit(1).for('update');
  if (!row) throw notFound();
  return row;
}

/** @rfc RFC-50 R4 */
export async function getUser(db: DbExecutor, id: string): Promise<User | null> {
  const row = await findUserById(db, id);
  return row ? withRoles(db, row) : null;
}

/** Newest first by id (UUID v7); `limit + 1` rows decide whether a next page exists. @rfc RFC-50 R2 */
export async function listUsers(
  db: DbExecutor,
  input: { status?: UserStatus; cursor?: string; limit: number },
): Promise<{ data: User[]; nextCursor: string | null }> {
  const conditions: SQL[] = [];
  if (input.status) conditions.push(eq(users.status, input.status));
  if (input.cursor) conditions.push(lt(users.id, decodeCursor(input.cursor)));
  const rows = await db
    .select()
    .from(users)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(users.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > input.limit && last ? encodeCursor(last.id) : null;
  const byUser = await rolesOf(
    db,
    page.map((r) => r.id),
  );
  return { data: page.map((r) => toUser(r, byUser.get(r.id) ?? [])), nextCursor };
}

/** @rfc RFC-50 R5 */
export async function updateUser(
  ctx: AuthContext,
  input: AdminActor & { id: string; name?: string; roleIds?: string[] },
): Promise<User> {
  const now = new Date(ctx.now());
  const user = await ctx.db.transaction(async (tx) => {
    const current = await lockUser(tx, input.id);
    if (input.name !== undefined) {
      const changed = await updateName(tx, { current, name: input.name, now });
      if (changed) {
        await recordAudit(tx, {
          actorUserId: input.actorUserId,
          action: 'users.updated',
          targetType: 'user',
          targetId: current.id,
          ip: input.ip,
          userAgent: input.userAgent,
          metadata: { fields: ['name'] },
        });
      }
    }
    if (input.roleIds !== undefined) {
      await setUserRoles(
        { ...ctx, db: tx },
        { userId: current.id, roleIds: input.roleIds, actorUserId: input.actorUserId },
      );
    }
    const row = await findUserById(tx, current.id);
    if (!row) throw notFound();
    return withRoles(tx, row);
  });
  // setUserRoles invalidated inside the transaction; a cache fill that raced
  // the commit would hold the old roles, so invalidate once more (RFC-32 R3).
  if (input.roleIds !== undefined) await ctx.permissionCache.invalidate([input.id]);
  return user;
}

/** @rfc RFC-50 R6 */
export async function suspendUser(
  ctx: AuthContext,
  input: AdminActor & { id: string },
): Promise<User> {
  const now = new Date(ctx.now());
  const user = await ctx.db.transaction(async (tx) => {
    const current = await lockUser(tx, input.id);
    if (current.status !== 'active') throw invalidStatus('Only an active user can be suspended');
    await assertNotLastAdmin(tx, current.id);
    const [row] = await tx
      .update(users)
      .set({ status: 'suspended', suspendedAt: now, updatedAt: now })
      .where(eq(users.id, current.id))
      .returning();
    if (!row) throw notFound();
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'users.suspended',
      targetType: 'user',
      targetId: row.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return withRoles(tx, row);
  });
  await ctx.sessions.revokeAll(user.id);
  await ctx.permissionCache.invalidate([user.id]);
  return user;
}

/** @rfc RFC-50 R7 */
export async function reactivateUser(
  ctx: AuthContext,
  input: AdminActor & { id: string },
): Promise<User> {
  const now = new Date(ctx.now());
  return ctx.db.transaction(async (tx) => {
    const current = await lockUser(tx, input.id);
    if (current.status !== 'suspended')
      throw invalidStatus('Only a suspended user can be reactivated');
    const [row] = await tx
      .update(users)
      .set({ status: 'active', suspendedAt: null, updatedAt: now })
      .where(eq(users.id, current.id))
      .returning();
    if (!row) throw notFound();
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'users.reactivated',
      targetType: 'user',
      targetId: row.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return withRoles(tx, row);
  });
}

/** Re-runs the invitation flow for an invited user; may throw InvitationMailError. @rfc RFC-50 R8 */
export async function resendInvite(
  ctx: AuthContext,
  input: AdminActor & { id: string },
): Promise<User> {
  const current = await findUserById(ctx.db, input.id);
  if (!current) throw notFound();
  if (current.status !== 'invited') throw invalidStatus('Only an invited user can be re-invited');
  const { user } = await inviteUser(ctx, {
    email: current.email,
    name: current.name,
    actorUserId: input.actorUserId,
  });
  return withRoles(ctx.db, user);
}

/** The caller's own name; actor and target are the same user. @rfc RFC-50 R11 */
export async function updateOwnName(
  ctx: AuthContext,
  input: RequestMeta & { user: UserRow; name: string },
): Promise<User> {
  const now = new Date(ctx.now());
  return ctx.db.transaction(async (tx) => {
    const current = await lockUser(tx, input.user.id);
    const changed = await updateName(tx, { current, name: input.name, now });
    if (changed) {
      await recordAudit(tx, {
        actorUserId: current.id,
        action: 'users.updated',
        targetType: 'user',
        targetId: current.id,
        ip: input.ip,
        userAgent: input.userAgent,
        metadata: { fields: ['name'] },
      });
    }
    const row = await findUserById(tx, current.id);
    if (!row) throw notFound();
    return withRoles(tx, row);
  });
}
