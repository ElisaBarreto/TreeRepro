import { index, integer, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { traits } from './dictionary.ts';
import { species } from './taxa.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * One row per species x trait with at least one record: what the species list,
 * the trait page's missing-traits mode and the dashboard read instead of
 * aggregating `trait_records` on every request.
 *
 * Maintained by the `trait_records_reference_usage` statement trigger on every
 * insert into `trait_records` — records are append-only (RFC-63 R4), so
 * nothing ever decrements, and withdrawn records still count: coverage answers
 * "is there a record", not "is there a good record". The trigger function is
 * `SECURITY DEFINER` and owned by the migrator, so the table is read-only for
 * the app role. Visibility (RFC-33) is applied by joining `species` and
 * `traits` and filtering on their `active` flags; this table has no flags.
 * @rfc RFC-69 R1, R2
 */
export const speciesTraitCoverage = pgTable(
  'species_trait_coverage',
  {
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id, { onDelete: 'restrict' }),
    traitId: uuid('trait_id')
      .notNull()
      .references(() => traits.id, { onDelete: 'restrict' }),
    recordCount: integer('record_count').notNull(),
    harmonisedCount: integer('harmonised_count').notNull(),
    firstRecordAt: ts('first_record_at').notNull(),
    lastRecordAt: ts('last_record_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.speciesId, t.traitId] }),
    index('species_trait_coverage_trait_idx').on(t.traitId, t.speciesId),
  ],
);

export type SpeciesTraitCoverageRow = typeof speciesTraitCoverage.$inferSelect;
