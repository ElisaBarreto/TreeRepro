import type { Platform } from '@treerepro/contracts';
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
import { PLATFORMS_SQL } from './user-roles.ts';

/** The platform whose scope a snapshot row was computed over (RFC-78 R7, R8). */
const platform = () => text('platform').$type<Platform>().notNull();

/**
 * Completeness of the weekly snapshot, one row per trait × region with data;
 * the reader computes the percentages.
 * @rfc RFC-78 R7, R9
 */
export const regionCompleteness = pgTable(
  'region_completeness',
  {
    platform: platform(),
    traitId: uuid('trait_id')
      .notNull()
      .references(() => traits.id, { onDelete: 'cascade' }),
    areaCodeL3: text('area_code_l3').notNull(),
    speciesWithData: integer('species_with_data').notNull(),
    wcvpSpecies: integer('wcvp_species').notNull(),
    wcvpTreeSpecies: integer('wcvp_tree_species').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.traitId, t.areaCodeL3] }),
    check('region_completeness_platform_check', sql`${t.platform} in (${PLATFORMS_SQL})`),
  ],
);

/** Statistics of the species medians, one row per quantitative trait × region. @rfc RFC-78 R7, R10 */
export const regionContinuous = pgTable(
  'region_continuous',
  {
    platform: platform(),
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
  (t) => [
    primaryKey({ columns: [t.platform, t.traitId, t.areaCodeL3] }),
    check('region_continuous_platform_check', sql`${t.platform} in (${PLATFORMS_SQL})`),
  ],
);

/** Species holding each state, one row per categorical trait × state × region. @rfc RFC-78 R7, R11 */
export const regionCategorical = pgTable(
  'region_categorical',
  {
    platform: platform(),
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
  (t) => [
    primaryKey({ columns: [t.platform, t.traitId, t.levelId, t.areaCodeL3] }),
    check('region_categorical_platform_check', sql`${t.platform} in (${PLATFORMS_SQL})`),
  ],
);

/** When each platform's current snapshot was computed; one row per platform at most. @rfc RFC-78 R7, R12 */
export const regionSnapshot = pgTable(
  'region_snapshot',
  {
    id: boolean('id').notNull().default(true),
    platform: platform(),
    computedAt: timestamp('computed_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.platform] }),
    check('region_snapshot_one_row', sql`${t.id}`),
    check('region_snapshot_platform_check', sql`${t.platform} in (${PLATFORMS_SQL})`),
  ],
);
