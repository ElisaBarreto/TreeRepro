import type {
  Coverage,
  CoverageQuery,
  CoverageRow,
  CoverageTopQuery,
  CoverageTraitRow,
  TraitValueType,
} from '@treerepro/contracts';
import { eq, type SQL, sql } from 'drizzle-orm';
import { globalSpeciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { traitCategories } from '../db/schema/dictionary.ts';
import { plots } from '../db/schema/plots.ts';
import { families } from '../db/schema/taxa.ts';
import { AppError } from '../http/errors.ts';
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
 * It is exported, and not folded into `coverageTotals`, because the cached
 * form writes one fixed Redis key per viewer class: integration tests run in
 * parallel against a single Redis, so a test reading the numbers through the
 * cache would race every other suite for that key and assert on whichever
 * caller happened to compute the entry. Callers in the application read the
 * cached form. That this is also where plan 11c hangs its filters is a bonus,
 * not the reason: those filters (family, category, plot) become further
 * conjuncts of the two predicates below, and the per-category and per-trait
 * breakdowns group the same joins.
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

/** The ranking `GET /api/coverage/top` is asked for. @rfc RFC-69 R7 */
export type CoverageTopMode = NonNullable<CoverageTopQuery['mode']>;

/** What `coverageTop` answers when the caller names no `limit`, as RFC-72 R1's own top list does. */
const TOP_LIMIT_DEFAULT = 10;

/** The ten minutes of RFC-69 R6, in seconds. */
const COVERAGE_TTL_SECONDS = 600;

/**
 * The two predicates a coverage answer is computed over: which species are in
 * the grid and which traits are. Every count below is a join filtered by these
 * two and nothing else, so the totals, the per-category rows and the per-trait
 * rows can never disagree about what the selection is.
 */
interface CoverageSelection {
  speciesSeen: SQL;
  traitSeen: SQL;
}

const both = (parts: SQL[]): SQL => parts.reduce((left, right) => sql`(${left}) and (${right})`);

/**
 * Resolves {@link CoverageQuery} into the selection, refusing the filters that
 * name nothing and the plot the viewer may not read.
 *
 * The base species predicate is `globalSpeciesVisible`, the same active-only
 * dimension `computeCoverageTotals` uses: the plot dimension enters the grid
 * only through an explicit `plotId`, which is part of the cache key (RFC-69
 * R6). `familyId` and `plotId` are existence-checked before they are
 * authorised and only then added as conjuncts, the order `speciesListConditions`
 * uses (RFC-60 R6), so a viewer learns "no such plot" before "not yours".
 * `categoryKey` is looked up the same way and refused with the same error
 * `speciesListConditions` raises for it (`VALIDATION_FAILED`, path
 * `categoryKey`), so a typo answers 400 on `GET /api/coverage` exactly as it
 * does on `GET /api/species`, rather than an empty grid that reads like a
 * dataset with no traits in that category.
 * @rfc RFC-69 R5
 * @rfc RFC-33 R2, R6
 * @rfc RFC-60 R6
 */
async function coverageSelection(
  db: DbExecutor,
  visibility: Visibility,
  filters: CoverageQuery,
): Promise<CoverageSelection> {
  const speciesParts = [globalSpeciesVisible(visibility, sql`s.active`, sql`s.id`)];
  if (filters.familyId) {
    const [family] = await db
      .select({ id: families.id })
      .from(families)
      .where(eq(families.id, filters.familyId))
      .limit(1);
    if (!family) throw new AppError('FAMILY_NOT_FOUND', 'Family not found');
    speciesParts.push(
      sql`exists (select 1 from genera g where g.id = s.genus_id and g.family_id = ${filters.familyId}::uuid)`,
    );
  }
  if (filters.plotId) {
    const [plot] = await db
      .select({ id: plots.id })
      .from(plots)
      .where(eq(plots.id, filters.plotId))
      .limit(1);
    if (!plot) throw new AppError('PLOT_NOT_FOUND', 'Plot not found');
    if (visibility.plotIds !== null && !visibility.plotIds.includes(filters.plotId)) {
      throw new AppError('PERMISSION_DENIED', 'Cannot view coverage outside assigned plots');
    }
    speciesParts.push(
      sql`exists (select 1 from plot_species ps where ps.species_id = s.id and ps.plot_id = ${filters.plotId}::uuid)`,
    );
  }
  const traitParts = [traitVisible(visibility, sql`t.active`)];
  if (filters.categoryKey) {
    const [category] = await db
      .select({ key: traitCategories.key })
      .from(traitCategories)
      .where(eq(traitCategories.key, filters.categoryKey))
      .limit(1);
    if (!category) {
      throw new AppError('VALIDATION_FAILED', 'Request validation failed', [
        { path: 'categoryKey', message: 'Unknown trait category' },
      ]);
    }
    traitParts.push(sql`t.category_key = ${filters.categoryKey}`);
  }
  return { speciesSeen: both(speciesParts), traitSeen: both(traitParts) };
}

/** A grid and how much of it is filled, with RFC-69 R5's one percentage definition. */
function coverageRow(cells: number, withData: number, accepted: number): CoverageRow {
  return {
    cells,
    withData,
    accepted,
    percentWithData: percentHalfUp(withData, cells),
    percentAccepted: percentHalfUp(accepted, cells),
  };
}

interface TraitMetricRow {
  trait_id: string;
  trait_key: string;
  value_type: TraitValueType;
  unit: string | null;
  category_key: string;
  category_label: string;
  category_sort: number;
  with_data: number;
  accepted: number;
}

/**
 * The answer itself, from the selection: the selected species counted once,
 * and every selected trait with the coverage rows (RFC-69 R1) and the accepted
 * pairs it holds over those species. The totals and the `byCategory` rows are
 * sums of those per-trait counts rather than counts of their own — the same
 * joins aggregated at a coarser grain, which is what RFC-69 R5 asks for and
 * what keeps a breakdown from ever contradicting the total above it.
 *
 * A trait with no data keeps its row (`withData` 0): the gaps are the point of
 * the answer, and RFC-69 R7 ranks them.
 */
async function coverageGrid(
  db: DbExecutor,
  selection: CoverageSelection,
): Promise<Omit<Coverage, 'computedAt'>> {
  const selSpecies = sql`sel_species as (select s.id from species s where ${selection.speciesSeen})`;
  const selTraits = sql`sel_traits as (
    select t.id, t.key, t.value_type, t.unit, t.category_key from traits t where ${selection.traitSeen})`;
  const [[speciesRow], traitRows] = await Promise.all([
    db.execute(
      sql`with ${selSpecies} select count(*)::int as n from sel_species`,
    ) as unknown as Promise<[{ n: number } | undefined]>,
    db.execute(sql`
      with ${selSpecies}, ${selTraits}
      select t.id as trait_id, t.key as trait_key, t.value_type as value_type, t.unit as unit,
             tc.key as category_key, tc.label as category_label, tc.sort_order as category_sort,
             coalesce(d.n, 0)::int as with_data,
             coalesce(a.n, 0)::int as accepted
      from sel_traits t
      join trait_categories tc on tc.key = t.category_key
      left join (select c.trait_id as trait_id, count(*)::int as n
                 from species_trait_coverage c
                 where c.species_id in (select id from sel_species)
                   and c.trait_id in (select id from sel_traits)
                 group by c.trait_id) d on d.trait_id = t.id
      left join (select newest.trait_id as trait_id, count(*)::int as n
                 from (select distinct on (v.species_id, v.trait_id) v.trait_id, v.decision
                       from accepted_values v
                       where v.species_id in (select id from sel_species)
                         and v.trait_id in (select id from sel_traits)
                       order by v.species_id, v.trait_id, v.id desc) newest
                 where newest.decision = 'accepted'
                 group by newest.trait_id) a on a.trait_id = t.id
      order by t.key asc`) as unknown as Promise<TraitMetricRow[]>,
  ]);

  const species = speciesRow?.n ?? 0;
  const byTrait: CoverageTraitRow[] = traitRows.map((r) => ({
    trait: { id: r.trait_id, key: r.trait_key, valueType: r.value_type, unit: r.unit },
    category: { key: r.category_key, label: r.category_label },
    // A `byTrait` row is one trait over the selected species, not a grid, so
    // its `cells` is the species count and its `species` is its own
    // `withData` — not a tally of its own (RFC-69 R5).
    species: r.with_data,
    ...coverageRow(species, r.with_data, r.accepted),
  }));

  const categories = new Map<string, { sort: number; label: string; rows: TraitMetricRow[] }>();
  for (const r of traitRows) {
    const entry = categories.get(r.category_key) ?? {
      sort: r.category_sort,
      label: r.category_label,
      rows: [],
    };
    entry.rows.push(r);
    categories.set(r.category_key, entry);
  }
  const byCategory = [...categories.entries()]
    .sort(([keyA, a], [keyB, b]) => a.sort - b.sort || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0))
    .map(([key, entry]) => ({
      category: { key, label: entry.label },
      traits: entry.rows.length,
      ...coverageRow(
        species * entry.rows.length,
        entry.rows.reduce((n, r) => n + r.with_data, 0),
        entry.rows.reduce((n, r) => n + r.accepted, 0),
      ),
    }));

  return {
    species,
    traits: byTrait.length,
    ...coverageRow(
      species * byTrait.length,
      traitRows.reduce((n, r) => n + r.with_data, 0),
      traitRows.reduce((n, r) => n + r.accepted, 0),
    ),
    byCategory,
    byTrait,
  };
}

