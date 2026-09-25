import { contestParamSchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import { visibilityOf } from '../../../access/visibility.ts';
import type { AuthContext } from '../../../auth/context.ts';
import { resolveContest, withdrawContest } from '../../../dataset/contest-actions.ts';
import type { AppEnv } from '../../env.ts';
import { forgetCachedBestEffort } from '../../invalidate-cache.ts';
import { currentPermissions, requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';
import { validate } from '../../validate.ts';

/**
 * Keep both and Withdraw contest. Both answer 200 `{ data: null }`.
 * @rfc RFC-65 R15, R16
 * @rfc RFC-33 R5
 */
export function contestRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .post(
      '/:id/resolve',
      requirePermission(ctx, 'records.review'),
      validate('param', contestParamSchema),
      async (c) => {
        const actor = currentUser(c);
        const visibility = await visibilityOf(ctx, c);
        await resolveContest(ctx.db, visibility, {
          contestId: c.req.valid('param').id,
          actorId: actor.id,
        });
        await forgetCachedBestEffort(c.get('logger'), ctx.redis, `dashboard:${actor.id}`, {
          actorId: actor.id,
        });
        return c.json({ data: null }, 200);
      },
    )
    .post(
      '/:id/withdraw',
      requirePermission(ctx, 'records.annotate'),
      validate('param', contestParamSchema),
      async (c) => {
        const actor = currentUser(c);
        const visibility = await visibilityOf(ctx, c);
        await withdrawContest(ctx.db, visibility, {
          contestId: c.req.valid('param').id,
          actorId: actor.id,
          canWithdrawAny: currentPermissions(c).has('records.withdraw'),
        });
        await forgetCachedBestEffort(c.get('logger'), ctx.redis, `dashboard:${actor.id}`, {
          actorId: actor.id,
        });
        return c.json({ data: null }, 200);
      },
    );
}
