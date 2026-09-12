import { recordAudit } from '../../audit/audit.ts';
import type { UserRow } from '../../db/schema/users.ts';
import { AppError } from '../../http/errors.ts';
import { passwordResetEmail } from '../../mail/templates.ts';
import type { AuthContext, RequestMeta } from '../context.ts';
import {
  checkPasswordPolicy,
  hashPassword,
  passwordWeakError,
  verifyPassword,
} from '../password.ts';
import type { SessionRecord } from '../sessions.ts';
import { consumeToken, issueToken } from '../tokens.ts';
import { findUserByEmail, findUserById, updatePasswordHash } from '../users.ts';

/** Always resolves; the caller answers the same body either way. @rfc RFC-21 R5 */
export async function forgotPassword(
  ctx: AuthContext,
  input: { email: string } & RequestMeta,
): Promise<void> {
  const user = await findUserByEmail(ctx.db, input.email);
  if (user?.status !== 'active') return;
  const now = new Date(ctx.now());
  const { raw, expiresAt } = await ctx.db.transaction(async (tx) => {
    const issued = await issueToken(tx, { userId: user.id, kind: 'password_reset', now });
    await recordAudit(tx, {
      actorUserId: null,
      action: 'auth.password.reset_requested',
      targetType: 'user',
      targetId: user.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return issued;
  });
  const link = `${ctx.appOrigin}/reset-password/${raw}`;
  try {
    await ctx.mailer.send({
      to: user.email,
      ...passwordResetEmail({ name: user.name, link, expiresAt }),
    });
  } catch (err) {
    ctx.logger.error(
      { userId: user.id, err: { name: (err as Error).name, message: (err as Error).message } },
      'password reset email failed',
    );
  }
}

/** @rfc RFC-21 R6 */
export async function resetPassword(
  ctx: AuthContext,
  input: { token: string; newPassword: string } & RequestMeta,
): Promise<void> {
  const weakness = await checkPasswordPolicy(input.newPassword, ctx.breachChecker);
  if (weakness) throw passwordWeakError(weakness);
  const passwordHash = await hashPassword(input.newPassword);
  const now = new Date(ctx.now());
  const userId = await ctx.db.transaction(async (tx) => {
    const consumed = await consumeToken(tx, { raw: input.token, kind: 'password_reset', now });
    const user = consumed ? await findUserById(tx, consumed.userId) : null;
    if (user?.status !== 'active') {
      throw new AppError('AUTH_TOKEN_INVALID', 'Reset link is invalid or has expired');
    }
    await updatePasswordHash(tx, { id: user.id, passwordHash, now });
    await recordAudit(tx, {
      actorUserId: user.id,
      action: 'auth.password.reset',
      targetType: 'user',
      targetId: user.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return user.id;
  });
  await ctx.sessions.revokeAll(userId);
}

/** @rfc RFC-21 R7 */
export async function changePassword(
  ctx: AuthContext,
  input: {
    user: UserRow;
    session: SessionRecord;
    currentPassword: string;
    newPassword: string;
  } & RequestMeta,
): Promise<void> {
  const verified =
    input.user.passwordHash !== null &&
    (await verifyPassword(input.user.passwordHash, input.currentPassword));
  if (!verified) throw new AppError('AUTH_INVALID_CREDENTIALS', 'Current password is incorrect');
  const weakness = await checkPasswordPolicy(input.newPassword, ctx.breachChecker);
  if (weakness) throw passwordWeakError(weakness);
  const passwordHash = await hashPassword(input.newPassword);
  const now = new Date(ctx.now());
  await ctx.db.transaction(async (tx) => {
    await updatePasswordHash(tx, { id: input.user.id, passwordHash, now });
    await recordAudit(tx, {
      actorUserId: input.user.id,
      action: 'auth.password.changed',
      targetType: 'user',
      targetId: input.user.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  });
  await ctx.sessions.revokeAll(input.user.id, input.session.id);
}
