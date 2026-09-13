import { idParamSchema, listSpeciesQuerySchema } from '@treerepro/contracts';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AuthContext } from '../../../auth/context.ts';
import { speciesTraitSummary } from '../../../dataset/summary.ts';
import { getSpecies, searchSpecies } from '../../../dataset/taxa.ts';
import { species } from '../../../db/schema/taxa.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { validate } from '../../validate.ts';

/**
 * @rfc RFC-60 R6, R7
 * @rfc RFC-63 R10
 */
export function speciesRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get(
      '/',
      requirePermission(ctx, 'dataset.read'),
      validate('query', listSpeciesQuerySchema),
      async (c) => {
        const q = c.req.valid('query');
        const { data, nextCursor } = await searchSpecies(ctx.db, {
          q: q.q,
          familyId: q.familyId,
          genusId: q.genusId,
          unresolved: q.unresolved === 'true',
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
        const found = await getSpecies(ctx.db, c.req.valid('param').id);
        if (!found) throw new AppError('SPECIES_NOT_FOUND', 'Species not found');
        return c.json({ data: found });
      },
    )
    .get(
      '/:id/traits',
      requirePermission(ctx, 'dataset.read'),
      validate('param', idParamSchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const [exists] = await ctx.db
          .select({ id: species.id })
          .from(species)
          .where(eq(species.id, id))
          .limit(1);
        if (!exists) throw new AppError('SPECIES_NOT_FOUND', 'Species not found');
        return c.json({ data: await speciesTraitSummary(ctx.db, id) });
      },
    );
}
