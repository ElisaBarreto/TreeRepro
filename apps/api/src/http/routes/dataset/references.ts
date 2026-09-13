import { idParamSchema, listReferencesQuerySchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import type { AuthContext } from '../../../auth/context.ts';
import { getReference, searchReferences } from '../../../dataset/references.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { validate } from '../../validate.ts';

/** @rfc RFC-61 R4 */
export function referenceRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get(
      '/',
      requirePermission(ctx, 'dataset.read'),
      validate('query', listReferencesQuerySchema),
      async (c) => {
        const q = c.req.valid('query');
        const { data, nextCursor } = await searchReferences(ctx.db, {
          q: q.q,
          cursor: q.cursor,
          limit: q.limit,
        });
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .get(
      '/:id',
      requirePermission(ctx, 'dataset.read'),
      validate('param', idParamSchema),
      async (c) => {
        const found = await getReference(ctx.db, c.req.valid('param').id);
        if (!found) throw new AppError('REFERENCE_NOT_FOUND', 'Reference not found');
        return c.json({ data: found });
      },
    );
}
