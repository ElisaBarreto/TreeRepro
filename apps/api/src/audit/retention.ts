import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { sanitizeError } from '../http/errors.ts';
import type { Logger } from '../logger.ts';

/** @rfc RFC-42 R4 */
export const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Runs the privileged purge function; returns the number of rows deleted. @rfc RFC-42 R2 */
export async function purgeAudit(db: DbExecutor): Promise<number> {
  const rows = await db.execute(sql`select audit_log_purge() as purged`);
  return Number(rows[0]?.purged ?? 0);
}

/**
 * Purges now and every `intervalMs` (default 24 hours). Failures are logged
 * and never thrown; the interval is unref'd so it never holds the process open.
 * @rfc RFC-42 R4
 */
export function startRetentionTimer(deps: {
  purge: () => Promise<number>;
  logger: Logger;
  intervalMs?: number;
}): { stop(): void } {
  const run = async (): Promise<void> => {
    try {
      const purged = await deps.purge();
      deps.logger.info({ purged }, 'audit retention run');
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
