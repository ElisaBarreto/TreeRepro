import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { sanitizeError } from '../http/errors.ts';
import { finishRun, startRun } from '../jobs/runs.ts';
import type { Logger } from '../logger.ts';

/** @rfc RFC-42 R4 */
export const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Runs the privileged purge function and records the run in `job_runs`;
 * returns the number of rows deleted.
 * @rfc RFC-42 R2, R4
 */
export async function purgeAudit(db: DbExecutor): Promise<number> {
  const runId = await startRun(db, 'audit_purge');
  try {
    const rows = await db.execute(sql`select audit_log_purge() as purged`);
    const purged = Number(rows[0]?.purged ?? 0);
    await finishRun(db, runId, { status: 'completed', detail: { purged } });
    return purged;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    // Best effort: the run row is a trace, and a purge that failed mid
    // transaction leaves that transaction unable to accept the UPDATE. The
    // purge's own error is what the caller must see.
    await finishRun(db, runId, { status: 'failed', error: error.message }).catch(() => undefined);
    throw error;
  }
}

/**
 * Runs the privileged `job_runs` purge; returns the number of runs deleted.
 * @rfc RFC-42 R6
 * @rfc RFC-74 R7
 */
export async function purgeJobRuns(db: DbExecutor): Promise<number> {
  const rows = await db.execute(sql`select job_runs_purge() as purged`);
  return Number(rows[0]?.purged ?? 0);
}

/**
 * Purges now and every `intervalMs` (default 24 hours): the audit log first,
 * then `job_runs` on the same schedule. Failures are logged and never thrown;
 * the interval is unref'd so it never holds the process open.
 * @rfc RFC-42 R4, R6
 */
export function startRetentionTimer(deps: {
  purge: () => Promise<number>;
  purgeRuns: () => Promise<number>;
  logger: Logger;
  intervalMs?: number;
}): { stop(): void } {
  const run = async (): Promise<void> => {
    try {
      const purged = await deps.purge();
      const purgedRuns = await deps.purgeRuns();
      deps.logger.info({ purged, purgedRuns }, 'audit retention run');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      deps.logger.error({ err: sanitizeError(error) }, 'audit retention failed');
    }
  };
  void run();
  const handle = setInterval(run, deps.intervalMs ?? RETENTION_INTERVAL_MS);
  handle.unref();
  return {
    stop() {
      clearInterval(handle);
    },
  };
}
