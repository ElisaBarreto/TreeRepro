import { HARMONISATION_STATUSES, RECORD_INTENTS, RECORD_ORIGINS } from '@treerepro/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  numeric,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { traitLevels, traits } from './dictionary.ts';
import { importBatches } from './imports.ts';
import { bibliographicReferences } from './references.ts';
import { species } from './taxa.ts';
import { users } from './users.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Numbers the platform's record codes: `TR_<n>`, gaps accepted (spec R-2). @rfc RFC-63 R12 */
export const recordCodeTrSeq = pgSequence('record_code_tr_seq');

/**
 * One claim: a reference reports that a species has a trait with a value.
 * Insert-only (RFC-63 R4; migration 0012 adds the trigger and the revokes).
 * @rfc RFC-63 R1-R3, R5, R12, R14, R15
 */
export const traitRecords = pgTable(
  'trait_records',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    /** `EB_<n>` from the import file, `TR_<n>` for anything created on the platform (RFC-63 R12). */
    recordCode: text('record_code')
      .notNull()
      .unique('trait_records_record_code_key')
      .default(sql`('TR_' || nextval('record_code_tr_seq'))`),
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id, { onDelete: 'restrict' }),
    traitId: uuid('trait_id')
      .notNull()
      .references(() => traits.id, { onDelete: 'restrict' }),
    levelId: uuid('level_id').references(() => traitLevels.id, { onDelete: 'restrict' }),
    numericValue: numeric('numeric_value', { mode: 'number' }),
    minValue: numeric('min_value', { mode: 'number' }),
    maxValue: numeric('max_value', { mode: 'number' }),
    meanValue: numeric('mean_value', { mode: 'number' }),
    sdValue: numeric('sd_value', { mode: 'number' }),
    n: integer('n'),
    valueText: text('value_text').notNull(),
    harmonisation: text('harmonisation', { enum: HARMONISATION_STATUSES }).notNull(),
    rawValue: text('raw_value'),
    originalTraitName: text('original_trait_name'),
    originalSpeciesName: text('original_species_name'),
    secondarySourceSpeciesName: text('secondary_source_species_name'),
    rawCategory: text('raw_category'),
    primaryReferenceId: uuid('primary_reference_id').references(() => bibliographicReferences.id, {
      onDelete: 'restrict',
    }),
    secondaryReferenceId: uuid('secondary_reference_id').references(
      () => bibliographicReferences.id,
      { onDelete: 'restrict' },
    ),
    origin: text('origin', { enum: RECORD_ORIGINS }).notNull(),
    importBatchId: uuid('import_batch_id').references(() => importBatches.id, {
      onDelete: 'restrict',
    }),
    importRowNo: bigint('import_row_no', { mode: 'number' }),
    createdBy: uuid('created_by').references(() => users.id),
    note: text('note'),
    /** The pending record this row harmonises (RFC-65 R7); null for every other row. */
    supersedesRecordId: uuid('supersedes_record_id').references(
      (): AnyPgColumn => traitRecords.id,
      {
        onDelete: 'restrict',
      },
    ),
    /** The intent of this response record (RFC-70 R1). */
    intent: text('intent', { enum: RECORD_INTENTS }),
    /** The record this row responds to (RFC-70 R1). */
    respondsToRecordId: uuid('responds_to_record_id').references(
      (): AnyPgColumn => traitRecords.id,
      { onDelete: 'restrict' },
    ),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('trait_records_claim_key')
      .on(
        t.speciesId,
        t.traitId,
        t.valueText,
        t.rawValue,
        t.primaryReferenceId,
        t.secondaryReferenceId,
      )
      .nullsNotDistinct(),
    index('trait_records_species_trait_idx').on(t.speciesId, t.traitId, t.id.desc()),
    index('trait_records_trait_idx').on(t.traitId),
    index('trait_records_primary_reference_idx').on(t.primaryReferenceId, t.id.desc()),
    index('trait_records_secondary_reference_idx').on(t.secondaryReferenceId),
    index('trait_records_batch_idx').on(t.importBatchId),
    index('trait_records_pending_idx')
      .on(t.harmonisation)
      .where(sql`${t.harmonisation} <> 'harmonised'`),
    index('trait_records_supersedes_idx')
      .on(t.supersedesRecordId)
      .where(sql`${t.supersedesRecordId} is not null`),
    index('trait_records_responds_to_idx')
      .on(t.respondsToRecordId)
      .where(sql`${t.respondsToRecordId} is not null`),
    /** RFC-71 R4: the viewer's own manual records, newest first. */
    index('trait_records_created_by_idx')
      .on(t.createdBy, t.id.desc())
      .where(sql`${t.createdBy} is not null`),
    /** A categorical contest has an intent and responds to no record (RFC-63 R14). */
    check(
      'trait_records_intent_check',
      sql`(${t.respondsToRecordId} is null or ${t.intent} is not null)
        and (${t.intent} is distinct from 'complement' or ${t.respondsToRecordId} is not null)`,
    ),
    check(
      'trait_records_reference_check',
      sql`${t.primaryReferenceId} is not null or ${t.secondaryReferenceId} is not null`,
    ),
    check(
      'trait_records_origin_check',
      sql`(${t.origin} = 'import' and ${t.importBatchId} is not null and ${t.importRowNo} is not null and ${t.createdBy} is null and ${t.supersedesRecordId} is null)
        or (${t.origin} = 'manual' and ${t.createdBy} is not null and ${t.importBatchId} is null and ${t.importRowNo} is null
            and (${t.primaryReferenceId} is not null or ${t.supersedesRecordId} is not null))`,
    ),
    check(
      'trait_records_harmonised_check',
      sql`${t.harmonisation} <> 'harmonised' or ${t.levelId} is not null
        or coalesce(${t.numericValue}, ${t.minValue}, ${t.maxValue}, ${t.meanValue}) is not null`,
    ),
    check(
      'trait_records_one_value_check',
      sql`${t.levelId} is null or num_nonnulls(${t.numericValue}, ${t.minValue}, ${t.maxValue}, ${t.meanValue}, ${t.sdValue}, ${t.n}) = 0`,
    ),
    check(
      'trait_records_value_requires_harmonised_check',
      sql`(${t.levelId} is null and num_nonnulls(${t.numericValue}, ${t.minValue}, ${t.maxValue}, ${t.meanValue}, ${t.sdValue}, ${t.n}) = 0)
        or ${t.harmonisation} = 'harmonised'`,
    ),
    check(
      'trait_records_quantitative_check',
      sql`(${t.minValue} is null or ${t.maxValue} is null or ${t.minValue} <= ${t.maxValue})
        and (${t.sdValue} is null or ${t.sdValue} >= 0) and (${t.n} is null or ${t.n} >= 1)`,
    ),
  ],
);

export type TraitRecordRow = typeof traitRecords.$inferSelect;
export type NewTraitRecordRow = typeof traitRecords.$inferInsert;

/**
 * The references of a record beyond its primary one (spec R-4): the first
 * source of a form is `primary_reference_id`, the rest land here. Imported
 * records never use it. Insert-only for the app role (migration 0035).
 * @rfc RFC-63 R16
 * @rfc RFC-61 R4, R9
 */
export const recordReferences = pgTable(
  'record_references',
  {
    recordId: uuid('record_id')
      .notNull()
      .references(() => traitRecords.id, { onDelete: 'restrict' }),
    referenceId: uuid('reference_id')
      .notNull()
      .references(() => bibliographicReferences.id, { onDelete: 'restrict' }),
  },
  (t) => [
    primaryKey({ columns: [t.recordId, t.referenceId] }),
    index('record_references_reference_idx').on(t.referenceId),
  ],
);

export type RecordReferenceRow = typeof recordReferences.$inferSelect;
