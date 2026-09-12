import type { SessionSummary } from '@treerepro/contracts';
import { recordAudit } from '../../audit/audit.ts';
import type { UserRow } from '../../db/schema/users.ts';
import type { AuthContext, RequestMeta } from '../context.ts';
import type { SessionRecord } from '../sessions.ts';

/** @rfc RFC-22 R9 */
export async function logout(
  ctx: AuthContext,
  input: { user: UserRow; session: SessionRecord } & RequestMeta,
): Promise<void> {
  await ctx.sessions.revoke(input.session.id);
  await recordAudit(ctx.db, {
    actorUserId: input.user.id,
    action: 'auth.logout',
    targetType: 'user',
    targetId: input.user.id,
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

/** @rfc RFC-22 R9 */
export async function logoutAll(
  ctx: AuthContext,
  input: { user: UserRow } & RequestMeta,
): Promise<number> {
  const count = await ctx.sessions.revokeAll(input.user.id);
  await recordAudit(ctx.db, {
    actorUserId: input.user.id,
    action: 'auth.logout_all',
    targetType: 'user',
    targetId: input.user.id,
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: { count },
  });
  return count;
}

/** @rfc RFC-22 R11 */
export async function listSessions(
  ctx: AuthContext,
  user: UserRow,
  currentId: string,
): Promise<SessionSummary[]> {
  const records = await ctx.sessions.list(user.id);
  return records.map((s) => ({
    id: s.id,
    createdAt: new Date(s.createdAt).toISOString(),
    lastSeenAt: new Date(s.lastSeenAt).toISOString(),
    ip: s.ip,
    userAgent: s.userAgent,
    current: s.id === currentId,
  }));
}

/** Revokes one of the user's own sessions; false when `id` is not theirs. @rfc RFC-22 R11 */
export async function revokeOwnSession(
  ctx: AuthContext,
  input: { user: UserRow; id: string } & RequestMeta,
): Promise<boolean> {
  const owned = (await ctx.sessions.list(input.user.id)).some((s) => s.id === input.id);
  if (!owned) return false;
  await ctx.sessions.revoke(input.id);
  await recordAudit(ctx.db, {
    actorUserId: input.user.id,
    action: 'auth.session.revoked',
    targetType: 'session',
    targetId: input.id,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return true;
}
