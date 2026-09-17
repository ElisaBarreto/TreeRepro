import {
  createPlotBodySchema,
  cursorQuerySchema,
  idParamSchema,
  listPlotSpeciesQuerySchema,
  listPlotsQuerySchema,
  plotSpeciesBodySchema,
  plotSpeciesMemberParamSchema,
  updatePlotBodySchema,
} from '@treerepro/contracts';
import { Hono } from 'hono';
import { visibilityOf } from '../../../access/visibility.ts';
import type { AuthContext } from '../../../auth/context.ts';
import {
  addPlotSpeciesMember,
  createPlot,
  getPlot,
  listPlotSpecies,
  listPlots,
  listPlotUsers,
  removePlotSpeciesMember,
  updatePlot,
} from '../../../dataset/plots.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { currentPermissions, requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';
import { validate } from '../../validate.ts';

/**
 * @rfc RFC-67 R3-R5
 * @rfc RFC-30 R1
 */
export function plotRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get(
      '/',
      requirePermission(ctx, 'dataset.read'),
      validate('query', listPlotsQuerySchema),
      async (c) => {
        const q = c.req.valid('query');
        const { data, nextCursor } = await listPlots(ctx.db, {
          q: q.q,
          cursor: q.cursor,
          limit: q.limit,
        });
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .post(
      '/',
      requirePermission(ctx, 'plots.manage'),
      validate('json', createPlotBodySchema),
      async (c) => {
        const body = c.req.valid('json');
        const plot = await createPlot(ctx.db, {
          ...body,
          actorId: currentUser(c).id,
        });
        return c.json({ data: plot }, 201);
      },
    )
    .get(
      '/:id',
      requirePermission(ctx, 'dataset.read'),
      validate('param', idParamSchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const withUserCount = currentPermissions(c).has('plots.manage');
        const plot = await getPlot(ctx.db, id, { withUserCount });
        if (!plot) throw new AppError('PLOT_NOT_FOUND', 'Plot not found');
        return c.json({ data: plot });
      },
    )
    .patch(
      '/:id',
      requirePermission(ctx, 'plots.manage'),
      validate('param', idParamSchema),
      validate('json', updatePlotBodySchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        const plot = await updatePlot(ctx.db, id, {
          ...body,
          actorId: currentUser(c).id,
        });
        return c.json({ data: plot });
      },
    )
    .get(
      '/:id/species',
      requirePermission(ctx, 'dataset.read'),
      validate('param', idParamSchema),
      validate('query', listPlotSpeciesQuerySchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const q = c.req.valid('query');
        const visibility = await visibilityOf(ctx, c);
        const { data, nextCursor } = await listPlotSpecies(ctx.db, visibility, id, {
          q: q.q,
          cursor: q.cursor,
          limit: q.limit,
        });
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .get(
      '/:id/users',
      requirePermission(ctx, 'plots.manage'),
      validate('param', idParamSchema),
      validate('query', cursorQuerySchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const q = c.req.valid('query');
        const { data, nextCursor } = await listPlotUsers(ctx.db, id, {
          cursor: q.cursor,
          limit: q.limit,
        });
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .post(
      '/:id/species',
      requirePermission(ctx, 'plots.manage'),
      validate('param', idParamSchema),
      validate('json', plotSpeciesBodySchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const { speciesId } = c.req.valid('json');
        await addPlotSpeciesMember(ctx.db, id, speciesId, currentUser(c).id);
        const plot = await getPlot(ctx.db, id, { withUserCount: true });
        return c.json({ data: plot }, 201);
      },
    )
    .delete(
      '/:id/species/:speciesId',
      requirePermission(ctx, 'plots.manage'),
      validate('param', plotSpeciesMemberParamSchema),
      async (c) => {
        const { id, speciesId } = c.req.valid('param');
        await removePlotSpeciesMember(ctx.db, id, speciesId, currentUser(c).id);
        const plot = await getPlot(ctx.db, id, { withUserCount: true });
        return c.json({ data: plot }, 200);
      },
    );
}
