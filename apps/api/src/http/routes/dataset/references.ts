import {
  createReferenceBodySchema,
  idParamSchema,
  listReferencesQuerySchema,
  updateReferenceBodySchema,
} from '@treerepro/contracts';
import { Hono } from 'hono';
import type { AuthContext } from '../../../auth/context.ts';
import { createReference, updateReference } from '../../../dataset/catalog.ts';
import { getReference, searchReferences } from '../../../dataset/references.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';
import { validate } from '../../validate.ts';

/** @rfc RFC-61 R4, R6 */
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
    .post(
      '/',
      requirePermission(ctx, 'references.manage'),
      validate('json', createReferenceBodySchema),
      async (c) =>
        c.json(
          {
            data: await createReference(ctx.db, {
              ...c.req.valid('json'),
              actorId: currentUser(c).id,
            }),
          },
          201,
        ),
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
    )
    .patch(
      '/:id',
      requirePermission(ctx, 'references.manage'),
      validate('param', idParamSchema),
      validate('json', updateReferenceBodySchema),
      async (c) =>
        c.json({
          data: await updateReference(ctx.db, {
            id: c.req.valid('param').id,
            ...c.req.valid('json'),
            actorId: currentUser(c).id,
          }),
        }),
    );
}
