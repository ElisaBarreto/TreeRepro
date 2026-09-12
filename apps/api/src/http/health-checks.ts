import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import type { Redis } from '../redis/client.ts';
import type { HealthChecks } from './routes/health.ts';

/** @rfc RFC-10 R10 */
export function createHealthChecks(db: Db, redis: Redis): HealthChecks {
  return {
    database: async () => {
      await db.execute(sql`select 1`);
      return true;
    },
    redis: async () => (await redis.ping()) === 'PONG',
  };
}
