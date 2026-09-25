import type { SpeciesTraits, TraitSummary } from '@treerepro/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { speciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { species } from '../db/schema/taxa.ts';
import { validatedPairsSql } from './coverage.ts';
import { dictionaryCategories } from './dictionary.ts';
import { recordVisible } from './records.ts';

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
  numeric_min: number | null;
  numeric_mean: number | null;
  numeric_max: number | null;
  numeric_count: number;
}

interface LevelAggregate {
  trait_id: string;
  level_id: string;
  level_key: string;
  count: number;
}

/**
 * One call for the species page: per category and trait, counts on both axes,
 * level distribution or numeric spread, and whether any record is validated.
 * `null` when the species itself is invisible to `visibility`.
 * The numeric spread follows spec R-5: the smallest and largest of single,
 * min, max and mean, and the mean of each record's single value or, without
 * one, its mean.
 * @rfc RFC-63 R10
 * @rfc RFC-70 R7
 * @rfc RFC-33 R2, R3
 */
export async function speciesTraitSummary(
  db: DbExecutor,
  visibility: Visibility,
  speciesId: string,
  options?: { includeMissing?: boolean },
): Promise<SpeciesTraits | null> {
  const [exists] = await db
    .select({ id: species.id })
    .from(species)
    .where(and(eq(species.id, speciesId), speciesVisible(visibility)))
    .limit(1);
  if (!exists) return null;
  const [aggregates, levels, validated] = await Promise.all([
    db.execute(sql`
      select t.id as trait_id, t.key as trait_key, t.value_type, t.unit,
        c.key as category_key, c.label as category_label,
        count(*)::int as record_count,
        count(*) filter (where r.harmonisation = 'harmonised')::int as harmonised,
        count(*) filter (where r.harmonisation = 'unknown_level')::int as unknown_level,
        count(*) filter (where r.harmonisation = 'multi_value')::int as multi_value,
        count(*) filter (where r.harmonisation = 'not_numeric')::int as not_numeric,
        count(*) filter (where r.harmonisation = 'empty')::int as empty,
        min(least(r.numeric_value, r.min_value, r.max_value, r.mean_value))::float8 as numeric_min,
        max(greatest(r.numeric_value, r.min_value, r.max_value, r.mean_value))::float8 as numeric_max,
        avg(coalesce(r.numeric_value, r.mean_value))::float8 as numeric_mean,
        count(*) filter (where coalesce(r.numeric_value, r.min_value, r.max_value, r.mean_value) is not null)::int as numeric_count
      from trait_records r
      join traits t on t.id = r.trait_id
      join trait_categories c on c.key = t.category_key
      join species s on s.id = r.species_id
      where r.species_id = ${speciesId}
        and ${traitVisible(visibility, sql`t.active`)}
        and ${speciesVisible(visibility, sql`s.active`, sql`s.id`)}
        and ${recordVisible(visibility, sql`r.id`, sql`r.harmonisation`)}
      group by t.id, t.key, t.value_type, t.unit, c.key, c.label, c.sort_order
      order by c.sort_order, c.key, t.key`) as unknown as Promise<TraitAggregate[]>,
    db.execute(sql`
      select r.trait_id, l.id as level_id, l.key as level_key, count(*)::int as count
      from trait_records r
      join trait_levels l on l.id = r.level_id
      join traits t on t.id = r.trait_id
      join species s on s.id = r.species_id
      where r.species_id = ${speciesId}
        and ${traitVisible(visibility, sql`t.active`)}
        and ${speciesVisible(visibility, sql`s.active`, sql`s.id`)}
        and ${recordVisible(visibility, sql`r.id`, sql`r.harmonisation`)}
      group by r.trait_id, l.id, l.key
      order by count desc, l.key`) as unknown as Promise<LevelAggregate[]>,
    // Visibility needs no predicate here: only visible traits reach
    // `summaryOf`, and the species was checked above.
    db.execute(sql`
      select v.trait_id from (${validatedPairsSql()}) v
      where v.species_id = ${speciesId}`) as unknown as Promise<{ trait_id: string }[]>,
  ]);
  const levelsByTrait = new Map<string, NonNullable<TraitSummary['levels']>>();
  for (const l of levels) {
    levelsByTrait.set(l.trait_id, [
      ...(levelsByTrait.get(l.trait_id) ?? []),
      { levelId: l.level_id, key: l.level_key, count: l.count },
    ]);
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
      numeric:
        quantitative &&
        row !== undefined &&
        row.numeric_count > 0 &&
        row.numeric_min !== null &&
        row.numeric_max !== null
          ? {
              min: row.numeric_min,
              max: row.numeric_max,
              mean: row.numeric_mean,
              count: row.numeric_count,
            }
          : null,
      validated: validatedTraits.has(trait.id),
    };
  };

  // `includeMissing` walks the dictionary instead of the aggregates, so a
  // trait the species has no record for still gets a row — an empty summary
  // in dictionary order (RFC-70 R7).
  if (options?.includeMissing) {
    const aggregatesByTrait = new Map(aggregates.map((row) => [row.trait_id, row]));
    const dictionary = await dictionaryCategories(db, visibility);
    return dictionary.map((cat) => ({
      category: { key: cat.key, label: cat.label },
      traits: cat.traits.map((t) =>
        summaryOf(
          { id: t.id, key: t.key, valueType: t.valueType, unit: t.unit },
          aggregatesByTrait.get(t.id),
        ),
      ),
    }));
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
