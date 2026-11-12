import { plantTypeQueueQuerySchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import { visibilityOf } from '../../../access/visibility.ts';
import type { AuthContext } from '../../../auth/context.ts';
import { listPlantTypeQueue } from '../../../dataset/queues.ts';
import type { AppEnv } from '../../env.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { validate } from '../../validate.ts';

/**
 * `GET /api/curation/plant-types`: the plant-type review queue, the same on
 * both platforms (RFC-65 R20, RFC-33 R11).
 * @rfc RFC-65 R20
 */
export function curationRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>().get(
    '/plant-types',
    requirePermission(ctx, 'records.review'),
    validate('query', plantTypeQueueQuerySchema),
    async (c) => {
      const { data, nextCursor } = await listPlantTypeQueue(
        ctx.db,
        await visibilityOf(ctx, c),
        c.req.valid('query'),
      );
      return c.json({ data, meta: { nextCursor } });
    },
  );
}
