import {
  ADMIN_ONLY_PERMISSIONS,
  isPermissionKey,
  PERMISSION_KEYS,
  type PermissionKey,
  type Role,
} from '@treerepro/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { recordAudit } from '../audit/audit.ts';
import { revokeAllApiKeys } from '../auth/api-keys.ts';
import type { DbExecutor } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { rolePermissions } from '../db/schema/role-permissions.ts';
import { ADMIN_ROLE_NAME, type RoleRow, roles } from '../db/schema/roles.ts';
import { userRoles } from '../db/schema/user-roles.ts';
import { users } from '../db/schema/users.ts';
import { AppError } from '../http/errors.ts';
import type { AccessContext } from './context.ts';
import { effectivePermissions } from './permissions.ts';

export interface RoleInput {
  name: string;
  description?: string;
  permissions: string[];
}

const isAdmin = (row: Pick<RoleRow, 'name' | 'isSystem'>) =>
  row.isSystem && row.name === ADMIN_ROLE_NAME;

/** @rfc RFC-31 R1, R2 */
export function toRole(row: RoleRow, permissionKeys: readonly string[]): Role {
  const permissions = isAdmin(row)
    ? [...PERMISSION_KEYS].sort()
    : [...new Set(permissionKeys.filter(isPermissionKey))].sort();
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    permissions,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Catalog keys only (R3), and never an admin-only key (R15). @rfc RFC-31 R3, R15 */
function validatePermissions(keys: string[]): PermissionKey[] {
  const unknown = keys.filter((k) => !isPermissionKey(k));
  if (unknown.length > 0) {
    throw new AppError(
      'PERMISSION_UNKNOWN',
      'Unknown permission',
      unknown.map((k) => ({ path: 'permissions', message: k })),
    );
  }
  const unique = [...new Set(keys as PermissionKey[])].sort();
  const adminOnly = unique.filter((k) => ADMIN_ONLY_PERMISSIONS.includes(k));
  if (adminOnly.length > 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Only the admin role holds this permission',
      adminOnly.map((k) => ({ path: 'permissions', message: k })),
    );
  }
  return unique;
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 64)
    throw new AppError('VALIDATION_FAILED', 'Role name must have 1 to 64 characters', [
      { path: 'name', message: 'Expected 1 to 64 characters' },
    ]);
  return trimmed;
}

async function permissionsOf(db: DbExecutor, roleId: string): Promise<string[]> {
  const rows = await db
    .select({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  return rows.map((r) => r.key);
}

async function findRow(db: DbExecutor, id: string): Promise<RoleRow | null> {
  const [row] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  return row ?? null;
}

type RefusalReason = 'admin_role' | 'ceiling' | 'own_roles' | 'held_role';

interface RefusalEntry {
  actorUserId: string;
  targetType: 'user' | 'role';
  targetId?: string;
  metadata: { reason: RefusalReason; added?: string[]; removed?: string[] };
}

/** What the actor may delegate: their roles, whether one of them is `admin`, and their effective permissions. @rfc RFC-31 R12 */
async function actorStanding(
  db: DbExecutor,
  actorUserId: string,
): Promise<{ admin: boolean; roleIds: string[]; permissions: ReadonlySet<string> }> {
  const held = await db
    .select({ id: roles.id, name: roles.name, isSystem: roles.isSystem })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, actorUserId));
  return {
    admin: held.some(isAdmin),
    roleIds: held.map((r) => r.id),
    permissions: new Set(await effectivePermissions(db, actorUserId)),
  };
}

/**
 * The 403 of R14, carrying the audit entry the caller writes once the
 * transaction that raised it has rolled back.
 * @rfc RFC-31 R14
 */
export class DelegationRefusedError extends AppError {
  readonly entry: RefusalEntry;
  constructor(entry: RefusalEntry) {
    super('PERMISSION_DENIED', 'You do not have permission to do this');
    this.name = 'DelegationRefusedError';
    this.entry = entry;
  }
}

