import type { Dashboard, PermissionKey, PlotRef } from '@treerepro/contracts';
import { and, count, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { speciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import { contributionSummary } from '../dataset/contributions.ts';
import { coverageTotals } from '../dataset/coverage.ts';
import { speciesCountsByTrait } from '../dataset/dictionary.ts';
import { countOpenProposals } from '../dataset/proposals.ts';
import { countContested, countPendingGroups } from '../dataset/queues.ts';
import { harmonisedFor, itemQuery, toItem } from '../dataset/records.ts';
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

/** One entry of the traits-with-data ranking. @rfc RFC-72 R1 */
export type TraitWithData = Dashboard['contributor']['topTraitsWithData'][number];

/** The global counts of RFC-72 R1, without the `computedAt` of their entry. */
export interface DatasetStats {
  speciesCount: number;
  referenceCount: number;
  primaryReferenceCount: number;
  secondaryReferenceCount: number;
  recordCount: number;
}

interface StatsRow {
  species_count: number;
  reference_count: number;
  primary_reference_count: number;
  secondary_reference_count: number;
  record_count: number;
}

/**
 * The global counts, uncached: active species (RFC-72 R1 counts only
 * those), every bibliographic reference, the references cited at least once
 * as a primary and as a secondary reference (`primary_count > 0`,
 * `secondary_count > 0`, the stored counters of RFC-61 — spec R-18), and
 * every record.
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
      roles.primary_reference_count,
      roles.secondary_reference_count,
      (select coalesce(sum(c.record_count), 0)::int from species_trait_coverage c)
        as record_count
    from (
      select (count(*) filter (where r.primary_count > 0))::int as primary_reference_count,
             (count(*) filter (where r.secondary_count > 0))::int as secondary_reference_count
      from bibliographic_references r
    ) roles`)) as unknown as [StatsRow | undefined];
  return {
    speciesCount: row?.species_count ?? 0,
    referenceCount: row?.reference_count ?? 0,
    primaryReferenceCount: row?.primary_reference_count ?? 0,
    secondaryReferenceCount: row?.secondary_reference_count ?? 0,
    recordCount: row?.record_count ?? 0,
  };
}

/**
 * `computeDatasetStats` behind the one-hour entry RFC-72 R1 names,
 * `stats:dataset`. The key carries no viewer class: these are the counts of
 * the dataset as a whole, the numbers the project description quotes to
 * every viewer (RFC-72 R3), and `computedAt` is the entry's own.
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
    harmonisedFor(visibility, traitRecords.harmonisation),
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
 * map of the items, the shape `listContested` uses for the same reason. An id
 * whose record has since gone is dropped rather than left as a hole.
 * @rfc RFC-72 R1
 * @rfc RFC-40 R1
 */
async function hydrateAwaiting(
  db: DbExecutor,
  visibility: Visibility,
  cached: AwaitingIds | null,
): Promise<Dashboard['contributor']['awaitingValidation']> {
  if (cached === null) return null;
  if (cached.recordIds.length === 0) return { count: cached.count, records: [] };
  const items = await itemQuery(db, visibility).where(inArray(traitRecords.id, cached.recordIds));
  const itemById = new Map(items.map((i) => [i.record.id, toItem(i)]));
  return {
    count: cached.count,
    records: cached.recordIds.flatMap((id) => {
      const item = itemById.get(id);
      return item ? [item] : [];
    }),
  };
}

interface TraitRow {
  trait_id: string;
  trait_key: string;
  value_type: TraitWithData['trait']['valueType'];
  unit: string | null;
  category_key: string;
  category_label: string;
}

/**
 * The visible traits ranked by how many species hold data for them, most
 * first and ties broken by trait key so the ranking is stable between calls
 * (spec R-18). A trait no species holds is left out: this answers "where is
 * the data", and a trait without any is not an answer to it.
 *
 * The per-trait counts are `speciesCountsByTrait` — the entry the dictionary
 * page already computes and caches (RFC-62 R5), read rather than recomputed,
 * because two producers writing one Redis key corrupt it the moment they
 * diverge. That entry is plot-blind: a dataset-wide statistic is open to a
 * plot-bound viewer, whose own slice is the trait lists, not this ranking.
 *
 * It is exported so a test can assert the full ranking: `getDashboard` cuts
 * it to ten, and which traits make that cut depends on every species and
 * trait in the database.
 * @rfc RFC-72 R1, R2
 * @rfc RFC-62 R5
 */
export async function traitsWithData(
  ctx: DashboardContext,
  visibility: Visibility,
): Promise<TraitWithData[]> {
  const [counts, rows] = await Promise.all([
    speciesCountsByTrait(ctx, visibility),
    ctx.db.execute(sql`
      select t.id as trait_id, t.key as trait_key, t.value_type as value_type, t.unit as unit,
             tc.key as category_key, tc.label as category_label
      from traits t
      join trait_categories tc on tc.key = t.category_key
      where ${traitVisible(visibility, sql`t.active`)}`) as unknown as Promise<TraitRow[]>,
  ]);
  return (
    rows
      .map((r) => ({
        trait: { id: r.trait_id, key: r.trait_key, valueType: r.value_type, unit: r.unit },
        category: { key: r.category_key, label: r.category_label },
        speciesCount: counts.get(r.trait_id) ?? 0,
      }))
      .filter((r) => r.speciesCount > 0)
      // Code-unit order, not `localeCompare`: the tie-break must not move with
      // the server's locale.
      .sort(
        (a, b) =>
          b.speciesCount - a.speciesCount ||
          (a.trait.key < b.trait.key ? -1 : a.trait.key > b.trait.key ? 1 : 0),
      )
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
  const [missingCells, awaiting, withData, summary] = await Promise.all([
    plotIds.length === 0 ? null : missingCellCount(ctx.db, visibility, plotIds),
    plotIds.length === 0 ? null : awaitingValidation(ctx.db, visibility, plotIds),
    traitsWithData(ctx, visibility),
    contributionSummary(ctx.db, viewer.id),
  ]);
  return {
    missingCells,
    awaitingValidation: awaiting,
    topTraitsWithData: withData.slice(0, 10),
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
  const [coverage, pendingGroups, contested, proposals] = await Promise.all([
    coverageTotals(ctx, visibility),
    countPendingGroups(ctx.db, visibility),
    countContested(ctx.db, visibility),
    // RFC-75 R7. A proposal is about a species that does not exist yet, so
    // RFC-33 has nothing to scope this count by: every reviewer sees the same
    // queue, which is also what keeps the cached panel free of proposal rows.
    // Its permission is the queue's own, `taxa.manage` (RFC-75 R3), not the
    // `records.review` the record queues beside it are gated on: a number
    // for a queue whose API would answer 403 is worse than no number.
    viewer.permissions.has('taxa.manage') ? countOpenProposals(ctx.db) : 0,
  ]);
  return { coverage, queues: { pendingGroups, contested, proposals } };
}

/**
 * `GET /api/me/dashboard`: the four sections of RFC-72 R1, each degrading on
 * its own. The sections are independent, so they run together; the viewer's
 * own one is served through `dashboard:<viewer id>` for five minutes and is
 * dropped by the routes that let a viewer change what it counts. The record
 * items it lists are re-hydrated outside that entry, which holds only their
 * ids (RFC-40 R1).
 *
 * Two writes do not drop the entry and leave it stale for the rest of its
 * five minutes: changing which species a plot holds, and revoking
 * `dataset.read_inactive`. Both would have to bust the key of every viewer
 * bound to that plot or holding that role, which is disproportionate to an
 * infrequent administrative action, so RFC-72 R1 states the staleness
 * instead — for at most five minutes a restricted viewer's section may count,
 * and list, a record on a species that has just left their plots. Nothing
 * outside this section is affected: `scope` and `curation` are computed per
 * request, and the ids are re-read through `itemQuery` but not re-filtered.
 * @rfc RFC-72 R1, R2
 * @rfc RFC-40 R1
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
      awaitingValidation: await hydrateAwaiting(ctx.db, visibility, entry.value.awaitingValidation),
    })),
    curationSection(ctx, visibility, viewer),
  ]);
  return { dataset, scope, contributor, curation };
}
