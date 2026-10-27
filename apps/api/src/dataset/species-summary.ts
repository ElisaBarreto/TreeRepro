import { type SQL, sql } from 'drizzle-orm';
import { speciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { recordVisible } from './records.ts';

/** How a continuous summary's value was reached (RFC-77 R5). @rfc RFC-77 R5 */
export type SummaryBasis =
  | 'median_of_source_medians'
  | 'central_values'
  | 'range_midpoint'
  | 'single_bound'
  | 'none';

/** One species × continuous trait (RFC-77 R5). @rfc RFC-77 R5 */
export interface ContinuousSummary {
  speciesId: string;
  traitId: string;
  speciesName: string;
  traitKey: string;
  speciesMedian: number | null;
  summaryBasis: SummaryBasis;
  speciesMean: number | null;
  meanBasis: SummaryBasis;
  speciesSd: number | null;
  speciesMin: number | null;
  speciesMax: number | null;
  nRecords: number;
  nSources: number;
  /** `unit_factor`, `trait_extreme` and/or `bounds_inverted`, joined with `;`; empty when none. */
  outlierFlags: string;
  unit: string | null;
}

/** One species × categorical trait × state (RFC-77 R6). @rfc RFC-77 R6 */
export interface CategoricalLevelSummary {
  speciesId: string;
  traitId: string;
  speciesName: string;
  traitKey: string;
  level: string;
  nReferences: number;
  nSources: number;
  nReferencesSpeciesTrait: number;
  nSourcesSpeciesTrait: number;
  shareOfReferences: number;
  shareOfSources: number;
  nLevels: number;
  isMainState: boolean;
  mainState: string;
}

/** One species × categorical trait (RFC-77 R7). @rfc RFC-77 R7 */
export interface CategoricalTraitSummary {
  speciesId: string;
  traitId: string;
  speciesName: string;
  traitKey: string;
  mainState: string;
  share: number;
  majority: boolean;
  states: string;
  allStates: string;
  nReferences: number;
  nStates: number;
}

/**
 * The records a summary may count (RFC-77 R1), as alias `r` joined to `t`
 * (traits) and `s` (species), with the observation key and the source of
 * RFC-77 R2 and R3 and the reference of R6. `speciesIds` null means every
 * species.
 * @rfc RFC-77 R1, R2, R3, R6
 */
export function countedRecordsSql(
  visibility: Visibility,
  valueType: 'quantitative' | 'categorical',
  speciesIds: readonly string[] | null,
  traitId?: string,
): SQL {
  const only =
    speciesIds === null
      ? sql`true`
      : sql`r.species_id in (${sql.join(
          speciesIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  return sql`
    select r.*, s.canonical_name, t.key as trait_key, t.unit as target_unit,
      coalesce(r.import_batch_id::text || ':' || r.import_row_no::text, r.id::text) as obs_id,
      case when r.origin = 'import' then coalesce(r.source_folder, '')
           else 'ref:' || coalesce(r.primary_reference_id::text, '') end as source,
      -- R6: the owner's source_folder + primary reference, else secondary; a
      -- reference id stands for its citation key, which is unique.
      case when r.origin = 'import'
           then coalesce(r.source_folder, '') || '|'
             || coalesce(r.primary_reference_id, r.secondary_reference_id)::text
           else 'ref:' || coalesce(r.primary_reference_id::text, '') end as ref
    from trait_records r
    join traits t on t.id = r.trait_id
    join species s on s.id = r.species_id
    where t.value_type = ${valueType} and r.harmonisation = 'harmonised' and ${only}
      ${traitId ? sql`and r.trait_id = ${traitId}::uuid` : sql``}
      and ${recordVisible(visibility, sql`r.id`, sql`r.harmonisation`)}
      and ${traitVisible(visibility, sql`t.active`)}
      and ${speciesVisible(visibility, sql`s.active`, sql`s.id`)}`;
}

/**
 * The continuous summaries of RFC-77 R4–R5, for `speciesIds` (null: every
 * species), in one statement: records become central values, bounds and
 * spreads, which are reduced per species × trait. `traitId` narrows it to one
 * trait (the trait page's species list, RFC-62 R8).
 * @rfc RFC-77 R1, R2, R3, R4, R5, R8
 */
export async function continuousSummaries(
  db: DbExecutor,
  visibility: Visibility,
  speciesIds: readonly string[] | null,
  traitId?: string,
): Promise<ContinuousSummary[]> {
  if (speciesIds !== null && speciesIds.length === 0) return [];
  const rows = (await db.execute(sql`
    with base as (${countedRecordsSql(visibility, 'quantitative', speciesIds, traitId)}),
    flagged as (
      select b.*, b.summary_source is null as own,
        b.unit_status is distinct from 'needs_unit_check' as usable,
        -- R4: a study's summary, repeated on each of its records, is taken once.
        b.summary_source = 'reported_by_study' and row_number() over (
          partition by b.species_id, b.trait_id, b.source, b.source_file, b.primary_reference_id,
            b.unit, b.min_value, b.max_value, b.sd_value, b.se_value, b.n
          order by b.import_row_no nulls last, b.id) = 1 as study_once
      from base b
    ),
    pieces as (
      select species_id, trait_id, canonical_name, trait_key, target_unit, obs_id, source,
        outlier_flag, usable, 'central' as cls, '' as stat,
        coalesce(numeric_value, case when own then coalesce(mean_value, median_value) end)::float8 as value,
        (case when own and n >= 1 then n else 1 end)::float8 as weight
      from flagged
      where coalesce(numeric_value, case when own then coalesce(mean_value, median_value) end) is not null
      union all
      select species_id, trait_id, canonical_name, trait_key, target_unit, obs_id, source,
        outlier_flag, usable, x.cls, x.stat, x.value::float8, 1
      from flagged
      cross join lateral (values ('bound', 'min', min_value), ('bound', 'max', max_value),
        ('spread', 'sd', sd_value), ('spread', 'se', se_value)) as x(cls, stat, value)
      where (own or study_once) and x.value is not null
    ),
    central as (select * from pieces where cls = 'central' and usable),
    source_medians as (
      select species_id, trait_id, source, percentile_cont(0.5) within group (order by value) as m
      from central group by 1, 2, 3
    ),
    central_median as (
      select species_id, trait_id, percentile_cont(0.5) within group (order by m) as v
      from source_medians group by 1, 2
    ),
    weighted as (
      select species_id, trait_id, sum(value * weight) / sum(weight) as mean, count(*) as n
      from central group by 1, 2
    ),
    spread as (
      select c.species_id, c.trait_id,
        case when w.n >= 2
             then sqrt(sum(c.weight * (c.value - w.mean) ^ 2) / sum(c.weight)) end as sd
      from central c join weighted w using (species_id, trait_id)
      group by c.species_id, c.trait_id, w.n
    ),
    bounds as (
      select species_id, trait_id,
        percentile_cont(0.5) within group (order by value) filter (where stat = 'min') as median_min,
        percentile_cont(0.5) within group (order by value) filter (where stat = 'max') as median_max,
        avg(value) filter (where stat = 'min') as mean_min,
        avg(value) filter (where stat = 'max') as mean_max
      from pieces where cls = 'bound' and usable group by 1, 2
    ),
    context as (
      select species_id, trait_id, canonical_name, trait_key, target_unit,
        count(distinct obs_id)::int as n_records, count(distinct source)::int as n_sources,
        bool_or(cls <> 'spread' and outlier_flag like '%unit_factor%') as unit_factor,
        bool_or(cls <> 'spread' and outlier_flag like '%trait_extreme%') as trait_extreme,
        bool_or(outlier_flag = 'bounds_inverted') as bounds_inverted,
        min(value) filter (where cls <> 'spread' and usable) as observed_min,
        max(value) filter (where cls <> 'spread' and usable) as observed_max
      from pieces group by 1, 2, 3, 4, 5
    ),
    summary as (
      select x.*, cm.v as central_median, w.mean as central_mean, sp.sd,
        b.median_min, b.median_max, b.mean_min, b.mean_max
      from context x
      left join central_median cm using (species_id, trait_id)
      left join weighted w using (species_id, trait_id)
      left join spread sp using (species_id, trait_id)
      left join bounds b using (species_id, trait_id)
    )
    select species_id as "speciesId", trait_id as "traitId", canonical_name as "speciesName",
      trait_key as "traitKey", target_unit as unit, n_records as "nRecords", n_sources as "nSources",
      case when central_median is not null then central_median
           when median_min is not null and median_max is not null then (median_min + median_max) / 2
           else coalesce(median_min, median_max) end as "speciesMedian",
      case when central_median is not null then 'median_of_source_medians'
           when median_min is not null and median_max is not null then 'range_midpoint'
           when coalesce(median_min, median_max) is not null then 'single_bound'
           else 'none' end as "summaryBasis",
      case when central_mean is not null then central_mean
           when mean_min is not null and mean_max is not null then (mean_min + mean_max) / 2
           else coalesce(mean_min, mean_max) end as "speciesMean",
      case when central_mean is not null then 'central_values'
           when mean_min is not null and mean_max is not null then 'range_midpoint'
           when coalesce(mean_min, mean_max) is not null then 'single_bound'
           else 'none' end as "meanBasis",
      sd as "speciesSd", observed_min as "speciesMin", observed_max as "speciesMax",
      concat_ws(';', case when unit_factor then 'unit_factor' end,
                     case when trait_extreme then 'trait_extreme' end,
                     case when bounds_inverted then 'bounds_inverted' end) as "outlierFlags"
    from summary
    where coalesce(central_median, central_mean, median_min, median_max, observed_min, observed_max) is not null
    order by trait_key, canonical_name`)) as unknown as ContinuousSummary[];
  return rows;
}

/**
 * The categorical summaries of RFC-77 R6, one row per species × trait ×
 * state, for `speciesIds` (null: every species), counted in distinct
 * references, each stating a state once however many records say it.
 * @rfc RFC-77 R1, R3, R6, R8
 */
export async function categoricalSummaries(
  db: DbExecutor,
  visibility: Visibility,
  speciesIds: readonly string[] | null,
): Promise<CategoricalLevelSummary[]> {
  if (speciesIds !== null && speciesIds.length === 0) return [];
  const rows = (await db.execute(sql`
    with base as (
      select r.species_id, r.trait_id, r.canonical_name, r.trait_key, r.source, r.ref,
        l.key as level
      from (${countedRecordsSql(visibility, 'categorical', speciesIds)}) r
      join trait_levels l on l.id = r.level_id
    ),
    totals as (
      select species_id, trait_id, count(distinct ref)::int as n_refs_t,
        count(distinct source)::int as n_sources_t
      from base group by 1, 2
    ),
    levels as (
      select species_id, trait_id, canonical_name, trait_key, level,
        count(distinct ref)::int as n_refs, count(distinct source)::int as n_sources
      from base group by 1, 2, 3, 4, 5
    ),
    ranked as (
      select l.*, t.n_refs_t, t.n_sources_t,
        count(*) over (partition by l.species_id, l.trait_id)::int as n_levels,
        l.n_refs = max(l.n_refs) over (partition by l.species_id, l.trait_id) as is_main
      from levels l join totals t using (species_id, trait_id)
    ),
    main as (
      select species_id, trait_id, string_agg(level, ';' order by level) as main_state
      from ranked where is_main group by 1, 2
    )
    select r.species_id as "speciesId", r.trait_id as "traitId", r.canonical_name as "speciesName",
      r.trait_key as "traitKey", r.level, r.n_refs as "nReferences", r.n_sources as "nSources",
      r.n_refs_t as "nReferencesSpeciesTrait", r.n_sources_t as "nSourcesSpeciesTrait",
      r.n_refs::float8 / r.n_refs_t as "shareOfReferences",
      r.n_sources::float8 / r.n_sources_t as "shareOfSources",
      r.n_levels as "nLevels", r.is_main as "isMainState", m.main_state as "mainState"
    from ranked r join main m using (species_id, trait_id)
    order by r.trait_key, r.canonical_name, r.level`)) as unknown as CategoricalLevelSummary[];
  return rows;
}

/** A state is a clear minority under this share of both references and sources (RFC-77 R7). */
const MINORITY = 0.1;

/**
 * The per species × categorical trait row of RFC-77 R7, from the level rows
 * of {@link categoricalSummaries}.
 * @rfc RFC-77 R7
 */
export function speciesTraitStates(
  levels: readonly CategoricalLevelSummary[],
): CategoricalTraitSummary[] {
  const groups = new Map<string, CategoricalLevelSummary[]>();
  for (const level of levels) {
    const key = `${level.speciesId}:${level.traitId}`;
    const group = groups.get(key);
    if (group) group.push(level);
    else groups.set(key, [level]);
  }
  return [...groups.values()].map((group) => {
    const ordered = [...group].sort(
      (a, b) =>
        b.nReferences - a.nReferences || (a.level < b.level ? -1 : a.level > b.level ? 1 : 0),
    );
    const first = ordered[0] as CategoricalLevelSummary;
    const top = Math.max(...group.map((l) => l.shareOfReferences));
    // As EB: the majority is decided on the exact share, which is reported rounded.
    const share = Math.round(top * 1e4) / 1e4;
    return {
      speciesId: first.speciesId,
      traitId: first.traitId,
      speciesName: first.speciesName,
      traitKey: first.traitKey,
      mainState: first.mainState,
      share,
      majority: top >= 0.5,
      states: ordered
        .filter((l) => !(l.shareOfReferences < MINORITY && l.shareOfSources < MINORITY))
        .map((l) => l.level)
        .join(';'),
      allStates: ordered.map((l) => l.level).join(';'),
      nReferences: first.nReferencesSpeciesTrait,
      nStates: first.nLevels,
    };
  });
}
