import { ANNOTATION_KINDS } from '@treerepro/contracts';
import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { traitRecords } from './records.ts';
import { bibliographicReferences } from './references.ts';
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
    /** Reference supplied on a confirmation (RFC-70 R6). Null for all other kinds. */
    referenceId: uuid('reference_id').references(() => bibliographicReferences.id, {
      onDelete: 'restrict',
    }),
    /** True when generated automatically by the service (e.g. a contest auto-dispute). */
    generated: boolean('generated').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('record_annotations_record_idx').on(t.recordId, t.id.desc()),
    /** RFC-71 R4: the viewer's own annotations, newest first. */
    index('record_annotations_actor_idx').on(t.actorId, t.id.desc()),
    check(
      'record_annotations_note_check',
      sql`${t.kind} not in ('dispute', 'withdraw') or ${t.note} is not null`,
    ),
    check(
      'record_annotations_reference_check',
      sql`${t.referenceId} is null or ${t.kind} = 'confirm'`,
    ),
  ],
);

export type RecordAnnotationRow = typeof recordAnnotations.$inferSelect;
