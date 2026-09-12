import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.ts';
import type { Redis } from '../redis/client.ts';
import { CHECK_TIMEOUT_MS, createHealthChecks } from './health-checks.ts';

const never = () => new Promise<never>(() => undefined);

describe('RFC-10 R10 readiness check timeouts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports false when the database query never resolves', async () => {
    const db = { execute: never } as unknown as Db;
    const redis = { ping: async () => 'PONG' } as unknown as Redis;
    const checks = createHealthChecks(db, redis);
    const pending = checks.database();
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS + 1);
    await expect(pending).resolves.toBe(false);
  });

  it('reports false when redis never answers', async () => {
    const db = { execute: async () => [] } as unknown as Db;
    const redis = { ping: never } as unknown as Redis;
    const checks = createHealthChecks(db, redis);
    const pending = checks.redis();
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS + 1);
    await expect(pending).resolves.toBe(false);
  });

  it('bounds the wait to three seconds', () => {
    expect(CHECK_TIMEOUT_MS).toBe(3000);
  });
});
