import { JOB_STATUSES } from '@treerepro/contracts';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** The background jobs that record their runs. @rfc RFC-74 R1 */
export const JOB_KINDS = ['audit_purge', 'digest'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/**
 * `skipped` means the job decided there was nothing to do. `JOB_STATUSES`
 * itself now lives in `@treerepro/contracts` (`health.ts`), which needs it
 * for `jobRunSummarySchema`; this type alias is kept here so
 * `apps/api/src/jobs/runs.ts` needs no change.
 */
export type JobStatus = (typeof JOB_STATUSES)[number];

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * One row per background job run: when it started, what it did and whether it
 * succeeded, so a failed job leaves a trace rather than only a log line.
 *
 * Append-only by GRANT, not by trigger (RFC-74 R7): the runtime role holds
 * `SELECT`, `INSERT` and `UPDATE` — `finishRun` closes its own row — but
 * neither `DELETE` nor `TRUNCATE`. Rows older than a year go through the
 * privileged `job_runs_purge()` (RFC-42 R6).
 * @rfc RFC-74 R1, R7
 * @rfc RFC-42 R6
 */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    kind: text('kind', { enum: JOB_KINDS }).notNull(),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('running'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    /** A failure code (`failureCode`), never a message — see the check below. */
    error: text('error'),
  },
  (t) => [
    index('job_runs_kind_idx').on(t.kind, t.startedAt.desc()),
    check('job_runs_kind_check', sql`${t.kind} in ('audit_purge', 'digest')`),
    check(
      'job_runs_status_check',
      sql`${t.status} in ('running', 'completed', 'failed', 'skipped')`,
    ),
    // `error` holds a failure code — one to three identifiers separated by
    // single spaces, `FAILURE_CODE_PATTERN` in `http/errors.ts` — never an
    // exception message,
    // so that the health page of RFC-52 can publish it as it is. The pattern
    // is stated here as well as in `failureCode`, so the guarantee is the
    // column's and not only the writers'.
    check(
      'job_runs_error_check',
      sql`${t.error} is null or ${t.error} ~ '^[A-Za-z0-9_]{1,64}( [A-Za-z0-9_]{1,64}){0,2}$'`,
    ),
  ],
);

export type JobRunRow = typeof jobRuns.$inferSelect;
export type NewJobRunRow = typeof jobRuns.$inferInsert;
