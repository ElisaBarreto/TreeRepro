import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { type JobKind, type JobRunRow, type JobStatus, jobRuns } from '../db/schema/job-runs.ts';

/** What a job reports when it closes its run. */
export interface JobRunResult {
  status: JobStatus;
  /** Replaces the row's `detail`; defaults to `{}`. */
  detail?: Record<string, unknown>;
  /** The failure message for a `failed` run. */
  error?: string;
}

/** Opens a run of `kind` with status `running` and returns its id. @rfc RFC-74 R1 */
export async function startRun(db: DbExecutor, kind: JobKind): Promise<string> {
  const [row] = await db.insert(jobRuns).values({ kind }).returning({ id: jobRuns.id });
  if (!row) throw new Error('startRun: no row');
  return row.id;
}

/**
 * Closes the run: sets `finished_at`, the final status, the detail and the
 * error. This is the one `UPDATE` the runtime role needs on `job_runs`.
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
      detail: result.detail ?? {},
      error: result.error ?? null,
    })
    .where(eq(jobRuns.id, id))
    .returning({ id: jobRuns.id });
  if (!row) throw new Error(`finishRun: no job run ${id}`);
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
