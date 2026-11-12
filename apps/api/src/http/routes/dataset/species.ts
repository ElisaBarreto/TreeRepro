import {
  changePlantTypeBodySchema,
  confirmPlantTypeBodySchema,
  countSpeciesQuerySchema,
  createSpeciesBodySchema,
  idParamSchema,
  levelActionParamSchema,
  listSpeciesQuerySchema,
  speciesNameBodySchema,
  speciesTraitsQuerySchema,
  type TreeFlag,
  treeFlagCountsQuerySchema,
  updateSpeciesBodySchema,
  validateLevelBodySchema,
} from '@treerepro/contracts';
import { Hono } from 'hono';
import type { z } from 'zod';
import { userScopeOf, visibilityOf } from '../../../access/visibility.ts';
import type { AuthContext } from '../../../auth/context.ts';
import {
  addSpeciesName,
  changePlantType,
  confirmPlantType,
  createSpecies,
  plantTypeFor,
  updateSpecies,
} from '../../../dataset/catalog.ts';
import { validateLevel, withdrawLevel } from '../../../dataset/curation.ts';
import { resolveSourceRef } from '../../../dataset/sources.ts';
import { speciesTraitSummary } from '../../../dataset/summary.ts';
import {
  countSpecies,
  getSpecies,
  listWcvpRegions,
  type SpeciesListFilters,
  searchSpecies,
  treeFlagCounts,
} from '../../../dataset/taxa.ts';
import { dashboardKeys } from '../../../workspace/dashboard.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { forgetCachedBestEffort } from '../../invalidate-cache.ts';
import { currentPermissions, requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';
import { validate } from '../../validate.ts';
import { proposalRoutes } from './proposals.ts';

/**
 * The search filters of a species query (RFC-60 R6), shared by the list, its
 * count (R12) and the tree basis counts (R11), whose query has no `treeFlag`.
 * @rfc RFC-60 R6, R11, R12
 */
function filtersOf(
  q: z.infer<typeof treeFlagCountsQuerySchema> & { treeFlag?: TreeFlag[] },
  viewerPlotIds: string[],
): SpeciesListFilters {
  return {
    q: q.q,
    familyId: q.familyId,
    genusId: q.genusId,
    unresolved: q.unresolved === 'true',
    contested: q.contested === 'true',
    unknownLevels: q.unknownLevels === 'true',
    outliers: q.outliers === 'true',
    status: q.status,
    scope: q.scope,
    plotId: q.plotId,
    viewerPlotIds,
    categoryKey: q.categoryKey,
    traitId: q.traitId,
    traitData: q.traitData,
    treeFlags: q.treeFlag,
    plantType: q.plantType,
    continents: q.continent,
    regions: q.region,
    areas: q.area,
    introduced: q.introduced === 'true',
  };
}

/**
 * The species routes, with the proposals router (RFC-75 R2, R3) mounted on
 * the literal `/proposals` segment **before** every `/:id` handler below, so
 * Hono can never read "proposals" as a species id.
 * @rfc RFC-60 R6, R7, R9, R10, R11, R12, R14
 * @rfc RFC-63 R10
 * @rfc RFC-65 R13, R14, R18, R19, R20
 * @rfc RFC-75 R2, R3
 */
export function speciesRoutes(ctx: AuthContext) {
  return (
    new Hono<AppEnv>()
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
            ...filtersOf(q, viewerPlotIds),
            sort: q.sort,
            order: q.order,
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
        async (c) => {
          const { plantType, ...body } = c.req.valid('json');
          const data = await createSpecies(ctx.db, {
            ...body,
            // RFC-65 R18: the platform fixes or requires the type; the creator's review decides the status.
            plantType: plantTypeFor(c.get('platform'), plantType),
            plantTypeStatus: currentPermissions(c).has('records.review') ? 'reviewed' : 'proposed',
            platform: c.get('platform'),
            actorId: currentUser(c).id,
          });
          return c.json({ data }, 201);
        },
      )
      .route('/proposals', proposalRoutes(ctx))
      // RFC-60 R12: the list's filters, counted; a literal segment, before `/:id`.
      .get(
        '/count',
        requirePermission(ctx, 'dataset.read'),
        validate('query', countSpeciesQuerySchema),
        async (c) => {
          const q = c.req.valid('query');
          const scope = await userScopeOf(ctx.db, c);
          const count = await countSpecies(
            ctx.db,
            await visibilityOf(ctx, c),
            filtersOf(
              q,
              scope.plots.map((p) => p.id),
            ),
          );
          return c.json({ data: { count } });
        },
      )
      // RFC-60 R11: a literal segment, so it is registered before `/:id`.
      .get(
        '/tree-flags',
        requirePermission(ctx, 'dataset.read'),
        validate('query', treeFlagCountsQuerySchema),
        async (c) => {
          const scope = await userScopeOf(ctx.db, c);
          const filters = filtersOf(
            c.req.valid('query'),
            scope.plots.map((p) => p.id),
          );
          return c.json({
            data: await treeFlagCounts(ctx.db, await visibilityOf(ctx, c), filters),
          });
        },
      )
      // RFC-60 R14: reference geography, the same for every viewer; before `/:id`.
      .get('/regions', requirePermission(ctx, 'dataset.read'), async (c) =>
        c.json({ data: await listWcvpRegions(ctx.db) }),
      )
      .get(
        '/:id',
        requirePermission(ctx, 'dataset.read'),
        validate('param', idParamSchema),
        async (c) => {
          const visibility = await visibilityOf(ctx, c);
          const scope = await userScopeOf(ctx.db, c);
          const viewerPlotIds = scope.plots.map((p) => p.id);

          const found = await getSpecies(ctx.db, visibility, c.req.valid('param').id, {
            viewerPlotIds,
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
              platform: c.get('platform'),
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
            missingOnly: q.missingOnly === 'true',
          });
          if (!summary) throw new AppError('SPECIES_NOT_FOUND', 'Species not found');
          return c.json({ data: summary });
        },
      )
      .post(
        '/:id/plant-type',
        requirePermission(ctx, 'records.review'),
        validate('param', idParamSchema),
        validate('json', changePlantTypeBodySchema),
        async (c) =>
          c.json({
            data: await changePlantType(ctx.db, await visibilityOf(ctx, c), {
              id: c.req.valid('param').id,
              plantType: c.req.valid('json').plantType,
              actorId: currentUser(c).id,
            }),
          }),
      )
      // RFC-65 R20: the plant-type queue's Confirm (RFC-33 R11).
      .post(
        '/:id/plant-type/confirm',
        requirePermission(ctx, 'records.review'),
        validate('param', idParamSchema),
        validate('json', confirmPlantTypeBodySchema),
        async (c) =>
          c.json({
            data: await confirmPlantType(ctx.db, await visibilityOf(ctx, c), {
              id: c.req.valid('param').id,
              plantType: c.req.valid('json').plantType,
              actorId: currentUser(c).id,
            }),
          }),
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
                platform: c.get('platform'),
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
          await forgetCachedBestEffort(c.get('logger'), ctx.redis, dashboardKeys(actor.id), {
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
          await forgetCachedBestEffort(c.get('logger'), ctx.redis, dashboardKeys(actor.id), {
            actorId: actor.id,
          });
          return c.json({ data }, 201);
        },
      )
  );
}
