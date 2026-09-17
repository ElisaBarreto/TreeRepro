import { cursorQuerySchema, idParamSchema, listImportsQuerySchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import type { AuthContext } from '../../../auth/context.ts';
import { getImportBatch, listImportBatches, listImportRejects } from '../../../dataset/import.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { validate } from '../../validate.ts';

const notFound = () => new AppError('IMPORT_NOT_FOUND', 'Import batch not found');

/**
 * @rfc RFC-64 R11
 * @rfc RFC-68 R7
 */
export function importRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get(
      '/',
      requirePermission(ctx, 'imports.read'),
      validate('query', listImportsQuerySchema),
      async (c) => {
        const q = c.req.valid('query');
        const { data, nextCursor } = await listImportBatches(ctx.db, {
          kind: q.kind,
          cursor: q.cursor,
          limit: q.limit,
        });
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .get(
      '/:id',
      requirePermission(ctx, 'imports.read'),
      validate('param', idParamSchema),
      async (c) => {
        const found = await getImportBatch(ctx.db, c.req.valid('param').id);
        if (!found) throw notFound();
        return c.json({ data: found });
      },
    )
    .get(
      '/:id/rejects',
      requirePermission(ctx, 'imports.read'),
      validate('param', idParamSchema),
      validate('query', cursorQuerySchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const q = c.req.valid('query');
        if (!(await getImportBatch(ctx.db, id))) throw notFound();
        const { data, nextCursor } = await listImportRejects(ctx.db, {
          batchId: id,
          cursor: q.cursor,
          limit: q.limit,
        });
        return c.json({ data, meta: { nextCursor } });
      },
    );
}
