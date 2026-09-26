import { randomBytes } from 'node:crypto';
import type { ApiKeyList, ApiKeySummary, CreateApiKeyResponse } from '@treerepro/contracts';
import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { recordAudit } from '../audit/audit.ts';
import type { Db, DbExecutor } from '../db/client.ts';
import { type ApiKeyRow, apiKeys } from '../db/schema/api-keys.ts';
import { ADMIN_ROLE_NAME, roles } from '../db/schema/roles.ts';
import { userRoles } from '../db/schema/user-roles.ts';
import { type UserRow, users } from '../db/schema/users.ts';
import { AppError } from '../http/errors.ts';
import type { AuthContext, RequestMeta } from './context.ts';
import { verifyPassword } from './password.ts';
import { hashToken } from './tokens.ts';
import { verifyTotpCode } from './totp.ts';

/** @rfc RFC-82 R1 */
export const API_KEY_PREFIX = 'tr_live_';
/** @rfc RFC-82 R1 */
export const API_KEY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60_000;

/** @rfc RFC-82 R1 */
export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(32).toString('base64url');
}

/**
 * The token of an `Authorization: Bearer …` header, or null. The scheme is
 * matched case-insensitively (HTTP auth schemes are, per RFC 7235 §2.1).
 * @rfc RFC-82 R3
 */
export function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

/** Holds the `admin` system role (RFC-31 R10). @rfc RFC-82 R2, R3 */
export async function holdsAdminRole(db: DbExecutor, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: roles.id })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(
      and(eq(userRoles.userId, userId), eq(roles.name, ADMIN_ROLE_NAME), eq(roles.isSystem, true)),
    )
    .limit(1);
  return row !== undefined;
}

/** @rfc RFC-82 R3 */
export async function findUsableKey(
  deps: { db: Db; now: () => number },
  raw: string,
): Promise<{ id: string; user: UserRow } | null> {
  const now = new Date(deps.now());
  const [row] = await deps.db
    .select({ key: apiKeys, user: users })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(
      and(
        eq(apiKeys.keyHash, hashToken(raw)),
        isNull(apiKeys.revokedAt),
        gt(apiKeys.expiresAt, now),
        eq(users.status, 'active'),
      ),
    );
  if (!row || !(await holdsAdminRole(deps.db, row.user.id))) return null;
  await deps.db
    .update(apiKeys)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(apiKeys.id, row.key.id),
        or(
          isNull(apiKeys.lastUsedAt),
          lt(apiKeys.lastUsedAt, new Date(now.getTime() - TOUCH_EVERY_MS)),
        ),
      ),
    );
  return { id: row.key.id, user: row.user };
}

function summary(row: ApiKeyRow, now: number): ApiKeySummary {
  const state = row.revokedAt ? 'revoked' : row.expiresAt.getTime() <= now ? 'expired' : 'active';
  return {
    id: row.id,
    name: row.name,
    prefix: row.keyPrefix,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    state,
  };
}

