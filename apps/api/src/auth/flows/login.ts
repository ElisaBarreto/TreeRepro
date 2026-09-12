import { and, eq, isNull } from 'drizzle-orm';
import { recordAudit } from '../../audit/audit.ts';
import { totpRecoveryCodes } from '../../db/schema/totp-recovery-codes.ts';
import type { UserRow } from '../../db/schema/users.ts';
import { AppError } from '../../http/errors.ts';
import type { AuthContext, RequestMeta } from '../context.ts';
import { dummyPasswordHash, verifyPassword } from '../password.ts';
import { hashRecoveryCode, verifyTotpCode } from '../totp.ts';
import { findUserByEmail, findUserById } from '../users.ts';

export type LoginFailureReason =
  | 'unknown_email'
  | 'wrong_password'
  | 'not_active'
  | 'suspended'
  | 'rate_limited';

export type LoginResult =
  | { status: 'ok'; user: UserRow; sessionRawId: string }
  | { status: 'totp_required'; mfaRawId: string };

/**
 * @rfc RFC-22 R2
 * @rfc RFC-24 R6
 */
export async function auditLoginFailure(
  ctx: AuthContext,
  input: { reason: LoginFailureReason; userId?: string } & RequestMeta,
): Promise<void> {
  await recordAudit(ctx.db, {
    actorUserId: null,
    action: 'auth.login.failure',
    targetType: input.userId ? 'user' : undefined,
    targetId: input.userId,
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: { reason: input.reason },
  });
}

const INVALID = () => new AppError('AUTH_INVALID_CREDENTIALS', 'Email or password is incorrect');

const canLogIn = (user: UserRow | null): user is UserRow & { passwordHash: string } =>
  user !== null &&
  user.passwordHash !== null &&
  (user.status === 'active' || user.status === 'suspended');

/**
 * @rfc RFC-22 R2, R3
 * @rfc RFC-21 R4
 */
export async function login(
  ctx: AuthContext,
  input: { email: string; password: string } & RequestMeta,
): Promise<LoginResult> {
  const user = await findUserByEmail(ctx.db, input.email);
  const loginable = canLogIn(user);
  const hash = loginable ? user.passwordHash : await dummyPasswordHash();
  const verified = await verifyPassword(hash, input.password);
  const meta = { ip: input.ip, userAgent: input.userAgent };

  if (!user) {
    await auditLoginFailure(ctx, { reason: 'unknown_email', ...meta });
    throw INVALID();
  }
  if (!loginable) {
    await auditLoginFailure(ctx, { reason: 'not_active', userId: user.id, ...meta });
    throw INVALID();
  }
  if (!verified) {
    await auditLoginFailure(ctx, { reason: 'wrong_password', userId: user.id, ...meta });
    throw INVALID();
  }
  if (user.status === 'suspended') {
    await auditLoginFailure(ctx, { reason: 'suspended', userId: user.id, ...meta });
    throw new AppError('AUTH_ACCOUNT_SUSPENDED', 'This account is suspended');
  }
  if (user.totpEnabledAt !== null) {
    const { rawId } = await ctx.mfa.createChallenge(user.id);
    return { status: 'totp_required', mfaRawId: rawId };
  }
  return { status: 'ok', ...(await openSession(ctx, user, meta)) };
}

async function openSession(
  ctx: AuthContext,
  user: UserRow,
  meta: RequestMeta,
  extraAudit?: 'auth.totp.recovery_used',
): Promise<{ user: UserRow; sessionRawId: string }> {
  const { rawId } = await ctx.sessions.create({
    userId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  await ctx.db.transaction(async (tx) => {
    await recordAudit(tx, {
      actorUserId: user.id,
      action: 'auth.login.success',
      targetType: 'user',
      targetId: user.id,
      ...meta,
    });
    if (extraAudit) {
      await recordAudit(tx, {
        actorUserId: user.id,
        action: extraAudit,
        targetType: 'user',
        targetId: user.id,
        ...meta,
      });
    }
  });
  return { user, sessionRawId: rawId };
}

const MFA_EXPIRED = () =>
  new AppError('AUTH_MFA_EXPIRED', 'Login challenge has expired; start again');

/** @rfc RFC-23 R4, R5, R6 */
export async function loginTotp(
  ctx: AuthContext,
  input: { mfaRawId: string | undefined; code?: string; recoveryCode?: string } & RequestMeta,
): Promise<{ user: UserRow; sessionRawId: string }> {
  if (!input.mfaRawId) throw MFA_EXPIRED();
  const challenge = await ctx.mfa.getChallenge(input.mfaRawId);
  if (!challenge) throw MFA_EXPIRED();
  const user = await findUserById(ctx.db, challenge.userId);
  if (user?.status !== 'active' || user.totpSecret === null) {
    await ctx.mfa.deleteChallenge(input.mfaRawId);
    throw MFA_EXPIRED();
  }
  const meta = { ip: input.ip, userAgent: input.userAgent };

  let usedRecovery = false;
  let ok = false;
  if (input.code !== undefined) {
    const counter = verifyTotpCode(user.totpSecret, input.code, ctx.now());
    ok = counter !== null && (await ctx.mfa.claimTotpCounter(user.id, counter));
  } else if (input.recoveryCode !== undefined) {
    const [row] = await ctx.db
      .update(totpRecoveryCodes)
      .set({ usedAt: new Date(ctx.now()) })
      .where(
        and(
          eq(totpRecoveryCodes.userId, user.id),
          eq(totpRecoveryCodes.codeHash, hashRecoveryCode(input.recoveryCode)),
          isNull(totpRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: totpRecoveryCodes.id });
    ok = row !== undefined;
    usedRecovery = ok;
  }

  if (!ok) {
    await recordAudit(ctx.db, {
      actorUserId: user.id,
      action: 'auth.login.totp_failure',
      targetType: 'user',
      targetId: user.id,
      ...meta,
    });
    const outcome = await ctx.mfa.recordFailure(input.mfaRawId);
    if (outcome === 'expired') throw MFA_EXPIRED();
    throw new AppError('AUTH_TOTP_INVALID', 'Code is not valid');
  }
  await ctx.mfa.deleteChallenge(input.mfaRawId);
  return openSession(ctx, user, meta, usedRecovery ? 'auth.totp.recovery_used' : undefined);
}