/**
 * The filtered coverage metrics, uncached and without the `computedAt` of
 * their entry. Exported for the reason {@link computeCoverageTotals} is: the
 * cached form writes one Redis key per viewer class and filter combination,
 * and a test asserting numbers through a key it shares with a sibling suite
 * asserts on whichever caller happened to compute the entry.
 * @rfc RFC-69 R5
 */
export async function computeCoverageMetrics(
  db: DbExecutor,
  visibility: Visibility,
  filters: CoverageQuery,
): Promise<Omit<Coverage, 'computedAt'>> {
  return coverageGrid(db, await coverageSelection(db, visibility, filters));
}

/**
 * One segment of the cache key: `-` for a filter that was not given, and the
 * percent-encoded value otherwise. `encodeURIComponent` escapes the `:` the
 * key is split on and leaves an ordinary key (`leaf_traits`, a uuid) exactly
 * as RFC-69 R6 writes it; it does *not* escape a lone `-`, which is the
 * sentinel, so that one value is written `%2D`. No value can then render as
 * the sentinel or as more than one segment, and `%2D` is itself unreachable
 * (`encodeURIComponent('%2D')` is `%252D`), so the mapping stays one-to-one.
 * @rfc RFC-69 R6
 */
function keySegment(value: string | undefined): string {
  if (value === undefined) return '-';
  const encoded = encodeURIComponent(value);
  return encoded === '-' ? '%2D' : encoded;
}

