import { IMPORT_BATCH_STATUSES, IMPORT_REJECT_REASONS } from '@treerepro/contracts';
import { sql } from 'drizzle-orm';
import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const count = (name: string) => bigint(name, { mode: 'number' }).notNull().default(0);

export interface UnknownLevelCount {
  trait: string;
  value: string;
  count: number;
}

/** @rfc RFC-64 R3 */
export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    fileName: text('file_name').notNull(),
    fileSha256: text('file_sha256').notNull(),
    runBy: uuid('run_by').references(() => users.id),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    status: text('status', { enum: IMPORT_BATCH_STATUSES }).notNull().default('running'),
    error: text('error'),
    rowsTotal: count('rows_total'),
    rowsInserted: count('rows_inserted'),
    rowsDuplicate: count('rows_duplicate'),
    rowsRejected: count('rows_rejected'),
    rowsPending: count('rows_pending'),
    unknownLevels: jsonb('unknown_levels').$type<UnknownLevelCount[]>().notNull().default([]),
  },
  (t) => [index('import_batches_sha_idx').on(t.fileSha256)],
);

/** @rfc RFC-64 R7 */
export const importRejects = pgTable(
  'import_rejects',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'restrict' }),
    rowNo: bigint('row_no', { mode: 'number' }).notNull(),
    reason: text('reason', { enum: IMPORT_REJECT_REASONS }).notNull(),
    rawRow: jsonb('raw_row').$type<Record<string, string>>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('import_rejects_batch_row_idx').on(t.batchId, t.rowNo)],
);

export type ImportBatchRow = typeof importBatches.$inferSelect;
export type ImportRejectRow = typeof importRejects.$inferSelect;
