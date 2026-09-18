import { listContributionsQuerySchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import { visibilityOf } from '../../access/visibility.ts';
import type { AuthContext } from '../../auth/context.ts';
import { contributionSummary, listContributions } from '../../dataset/contributions.ts';
import type { AppEnv } from '../env.ts';
import { requirePermission } from '../middleware/require-permission.ts';
import { currentUser } from '../middleware/session.ts';
import { validate } from '../validate.ts';

/**
 * Mounted on `/me` beside `meRoutes`: these two need `dataset.read`,
 * which is what makes them contributions and not self-service (RFC-32 R5).
 * @rfc RFC-71 R1, R2, R3, R4
 * @rfc RFC-33 R2, R3
 */
export function contributionRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get(
      '/contributions',
      requirePermission(ctx, 'dataset.read'),
      validate('query', listContributionsQuerySchema),
      async (c) => {
        const { data, nextCursor } = await listContributions(
          ctx.db,
          await visibilityOf(ctx, c),
          currentUser(c).id,
          c.req.valid('query'),
        );
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .get('/contributions/summary', requirePermission(ctx, 'dataset.read'), async (c) =>
      c.json({ data: await contributionSummary(ctx.db, currentUser(c).id) }),
    );
}
