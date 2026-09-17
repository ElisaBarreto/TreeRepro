import {
  createGenusBodySchema,
  cursorQuerySchema,
  familyBodySchema,
  idParamSchema,
  listGeneraQuerySchema,
  updateGenusBodySchema,
} from '@treerepro/contracts';
import { Hono } from 'hono';
import { visibilityOf } from '../../../access/visibility.ts';
import type { AuthContext } from '../../../auth/context.ts';
import { createFamily, createGenus, updateFamily, updateGenus } from '../../../dataset/catalog.ts';
import { listFamilies, listGenera } from '../../../dataset/taxa.ts';
import type { AppEnv } from '../../env.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';
import { validate } from '../../validate.ts';

/** @rfc RFC-60 R8, R9 */
export function familyRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get(
      '/',
      requirePermission(ctx, 'dataset.read'),
      validate('query', cursorQuerySchema),
      async (c) => {
        const q = c.req.valid('query');
        const visibility = await visibilityOf(ctx, c);
        const { data, nextCursor } = await listFamilies(ctx.db, visibility, {
          cursor: q.cursor,
          limit: q.limit,
        });
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .post(
      '/',
      requirePermission(ctx, 'taxa.manage'),
      validate('json', familyBodySchema),
      async (c) =>
        c.json(
          {
            data: await createFamily(ctx.db, {
              ...c.req.valid('json'),
              actorId: currentUser(c).id,
            }),
          },
          201,
        ),
    )
    .patch(
      '/:id',
      requirePermission(ctx, 'taxa.manage'),
      validate('param', idParamSchema),
      validate('json', familyBodySchema),
      async (c) =>
        c.json({
          data: await updateFamily(ctx.db, {
            id: c.req.valid('param').id,
            ...c.req.valid('json'),
            actorId: currentUser(c).id,
          }),
        }),
    );
}

/** @rfc RFC-60 R8, R9 */
export function genusRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get(
      '/',
      requirePermission(ctx, 'dataset.read'),
      validate('query', listGeneraQuerySchema),
      async (c) => {
        const q = c.req.valid('query');
        const visibility = await visibilityOf(ctx, c);
        const { data, nextCursor } = await listGenera(ctx.db, visibility, {
          familyId: q.familyId,
          q: q.q,
          cursor: q.cursor,
          limit: q.limit,
        });
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .post(
      '/',
      requirePermission(ctx, 'taxa.manage'),
      validate('json', createGenusBodySchema),
      async (c) =>
        c.json(
          {
            data: await createGenus(ctx.db, { ...c.req.valid('json'), actorId: currentUser(c).id }),
          },
          201,
        ),
    )
    .patch(
      '/:id',
      requirePermission(ctx, 'taxa.manage'),
      validate('param', idParamSchema),
      validate('json', updateGenusBodySchema),
      async (c) =>
        c.json({
          data: await updateGenus(ctx.db, {
            id: c.req.valid('param').id,
            ...c.req.valid('json'),
            actorId: currentUser(c).id,
          }),
        }),
    );
}
