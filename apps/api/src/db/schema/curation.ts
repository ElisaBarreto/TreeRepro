import { ANNOTATION_KINDS } from '@treerepro/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { traitRecords } from './records.ts';
import { bibliographicReferences } from './references.ts';
import { users } from './users.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Append-only (RFC-63 R4). Written by plan 07 (RFC-65). A `withdraw` row
 * decrements the record's counters through a statement trigger (migration
 * `contest_withdrawal`, RFC-63 R13).
 * @rfc RFC-63 R6, R7, R13
 */
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
    /**
     * One withdrawal per record (RFC-63 R13): the `record_annotations_withdraw_counters`
     * trigger decrements a record's counters once.
     */
    uniqueIndex('record_annotations_withdraw_idx')
      .on(t.recordId)
      .where(sql`${t.kind} = 'withdraw'`),
    check(
      'record_annotations_reference_check',
      sql`${t.referenceId} is null or ${t.kind} = 'confirm'`,
    ),
  ],
);

export type RecordAnnotationRow = typeof recordAnnotations.$inferSelect;
