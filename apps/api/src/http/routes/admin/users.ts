import {
  createUserBodySchema,
  listContributionsQuerySchema,
  listUsersQuerySchema,
  setUserPlotsBodySchema,
  updateUserBodySchema,
  userIdParamSchema,
} from '@treerepro/contracts';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { visibilityOf } from '../../../access/visibility.ts';
import {
  listUserSessions,
  revokeAllUserSessions,
  revokeUserSession,
} from '../../../admin/sessions.ts';
import {
  type AdminActor,
  getUser,
  listUsers,
  reactivateUser,
  resendInvite,
  setUserPlots,
  suspendUser,
  updateUser,
} from '../../../admin/users.ts';
import type { AuthContext } from '../../../auth/context.ts';
import { InvitationMailError, inviteUser } from '../../../auth/flows/invitation.ts';
import { UserEmailTakenError } from '../../../auth/users.ts';
import { contributionSummary, listContributions } from '../../../dataset/contributions.ts';
import { forgetCached } from '../../../redis/cache.ts';
import { clientIp, userAgent } from '../../client-ip.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';
import { validate } from '../../validate.ts';

const sessionParamSchema = userIdParamSchema.extend({
  sessionId: z.string().regex(/^[0-9a-f]{64}$/),
});

const actor = (c: Context<AppEnv>): AdminActor => ({
  actorUserId: currentUser(c).id,
  ip: clientIp(c),
  userAgent: userAgent(c),
});

/** Maps the invitation flow's domain errors to their codes. @rfc RFC-50 R3, R8 */
async function inviting<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UserEmailTakenError)
      throw new AppError('USER_EMAIL_TAKEN', 'Another account already uses this email');
    if (err instanceof InvitationMailError)
      throw new AppError(
        'MAIL_SEND_FAILED',
        'The invitation email could not be sent; re-send the invitation',
      );
    throw err;
  }
}

/**
 * Answers 404 for a user id nobody holds, so the per-user reads never look
 * like an empty contribution list.
 * @rfc RFC-50 R4
 */
async function requireUserId(ctx: AuthContext, id: string): Promise<string> {
  const user = await getUser(ctx.db, id);
  if (!user) throw new AppError('USER_NOT_FOUND', 'User not found');
  return user.id;
}

/**
 * @rfc RFC-50 R2-R9
 * @rfc RFC-71 R5
 */
export function adminUserRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get(
      '/',
      requirePermission(ctx, 'users.read'),
      validate('query', listUsersQuerySchema),
      async (c) => {
        const { status, cursor, limit } = c.req.valid('query');
        const { data, nextCursor } = await listUsers(ctx.db, { status, cursor, limit });
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .post(
      '/',
      requirePermission(ctx, 'users.invite'),
      validate('json', createUserBodySchema),
      async (c) => {
        const body = c.req.valid('json');
        const { user } = await inviting(() =>
          inviteUser(ctx, { ...body, actorUserId: currentUser(c).id }),
        );
        return c.json({ data: await getUser(ctx.db, user.id) }, 201);
      },
    )
    .get(
      '/:id',
      requirePermission(ctx, 'users.read'),
      validate('param', userIdParamSchema),
      async (c) => {
        const user = await getUser(ctx.db, c.req.valid('param').id);
        if (!user) throw new AppError('USER_NOT_FOUND', 'User not found');
        return c.json({ data: user });
      },
    )
    .patch(
      '/:id',
      requirePermission(ctx, 'users.update'),
      validate('param', userIdParamSchema),
      validate('json', updateUserBodySchema),
      async (c) => {
        const { name, roles } = c.req.valid('json');
        const data = await updateUser(ctx, {
          ...actor(c),
          id: c.req.valid('param').id,
          name,
          roleIds: roles,
        });
        return c.json({ data });
      },
    )
    .put(
      '/:id/plots',
      requirePermission(ctx, 'users.update'),
      validate('param', userIdParamSchema),
      validate('json', setUserPlotsBodySchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const { plotIds, restrictToAssignedPlots } = c.req.valid('json');
        const data = await setUserPlots(ctx, {
          ...actor(c),
          userId: id,
          plotIds,
          restrictToAssignedPlots,
        });
        // After the transaction, never inside the service: the target
        // user's own dashboard answers over the plots that just changed,
        // not the ones cached from before (RFC-72 R1). The target's key,
        // not the acting admin's — it is the target's `scope` that changed.
        await forgetCached(ctx.redis, `dashboard:${id}`);
        return c.json({ data });
      },
    )
    .post(
      '/:id/suspend',
      requirePermission(ctx, 'users.suspend'),
      validate('param', userIdParamSchema),
      async (c) =>
        c.json({ data: await suspendUser(ctx, { ...actor(c), id: c.req.valid('param').id }) }),
    )
    .post(
      '/:id/reactivate',
      requirePermission(ctx, 'users.suspend'),
      validate('param', userIdParamSchema),
      async (c) =>
        c.json({ data: await reactivateUser(ctx, { ...actor(c), id: c.req.valid('param').id }) }),
    )
    .post(
      '/:id/resend-invite',
      requirePermission(ctx, 'users.invite'),
      validate('param', userIdParamSchema),
      async (c) =>
        c.json({
          data: await inviting(() =>
            resendInvite(ctx, { ...actor(c), id: c.req.valid('param').id }),
          ),
        }),
    )
    .get(
      '/:id/contributions',
      requirePermission(ctx, 'contributions.read'),
      validate('param', userIdParamSchema),
      validate('query', listContributionsQuerySchema),
      async (c) => {
        const userId = await requireUserId(ctx, c.req.valid('param').id);
        // RFC-71 R5: the viewer's own visibility, never the target user's.
        const { data, nextCursor } = await listContributions(
          ctx.db,
          await visibilityOf(ctx, c),
          userId,
          c.req.valid('query'),
        );
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .get(
      '/:id/contributions/summary',
      requirePermission(ctx, 'contributions.read'),
      validate('param', userIdParamSchema),
      async (c) => {
        const userId = await requireUserId(ctx, c.req.valid('param').id);
        return c.json({ data: await contributionSummary(ctx.db, userId) });
      },
    )
    .get(
      '/:id/sessions',
      requirePermission(ctx, 'sessions.read'),
      validate('param', userIdParamSchema),
      async (c) => c.json({ data: await listUserSessions(ctx, c.req.valid('param').id) }),
    )
    .delete(
      '/:id/sessions',
      requirePermission(ctx, 'sessions.revoke'),
      validate('param', userIdParamSchema),
      async (c) => {
        await revokeAllUserSessions(ctx, { ...actor(c), userId: c.req.valid('param').id });
        return c.json({ data: { status: 'ok' as const } });
      },
    )
    .delete(
      '/:id/sessions/:sessionId',
      requirePermission(ctx, 'sessions.revoke'),
      validate('param', sessionParamSchema),
      async (c) => {
        const { id, sessionId } = c.req.valid('param');
        const revoked = await revokeUserSession(ctx, { ...actor(c), userId: id, sessionId });
        if (!revoked) throw new AppError('NOT_FOUND', 'Session not found');
        return c.json({ data: { status: 'ok' as const } });
      },
    );
}
