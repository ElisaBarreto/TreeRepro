import { recordingRefusal, setUserRoles } from '../../access/roles.ts';
import { recordAudit } from '../../audit/audit.ts';
import type { UserRow } from '../../db/schema/users.ts';
import { AppError } from '../../http/errors.ts';
import { inviteEmail } from '../../mail/templates.ts';
import type { AuthContext, RequestMeta } from '../context.ts';
import { checkPasswordPolicy, hashPassword, passwordWeakError } from '../password.ts';
import { consumeToken, issueToken } from '../tokens.ts';
import { activateUser, createInvitedUser, findUserByEmail, UserEmailTakenError } from '../users.ts';

export interface InviteInput {
  email: string;
  name: string;
  /** Set as the user's roles in the same transaction (RFC-50 R3). */
  roleIds?: string[];
  /** Null for the seed command. */
  actorUserId: string | null;
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
 * @rfc RFC-50 R3
 * @rfc RFC-31 R14
 */
export async function inviteUser(
  ctx: AuthContext,
  input: InviteInput,
): Promise<{ user: UserRow; link: string; expiresAt: Date }> {
  const now = new Date(ctx.now());
  // `recordingRefusal` on the root connection, as in `updateUser`: a refused
  // role rolls the invitation back and its audit entry is written afterwards.
  const result = await recordingRefusal(ctx.db, () =>
    ctx.db.transaction(async (tx) => {
      const existing = await findUserByEmail(tx, input.email);
      if (existing && existing.status !== 'invited') throw new UserEmailTakenError();
      const user =
        existing ?? (await createInvitedUser(tx, { email: input.email, name: input.name, now }));
      const { raw, expiresAt } = await issueToken(tx, { userId: user.id, kind: 'invite', now });
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'auth.invite.created',
        targetType: 'user',
        targetId: user.id,
      });
      if (input.roleIds !== undefined) {
        await setUserRoles(
          { ...ctx, db: tx },
          { userId: user.id, roleIds: input.roleIds, actorUserId: input.actorUserId },
        );
      }
      return { user, raw, expiresAt };
    }),
  );
  // A cache fill that raced the commit would hold the old roles (RFC-32 R3).
  if (input.roleIds !== undefined) await ctx.permissionCache.invalidate([result.user.id]);
  const link = `${ctx.appOrigin}/invite/${result.raw}`;
  const mail = inviteEmail({
    name: result.user.name,
    link,
    expiresAt: result.expiresAt,
    appOrigin: ctx.appOrigin,
    contactEmail: ctx.inviteContactEmail,
  });
  try {
    await ctx.mailer.send({ to: result.user.email, ...mail });
  } catch (cause) {
    throw new InvitationMailError({ user: result.user, link, expiresAt: result.expiresAt, cause });
  }
  return { user: result.user, link, expiresAt: result.expiresAt };
}

/** @rfc RFC-20 R6 */
export async function acceptInvitation(
  ctx: AuthContext,
  input: { token: string; password: string } & RequestMeta,
): Promise<{ user: UserRow; sessionRawId: string }> {
  const weakness = await checkPasswordPolicy(input.password, ctx.breachChecker);
  if (weakness) throw passwordWeakError(weakness);
  const passwordHash = await hashPassword(input.password);
  const now = new Date(ctx.now());
  const user = await ctx.db.transaction(async (tx) => {
    const consumed = await consumeToken(tx, { raw: input.token, kind: 'invite', now });
    const activated = consumed
      ? await activateUser(tx, { id: consumed.userId, passwordHash, now })
      : null;
    if (!activated)
      throw new AppError('AUTH_TOKEN_INVALID', 'Invitation link is invalid or has expired');
    await recordAudit(tx, {
      actorUserId: activated.id,
      action: 'auth.invite.accepted',
      targetType: 'user',
      targetId: activated.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return activated;
  });
  const { rawId } = await ctx.sessions.create({
    userId: user.id,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { user, sessionRawId: rawId };
}