/**
 * Runs `fn` — a transaction — and, when it ends in a `DelegationRefusedError`,
 * records the refusal on `db` afterwards, outside the rolled-back
 * transaction, then rethrows. A service whose `db` is itself a transaction
 * (RFC-32 R1) writes into that one, which its caller's own rollback
 * discards; the caller therefore wraps its transaction the same way with the
 * root connection (`updateUser`, RFC-50 R5), and exactly one entry commits.
 * @rfc RFC-31 R14
 */
export async function recordingRefusal<T>(db: DbExecutor, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DelegationRefusedError)
      await recordAudit(db, { ...err.entry, action: 'roles.delegation_refused' });
    throw err;
  }
}

/**
 * The R12/R13 gate on `setUserRoles`, run inside its transaction once the
 * user and the roles are known to exist, on the same snapshot as the write
 * (RFC-31 R14): what it computed is what changes.
 * @rfc RFC-31 R12, R13, R14
 */
async function assertMayAssignRoles(
  db: DbExecutor,
  input: {
    userId: string;
    added: string[];
    removed: string[];
    admin: RoleRow | null;
    actorUserId: string | null;
  },
): Promise<void> {
  if (input.actorUserId === null) return;
  const actorUserId = input.actorUserId;
  const { added, removed } = input;
  const deny = (reason: RefusalReason) =>
    new DelegationRefusedError({
      actorUserId,
      targetType: 'user',
      targetId: input.userId,
      metadata: { reason, added, removed },
    });
  if (input.userId === actorUserId) throw deny('own_roles');
  const actor = await actorStanding(db, actorUserId);
  if (actor.admin) return;
  if (input.admin && (added.includes(input.admin.id) || removed.includes(input.admin.id)))
    throw deny('admin_role');
  if (added.length === 0) return;
  const granted = await db
    .selectDistinct({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, added));
  if (granted.some((r) => !actor.permissions.has(r.key))) throw deny('ceiling');
}

/**
 * The R12/R13 gate on `createRole` (`roleId` null, `stored` empty) and
 * `updateRole`, run inside their transaction after `requireEditable`. Only
 * the permission set is capped; a name or description edit passes.
 * @rfc RFC-31 R12, R13, R14
 */
async function assertMayWritePermissions(
  db: DbExecutor,
  input: {
    roleId: string | null;
    stored: readonly string[];
    permissions: readonly string[];
    actorUserId: string | null;
  },
): Promise<void> {
  if (input.actorUserId === null) return;
  const actorUserId = input.actorUserId;
  const actor = await actorStanding(db, actorUserId);
  if (actor.admin) return;
  const added = input.permissions.filter((key) => !input.stored.includes(key));
  const changed = added.length > 0 || input.stored.some((key) => !input.permissions.includes(key));
  const deny = (reason: RefusalReason) =>
    new DelegationRefusedError({
      actorUserId,
      targetType: 'role',
      ...(input.roleId === null ? {} : { targetId: input.roleId }),
      metadata: { reason },
    });
  if (changed && input.roleId !== null && actor.roleIds.includes(input.roleId))
    throw deny('held_role');
  if (added.some((key) => !actor.permissions.has(key))) throw deny('ceiling');
}

/** @rfc RFC-31 R1 */
export async function getRole(db: DbExecutor, id: string): Promise<Role | null> {
  const row = await findRow(db, id);
  return row ? toRole(row, await permissionsOf(db, row.id)) : null;
}

/** By name, case-insensitively. @rfc RFC-31 R1 */
export async function listRoles(db: DbExecutor): Promise<Role[]> {
  const rows = await db
    .select()
    .from(roles)
    .orderBy(asc(sql`lower(${roles.name})`));
  const perms = await db.select().from(rolePermissions);
  const byRole = new Map<string, string[]>();
  for (const p of perms) byRole.set(p.roleId, [...(byRole.get(p.roleId) ?? []), p.permissionKey]);
  return rows.map((row) => toRole(row, byRole.get(row.id) ?? []));
}

