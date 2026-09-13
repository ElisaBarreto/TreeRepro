import { ACCEPTED_DECISIONS, ANNOTATION_KINDS } from '@treerepro/contracts';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { traits } from './dictionary.ts';
import { traitRecords } from './records.ts';
import { species } from './taxa.ts';
import { users } from './users.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Append-only (RFC-63 R4). Written by plan 07 (RFC-65). @rfc RFC-63 R6, R7 */
export const recordAnnotations = pgTable(
  'record_annotations',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    recordId: uuid('record_id')
      .notNull()
      .references(() => traitRecords.id, { onDelete: 'restrict' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind', { enum: ANNOTATION_KINDS }).notNull(),
    note: text('note'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('record_annotations_record_idx').on(t.recordId, t.id.desc()),
    check(
      'record_annotations_note_check',
      sql`${t.kind} not in ('dispute', 'withdraw') or ${t.note} is not null`,
    ),
  ],
);

/** Append-only (RFC-63 R4). Written by plan 07 (RFC-65). @rfc RFC-63 R6, R7 */
export const acceptedValues = pgTable(
  'accepted_values',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id, { onDelete: 'restrict' }),
    traitId: uuid('trait_id')
      .notNull()
      .references(() => traits.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id').references(() => traitRecords.id, { onDelete: 'restrict' }),
    decision: text('decision', { enum: ACCEPTED_DECISIONS }).notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    note: text('note'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('accepted_values_species_trait_idx').on(t.speciesId, t.traitId, t.id.desc()),
    check(
      'accepted_values_record_check',
      sql`(${t.decision} = 'accepted' and ${t.recordId} is not null) or (${t.decision} = 'cleared' and ${t.recordId} is null)`,
    ),
  ],
);

export type RecordAnnotationRow = typeof recordAnnotations.$inferSelect;
export type AcceptedValueRow = typeof acceptedValues.$inferSelect;
