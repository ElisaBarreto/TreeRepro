import type { Dashboard, PermissionKey, PlotRef } from '@treerepro/contracts';
import { and, count, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import {
  globalSpeciesVisible,
  speciesVisible,
  traitVisible,
  type Visibility,
} from '../access/visibility.ts';
import { contributionSummary } from '../dataset/contributions.ts';
import { coverageTotals } from '../dataset/coverage.ts';
import { speciesCountsByTrait } from '../dataset/dictionary.ts';
import { countContested, countDisputed, countPendingGroups } from '../dataset/queues.ts';
import { itemQuery, toItem } from '../dataset/records.ts';
import type { DbExecutor } from '../db/client.ts';
import { traits } from '../db/schema/dictionary.ts';
import { traitRecords } from '../db/schema/records.ts';
import { species } from '../db/schema/taxa.ts';
import { cachedJson } from '../redis/cache.ts';
import type { Redis } from '../redis/client.ts';

/** The db and cache the dashboard reads; deliberately narrower than `AuthContext`. */
type DashboardContext = { db: DbExecutor; redis: Redis };

/**
 * Who the dashboard is answered for: the permissions decide whether curation
 * is part of the answer, the plots decide whether the scope-dependent numbers
 * exist at all (RFC-72 R1).
 * @rfc RFC-72 R1
 */
export interface DashboardViewer {
  id: string;
  permissions: ReadonlySet<PermissionKey>;
  scope: { plots: PlotRef[]; restricted: boolean };
}

/** One entry of the missing-trait ranking. @rfc RFC-72 R1 */
export type MissingTrait = Dashboard['contributor']['topMissingTraits'][number];

/** The global counts of RFC-72 R1, without the `computedAt` of their entry. */
export interface DatasetStats {
  speciesCount: number;
  referenceCount: number;
  recordCount: number;
}

interface StatsRow {
  species_count: number;
  reference_count: number;
  record_count: number;
}

/**
 * The three global counts, uncached: active species (RFC-72 R1 counts only
 * those), every bibliographic reference and every record.
 *
 * The record count is `sum(record_count)` over `species_trait_coverage`
 * (RFC-69 R1), the source `docs/specs/2026-09-17-workspace-design.md` §4
 * names, and not `count(*)` over `trait_records`. The two are equal — the
 * trigger of migration 0022 maintains the counter and records are append-only
 * (RFC-63 R4) — but RFC-72's context is explicit that these numbers come from
 * a stored counter or a small table and never from a scan of the whole
 * dataset. The hourly entry does not excuse the scan: the counter is cheaper
 * at exactly the same cadence. Being a sum of monotonic counters, it also
 * never shows a smaller number than the hour before.
 *
 * It is exported, and not folded into `datasetStats`, for the reason
 * `computeCoverageTotals` is: `stats:dataset` is one fixed key shared by every
 * caller in a test run, so a test reading the numbers through the cache would
 * assert on whichever caller happened to compute the entry. Callers in the
 * application read the cached form.
 * @rfc RFC-72 R1
 */
export async function computeDatasetStats(db: DbExecutor): Promise<DatasetStats> {
  const [row] = (await db.execute(sql`
    select
      (select count(*)::int from species s where s.active) as species_count,
      (select count(*)::int from bibliographic_references) as reference_count,
      (select coalesce(sum(c.record_count), 0)::int from species_trait_coverage c)
        as record_count`)) as unknown as [StatsRow | undefined];
  return {
    speciesCount: row?.species_count ?? 0,
    referenceCount: row?.reference_count ?? 0,
    recordCount: row?.record_count ?? 0,
  };
}

/**
 * `computeDatasetStats` behind the one-hour entry RFC-72 R1 names,
 * `stats:dataset`. The key carries no viewer class: these are the counts of
 * the dataset as a whole, the same three numbers the project description
 * quotes to every viewer (RFC-72 R3), and `computedAt` is the entry's own.
 * @rfc RFC-72 R1
 */
export async function datasetStats(ctx: DashboardContext): Promise<Dashboard['dataset']> {
  const { value, computedAt } = await cachedJson(ctx.redis, 'stats:dataset', 3600, () =>
    computeDatasetStats(ctx.db),
  );
  return { ...value, computedAt };
}

/** The viewer's plots with the visible species each holds, or null when they have none. */
async function scopeSection(
  db: DbExecutor,
  visibility: Visibility,
  scope: DashboardViewer['scope'],
): Promise<Dashboard['scope']> {
  if (scope.plots.length === 0) return null;
  const plotIds = scope.plots.map((p) => p.id);
  const ids = sql`ps.plot_id = any(${sql.param(plotIds)}::uuid[])`;
  const seen = speciesVisible(visibility, sql`s.active`, sql`s.id`);
  const [perPlot, [total]] = await Promise.all([
    db.execute(sql`
      select ps.plot_id as plot_id, count(*)::int as species_count
      from plot_species ps
      join species s on s.id = ps.species_id
      where ${ids} and ${seen}
      group by ps.plot_id`) as unknown as Promise<{ plot_id: string; species_count: number }[]>,
    db.execute(sql`
      select count(distinct ps.species_id)::int as n
      from plot_species ps
      join species s on s.id = ps.species_id
      where ${ids} and ${seen}`) as unknown as Promise<[{ n: number } | undefined]>,
  ]);
  const byPlot = new Map(perPlot.map((r) => [r.plot_id, r.species_count]));
  return {
    plots: scope.plots.map((p) => ({ ...p, speciesCount: byPlot.get(p.id) ?? 0 })),
    speciesCount: total?.n ?? 0,
    restricted: scope.restricted,
  };
}

/** The plot species of the viewer, as a CTE every scope-dependent query opens with. */
function plotSpeciesCte(visibility: Visibility, plotIds: string[]): SQL {
  return sql`plot_sp as (
    select distinct ps.species_id as id
    from plot_species ps
    join species s on s.id = ps.species_id
    where ps.plot_id = any(${sql.param(plotIds)}::uuid[])
      and ${speciesVisible(visibility, sql`s.active`, sql`s.id`)})`;
}

/**
 * The cells of the viewer's own grid that hold no record at all: their plot
 * species times the visible traits, less the coverage rows (RFC-69 R1) that
 * fall inside it.
 */
async function missingCellCount(
  db: DbExecutor,
  visibility: Visibility,
  plotIds: string[],
): Promise<number> {
  const traitSeen = traitVisible(visibility, sql`t.active`);
  const [row] = (await db.execute(sql`
    with ${plotSpeciesCte(visibility, plotIds)}
    select
      (select count(*)::int from plot_sp) as species_count,
      (select count(*)::int from traits t where ${traitSeen}) as trait_count,
      (select count(*)::int from species_trait_coverage c
        join traits t on t.id = c.trait_id
        where c.species_id in (select id from plot_sp) and ${traitSeen}) as covered`)) as unknown as [
    { species_count: number; trait_count: number; covered: number } | undefined,
  ];
  if (!row) return 0;
  return Math.max(0, row.species_count * row.trait_count - row.covered);
}

/** The cached form of `awaitingValidation`: ids, never the items themselves. */
interface AwaitingIds {
  count: number;
  recordIds: string[];
}

/**
 * The records on the viewer's plot species that no scientist has confirmed or
 * withdrawn yet: the ids of the twenty newest, and how many there are in
 * total.
 *
 * Ids and not items, because this is what the per-viewer entry stores. A
 * record item carries `createdBy: { id, name }`, and `users.name` is an
 * encrypted column (RFC-40 R1): caching the items would persist a colleague's
 * real name in the clear in Redis — visible in `MONITOR`, in an RDB or AOF
 * dump and in every backup — which is exactly what R1 forbids, for Redis as
 * much as for Postgres. `hydrateAwaiting` builds the items per request
 * instead; the expensive parts of this section stay cached.
 * @rfc RFC-40 R1
 * @rfc RFC-33 R2, R3
 */
async function awaitingValidation(
  db: DbExecutor,
  visibility: Visibility,
  plotIds: string[],
): Promise<AwaitingIds> {
  const where = and(
    speciesVisible(visibility),
    traitVisible(visibility),
    sql`exists (select 1 from plot_species ps
      where ps.species_id = trait_records.species_id
        and ps.plot_id = any(${sql.param(plotIds)}::uuid[]))`,
    sql`not exists (select 1 from record_annotations a
      where a.record_id = trait_records.id and a.kind in ('confirm', 'withdraw'))`,
  ) as SQL;
  const [rows, [total]] = await Promise.all([
    db
      .select({ id: traitRecords.id })
      .from(traitRecords)
      .innerJoin(species, eq(species.id, traitRecords.speciesId))
      .innerJoin(traits, eq(traits.id, traitRecords.traitId))
      .where(where)
      .orderBy(desc(traitRecords.id))
      .limit(20),
    db
      .select({ n: count() })
      .from(traitRecords)
      .innerJoin(species, eq(species.id, traitRecords.speciesId))
      .innerJoin(traits, eq(traits.id, traitRecords.traitId))
      .where(where),
  ]);
  return { count: total?.n ?? 0, recordIds: rows.map((r) => r.id) };
}

/**
 * The cached ids turned back into record items, in the order they were
 * cached. Bounded by construction — at most twenty rows, fetched by primary
 * key — so it costs one indexed lookup per request.
 *
 * `inArray` does not preserve the order of the id list, so the newest-first
 * guarantee of RFC-72 R1 is re-applied here by mapping the ordered ids over a
 * map of the items, the shape `listDisputed` uses for the same reason. An id
 * whose record has since gone is dropped rather than left as a hole.
 * @rfc RFC-72 R1
 * @rfc RFC-40 R1
 */
async function hydrateAwaiting(
  db: DbExecutor,
  cached: AwaitingIds | null,
): Promise<Dashboard['contributor']['awaitingValidation']> {
  if (cached === null) return null;
  if (cached.recordIds.length === 0) return { count: cached.count, records: [] };
  const items = await itemQuery(db).where(inArray(traitRecords.id, cached.recordIds));
  const itemById = new Map(items.map((i) => [i.record.id, toItem(i)]));
  return {
    count: cached.count,
    records: cached.recordIds.flatMap((id) => {
      const item = itemById.get(id);
      return item ? [item] : [];
    }),
  };
}

interface RankRow {
  trait_id: string;
  trait_key: string;
  value_type: MissingTrait['trait']['valueType'];
  unit: string | null;
  category_key: string;
  category_label: string;
  missing?: number;
}

const toMissingTrait = (r: RankRow, missing: number): MissingTrait => ({
  trait: { id: r.trait_id, key: r.trait_key, valueType: r.value_type, unit: r.unit },
  category: { key: r.category_key, label: r.category_label },
  missingSpeciesCount: missing,
});

/**
 * The visible traits ranked by how many species still miss them, most missing
 * first and ties broken by trait key so the ranking is stable between calls.
 * Traits nothing misses are left out: this answers "where is data missing",
 * and a trait every species already holds is not an answer to it.
 *
 * With plots, the count is over the viewer's plot species alone. Without, it
 * is over every visible species and the per-trait species counts come from
 * `speciesCountsByTrait` — the entry the dictionary page already computes and
 * caches (RFC-62 R5), read rather than recomputed, because two producers
 * writing one Redis key corrupt it the moment they diverge. That entry is
 * plot-blind, which is exactly what a viewer with no plots asks for; a viewer
 * restricted to no plots at all sees nothing, and is answered nothing.
 *
 * The two halves of that subtraction are of different ages: `visible` is
 * counted live, `counts` comes from an entry up to ten minutes old. So a
 * species committed inside that window is in the denominator but not yet in
 * the per-trait count, and `missingSpeciesCount` overstates by at most the
 * species added in ten minutes; a species deactivated in the same window
 * understates it, which is why the subtraction is clamped at zero. The error
 * is bounded and heals itself when the entry expires, and a ranking is the
 * one consumer that can carry it: it orders traits, and a handful of species
 * shared by every trait alike barely moves the order.
 *
 * It is exported for the reason `computeCoverageTotals` is: `getDashboard`
 * cuts the ranking to ten, and which traits make that cut depends on every
 * species and trait in the database, so only the full ranking can be asserted
 * against a test's own fixture.
 * @rfc RFC-72 R1, R2
 * @rfc RFC-33 R2, R3
 */
export async function missingTraitCounts(
  ctx: DashboardContext,
  visibility: Visibility,
  plotIds: string[],
): Promise<MissingTrait[]> {
  const traitSeen = traitVisible(visibility, sql`t.active`);
  if (plotIds.length > 0) {
    const rows = (await ctx.db.execute(sql`
      with ${plotSpeciesCte(visibility, plotIds)}
      select t.id as trait_id, t.key as trait_key, t.value_type as value_type, t.unit as unit,
             tc.key as category_key, tc.label as category_label,
             (select count(*)::int from plot_sp) - count(c.species_id)::int as missing
      from traits t
      join trait_categories tc on tc.key = t.category_key
      left join species_trait_coverage c
        on c.trait_id = t.id and c.species_id in (select id from plot_sp)
      where ${traitSeen}
      group by t.id, t.key, t.value_type, t.unit, tc.key, tc.label
      order by missing desc, t.key asc`)) as unknown as RankRow[];
    return rows.filter((r) => (r.missing ?? 0) > 0).map((r) => toMissingTrait(r, r.missing ?? 0));
  }
  if (visibility.plotIds !== null && visibility.plotIds.length === 0) return [];
  const [counts, rows, [total]] = await Promise.all([
    speciesCountsByTrait(ctx, visibility),
    ctx.db.execute(sql`
      select t.id as trait_id, t.key as trait_key, t.value_type as value_type, t.unit as unit,
             tc.key as category_key, tc.label as category_label
      from traits t
      join trait_categories tc on tc.key = t.category_key
      where ${traitSeen}
      order by t.key asc`) as unknown as Promise<RankRow[]>,
    ctx.db.execute(sql`
      select count(*)::int as n from species s
      where ${globalSpeciesVisible(visibility, sql`s.active`, sql`s.id`)}`) as unknown as Promise<
      [{ n: number } | undefined]
    >,
  ]);
  const visible = total?.n ?? 0;
  return rows
    .map((r) => toMissingTrait(r, Math.max(0, visible - (counts.get(r.trait_id) ?? 0))))
    .filter((r) => r.missingSpeciesCount > 0)
    .sort(
      (a, b) =>
        b.missingSpeciesCount - a.missingSpeciesCount || a.trait.key.localeCompare(b.trait.key),
    );
}

/**
 * The cached form of the contributor section: everything the panel shows
 * except the record items, which are represented by their ids (RFC-40 R1).
 */
interface CachedContributor extends Omit<Dashboard['contributor'], 'awaitingValidation'> {
  awaitingValidation: AwaitingIds | null;
}

/**
 * Everything the viewer's own contribution panel shows, cached as one blob —
 * bar the records awaiting validation, which are cached as ids and
 * re-hydrated per request so no name is persisted in Redis (RFC-40 R1).
 */
async function contributorSection(
  ctx: DashboardContext,
  visibility: Visibility,
  viewer: DashboardViewer,
  plotIds: string[],
): Promise<CachedContributor> {
  const [missingCells, awaiting, topMissingTraits, summary] = await Promise.all([
    plotIds.length === 0 ? null : missingCellCount(ctx.db, visibility, plotIds),
    plotIds.length === 0 ? null : awaitingValidation(ctx.db, visibility, plotIds),
    missingTraitCounts(ctx, visibility, plotIds),
    contributionSummary(ctx.db, viewer.id),
  ]);
  return {
    missingCells,
    awaitingValidation: awaiting,
    topMissingTraits: topMissingTraits.slice(0, 10),
    summary,
  };
}

/** The curation panel, answered only to a viewer who reviews records. */
async function curationSection(
  ctx: DashboardContext,
  visibility: Visibility,
  viewer: DashboardViewer,
): Promise<Dashboard['curation']> {
  if (!viewer.permissions.has('records.review')) return null;
  const [coverage, pendingGroups, disputed, contested] = await Promise.all([
    coverageTotals(ctx, visibility),
    countPendingGroups(ctx.db, visibility),
    countDisputed(ctx.db, visibility),
    countContested(ctx.db, visibility),
  ]);
  // RFC-75 proposals arrive with plan 12c; until then the queue is empty
  // rather than absent, so the panel keeps one shape.
  return { coverage, queues: { pendingGroups, disputed, contested, proposals: 0 } };
}

/**
 * `GET /api/me/dashboard`: the four sections of RFC-72 R1, each degrading on
 * its own. The sections are independent, so they run together; the viewer's
 * own one is served through `dashboard:<viewer id>` for five minutes and is
 * dropped by the routes that let a viewer change what it counts.
 * @rfc RFC-72 R1, R2
 * @rfc RFC-33 R2, R3
 */
export async function getDashboard(
  ctx: DashboardContext,
  visibility: Visibility,
  viewer: DashboardViewer,
): Promise<Dashboard> {
  const plotIds = viewer.scope.plots.map((p) => p.id);
  const [dataset, scope, contributor, curation] = await Promise.all([
    datasetStats(ctx),
    scopeSection(ctx.db, visibility, viewer.scope),
    cachedJson(ctx.redis, `dashboard:${viewer.id}`, 300, () =>
      contributorSection(ctx, visibility, viewer, plotIds),
    ).then(async (entry) => ({
      ...entry.value,
      awaitingValidation: await hydrateAwaiting(ctx.db, entry.value.awaitingValidation),
    })),
    curationSection(ctx, visibility, viewer),
  ]);
  return { dataset, scope, contributor, curation };
}
