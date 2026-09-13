import { Hono } from 'hono';
import type { AuthContext } from '../../../auth/context.ts';
import { getDictionary } from '../../../dataset/dictionary.ts';
import type { AppEnv } from '../../env.ts';
import { requirePermission } from '../../middleware/require-permission.ts';

/** @rfc RFC-62 R5 */
export function traitRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>().get('/', requirePermission(ctx, 'dataset.read'), async (c) => {
    c.header('Cache-Control', 'private, max-age=300');
    return c.json({ data: await getDictionary(ctx.db) });
  });
}
