import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import type { Redis } from '../redis/client.ts';
import type { HealthChecks } from './routes/health.ts';

/** Upper bound for one readiness probe; a black-holed dependency answers "not ready", it never hangs the endpoint. @rfc RFC-10 R10 */
export const CHECK_TIMEOUT_MS = 3000;

function withTimeout(run: () => Promise<boolean>): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS);
    run().then(
      (ok) => {
        clearTimeout(timer);
        resolve(ok);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

/** @rfc RFC-10 R10 */
export function createHealthChecks(db: Db, redis: Redis): HealthChecks {
  return {
    database: () =>
      withTimeout(async () => {
        await db.execute(sql`select 1`);
        return true;
      }),
    redis: () => withTimeout(async () => (await redis.ping()) === 'PONG'),
  };
}
