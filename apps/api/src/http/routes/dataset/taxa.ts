import { cursorQuerySchema, listGeneraQuerySchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import type { AuthContext } from '../../../auth/context.ts';
import { listFamilies, listGenera } from '../../../dataset/taxa.ts';
import type { AppEnv } from '../../env.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { validate } from '../../validate.ts';

/** @rfc RFC-60 R8 */
export function familyRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>().get(
    '/',
    requirePermission(ctx, 'dataset.read'),
    validate('query', cursorQuerySchema),
    async (c) => {
      const q = c.req.valid('query');
      const { data, nextCursor } = await listFamilies(ctx.db, { cursor: q.cursor, limit: q.limit });
      return c.json({ data, meta: { nextCursor } });
    },
  );
}

/** @rfc RFC-60 R8 */
export function genusRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>().get(
    '/',
    requirePermission(ctx, 'dataset.read'),
    validate('query', listGeneraQuerySchema),
    async (c) => {
      const q = c.req.valid('query');
      const { data, nextCursor } = await listGenera(ctx.db, {
        familyId: q.familyId,
        q: q.q,
        cursor: q.cursor,
        limit: q.limit,
      });
      return c.json({ data, meta: { nextCursor } });
    },
  );
}