/** @rfc RFC-31 R4, R5 */
export async function userIdsWithRole(db: DbExecutor, roleId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.roleId, roleId));
  return rows.map((r) => r.userId);
}

/** @rfc RFC-31 R3, R12, R14, R15 */
export async function createRole(
  ctx: AccessContext,
  input: RoleInput & { actorUserId: string | null },
): Promise<Role> {
  const name = normalizeName(input.name);
  const permissions = validatePermissions(input.permissions);
  const now = new Date(ctx.now());
  return recordingRefusal(ctx.db, () =>
    ctx.db.transaction(async (tx) => {
      await assertMayWritePermissions(tx, {
        roleId: null,
        stored: [],
        permissions,
        actorUserId: input.actorUserId,
      });
      let inserted: RoleRow | undefined;
      try {
        [inserted] = await tx
          .insert(roles)
          .values({ name, description: input.description ?? '', createdAt: now, updatedAt: now })
          .returning();
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('ROLE_NAME_TAKEN', 'A role with this name already exists');
        throw err;
      }
      if (!inserted) throw new Error('insert returned no row');
      const row = inserted;
      if (permissions.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(permissions.map((permissionKey) => ({ roleId: row.id, permissionKey })));
      }
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'roles.created',
        targetType: 'role',
        targetId: row.id,
        metadata: { permissions },
      });
      return toRole(row, permissions);
    }),
  );
}

async function requireEditable(db: DbExecutor, id: string): Promise<RoleRow> {
  const row = await findRow(db, id);
  if (!row) throw new AppError('ROLE_NOT_FOUND', 'Role not found');
  if (row.isSystem) throw new AppError('ROLE_IS_SYSTEM', 'A system role cannot be changed');
  return row;
}

/** @rfc RFC-31 R4, R12, R13, R14, R15 */
export async function updateRole(
  ctx: AccessContext,
  input: {
    id: string;
    name?: string;
    description?: string;
    permissions?: string[];
    actorUserId: string | null;
  },
): Promise<Role> {
  const now = new Date(ctx.now());
  const name = input.name === undefined ? undefined : normalizeName(input.name);
  const permissions =
    input.permissions === undefined ? undefined : validatePermissions(input.permissions);
  const { role, holders } = await recordingRefusal(ctx.db, () =>
    ctx.db.transaction(async (tx) => {
      const current = await requireEditable(tx, input.id);
      const changes: string[] = [];
      if (name !== undefined && name !== current.name) changes.push('name');
      if (input.description !== undefined && input.description !== current.description)
        changes.push('description');
      if (permissions !== undefined) {
        const stored = (await permissionsOf(tx, input.id)).sort();
        await assertMayWritePermissions(tx, {
          roleId: input.id,
          stored,
          permissions,
          actorUserId: input.actorUserId,
        });
        const same =
          stored.length === permissions.length && stored.every((key, i) => key === permissions[i]);
        if (!same) changes.push('permissions');
      }
      let updated: RoleRow | undefined;
      try {
        [updated] = await tx
          .update(roles)
          .set({
            ...(name !== undefined ? { name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            updatedAt: now,
          })
          .where(eq(roles.id, input.id))
          .returning();
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('ROLE_NAME_TAKEN', 'A role with this name already exists');
        throw err;
      }
      if (!updated) throw new AppError('ROLE_NOT_FOUND', 'Role not found');
      const row = updated;
      if (permissions !== undefined) {
        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, input.id));
        if (permissions.length > 0) {
          await tx
            .insert(rolePermissions)
            .values(permissions.map((permissionKey) => ({ roleId: input.id, permissionKey })));
        }
      }
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'roles.updated',
        targetType: 'role',
        targetId: input.id,
        metadata: { changes },
      });
      return {
        role: toRole(row, permissions ?? (await permissionsOf(tx, input.id))),
        holders: await userIdsWithRole(tx, input.id),
      };
    }),
  );
  await ctx.permissionCache.invalidate(holders);
  return role;
}

