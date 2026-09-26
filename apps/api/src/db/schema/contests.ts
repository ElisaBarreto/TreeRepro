import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { traitLevels, traits } from './dictionary.ts';
import { traitRecords } from './records.ts';
import { species } from './taxa.ts';
import { users } from './users.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * One contest, categorical or quantitative, whether or not it created a
 * record. The four contest tables are insert-only: the migration
 * `contest_withdrawal` adds the `dataset_append_only()` triggers and leaves
 * `treerepro_app` only `SELECT` and `INSERT`.
 * @rfc RFC-63 R4, R14
 * @rfc RFC-65 R16
 */
export const contests = pgTable(
  'contests',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id, { onDelete: 'restrict' }),
    traitId: uuid('trait_id')
      .notNull()
      .references(() => traits.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('contests_species_trait_idx').on(t.speciesId, t.traitId),
    /** RFC-71 R4: the viewer's own contests, newest first. */
    index('contests_created_by_idx').on(t.createdBy, t.id.desc()),
  ],
);

/** @rfc RFC-63 R4, R14 */
export type ContestRow = typeof contests.$inferSelect;

/**
 * The levels a categorical contest contests: E \ S at submission, fixed
 * forever. None for a quantitative contest.
 * @rfc RFC-63 R14
 */
export const contestLevels = pgTable(
  'contest_levels',
  {
    contestId: uuid('contest_id')
      .notNull()
      .references(() => contests.id, { onDelete: 'restrict' }),
    levelId: uuid('level_id')
      .notNull()
      .references(() => traitLevels.id, { onDelete: 'restrict' }),
  },
  (t) => [
    primaryKey({ columns: [t.contestId, t.levelId] }),
    index('contest_levels_level_idx').on(t.levelId),
  ],
);

/**
 * The records a contest created: S \ E for a categorical contest, the one
 * contest record (whose `responds_to_record_id` is the contested record) for a
 * quantitative one. A record belongs to at most one contest.
 * @rfc RFC-63 R14
 */
export const contestRecords = pgTable(
  'contest_records',
  {
    contestId: uuid('contest_id')
      .notNull()
      .references(() => contests.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => traitRecords.id, { onDelete: 'restrict' }),
  },
  (t) => [
    primaryKey({ columns: [t.contestId, t.recordId] }),
    unique('contest_records_record_key').on(t.recordId),
  ],
);

/** @rfc RFC-63 R14 */
export const CONTEST_EVENT_KINDS = ['resolve', 'withdraw'] as const;

/**
 * `resolve` is Keep both (RFC-65 R15, R16); `withdraw` is Withdraw contest on
 * a contest that created no record (RFC-65 R16). At most one of each.
 * @rfc RFC-63 R14
 * @rfc RFC-65 R16
 */
export const contestEvents = pgTable(
  'contest_events',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    contestId: uuid('contest_id')
      .notNull()
      .references(() => contests.id, { onDelete: 'restrict' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind', { enum: CONTEST_EVENT_KINDS }).notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('contest_events_contest_kind_key').on(t.contestId, t.kind),
    check('contest_events_kind_check', sql`${t.kind} in ('resolve', 'withdraw')`),
  ],
);
