import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { type JobKind, type JobRunRow, type JobStatus, jobRuns } from '../db/schema/job-runs.ts';

/** What a job reports when it closes its run. */
export interface JobRunResult {
  status: JobStatus;
  /**
   * Replaces the row's `detail`. OMITTED, the row keeps what it already has —
   * a run that recorded `phase: 'sending'` through `recordRunDetail` and then
   * threw must not have that erased by its own failure, because it is the only
   * evidence the next run has that this one had begun mailing (RFC-74 R2).
   */
  detail?: Record<string, unknown>;
  /**
   * The failure code of a `failed` run — `failureCode(err)` in
   * `http/errors.ts`, identifiers only, never a message: the column's check
   * refuses anything else, and the health page of RFC-52 publishes it.
   */
  error?: string;
}

/** Opens a run of `kind` with status `running` and returns its id. @rfc RFC-74 R1 */
export async function startRun(db: DbExecutor, kind: JobKind): Promise<string> {
  const [row] = await db.insert(jobRuns).values({ kind }).returning({ id: jobRuns.id });
  if (!row) throw new Error('startRun: no row');
  return row.id;
}

/**
 * Closes the run: sets `finished_at`, the final status and the error, and the
 * detail when the caller supplies one. A caller that supplies none leaves the
 * detail alone rather than clearing it (see `JobRunResult.detail`).
 *
 * Throws when `id` closes no row. R7 scopes the update to "its own row by id",
 * and a table-level `UPDATE` grant cannot tell one row from another, so this
 * is the only place that can be enforced: a stale id must be a loud failure,
 * not a silent no-op that leaves a run `running` for ever.
 * @rfc RFC-74 R1, R7
 */
export async function finishRun(db: DbExecutor, id: string, result: JobRunResult): Promise<void> {
  const [row] = await db
    .update(jobRuns)
    .set({
      status: result.status,
      finishedAt: new Date(),
      ...(result.detail === undefined ? {} : { detail: result.detail }),
      error: result.error ?? null,
    })
    .where(eq(jobRuns.id, id))
    .returning({ id: jobRuns.id });
  if (!row) throw new Error(`finishRun: no job run ${id}`);
}

/**
 * Replaces an OPEN run's `detail`, leaving `status` and `finished_at` exactly
 * as they are. `finishRun` is the only writer of a terminal state; this is for
 * what a run knows about itself while it is still `running`.
 *
 * The digest writes `{ windowStart, windowEnd, phase: 'sending' }` here
 * immediately before its first e-mail, so that a run which dies afterwards
 * leaves a durable record that it had begun mailing — which is what lets the
 * next run tell a repeat from a fresh attempt (RFC-74 R2). Writing it at
 * `startRun` instead would make a run that died BEFORE sending look identical
 * to one that mailed, and the distinction is the whole point.
 *
 * Throws when `id` updates no row, for the same reason `finishRun` does: the
 * row was opened by this job moments ago, so a miss is a bug, not a state.
 * @rfc RFC-74 R1, R2
 */
export async function recordRunDetail(
  db: DbExecutor,
  id: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const [row] = await db
    .update(jobRuns)
    .set({ detail })
    .where(eq(jobRuns.id, id))
    .returning({ id: jobRuns.id });
  if (!row) throw new Error(`recordRunDetail: no job run ${id}`);
}

/**
 * The newest run of `kind` by `started_at`, or null. `statuses` restricts it —
 * the digest asks for the last `completed` or `skipped` run (RFC-74 R2);
 * omitted, any status answers. Ties break on the uuidv7 id, which is itself
 * time-ordered.
 * @rfc RFC-74 R1, R2
 */
export async function latestRun(
  db: DbExecutor,
  kind: JobKind,
  statuses?: readonly JobStatus[],
): Promise<JobRunRow | null> {
  const ofKind = eq(jobRuns.kind, kind);
  const rows = await db
    .select()
    .from(jobRuns)
    .where(statuses === undefined ? ofKind : and(ofKind, inArray(jobRuns.status, [...statuses])))
    .orderBy(desc(jobRuns.startedAt), desc(jobRuns.id))
    .limit(1);
  return rows[0] ?? null;
}
