import { describe, expect, inject, it } from 'vitest';
import { useTestDb } from '../../test/helpers/db.ts';
import { createRedis } from '../redis/client.ts';
import { createHealthChecks } from './health-checks.ts';

describe('RFC-10 R10 readiness checks', () => {
  const t = useTestDb();

  it('report true when PostgreSQL and Redis answer', async () => {
    const redis = createRedis(inject('redisUrl'));
    await redis.connect();
    const checks = createHealthChecks(t.db, redis);
    expect(await checks.database()).toBe(true);
    expect(await checks.redis()).toBe(true);
    await redis.quit();
  });

  it('report false or reject when Redis is disconnected', async () => {
    const redis = createRedis(inject('redisUrl'));
    try {
      const checks = createHealthChecks(t.db, redis);
      expect(await checks.redis().catch(() => false)).toBe(false);
    } finally {
      // ping() nudged the lazy client into connecting; drop it.
      redis.disconnect();
    }
  });
});