/**
 * `GET /api/coverage`: {@link computeCoverageMetrics} behind the ten-minute
 * entry of RFC-69 R6, keyed by the viewer class and the explicit filters —
 * `coverage:<u|r>:<familyId>:<categoryKey>:<plotId>`, an absent filter being
 * `-`. The key is honest per viewer because the base selection never carries
 * the plot dimension (see {@link coverageSelection}).
 *
 * The filters are resolved before the entry is read, not inside the
 * computation the entry wraps: a plot a viewer may not read must be refused on
 * a cache hit exactly as on a miss, and a hit is what a viewer allowed that
 * same plot leaves behind.
 *
 * The segments are escaped by {@link keySegment}: a filter value must not be
 * able to forge the key of a different filter set, because two filter sets
 * sharing one entry is both a wrong answer and a way to write into an answer
 * a viewer never asked for. `categoryKey` is free text
 * (`coverageQuerySchema`), so unescaped it could carry the `:` separator
 * (`x:<plot uuid>` is otherwise the key of category `x` scoped to that plot —
 * the plot-scoped number R6 keeps a viewer from reading) or be the absent
 * sentinel itself (`-` is otherwise the unfiltered key, the entry every viewer
 * of the class reads).
 * @rfc RFC-69 R5, R6
 * @rfc RFC-33 R2, R6
 */
export async function coverageMetrics(
  ctx: { db: DbExecutor; redis: Redis },
  visibility: Visibility,
  filters: CoverageQuery,
): Promise<Coverage> {
  const selection = await coverageSelection(ctx.db, visibility, filters);
  const key = [
    'coverage',
    visibility.inactive ? 'u' : 'r',
    keySegment(filters.familyId),
    keySegment(filters.categoryKey),
    keySegment(filters.plotId),
  ].join(':');
  const { value, computedAt } = await cachedJson(ctx.redis, key, COVERAGE_TTL_SECONDS, () =>
    coverageGrid(ctx.db, selection),
  );
  return { ...value, computedAt };
}

/**
 * RFC-69 R7's ranking of `byTrait` rows: ascending `withData` for `missing`
 * (the trait the most selected species lack comes first) and ascending
 * `percentAccepted` for `least_accepted`. The sort is stable and the rows
 * arrive in trait-key order, so equals keep that order and the answer is the
 * same on every call; the input is left alone.
 * @rfc RFC-69 R7
 */
export function rankCoverageTraits(
  rows: readonly CoverageTraitRow[],
  mode: CoverageTopMode,
): CoverageTraitRow[] {
  const rank = (r: CoverageTraitRow) =>
    mode === 'least_accepted' ? r.percentAccepted : r.withData;
  return [...rows].sort((a, b) => rank(a) - rank(b));
}

/**
 * `GET /api/coverage/top`: the traits with the most visible species lacking
 * data, or with the lowest accepted share, as `byTrait` items. It is the full
 * unfiltered visible grid — the same base selection as {@link coverageTotals},
 * never {@link coverageMetrics}'s filters — ranked and cut.
 *
 * That grid is {@link coverageMetrics} with no filters, so this reads R6's
 * no-filter entry (`coverage:<u|r>:-:-:-`) rather than computing a grid of its
 * own: the scope of this answer *is* the no-filter scope, and the coverage
 * page asks for both within one load. A ranking computed beside a sibling
 * request that is a cache hit would put a `distinct on` over `accepted_values`
 * and a group-by over `species_trait_coverage` on every page load and every
 * mode toggle, which is the scan per page load RFC-69 exists to remove.
 * @rfc RFC-69 R6, R7
 */
export async function coverageTop(
  ctx: { db: DbExecutor; redis: Redis },
  visibility: Visibility,
  options: CoverageTopQuery,
): Promise<CoverageTraitRow[]> {
  const { byTrait } = await coverageMetrics(ctx, visibility, {});
  return rankCoverageTraits(byTrait, options.mode ?? 'missing').slice(
    0,
    options.limit ?? TOP_LIMIT_DEFAULT,
  );
}
