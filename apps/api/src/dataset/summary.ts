import type { SpeciesTraits, TraitSummary } from '@treerepro/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { speciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { species } from '../db/schema/taxa.ts';

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
  numeric_median: number | null;
  numeric_max: number | null;
  numeric_count: number;
}

interface LevelAggregate {
  trait_id: string;
  level_id: string;
  level_key: string;
  count: number;
}

interface AcceptedCurrent {
  trait_id: string;
  decision: 'accepted' | 'cleared';
  record_id: string | null;
  value_text: string | null;
  created_at: Date;
}

/**
 * One call for the species page: per category and trait, counts on both axes,
 * level distribution or numeric spread, and the current accepted value.
 * `null` when the species itself is invisible to `visibility`.
 * @rfc RFC-63 R10
 * @rfc RFC-33 R2, R3
 */
export async function speciesTraitSummary(
  db: DbExecutor,
  visibility: Visibility,
  speciesId: string,
): Promise<SpeciesTraits | null> {
  const [exists] = await db
    .select({ id: species.id })
    .from(species)
    .where(and(eq(species.id, speciesId), speciesVisible(visibility)))
    .limit(1);
  if (!exists) return null;
  const [aggregates, levels, accepted] = await Promise.all([
    db.execute(sql`
      select t.id as trait_id, t.key as trait_key, t.value_type, t.unit,
        c.key as category_key, c.label as category_label,
        count(*)::int as record_count,
        count(*) filter (where r.harmonisation = 'harmonised')::int as harmonised,
        count(*) filter (where r.harmonisation = 'unknown_level')::int as unknown_level,
        count(*) filter (where r.harmonisation = 'multi_value')::int as multi_value,
        count(*) filter (where r.harmonisation = 'not_numeric')::int as not_numeric,
        count(*) filter (where r.harmonisation = 'empty')::int as empty,
        min(r.numeric_value)::float8 as numeric_min,
        (percentile_cont(0.5) within group (order by r.numeric_value))::float8 as numeric_median,
        max(r.numeric_value)::float8 as numeric_max,
        count(r.numeric_value)::int as numeric_count
      from trait_records r
      join traits t on t.id = r.trait_id
      join trait_categories c on c.key = t.category_key
      join species s on s.id = r.species_id
      where r.species_id = ${speciesId}
        and ${traitVisible(visibility, sql`t.active`)}
        and ${speciesVisible(visibility, sql`s.active`, sql`s.id`)}
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
      group by r.trait_id, l.id, l.key
      order by count desc, l.key`) as unknown as Promise<LevelAggregate[]>,
    db.execute(sql`
      select distinct on (a.trait_id) a.trait_id, a.decision, a.record_id, r.value_text, a.created_at
      from accepted_values a
      join traits t on t.id = a.trait_id
      join species s on s.id = a.species_id
      left join trait_records r on r.id = a.record_id
      where a.species_id = ${speciesId}
        and ${traitVisible(visibility, sql`t.active`)}
        and ${speciesVisible(visibility, sql`s.active`, sql`s.id`)}
      order by a.trait_id, a.id desc`) as unknown as Promise<AcceptedCurrent[]>,
  ]);
  const levelsByTrait = new Map<string, NonNullable<TraitSummary['levels']>>();
  for (const l of levels) {
    levelsByTrait.set(l.trait_id, [
      ...(levelsByTrait.get(l.trait_id) ?? []),
      { levelId: l.level_id, key: l.level_key, count: l.count },
    ]);
  }
  const acceptedByTrait = new Map<string, TraitSummary['accepted']>();
  for (const a of accepted) {
    acceptedByTrait.set(
      a.trait_id,
      a.decision === 'accepted' && a.record_id && a.value_text !== null
        ? {
            recordId: a.record_id,
            valueText: a.value_text,
            decidedAt: new Date(a.created_at).toISOString(),
          }
        : null,
    );
  }
  const result: SpeciesTraits = [];
  for (const row of aggregates) {
    let category = result[result.length - 1];
    if (!category || category.category.key !== row.category_key) {
      category = { category: { key: row.category_key, label: row.category_label }, traits: [] };
      result.push(category);
    }
    const quantitative = row.value_type === 'quantitative';
    category.traits.push({
      trait: { id: row.trait_id, key: row.trait_key, valueType: row.value_type, unit: row.unit },
      recordCount: row.record_count,
      harmonisationCounts: {
        harmonised: row.harmonised,
        unknownLevel: row.unknown_level,
        multiValue: row.multi_value,
        notNumeric: row.not_numeric,
        empty: row.empty,
      },
      levels: quantitative ? null : (levelsByTrait.get(row.trait_id) ?? []),
      numeric:
        quantitative &&
        row.numeric_count > 0 &&
        row.numeric_min !== null &&
        row.numeric_median !== null &&
        row.numeric_max !== null
          ? {
              min: row.numeric_min,
              median: row.numeric_median,
              max: row.numeric_max,
              count: row.numeric_count,
            }
          : null,
      accepted: acceptedByTrait.get(row.trait_id) ?? null,
    });
  }
  return result;
}
