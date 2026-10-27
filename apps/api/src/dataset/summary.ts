import {
  type SpeciesTraits,
  SUMMARY_OUTLIER_FLAGS,
  type SummaryOutlierFlag,
  type TraitSummary,
} from '@treerepro/contracts';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import { speciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { species } from '../db/schema/taxa.ts';
import { levelContestedSql, recordContestedSql } from './contests.ts';
import { validatedPairsSql } from './coverage.ts';
import { dictionaryCategories } from './dictionary.ts';
import { recordVisible } from './records.ts';
import {
  type CategoricalTraitSummary,
  type ContinuousSummary,
  categoricalSummaries,
  continuousSummaries,
  speciesTraitStates,
} from './species-summary.ts';

/** A record's effective unit: its own, else its trait's standard unit (RFC-63 R10). */
const effectiveUnit = 'coalesce(r.unit, su.unit)';

/** A study summary's field repeated on its records: kept on the first, nulled on the rest. */
const once = (field: string) =>
  sql.raw(`case when row_number() over (partition by r.species_id, r.trait_id,
    r.primary_reference_id, r.secondary_reference_id, r.${field}, ${effectiveUnit},
    r.unit_status is distinct from 'needs_unit_check' order by r.id) = 1
    then r.${field} end as ${field}_once`);

/**
 * The `trait_records` matching `where` (written against alias `r`), as alias
 * `r` with `summary_unit` — the record's effective unit, its own `unit` or
 * else its trait's — and `mean_value_once`, `median_value_once`,
 * `min_value_once` and `max_value_once` beside every column: the field on
 * the first record of each species, trait, (primary reference, secondary
 * reference, value), effective unit and unit-check class, null on the
 * others, so a study's summary repeated on each of its measurement rows
 * enters a mean once. `where` must hold every per-record filter of the
 * summary, so a filtered-out record never takes the place of a counted one.
 * @rfc RFC-63 R10
 * @rfc RFC-62 R7, R8
 */
export function summaryRecordsSql(where: SQL): SQL {
  return sql`(select r.*, ${sql.raw(effectiveUnit)} as summary_unit,
      ${once('mean_value')}, ${once('median_value')}, ${once('min_value')}, ${once('max_value')}
    from trait_records r join traits su on su.id = r.trait_id where ${where}) r`;
}

interface TraitAggregate {
  trait_id: string;
  trait_key: string;
  value_type: 'categorical' | 'quantitative';
  unit: string | null;
  category_key: string;
  category_label: string;
  record_count: number;
  harmonised: number;
  unknown_level: number;
  multi_value: number;
  not_numeric: number;
  empty: number;
  contested: boolean;
}

interface LevelAggregate {
  trait_id: string;
  level_id: string;
  level_key: string;
  validation_count: number;
  contested: boolean;
}

/**
 * RFC-77 R5's row in the shape of RFC-63 R10 and RFC-62 R8.
 * @rfc RFC-77 R5
 * @rfc RFC-63 R10
 */
export function continuousOf(c: ContinuousSummary | undefined): TraitSummary['continuous'] {
  if (!c) return null;
  return {
    median: c.speciesMedian,
    summaryBasis: c.summaryBasis,
    mean: c.speciesMean,
    meanBasis: c.meanBasis,
    sd: c.speciesSd,
    min: c.speciesMin,
    max: c.speciesMax,
    nRecords: c.nRecords,
    nSources: c.nSources,
    outlierFlags: c.outlierFlags
      .split(';')
      .filter((f): f is SummaryOutlierFlag =>
        (SUMMARY_OUTLIER_FLAGS as readonly string[]).includes(f),
      ),
    unit: c.unit,
  };
}

/** RFC-77 R7's row in the shape of RFC-63 R10. */
function categoricalOf(c: CategoricalTraitSummary | undefined): TraitSummary['categorical'] {
  if (!c) return null;
  return {
    mainStates: c.mainState.split(';'),
    share: c.share,
    majority: c.majority,
    states: c.states === '' ? [] : c.states.split(';'),
    nReferences: c.nReferences,
  };
}

/**
 * One call for the species page: per category and trait, counts on both axes,
 * level distribution (each level with its validators, contested flag and its
 * sources and share in the species summary), the species summaries of RFC-77
 * computed live for this species (`continuous`, `categorical`), and whether any
 * record is validated or contested. `null` when the species itself is
 * invisible to `visibility`.
 * @rfc RFC-63 R10
 * @rfc RFC-77 R8
 * @rfc RFC-70 R7
 * @rfc RFC-33 R2, R3
 */
export async function speciesTraitSummary(
  db: DbExecutor,
  visibility: Visibility,
  speciesId: string,
  options?: { missingOnly?: boolean },
): Promise<SpeciesTraits | null> {
  const [exists] = await db
    .select({ id: species.id })
    .from(species)
    .where(and(eq(species.id, speciesId), speciesVisible(visibility)))
    .limit(1);
  if (!exists) return null;
  const [aggregates, levels, validated, continuous, categorical] = await Promise.all([
    db.execute(sql`
      select t.id as trait_id, t.key as trait_key, t.value_type, t.unit,
        c.key as category_key, c.label as category_label,
        count(*)::int as record_count,
        count(*) filter (where r.harmonisation = 'harmonised')::int as harmonised,
        count(*) filter (where r.harmonisation = 'unknown_level')::int as unknown_level,
        count(*) filter (where r.harmonisation = 'multi_value')::int as multi_value,
        count(*) filter (where r.harmonisation = 'not_numeric')::int as not_numeric,
        count(*) filter (where r.harmonisation = 'empty')::int as empty,
        bool_or(${recordContestedSql(visibility, sql`r.id`)}) as contested
      from trait_records r
      join traits t on t.id = r.trait_id
      join trait_categories c on c.key = t.category_key
      join species s on s.id = r.species_id
      where r.species_id = ${speciesId}
        and ${recordVisible(visibility, sql`r.id`, sql`r.harmonisation`)}
        and ${traitVisible(visibility, sql`t.active`)}
        and ${speciesVisible(visibility, sql`s.active`, sql`s.id`)}
      group by t.id, t.key, t.value_type, t.unit, c.key, c.label, c.sort_order
      order by c.sort_order, c.key, t.key`) as unknown as Promise<TraitAggregate[]>,
    db.execute(sql`
      select r.trait_id, l.id as level_id, l.key as level_key,
        (select count(distinct va.actor_id) from record_annotations va
          join trait_records vr on vr.id = va.record_id
          where va.kind = 'confirm' and vr.species_id = ${speciesId} and vr.trait_id = r.trait_id
            and vr.level_id = l.id
            and ${recordVisible(visibility, sql`vr.id`, sql`vr.harmonisation`)})::int as validation_count,
        ${levelContestedSql(visibility, sql`${speciesId}::uuid`, sql`r.trait_id`, sql`l.id`)} as contested
      from trait_records r
      join trait_levels l on l.id = r.level_id
      join traits t on t.id = r.trait_id
      join species s on s.id = r.species_id
      where r.species_id = ${speciesId}
        and ${traitVisible(visibility, sql`t.active`)}
        and ${speciesVisible(visibility, sql`s.active`, sql`s.id`)}
        and ${recordVisible(visibility, sql`r.id`, sql`r.harmonisation`)}
      group by r.trait_id, l.id, l.key`) as unknown as Promise<LevelAggregate[]>,
    // Visibility needs no predicate here: only visible traits reach
    // `summaryOf`, and the species was checked above.
    db.execute(sql`
      select v.trait_id from (${validatedPairsSql()}) v
      where v.species_id = ${speciesId}`) as unknown as Promise<{ trait_id: string }[]>,
    // RFC-77, live for this species under the viewer's visibility (RFC-77 R8).
    continuousSummaries(db, visibility, [speciesId]),
    categoricalSummaries(db, visibility, [speciesId]),
  ]);
  const continuousByTrait = new Map(continuous.map((c) => [c.traitId, c]));
  const levelSummaries = new Map(categorical.map((l) => [`${l.traitId}:${l.level}`, l]));
  const categoricalByTrait = new Map(speciesTraitStates(categorical).map((c) => [c.traitId, c]));
  const levelsByTrait = new Map<string, NonNullable<TraitSummary['levels']>>();
  for (const l of levels) {
    const counted = levelSummaries.get(`${l.trait_id}:${l.level_key}`);
    levelsByTrait.set(l.trait_id, [
      ...(levelsByTrait.get(l.trait_id) ?? []),
      {
        levelId: l.level_id,
        key: l.level_key,
        nReferences: counted?.nReferences ?? 0,
        validationCount: l.validation_count,
        contested: l.contested,
        nSources: counted?.nSources ?? 0,
        shareOfReferences: counted?.shareOfReferences ?? 0,
      },
    ]);
  }
  // RFC-63 R10: references descending, then key.
  for (const list of levelsByTrait.values()) {
    list.sort(
      (a, b) => b.nReferences - a.nReferences || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
  }
  const validatedTraits = new Set(validated.map((v) => v.trait_id));
  const summaryOf = (
    trait: TraitSummary['trait'],
    row: TraitAggregate | undefined,
  ): TraitSummary => {
    const quantitative = trait.valueType === 'quantitative';
    return {
      trait,
      recordCount: row?.record_count ?? 0,
      harmonisationCounts: {
        harmonised: row?.harmonised ?? 0,
        unknownLevel: row?.unknown_level ?? 0,
        multiValue: row?.multi_value ?? 0,
        notNumeric: row?.not_numeric ?? 0,
        empty: row?.empty ?? 0,
      },
      levels: quantitative ? null : (levelsByTrait.get(trait.id) ?? []),
      continuous: quantitative ? continuousOf(continuousByTrait.get(trait.id)) : null,
      categorical: quantitative ? null : categoricalOf(categoricalByTrait.get(trait.id)),
      validated: validatedTraits.has(trait.id),
      contested: row?.contested ?? false,
    };
  };

  // `missingOnly` walks the dictionary instead of the aggregates and keeps
  // the traits the species has no visible record for — empty summaries in
  // dictionary order, a category only when it keeps one (RFC-70 R7).
  if (options?.missingOnly) {
    const withData = new Set(aggregates.map((row) => row.trait_id));
    const dictionary = await dictionaryCategories(db, visibility);
    return dictionary
      .map((cat) => ({
        category: { key: cat.key, label: cat.label },
        traits: cat.traits
          .filter((t) => !withData.has(t.id))
          .map((t) =>
            summaryOf({ id: t.id, key: t.key, valueType: t.valueType, unit: t.unit }, undefined),
          ),
      }))
      .filter((cat) => cat.traits.length > 0);
  }

  const result: SpeciesTraits = [];
  for (const row of aggregates) {
    let category = result[result.length - 1];
    if (!category || category.category.key !== row.category_key) {
      category = { category: { key: row.category_key, label: row.category_label }, traits: [] };
      result.push(category);
    }
    category.traits.push(
      summaryOf(
        { id: row.trait_id, key: row.trait_key, valueType: row.value_type, unit: row.unit },
        row,
      ),
    );
  }
  return result;
}
