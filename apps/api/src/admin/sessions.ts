import type { SessionSummary } from '@treerepro/contracts';
import { recordAudit } from '../audit/audit.ts';
import { revokeAllApiKeys } from '../auth/api-keys.ts';
import type { AuthContext } from '../auth/context.ts';
import { listSessions } from '../auth/flows/session.ts';
import { findUserById } from '../auth/users.ts';
import type { UserRow } from '../db/schema/users.ts';
import { AppError } from '../http/errors.ts';
import type { AdminActor } from './users.ts';

async function requireUser(ctx: AuthContext, id: string): Promise<UserRow> {
  const user = await findUserById(ctx.db, id);
  if (!user) throw new AppError('USER_NOT_FOUND', 'User not found');
  return user;
}

/** RFC-22 R11 shape; no session is the administrator's, so `current` is false. @rfc RFC-50 R9 */
export async function listUserSessions(
  ctx: AuthContext,
  userId: string,
): Promise<SessionSummary[]> {
  const user = await requireUser(ctx, userId);
  return listSessions(ctx, user, '');
}

/** False when `sessionId` is not one of the user's sessions. @rfc RFC-50 R9 */
export async function revokeUserSession(
  ctx: AuthContext,
  input: AdminActor & { userId: string; sessionId: string },
): Promise<boolean> {
  await requireUser(ctx, input.userId);
  const owned = (await ctx.sessions.list(input.userId)).some((s) => s.id === input.sessionId);
  if (!owned) return false;
  await ctx.sessions.revoke(input.sessionId);
  await recordAudit(ctx.db, {
    actorUserId: input.actorUserId,
    action: 'sessions.revoked',
    targetType: 'session',
    targetId: input.sessionId,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return true;
}

/**
 * @rfc RFC-50 R9
 * @rfc RFC-82 R3
 */
export async function revokeAllUserSessions(
  ctx: AuthContext,
  input: AdminActor & { userId: string },
): Promise<number> {
  await requireUser(ctx, input.userId);
  // Database first, sessions after, as every other revoking flow: a failed
  // commit must not leave the sessions dead and the keys alive.
  const count = (await ctx.sessions.list(input.userId)).length;
  await ctx.db.transaction(async (tx) => {
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'sessions.revoked',
      targetType: 'user',
      targetId: input.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { count },
    });
    await revokeAllApiKeys(tx, {
      userId: input.userId,
      actorUserId: input.actorUserId,
      reason: 'sessions_revoked',
      now: new Date(ctx.now()),
      ip: input.ip,
      userAgent: input.userAgent,
    });
  });
  await ctx.sessions.revokeAll(input.userId);
  return count;
}
