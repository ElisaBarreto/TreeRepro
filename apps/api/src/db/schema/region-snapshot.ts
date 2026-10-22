import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { traitLevels, traits } from './dictionary.ts';

/**
 * Completeness of the weekly snapshot, one row per trait × region with data;
 * the reader computes the percentages.
 * @rfc RFC-78 R7, R9
 */
export const regionCompleteness = pgTable(
  'region_completeness',
  {
    traitId: uuid('trait_id')
      .notNull()
      .references(() => traits.id, { onDelete: 'cascade' }),
    areaCodeL3: text('area_code_l3').notNull(),
    speciesWithData: integer('species_with_data').notNull(),
    wcvpSpecies: integer('wcvp_species').notNull(),
    wcvpTreeSpecies: integer('wcvp_tree_species').notNull(),
  },
  (t) => [primaryKey({ columns: [t.traitId, t.areaCodeL3] })],
);

/** Statistics of the species medians, one row per quantitative trait × region. @rfc RFC-78 R7, R10 */
export const regionContinuous = pgTable(
  'region_continuous',
  {
    traitId: uuid('trait_id')
      .notNull()
      .references(() => traits.id, { onDelete: 'cascade' }),
    areaCodeL3: text('area_code_l3').notNull(),
    nSpecies: integer('n_species').notNull(),
    mean: doublePrecision('mean').notNull(),
    sd: doublePrecision('sd'),
    median: doublePrecision('median').notNull(),
    min: doublePrecision('min').notNull(),
    max: doublePrecision('max').notNull(),
    cv: doublePrecision('cv'),
  },
  (t) => [primaryKey({ columns: [t.traitId, t.areaCodeL3] })],
);

/** Species holding each state, one row per categorical trait × state × region. @rfc RFC-78 R7, R11 */
export const regionCategorical = pgTable(
  'region_categorical',
  {
    traitId: uuid('trait_id')
      .notNull()
      .references(() => traits.id, { onDelete: 'cascade' }),
    levelId: uuid('level_id')
      .notNull()
      .references(() => traitLevels.id, { onDelete: 'cascade' }),
    areaCodeL3: text('area_code_l3').notNull(),
    nSpeciesWithLevel: integer('n_species_with_level').notNull(),
    nSpeciesWithTrait: integer('n_species_with_trait').notNull(),
  },
  (t) => [primaryKey({ columns: [t.traitId, t.levelId, t.areaCodeL3] })],
);

/** When the current snapshot was computed; one row at most. @rfc RFC-78 R7, R12 */
export const regionSnapshot = pgTable(
  'region_snapshot',
  {
    id: boolean('id').primaryKey().default(true),
    computedAt: timestamp('computed_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [check('region_snapshot_one_row', sql`${t.id}`)],
);
