import {
  createSpeciesBodySchema,
  idParamSchema,
  listSpeciesQuerySchema,
  speciesNameBodySchema,
  speciesTraitsQuerySchema,
  updateSpeciesBodySchema,
} from '@treerepro/contracts';
import { Hono } from 'hono';
import { userScopeOf, visibilityOf } from '../../../access/visibility.ts';
import type { AuthContext } from '../../../auth/context.ts';
import { addSpeciesName, createSpecies, updateSpecies } from '../../../dataset/catalog.ts';
import { speciesTraitSummary } from '../../../dataset/summary.ts';
import { getSpecies, searchSpecies } from '../../../dataset/taxa.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { currentPermissions, requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';
import { validate } from '../../validate.ts';
import { proposalRoutes } from './proposals.ts';

/**
 * The species routes, with the proposals router (RFC-75 R2, R3) mounted on
 * the literal `/proposals` segment **before** every `/:id` handler below, so
 * Hono can never read "proposals" as a species id.
 * @rfc RFC-60 R6, R7, R9, R10
 * @rfc RFC-63 R10
 * @rfc RFC-75 R2, R3
 */
export function speciesRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get(
      '/',
      requirePermission(ctx, 'dataset.read'),
      validate('query', listSpeciesQuerySchema),
      async (c) => {
        const q = c.req.valid('query');
        const visibility = await visibilityOf(ctx, c);
        const scope = await userScopeOf(ctx.db, c);
        const viewerPlotIds = scope.plots.map((p) => p.id);

        const { data, nextCursor } = await searchSpecies(ctx.db, visibility, {
          q: q.q,
          familyId: q.familyId,
          genusId: q.genusId,
          unresolved: q.unresolved === 'true',
          status: q.status,
          scope: q.scope,
          plotId: q.plotId,
          viewerPlotIds,
          categoryKey: q.categoryKey,
          traitId: q.traitId,
          traitData: q.traitData,
          sort: q.sort,
          cursor: q.cursor,
          limit: q.limit,
        });
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .post(
      '/',
      requirePermission(ctx, 'taxa.manage'),
      validate('json', createSpeciesBodySchema),
      async (c) =>
        c.json(
          {
            data: await createSpecies(ctx.db, {
              ...c.req.valid('json'),
              actorId: currentUser(c).id,
            }),
          },
          201,
        ),
    )
    .route('/proposals', proposalRoutes(ctx))
    .get(
      '/:id',
      requirePermission(ctx, 'dataset.read'),
      validate('param', idParamSchema),
      async (c) => {
        const visibility = await visibilityOf(ctx, c);
        const scope = await userScopeOf(ctx.db, c);
        const viewerPlotIds = scope.plots.map((p) => p.id);
        const allPlots = currentPermissions(c).has('plots.manage');

        const found = await getSpecies(ctx.db, visibility, c.req.valid('param').id, {
          viewerPlotIds,
          allPlots,
        });
        if (!found) throw new AppError('SPECIES_NOT_FOUND', 'Species not found');
        return c.json({ data: found });
      },
    )
    .patch(
      '/:id',
      requirePermission(ctx, 'taxa.manage'),
      validate('param', idParamSchema),
      validate('json', updateSpeciesBodySchema),
      async (c) =>
        c.json({
          data: await updateSpecies(ctx.db, {
            id: c.req.valid('param').id,
            ...c.req.valid('json'),
            actorId: currentUser(c).id,
          }),
        }),
    )
    .get(
      '/:id/traits',
      requirePermission(ctx, 'dataset.read'),
      validate('param', idParamSchema),
      validate('query', speciesTraitsQuerySchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const q = c.req.valid('query');
        const visibility = await visibilityOf(ctx, c);
        const summary = await speciesTraitSummary(ctx.db, visibility, id, {
          includeMissing: q.includeMissing === 'true',
        });
        if (!summary) throw new AppError('SPECIES_NOT_FOUND', 'Species not found');
        return c.json({ data: summary });
      },
    )
    .post(
      '/:id/names',
      requirePermission(ctx, 'taxa.manage'),
      validate('param', idParamSchema),
      validate('json', speciesNameBodySchema),
      async (c) =>
        c.json(
          {
            data: await addSpeciesName(ctx.db, {
              speciesId: c.req.valid('param').id,
              ...c.req.valid('json'),
              actorId: currentUser(c).id,
            }),
          },
          201,
        ),
    );
}