/** @rfc RFC-82 R1, R2, R8 */
export async function createApiKey(
  ctx: AuthContext,
  input: { user: UserRow; name: string; password: string; code: string } & RequestMeta,
): Promise<CreateApiKeyResponse> {
  const { user } = input;
  if (!(await holdsAdminRole(ctx.db, user.id))) {
    throw new AppError('PERMISSION_DENIED', 'Only administrators can create API keys');
  }
  if (user.totpEnabledAt === null || user.totpSecret === null) {
    throw new AppError('AUTH_TOTP_NOT_ENABLED', 'Enable two-factor authentication first');
  }
  const verified =
    user.passwordHash !== null && (await verifyPassword(user.passwordHash, input.password));
  if (!verified) throw new AppError('AUTH_INVALID_CREDENTIALS', 'Password is incorrect');
  const counter = verifyTotpCode(user.totpSecret, input.code, ctx.now());
  if (counter === null || !(await ctx.mfa.claimTotpCounter(user.id, counter))) {
    throw new AppError('AUTH_TOTP_INVALID', 'Code is not valid');
  }
  const secret = generateApiKey();
  const now = new Date(ctx.now());
  const row = await ctx.db.transaction(async (tx) => {
    // Re-read under the row lock the revoking flows take: a password reset or
    // a suspension that committed while the password was being verified must
    // not be followed by a key that outlives it (RFC-82 R3).
    const [locked] = await tx.select().from(users).where(eq(users.id, user.id)).for('update');
    if (locked?.status !== 'active') {
      throw new AppError('AUTH_UNAUTHENTICATED', 'Authentication required');
    }
    if (locked.passwordHash !== user.passwordHash) {
      throw new AppError('AUTH_INVALID_CREDENTIALS', 'Password is incorrect');
    }
    const [inserted] = await tx
      .insert(apiKeys)
      .values({
        userId: user.id,
        name: input.name,
        keyHash: hashToken(secret),
        keyPrefix: secret.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + 8),
        createdAt: now,
        expiresAt: new Date(now.getTime() + API_KEY_TTL_MS),
      })
      .returning();
    if (!inserted) throw new Error('api key insert returned no row');
    await recordAudit(tx, {
      actorUserId: user.id,
      action: 'auth.api_key.created',
      targetType: 'api_key',
      targetId: inserted.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return inserted;
  });
  return { key: summary(row, ctx.now()), secret };
}

/** @rfc RFC-82 R7 */
export async function listApiKeys(ctx: AuthContext, user: UserRow): Promise<ApiKeyList> {
  const rows = await ctx.db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, user.id))
    .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id));
  return {
    eligible: await holdsAdminRole(ctx.db, user.id),
    keys: rows.map((r) => summary(r, ctx.now())),
  };
}

/** @rfc RFC-82 R7, R8 */
export async function revokeApiKey(
  ctx: AuthContext,
  input: { user: UserRow; id: string } & RequestMeta,
): Promise<void> {
  const now = new Date(ctx.now());
  await ctx.db.transaction(async (tx) => {
    // Users row first, as suspendUser and createApiKey lock it, so the lock
    // order is the same everywhere and the two cannot deadlock.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, input.user.id)).for('update');
    const [row] = await tx
      .update(apiKeys)
      .set({ revokedAt: now })
      .where(
        and(
          eq(apiKeys.id, input.id),
          eq(apiKeys.userId, input.user.id),
          isNull(apiKeys.revokedAt),
          gt(apiKeys.expiresAt, now),
        ),
      )
      .returning({ id: apiKeys.id });
    if (!row) throw new AppError('NOT_FOUND', 'API key not found');
    await recordAudit(tx, {
      actorUserId: input.user.id,
      action: 'auth.api_key.revoked',
      targetType: 'api_key',
      targetId: row.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  });
}

/** Why every key of a user was revoked at once (RFC-82 R3). */
export type ApiKeyRevocationReason =
  | 'password_reset'
  | 'password_change'
  | 'totp_disabled'
  | 'logout_all'
  | 'user_suspended'
  | 'admin_role_removed'
  | 'sessions_revoked';

/**
 * Revokes every active key of `userId` inside the caller's transaction, one
 * `auth.api_key.revoked` entry per key carrying the reason.
 * @rfc RFC-82 R3, R8
 */
export async function revokeAllApiKeys(
  tx: DbExecutor,
  input: {
    userId: string;
    /** Null for a CLI actor (RFC-41). */
    actorUserId: string | null;
    reason: ApiKeyRevocationReason;
    now: Date;
  } & Partial<RequestMeta>,
): Promise<void> {
  const rows = await tx
    .update(apiKeys)
    .set({ revokedAt: input.now })
    .where(
      and(
        eq(apiKeys.userId, input.userId),
        isNull(apiKeys.revokedAt),
        gt(apiKeys.expiresAt, input.now),
      ),
    )
    .returning({ id: apiKeys.id });
  for (const row of rows) {
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'auth.api_key.revoked',
      targetType: 'api_key',
      targetId: row.id,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { reason: input.reason },
    });
  }
}
