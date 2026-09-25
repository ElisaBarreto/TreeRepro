import {
  createSpeciesBodySchema,
  idParamSchema,
  levelActionParamSchema,
  listSpeciesQuerySchema,
  speciesNameBodySchema,
  speciesTraitsQuerySchema,
  updateSpeciesBodySchema,
  validateLevelBodySchema,
} from '@treerepro/contracts';
import { Hono } from 'hono';
import { userScopeOf, visibilityOf } from '../../../access/visibility.ts';
import type { AuthContext } from '../../../auth/context.ts';
import { addSpeciesName, createSpecies, updateSpecies } from '../../../dataset/catalog.ts';
import { validateLevel, withdrawLevel } from '../../../dataset/curation.ts';
import { resolveSourceRef } from '../../../dataset/sources.ts';
import { speciesTraitSummary } from '../../../dataset/summary.ts';
import { getSpecies, searchSpecies } from '../../../dataset/taxa.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { forgetCachedBestEffort } from '../../invalidate-cache.ts';
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
 * @rfc RFC-65 R13, R14
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
          contested: q.contested === 'true',
          unknownLevels: q.unknownLevels === 'true',
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
    )
    .post(
      '/:id/traits/:traitId/levels/:levelId/validate',
      requirePermission(ctx, 'records.annotate'),
      validate('param', levelActionParamSchema),
      validate('json', validateLevelBodySchema),
      async (c) => {
        const { id, traitId, levelId } = c.req.valid('param');
        const body = c.req.valid('json');
        const actor = currentUser(c);
        const visibility = await visibilityOf(ctx, c);
        const referenceId = body.referenceSource
          ? await resolveSourceRef(
              { db: ctx.db, doi: ctx.doi },
              actor.id,
              body.referenceSource,
              'referenceSource',
            )
          : undefined;
        const data = await validateLevel(ctx.db, visibility, {
          speciesId: id,
          traitId,
          levelId,
          actorId: actor.id,
          referenceId,
        });
        await forgetCachedBestEffort(c.get('logger'), ctx.redis, `dashboard:${actor.id}`, {
          actorId: actor.id,
        });
        return c.json({ data }, 201);
      },
    )
    .post(
      '/:id/traits/:traitId/levels/:levelId/withdraw',
      requirePermission(ctx, 'records.review'),
      validate('param', levelActionParamSchema),
      async (c) => {
        const { id, traitId, levelId } = c.req.valid('param');
        const actor = currentUser(c);
        const permissions = currentPermissions(c);
        const visibility = await visibilityOf(ctx, c);
        const data = await withdrawLevel(ctx.db, visibility, {
          speciesId: id,
          traitId,
          levelId,
          actorId: actor.id,
          canWithdrawAny: permissions.has('records.withdraw'),
          canWithdrawImported: permissions.has('records.withdraw_imported'),
        });
        await forgetCachedBestEffort(c.get('logger'), ctx.redis, `dashboard:${actor.id}`, {
          actorId: actor.id,
        });
        return c.json({ data }, 201);
      },
    );
}