/** @rfc RFC-31 R5 */
export async function deleteRole(
  ctx: AccessContext,
  input: { id: string; actorUserId: string | null },
): Promise<void> {
  const holders = await ctx.db.transaction(async (tx) => {
    await requireEditable(tx, input.id);
    const ids = await userIdsWithRole(tx, input.id);
    await tx.delete(roles).where(eq(roles.id, input.id));
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'roles.deleted',
      targetType: 'role',
      targetId: input.id,
    });
    return ids;
  });
  await ctx.permissionCache.invalidate(holders);
}

async function adminRole(db: DbExecutor): Promise<RoleRow | null> {
  const [row] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.name, ADMIN_ROLE_NAME), eq(roles.isSystem, true)))
    .limit(1);
  return row ?? null;
}

/**
 * Throws ROLE_LAST_ADMIN when `userId` is the only active holder of `admin`.
 * Callers run inside a transaction (`setUserRoles` does; suspension and erasure
 * will): the check takes a transaction-scoped advisory lock so concurrent
 * removals serialize instead of both passing on the same snapshot.
 * @rfc RFC-31 R7
 */
export async function assertNotLastAdmin(db: DbExecutor, userId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('roles:admin-holders'))`);
  const admin = await adminRole(db);
  if (!admin) return;
  const holders = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(userRoles.roleId, admin.id), eq(users.status, 'active')));
  const ids = holders.map((h) => h.userId);
  if (ids.includes(userId) && ids.length === 1) {
    throw new AppError('ROLE_LAST_ADMIN', 'This is the last active administrator');
  }
}

/**
 * @rfc RFC-31 R6, R7, R12, R13, R14
 * @rfc RFC-82 R3
 */
export async function setUserRoles(
  ctx: AccessContext,
  input: { userId: string; roleIds: string[]; actorUserId: string | null },
): Promise<{ added: string[]; removed: string[] }> {
  const wanted = [...new Set(input.roleIds)];
  const now = new Date(ctx.now());
  const result = await recordingRefusal(ctx.db, () =>
    ctx.db.transaction(async (tx) => {
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!user) throw new AppError('NOT_FOUND', 'User not found');
      if (wanted.length > 0) {
        const found = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(inArray(roles.id, wanted));
        if (found.length !== wanted.length) throw new AppError('ROLE_NOT_FOUND', 'Role not found');
      }
      const current = (
        await tx
          .select({ roleId: userRoles.roleId })
          .from(userRoles)
          .where(eq(userRoles.userId, input.userId))
      ).map((r) => r.roleId);
      const added = wanted.filter((id) => !current.includes(id));
      const removed = current.filter((id) => !wanted.includes(id));
      const admin = await adminRole(tx);
      await assertMayAssignRoles(tx, {
        userId: input.userId,
        added,
        removed,
        admin,
        actorUserId: input.actorUserId,
      });
      if (admin && removed.includes(admin.id)) {
        await assertNotLastAdmin(tx, input.userId);
        // Keys are revoked, not just dormant: a later grant must revive none (RFC-82 R3).
        await revokeAllApiKeys(tx, {
          userId: input.userId,
          actorUserId: input.actorUserId,
          reason: 'admin_role_removed',
          now,
        });
      }
      if (removed.length > 0)
        await tx
          .delete(userRoles)
          .where(and(eq(userRoles.userId, input.userId), inArray(userRoles.roleId, removed)));
      if (added.length > 0)
        await tx
          .insert(userRoles)
          .values(added.map((roleId) => ({ userId: input.userId, roleId, createdAt: now })));
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'users.roles_changed',
        targetType: 'user',
        targetId: input.userId,
        metadata: { added, removed },
      });
      return { added, removed };
    }),
  );
  await ctx.permissionCache.invalidate([input.userId]);
  return result;
}
