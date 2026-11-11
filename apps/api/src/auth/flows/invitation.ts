import type { Platform } from '@treerepro/contracts';
import { recordingRefusal, setUserRoles } from '../../access/roles.ts';
import { recordAudit } from '../../audit/audit.ts';
import { ConfigError } from '../../config.ts';
import type { UserRow } from '../../db/schema/users.ts';
import { AppError } from '../../http/errors.ts';
import { inviteEmail } from '../../mail/templates.ts';
import type { AuthContext, RequestMeta } from '../context.ts';
import { checkPasswordPolicy, hashPassword, passwordWeakError } from '../password.ts';
import { assertHoldsPlatform, PlatformDeniedError, platformsHeld } from '../platform-access.ts';
import { consumeToken, issueToken } from '../tokens.ts';
import { activateUser, createInvitedUser, findUserByEmail, UserEmailTakenError } from '../users.ts';
import { auditPlatformDenied } from './login.ts';

export interface InviteInput {
  email: string;
  name: string;
  /** Set as a new user's roles in the same transaction; a re-invite keeps the roles (RFC-50 R3). */
  roleIds?: string[];
  /** Null for the seed command. */
  actorUserId: string | null;
  /** The link goes to this platform's origin (RFC-14 R4). */
  platform: Platform;
}

/**
 * The invitation exists; only the email failed. Carries what the caller
 * needs to retry or hand the link over.
 * @rfc RFC-20 R4
 */
export class InvitationMailError extends Error {
  readonly user: UserRow;
  readonly link: string;
  readonly expiresAt: Date;

  constructor(input: { user: UserRow; link: string; expiresAt: Date; cause: unknown }) {
    super('Invitation email could not be sent', { cause: input.cause });
    this.name = 'InvitationMailError';
    this.user = input.user;
    this.link = input.link;
    this.expiresAt = input.expiresAt;
  }
}

/**
 * @rfc RFC-20 R4, R7
 * @rfc RFC-14 R4
 * @rfc RFC-50 R3
 * @rfc RFC-31 R14
 */
export async function inviteUser(
  ctx: AuthContext,
  input: InviteInput,
): Promise<{ user: UserRow; link: string; expiresAt: Date }> {
  const now = new Date(ctx.now());
  // RFC-14 R3: a platform with no host cannot be linked to; refuse before writing.
  let origin: string;
  try {
    origin = ctx.originOf(input.platform);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    throw new AppError('VALIDATION_FAILED', 'This platform has no host configured', [
      { path: 'platform', message: input.platform },
    ]);
  }
  // `recordingRefusal` on the root connection, as in `updateUser`: a refused
  // role rolls the invitation back and its audit entry is written afterwards.
  const result = await recordingRefusal(ctx.db, () =>
    ctx.db.transaction(async (tx) => {
      const existing = await findUserByEmail(tx, input.email);
      if (existing && existing.status !== 'invited') throw new UserEmailTakenError();
      const user =
        existing ?? (await createInvitedUser(tx, { email: input.email, name: input.name, now }));
      const { raw, expiresAt } = await issueToken(tx, {
        userId: user.id,
        kind: 'invite',
        now,
        platform: input.platform,
      });
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'auth.invite.created',
        targetType: 'user',
        targetId: user.id,
      });
      // A re-invite only re-issues the link; roles change through RFC-50 R5.
      if (input.roleIds !== undefined && !existing) {
        await setUserRoles(
          { ...ctx, db: tx },
          {
            userId: user.id,
            platform: input.platform,
            roleIds: input.roleIds,
            actorUserId: input.actorUserId,
          },
        );
      }
      return { user, raw, expiresAt };
    }),
  );
  const link = `${origin}/invite/${result.raw}`;
  const mail = inviteEmail({
    name: result.user.name,
    link,
    expiresAt: result.expiresAt,
    appOrigin: origin,
    contactEmail: ctx.inviteContactEmail,
  });
  try {
    await ctx.mailer.send({ to: result.user.email, ...mail });
  } catch (cause) {
    throw new InvitationMailError({ user: result.user, link, expiresAt: result.expiresAt, cause });
  }
  return { user: result.user, link, expiresAt: result.expiresAt };
}

/**
 * Refused (RFC-22 R13) on the other platform than the invitation's, or for a
 * user with no role on the request's platform, inside the transaction so
 * the invitation is not spent.
 * @rfc RFC-20 R6
 * @rfc RFC-22 R13
 * @rfc RFC-14 R5
 */
export async function acceptInvitation(
  ctx: AuthContext,
  input: { token: string; password: string; platform: Platform } & RequestMeta,
): Promise<{ user: UserRow; sessionRawId: string }> {
  const weakness = await checkPasswordPolicy(input.password, ctx.breachChecker);
  if (weakness) throw passwordWeakError(weakness);
  const passwordHash = await hashPassword(input.password);
  const now = new Date(ctx.now());
  const meta = { ip: input.ip, userAgent: input.userAgent };
  const user = await refusingPlatform(ctx, meta, () =>
    ctx.db.transaction(async (tx) => {
      const consumed = await consumeToken(tx, { raw: input.token, kind: 'invite', now });
      const activated = consumed
        ? await activateUser(tx, { id: consumed.userId, passwordHash, now })
        : null;
      if (!activated || !consumed)
        throw new AppError('AUTH_TOKEN_INVALID', 'Invitation link is invalid or has expired');
      if (consumed.platform !== input.platform)
        throw new PlatformDeniedError({
          userId: activated.id,
          platform: input.platform,
          reason: 'other_platform',
          held: await platformsHeld(tx, activated.id),
        });
      await assertHoldsPlatform(tx, activated.id, input.platform);
      await recordAudit(tx, {
        actorUserId: activated.id,
        action: 'auth.invite.accepted',
        targetType: 'user',
        targetId: activated.id,
        ip: input.ip,
        userAgent: input.userAgent,
      });
      return activated;
    }),
  );
  const { rawId } = await ctx.sessions.create({
    userId: user.id,
    ip: input.ip,
    userAgent: input.userAgent,
    platform: input.platform,
  });
  return { user, sessionRawId: rawId };
}

/** Audits a platform refusal after its transaction rolled back. @rfc RFC-22 R13 */
async function refusingPlatform<T>(
  ctx: AuthContext,
  meta: RequestMeta,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PlatformDeniedError) await auditPlatformDenied(ctx.db, err, meta);
    throw err;
  }
}
