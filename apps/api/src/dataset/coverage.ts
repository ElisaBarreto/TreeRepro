import { sql } from 'drizzle-orm';
import { globalSpeciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { cachedJson } from '../redis/cache.ts';
import type { Redis } from '../redis/client.ts';

/** How full the dataset is: the visible grid, the cells that hold data and the decided ones. */
export interface CoverageTotals {
  cells: number;
  withData: number;
  accepted: number;
  percentWithData: number;
  percentAccepted: number;
}

/**
 * `part` as an integer percentage of `whole`, a half always going up, and `0`
 * for an empty grid. The arithmetic stays in integers — `part * 200 + whole`
 * over `whole * 2` — because the float quotient of two counts can land just
 * under a half that is exactly a half in the rationals, and would then round
 * the wrong way.
 * @rfc RFC-69 R5
 */
export function percentHalfUp(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.floor((part * 200 + whole) / (whole * 2));
}

interface TotalsRow {
  species_count: number;
  trait_count: number;
  with_data: number;
  accepted: number;
}

/**
 * The totals themselves, uncached: one statement over the visible grid, the
 * coverage table (RFC-69 R1) and the newest decision of each species × trait
 * pair. Visibility is the active flags of `species` and `traits` (RFC-69 R4);
 * the plot dimension is dropped as it is for every other cached global
 * summary (`globalSpeciesVisible`), because the cache key of `coverageTotals`
 * holds only the viewer class and a plot-scoped number under it would be read
 * back by the wrong viewer.
 *
 * Plan 11c generalises this into a filtered `coverageMetrics`: the filters
 * (family, category, plot) become further conjuncts of the two predicates
 * below, and the per-category and per-trait breakdowns group the same joins.
 * @rfc RFC-69 R5
 * @rfc RFC-33 R2
 */
export async function computeCoverageTotals(
  db: DbExecutor,
  visibility: Visibility,
): Promise<CoverageTotals> {
  const speciesSeen = globalSpeciesVisible(visibility, sql`s.active`, sql`s.id`);
  const traitSeen = traitVisible(visibility, sql`t.active`);
  const [row] = (await db.execute(sql`
    select
      (select count(*)::int from species s where ${speciesSeen}) as species_count,
      (select count(*)::int from traits t where ${traitSeen}) as trait_count,
      (select count(*)::int from species_trait_coverage c
        join species s on s.id = c.species_id
        join traits t on t.id = c.trait_id
        where ${speciesSeen} and ${traitSeen}) as with_data,
      (select count(*)::int from (
        select distinct on (v.species_id, v.trait_id) v.decision
        from accepted_values v
        join species s on s.id = v.species_id
        join traits t on t.id = v.trait_id
        where ${speciesSeen} and ${traitSeen}
        order by v.species_id, v.trait_id, v.id desc) newest
      where newest.decision = 'accepted') as accepted`)) as unknown as [TotalsRow | undefined];
  const cells = (row?.species_count ?? 0) * (row?.trait_count ?? 0);
  const withData = row?.with_data ?? 0;
  const accepted = row?.accepted ?? 0;
  return {
    cells,
    withData,
    accepted,
    percentWithData: percentHalfUp(withData, cells),
    percentAccepted: percentHalfUp(accepted, cells),
  };
}

/**
 * `computeCoverageTotals` behind the ten-minute cache the dashboard reads
 * (RFC-72 R1), keyed by viewer class alone — `coverage:totals:<u|r>`.
 * @rfc RFC-69 R5
 */
export async function coverageTotals(
  ctx: { db: DbExecutor; redis: Redis },
  visibility: Visibility,
): Promise<CoverageTotals> {
  const key = `coverage:totals:${visibility.inactive ? 'u' : 'r'}`;
  const { value } = await cachedJson(ctx.redis, key, 600, () =>
    computeCoverageTotals(ctx.db, visibility),
  );
  return value;
}
