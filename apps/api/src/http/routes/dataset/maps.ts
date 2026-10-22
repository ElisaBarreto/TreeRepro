import { mapValuesQuerySchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import { visibilityOf } from '../../../access/visibility.ts';
import type { AuthContext } from '../../../auth/context.ts';
import { listMaps, mapValues } from '../../../maps/regions.ts';
import type { AppEnv } from '../../env.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { validate } from '../../validate.ts';

/**
 * The trait maps, computed from the weekly region snapshot: the list a viewer
 * may see, and one map's regions and legend.
 * @rfc RFC-76 R5, R6
 */
export function mapRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get('/', requirePermission(ctx, 'dataset.read'), async (c) => {
      const visibility = await visibilityOf(ctx, c);
      return c.json({ data: await listMaps(ctx.db, visibility) });
    })
    .get(
      '/values',
      requirePermission(ctx, 'dataset.read'),
      validate('query', mapValuesQuerySchema),
      async (c) => {
        const visibility = await visibilityOf(ctx, c);
        return c.json({ data: await mapValues(ctx.db, visibility, c.req.valid('query')) });
      },
    );
}
