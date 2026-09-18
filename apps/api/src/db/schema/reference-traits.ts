import { index, integer, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { traits } from './dictionary.ts';
import { bibliographicReferences } from './references.ts';

/**
 * One row per reference x trait: `record_count` counts the records naming the
 * reference in either role, once per record, so a record that names the same
 * reference as primary and secondary counts once.
 *
 * Maintained by the `trait_records_reference_usage` statement trigger on every
 * insert into `trait_records` and backfilled by the `references_enriched`
 * migration, the pattern of `species_trait_coverage` (RFC-69 R2-R3). Records
 * are append-only (RFC-63 R4), so nothing ever decrements. The trigger
 * function is `SECURITY DEFINER` and owned by the migrator, so the table is
 * read-only for the app role. Visibility (RFC-33) is applied by joining
 * `traits` and filtering on its `active` flag; this table has no flags.
 * @rfc RFC-61 R9
 */
export const referenceTraits = pgTable(
  'reference_traits',
  {
    referenceId: uuid('reference_id')
      .notNull()
      .references(() => bibliographicReferences.id, { onDelete: 'restrict' }),
    traitId: uuid('trait_id')
      .notNull()
      .references(() => traits.id, { onDelete: 'restrict' }),
    recordCount: integer('record_count').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.referenceId, t.traitId] }),
    index('reference_traits_trait_idx').on(t.traitId),
  ],
);

export type ReferenceTraitRow = typeof referenceTraits.$inferSelect;
