import {
  createLevelBodySchema,
  createTraitBodySchema,
  idParamSchema,
  listTraitSpeciesQuerySchema,
  listTraitsQuerySchema,
  traitLevelParamSchema,
  updateLevelBodySchema,
  updateTraitBodySchema,
} from '@treerepro/contracts';
import { Hono } from 'hono';
import { userScopeOf, visibilityOf } from '../../../access/visibility.ts';
import type { AuthContext } from '../../../auth/context.ts';
import { createLevel, createTrait, updateLevel, updateTrait } from '../../../dataset/catalog.ts';
import { getDictionary } from '../../../dataset/dictionary.ts';
import { getTraitDetail, listTraitSpecies } from '../../../dataset/trait-page.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';
import { validate } from '../../validate.ts';

/**
 * @rfc RFC-62 R5, R6, R7, R8
 * @rfc RFC-33 R2, R3, R6
 */
export function traitRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get(
      '/',
      requirePermission(ctx, 'dataset.read'),
      validate('query', listTraitsQuerySchema),
      async (c) => {
        const visibility = await visibilityOf(ctx, c);
        const filters = c.req.valid('query');
        return c.json({
          data: await getDictionary({ db: ctx.db, redis: ctx.redis }, visibility, filters),
        });
      },
    )
    .get(
      '/:id',
      requirePermission(ctx, 'dataset.read'),
      validate('param', idParamSchema),
      async (c) => {
        const visibility = await visibilityOf(ctx, c);
        const detail = await getTraitDetail(
          { db: ctx.db, redis: ctx.redis },
          visibility,
          c.req.valid('param').id,
        );
        if (!detail) throw new AppError('TRAIT_NOT_FOUND', 'Trait not found');
        return c.json({ data: detail });
      },
    )
    .get(
      '/:id/species',
      requirePermission(ctx, 'dataset.read'),
      validate('param', idParamSchema),
      validate('query', listTraitSpeciesQuerySchema),
      async (c) => {
        const q = c.req.valid('query');
        const visibility = await visibilityOf(ctx, c);
        const scope = await userScopeOf(ctx.db, c);
        const { data, nextCursor } = await listTraitSpecies(
          ctx.db,
          visibility,
          c.req.valid('param').id,
          {
            // The page the trait link opens on is the one with data.
            mode: q.mode ?? 'with',
            q: q.q,
            familyId: q.familyId,
            genusId: q.genusId,
            scope: q.scope,
            plotId: q.plotId,
            viewerPlotIds: scope.plots.map((p) => p.id),
            cursor: q.cursor,
            limit: q.limit,
          },
        );
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .post(
      '/',
      requirePermission(ctx, 'traits.manage'),
      validate('json', createTraitBodySchema),
      async (c) =>
        c.json(
          {
            data: await createTrait(ctx.db, { ...c.req.valid('json'), actorId: currentUser(c).id }),
          },
          201,
        ),
    )
    .patch(
      '/:id',
      requirePermission(ctx, 'traits.manage'),
      validate('param', idParamSchema),
      validate('json', updateTraitBodySchema),
      async (c) =>
        c.json({
          data: await updateTrait(ctx.db, {
            id: c.req.valid('param').id,
            ...c.req.valid('json'),
            actorId: currentUser(c).id,
          }),
        }),
    )
    .post(
      '/:id/levels',
      requirePermission(ctx, 'traits.manage'),
      validate('param', idParamSchema),
      validate('json', createLevelBodySchema),
      async (c) =>
        c.json(
          {
            data: await createLevel(ctx.db, {
              traitId: c.req.valid('param').id,
              ...c.req.valid('json'),
              actorId: currentUser(c).id,
            }),
          },
          201,
        ),
    )
    .patch(
      '/:id/levels/:levelId',
      requirePermission(ctx, 'traits.manage'),
      validate('param', traitLevelParamSchema),
      validate('json', updateLevelBodySchema),
      async (c) => {
        const { id, levelId } = c.req.valid('param');
        return c.json({
          data: await updateLevel(ctx.db, {
            traitId: id,
            levelId,
            ...c.req.valid('json'),
            actorId: currentUser(c).id,
          }),
        });
      },
    );
}
