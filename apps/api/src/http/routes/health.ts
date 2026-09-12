import type { HealthResponse } from '@treerepro/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { errorBody } from '../errors.ts';

export interface HealthChecks {
  database(): Promise<boolean>;
  redis(): Promise<boolean>;
}

const OK: HealthResponse = { ok: true };

const safe = (check: () => Promise<boolean>): Promise<boolean> => check().catch(() => false);

/** @rfc RFC-10 R10 */
export function healthRoutes(checks: HealthChecks) {
  return new Hono<AppEnv>()
    .get('/', (c) => c.json(OK))
    .get('/ready', async (c) => {
      const [database, redis] = await Promise.all([safe(checks.database), safe(checks.redis)]);
      if (database && redis) return c.json(OK);
      return c.json(errorBody('SERVICE_UNAVAILABLE', 'A dependency is unavailable'), 503);
    });
}
