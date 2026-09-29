import type {
  FieldMeans,
  SpeciesScope,
  TraitDetail,
  TraitSpeciesItem,
  TraitSpeciesMode,
} from '@treerepro/contracts';
import { eq, sql } from 'drizzle-orm';
import { globalSpeciesVisible, levelVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { traitCategories, traits } from '../db/schema/dictionary.ts';
import { cachedJson } from '../redis/cache.ts';
import type { Redis } from '../redis/client.ts';
import { validatedPairsSql } from './coverage.ts';
import { getTrait, requireTrait } from './dictionary.ts';
import { liveSql } from './records.ts';
import { searchSpecies } from './taxa.ts';

/** A record whose unit needs checking stays out of every numeric summary (RFC-62 R7, R8). */
const unitChecked = sql`r.unit_status is distinct from 'needs_unit_check'`;

/** How long a trait's distribution stays cached (RFC-62 R7). */
const DISTRIBUTION_TTL_SECONDS = 600;

/** One cache entry per trait and viewer class (RFC-62 R7). */
const distributionKey = (traitId: string, visibility: Visibility) =>
  `trait:${traitId}:distribution:v2:${visibility.inactive ? 'u' : 'r'}`;

type Distribution = TraitDetail['distribution'];

interface LevelRow {
  level_id: string;
  level_key: string;
  species_count: number;
  record_count: number;
}

/** The five field means of RFC-62 R7, R8 and RFC-63 R10, as SQL returns them. */
interface FieldMeansRow {
  single: number | null;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
}

interface NumericRow extends FieldMeansRow {
  species_count: number;
}

const fieldMeansOf = (r: FieldMeansRow): FieldMeans => ({
  single: r.single,
  mean: r.mean,
  median: r.median,
  min: r.min,
  max: r.max,
});

/**
 * The level or numeric spread of one trait over the whole dataset: harmonised
 * records only, species counted distinct, levels with the most species first.
 * A quantitative trait answers the mean of each value field on its own,
 * taken per species first so every species weighs the same; a species
 * without the field stays out of that mean (RFC-62 R7).
 * Plot-blind like every other number of the trait header — see
 * {@link globalSpeciesVisible}.
 */
async function computeDistribution(
  db: DbExecutor,
  visibility: Visibility,
  traitId: string,
  valueType: 'categorical' | 'quantitative',
): Promise<Distribution> {
  if (valueType === 'quantitative') {
    const [row] = (await db.execute(sql`
      with per_species as (
        select avg(r.numeric_value) as single, avg(r.mean_value) as mean,
          avg(r.median_value) as median, avg(r.min_value) as min, avg(r.max_value) as max
        from trait_records r
        join species s on s.id = r.species_id
        where r.trait_id = ${traitId}::uuid
          and r.harmonisation = 'harmonised'
          and coalesce(r.numeric_value, r.min_value, r.max_value, r.mean_value, r.median_value) is not null
          and ${unitChecked}
          and ${liveSql(sql`r.id`)}
          and ${globalSpeciesVisible(visibility, sql`s.active`, sql`s.id`)}
        group by r.species_id
      )
      select avg(single)::float8 as single, avg(mean)::float8 as mean,
        avg(median)::float8 as median, avg(min)::float8 as min, avg(max)::float8 as max,
        count(*)::int as species_count
      from per_species
    `)) as unknown as NumericRow[];
    if (!row || row.species_count === 0) return { numeric: null };
    return { numeric: { means: fieldMeansOf(row), speciesCount: row.species_count } };
  }
  // An inactive level is invisible to a restricted viewer (RFC-33 R2), so its
  // records leave that viewer's distribution with it; the two viewer classes
  // are separate cache entries, so neither ever reads the other's numbers.
  const rows = (await db.execute(sql`
    select l.id as level_id, l.key as level_key,
      count(distinct r.species_id)::int as species_count,
      count(*)::int as record_count
    from trait_records r
    join trait_levels l on l.id = r.level_id
    join species s on s.id = r.species_id
    where r.trait_id = ${traitId}::uuid
      and r.harmonisation = 'harmonised'
      and ${liveSql(sql`r.id`)}
      and ${globalSpeciesVisible(visibility, sql`s.active`, sql`s.id`)}
      and ${levelVisible(visibility, sql`l.active`)}
    group by l.id, l.key
    order by species_count desc, record_count desc, l.key
  `)) as unknown as LevelRow[];
  return {
    levels: rows.map((r) => ({
      level: { id: r.level_id, key: r.level_key },
      speciesCount: r.species_count,
      recordCount: r.record_count,
    })),
  };
}

/**
 * `GET /api/traits/:id`: the trait entry, its category, how many visible
 * species have a value for it, how many are still missing one, how many have
 * a validated record, and the distribution of its harmonised records.
 * `null` when the trait does not exist or the viewer cannot see it (RFC-33
 * R2) — the route answers 404.
 *
 * Every number here is a global summary: it varies with the viewer's
 * active/inactive class and never with their plots, so a plot-bound viewer
 * reads a header counting the whole dataset while the species lists below it
 * stay inside their plots ({@link listTraitSpecies}, RFC-62 R8). Only the
 * distribution is cached — ten minutes per trait and viewer class, since it
 * scans one trait's records — and its `computedAt` is the age the page shows;
 * the counts are read fresh, which is what makes "add a record, see
 * `speciesMissing` fall" true on the next request.
 * @rfc RFC-62 R7
 * @rfc RFC-33 R2
 */
export async function getTraitDetail(
  ctx: { db: DbExecutor; redis: Redis },
  visibility: Visibility,
  id: string,
): Promise<TraitDetail | null> {
  const trait = await getTrait(ctx.db, visibility, id);
  if (!trait) return null;
  const [category, counts, distribution] = await Promise.all([
    ctx.db
      .select({ key: traitCategories.key, label: traitCategories.label })
      .from(traits)
      .innerJoin(traitCategories, eq(traitCategories.key, traits.categoryKey))
      .where(eq(traits.id, id))
      .limit(1),
    ctx.db.execute(sql`
      select
        -- "Visible species without a coverage row" (RFC-62 R7), over exactly
        -- the population speciesWithData counts: an inactive species with no
        -- record must fall on this side for a viewer who can see it, rather
        -- than out of both sides of a header a reader adds up.
        (select count(*)::int
           from species s
          where ${globalSpeciesVisible(visibility, sql`s.active`, sql`s.id`)}
            and not exists (select 1 from species_trait_coverage c
                             where c.species_id = s.id and c.trait_id = ${id}::uuid)
        ) as species_missing,
        (select count(*)::int
           from (${validatedPairsSql()}) v
           join species s on s.id = v.species_id
          where v.trait_id = ${id}::uuid
            and ${globalSpeciesVisible(visibility, sql`s.active`, sql`s.id`)}
        ) as validated_count
    `) as unknown as Promise<{ species_missing: number; validated_count: number }[]>,
    cachedJson(
      ctx.redis,
      distributionKey(id, visibility),
      DISTRIBUTION_TTL_SECONDS,
      async () => await computeDistribution(ctx.db, visibility, id, trait.valueType),
    ),
  ]);
  const [row] = category;
  // The trait was retired out of sight between the two reads; there is no
  // detail to answer.
  if (!row) return null;
  return {
    ...trait,
    category: row,
    // The same number as the dictionary's `speciesCount` (RFC-62 R5): visible
    // species with a coverage row for this trait. The page must not report
    // one figure in the list and another in the header.
    speciesWithData: trait.speciesCount,
    speciesMissing: counts[0]?.species_missing ?? 0,
    validatedCount: counts[0]?.validated_count ?? 0,
    distribution: distribution.value,
    computedAt: distribution.computedAt,
  };
}

/**
 * `GET /api/traits/:id/species` filters: the taxonomy and plot filters of the
 * species list (RFC-60 R6) plus which side of the trait to list.
 * @rfc RFC-62 R8
 */
export interface TraitSpeciesInput {
  mode: TraitSpeciesMode;
  q?: string;
  familyId?: string;
  genusId?: string;
  scope?: SpeciesScope;
  plotId?: string;
  viewerPlotIds?: string[];
  cursor?: string;
  limit: number;
}

interface SpeciesLevelRow {
  species_id: string;
  level_key: string | null;
  count: number;
}

interface SpeciesNumericRow extends FieldMeansRow {
  species_id: string;
  record_count: number;
}

type Summary = TraitSpeciesItem['summary'];

/** What the page's species have on the trait, keyed by species id. */
interface Enrichment {
  recordCount: Map<string, number>;
  summary: Map<string, Summary>;
  validated: Map<string, boolean>;
}

/**
 * The records of the species of one page, in one query bounded to that
 * page's ids (at most `limit` ≤ 200, the coverage index's `(species_id,
 * trait_id)` prefix) rather than to the trait as a whole, plus one further
 * query for which of those species has a validated record on the trait
 * (spec R-1, RFC-62 R8), the same bound applied to {@link validatedPairsSql}.
 */
async function enrich(
  db: DbExecutor,
  visibility: Visibility,
  traitId: string,
  valueType: 'categorical' | 'quantitative',
  ids: string[],
): Promise<Enrichment> {
  const recordCount = new Map<string, number>();
  const summary = new Map<string, Summary>();

  const validatedRows = db.execute(sql`
    select v.species_id
    from (${validatedPairsSql()}) v
    where v.trait_id = ${traitId}::uuid and v.species_id = any(${sql.param(ids)}::uuid[])
  `) as unknown as Promise<{ species_id: string }[]>;

  let validatedRowsResult: { species_id: string }[];

  if (valueType === 'quantitative') {
    const [rows, result] = await Promise.all([
      db.execute(sql`
        select r.species_id, count(*)::int as record_count,
          avg(r.numeric_value) filter (where ${unitChecked})::float8 as single,
          avg(r.mean_value) filter (where ${unitChecked})::float8 as mean,
          avg(r.median_value) filter (where ${unitChecked})::float8 as median,
          avg(r.min_value) filter (where ${unitChecked})::float8 as min,
          avg(r.max_value) filter (where ${unitChecked})::float8 as max
        from trait_records r
        where r.trait_id = ${traitId}::uuid and r.species_id = any(${sql.param(ids)}::uuid[])
          and ${liveSql(sql`r.id`)}
        group by r.species_id
      `) as unknown as Promise<SpeciesNumericRow[]>,
      validatedRows,
    ]);
    validatedRowsResult = result;
    for (const r of rows) {
      recordCount.set(r.species_id, r.record_count);
      summary.set(
        r.species_id,
        [r.single, r.mean, r.median, r.min, r.max].every((v) => v === null)
          ? null
          : { numeric: { means: fieldMeansOf(r) } },
      );
    }
  } else {
    const [rows, result] = await Promise.all([
      db.execute(sql`
        select r.species_id, l.key as level_key, count(*)::int as count
        from trait_records r
        left join trait_levels l
          on l.id = r.level_id and ${levelVisible(visibility, sql`l.active`)}
        where r.trait_id = ${traitId}::uuid and r.species_id = any(${sql.param(ids)}::uuid[])
          and ${liveSql(sql`r.id`)}
        group by r.species_id, l.key
        order by count desc, l.key
      `) as unknown as Promise<SpeciesLevelRow[]>,
      validatedRows,
    ]);
    validatedRowsResult = result;
    const levels = new Map<string, { key: string; count: number }[]>();
    for (const r of rows) {
      // Every record counts, harmonised or not; only the ones that landed on
      // a visible level can be summarised (RFC-63 R5).
      recordCount.set(r.species_id, (recordCount.get(r.species_id) ?? 0) + r.count);
      if (r.level_key === null) continue;
      levels.set(r.species_id, [
        ...(levels.get(r.species_id) ?? []),
        { key: r.level_key, count: r.count },
      ]);
    }
    for (const [speciesId, entries] of levels) summary.set(speciesId, { levels: entries });
  }

  const validated = new Map(validatedRowsResult.map((r) => [r.species_id, true]));
  return { recordCount, summary, validated };
}

/**
 * `GET /api/traits/:id/species`: one page of the species that have a record
 * on the trait (`mode: 'with'`) or of those that have none (`mode:
 * 'missing'`), in the order and with the cursor of the species list — it is
 * the species list, narrowed by the coverage table, so visibility, plot scope
 * and the taxonomy filters have one implementation ({@link searchSpecies},
 * over `speciesListConditions`).
 *
 * Unlike the header counts of {@link getTraitDetail}, this list is plot-bound
 * for a plot-bound viewer (RFC-62 R8 lists the plot scope of RFC-33 R6): such
 * a viewer may read how many species the dataset has values for, but may only
 * browse their own.
 *
 * In `with` mode each row carries the species' own records on the trait and
 * whether one of them is validated (spec R-1); `missing` mode has no records
 * to describe, so all three are null. Throws `TRAIT_NOT_FOUND` when the trait
 * is unknown or invisible.
 * @rfc RFC-62 R8
 * @rfc RFC-33 R2, R6
 */
export async function listTraitSpecies(
  db: DbExecutor,
  visibility: Visibility,
  traitId: string,
  input: TraitSpeciesInput,
): Promise<{ data: TraitSpeciesItem[]; nextCursor: string | null }> {
  const trait = await requireTrait(db, visibility, traitId);
  const { data, nextCursor } = await searchSpecies(db, visibility, {
    q: input.q,
    familyId: input.familyId,
    genusId: input.genusId,
    scope: input.scope,
    plotId: input.plotId,
    viewerPlotIds: input.viewerPlotIds,
    traitId,
    traitData: input.mode,
    cursor: input.cursor,
    limit: input.limit,
  });
  if (input.mode === 'missing' || data.length === 0) {
    return {
      data: data.map((s) => ({ ...s, recordCount: null, validated: null, summary: null })),
      nextCursor,
    };
  }
  const enrichment = await enrich(
    db,
    visibility,
    traitId,
    trait.valueType,
    data.map((s) => s.id),
  );
  return {
    data: data.map((s) => ({
      ...s,
      recordCount: enrichment.recordCount.get(s.id) ?? 0,
      validated: enrichment.validated.get(s.id) ?? false,
      summary: enrichment.summary.get(s.id) ?? null,
    })),
    nextCursor,
  };
}
