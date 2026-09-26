import { and, eq, isNull } from 'drizzle-orm';
import { recordAudit } from '../../audit/audit.ts';
import { totpRecoveryCodes } from '../../db/schema/totp-recovery-codes.ts';
import type { UserRow } from '../../db/schema/users.ts';
import { AppError } from '../../http/errors.ts';
import { revokeAllApiKeys } from '../api-keys.ts';
import type { AuthContext, RequestMeta } from '../context.ts';
import { verifyPassword } from '../password.ts';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  totpUri,
  verifyTotpCode,
} from '../totp.ts';
import { updateTotp } from '../users.ts';

/** @rfc RFC-23 R2 */
export async function startTotpSetup(
  ctx: AuthContext,
  user: UserRow,
  password: string,
): Promise<{ secret: string; otpauthUri: string }> {
  if (user.totpEnabledAt !== null) {
    throw new AppError('AUTH_TOTP_ALREADY_ENABLED', 'Two-factor authentication is already enabled');
  }
  const verified =
    user.passwordHash !== null && (await verifyPassword(user.passwordHash, password));
  if (!verified) throw new AppError('AUTH_INVALID_CREDENTIALS', 'Password is incorrect');
  const secret = generateTotpSecret();
  await ctx.mfa.putSetupSecret(user.id, secret);
  return { secret, otpauthUri: totpUri(secret, user.email) };
}

/** @rfc RFC-23 R3, R5 */
export async function confirmTotpSetup(
  ctx: AuthContext,
  input: { user: UserRow; code: string } & RequestMeta,
): Promise<{ recoveryCodes: string[] }> {
  const secret = await ctx.mfa.getSetupSecret(input.user.id);
  const counter = secret ? verifyTotpCode(secret, input.code, ctx.now()) : null;
  if (!secret || counter === null || !(await ctx.mfa.claimTotpCounter(input.user.id, counter))) {
    throw new AppError('AUTH_TOTP_INVALID', 'Code is not valid');
  }
  const recoveryCodes = generateRecoveryCodes();
  const now = new Date(ctx.now());
  await ctx.db.transaction(async (tx) => {
    await updateTotp(tx, { id: input.user.id, secret, enabledAt: now, now });
    await tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, input.user.id));
    await tx.insert(totpRecoveryCodes).values(
      recoveryCodes.map((code) => ({
        userId: input.user.id,
        codeHash: hashRecoveryCode(code),
        createdAt: now,
      })),
    );
    await recordAudit(tx, {
      actorUserId: input.user.id,
      action: 'auth.totp.enabled',
      targetType: 'user',
      targetId: input.user.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  });
  await ctx.mfa.deleteSetupSecret(input.user.id);
  return { recoveryCodes };
}

/** @rfc RFC-23 R7, RFC-82 R3 */
export async function disableTotp(
  ctx: AuthContext,
  input: { user: UserRow; password: string; code?: string; recoveryCode?: string } & RequestMeta,
): Promise<void> {
  const { user } = input;
  if (user.totpEnabledAt === null || user.totpSecret === null) {
    throw new AppError('AUTH_TOTP_NOT_ENABLED', 'Two-factor authentication is not enabled');
  }
  const verified =
    user.passwordHash !== null && (await verifyPassword(user.passwordHash, input.password));
  if (!verified) throw new AppError('AUTH_INVALID_CREDENTIALS', 'Password is incorrect');
  const now = new Date(ctx.now());
  await ctx.db.transaction(async (tx) => {
    let ok = false;
    if (input.code !== undefined) {
      const counter = verifyTotpCode(user.totpSecret as string, input.code, ctx.now());
      ok = counter !== null && (await ctx.mfa.claimTotpCounter(user.id, counter));
    } else if (input.recoveryCode !== undefined) {
      const [row] = await tx
        .update(totpRecoveryCodes)
        .set({ usedAt: now })
        .where(
          and(
            eq(totpRecoveryCodes.userId, user.id),
            eq(totpRecoveryCodes.codeHash, hashRecoveryCode(input.recoveryCode)),
            isNull(totpRecoveryCodes.usedAt),
          ),
        )
        .returning({ id: totpRecoveryCodes.id });
      ok = row !== undefined;
    }
    if (!ok) throw new AppError('AUTH_TOTP_INVALID', 'Code is not valid');
    await updateTotp(tx, { id: user.id, secret: null, enabledAt: null, now });
    await tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, user.id));
    await recordAudit(tx, {
      actorUserId: user.id,
      action: 'auth.totp.disabled',
      targetType: 'user',
      targetId: user.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await revokeAllApiKeys(tx, {
      userId: user.id,
      actorUserId: user.id,
      reason: 'totp_disabled',
      now,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  });
}
