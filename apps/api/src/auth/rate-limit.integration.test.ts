import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createRedis, type Redis } from '../redis/client.ts';
import { createRateLimiter, RATE_LIMITS } from './rate-limit.ts';

describe('RFC-24 R1, R2 sliding window limiter', () => {
  let redis: Redis;
  const clock = { now: Date.parse('2026-09-12T10:00:00Z') };
  const key = () => `k-${Math.random().toString(16).slice(2)}`;
  beforeAll(async () => {
    redis = createRedis(inject('redisUrl'));
    await redis.connect();
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('allows `limit` hits then rejects with the seconds until the oldest hit leaves the window', async () => {
    const limiter = createRateLimiter(redis, () => clock.now);
    const rule = { limit: 3, windowMs: 60_000 };
    const k = key();
    for (let i = 0; i < 3; i++) {
      expect(await limiter.hit('t', k, rule)).toEqual({ allowed: true, retryAfterSeconds: 0 });
      clock.now += 1000;
    }
    const rejected = await limiter.hit('t', k, rule);
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterSeconds).toBe(57);
    expect(await redis.zcard(`rl:t:${k}`)).toBe(3);
  });

  it('slides: after the window passes the key accepts again; rejected hits are not recorded', async () => {
    const limiter = createRateLimiter(redis, () => clock.now);
    const rule = { limit: 1, windowMs: 10_000 };
    const k = key();
    expect((await limiter.hit('t', k, rule)).allowed).toBe(true);
    expect((await limiter.hit('t', k, rule)).allowed).toBe(false);
    clock.now += 9_999;
    expect((await limiter.hit('t', k, rule)).allowed).toBe(false);
    clock.now += 2;
    expect((await limiter.hit('t', k, rule)).allowed).toBe(true);
    expect(await redis.pttl(`rl:t:${k}`)).toBeGreaterThan(9_000);
  });

  it('rounds Retry-After up and never below 1', async () => {
    const limiter = createRateLimiter(redis, () => clock.now);
    const rule = { limit: 1, windowMs: 1_500 };
    const k = key();
    await limiter.hit('t', k, rule);
    clock.now += 1_400;
    expect((await limiter.hit('t', k, rule)).retryAfterSeconds).toBe(1);
  });

  it('keys and scopes are independent', async () => {
    const limiter = createRateLimiter(redis, () => clock.now);
    const rule = { limit: 1, windowMs: 60_000 };
    const k = key();
    expect((await limiter.hit('a', k, rule)).allowed).toBe(true);
    expect((await limiter.hit('b', k, rule)).allowed).toBe(true);
    expect((await limiter.hit('a', `${k}-2`, rule)).allowed).toBe(true);
    expect((await limiter.hit('a', k, rule)).allowed).toBe(false);
  });

  it('R3 documents the configured limits', () => {
    expect(RATE_LIMITS.globalSession).toEqual({ limit: 300, windowMs: 60_000 });
    expect(RATE_LIMITS.globalIp).toEqual({ limit: 100, windowMs: 60_000 });
    expect(RATE_LIMITS.loginEmailIp).toEqual({ limit: 5, windowMs: 15 * 60_000 });
    expect(RATE_LIMITS.loginIp).toEqual({ limit: 20, windowMs: 15 * 60_000 });
    expect(RATE_LIMITS.loginTotp).toEqual({ limit: 5, windowMs: 15 * 60_000 });
    expect(RATE_LIMITS.forgotEmailIp).toEqual({ limit: 3, windowMs: 15 * 60_000 });
    expect(RATE_LIMITS.forgotIp).toEqual({ limit: 10, windowMs: 15 * 60_000 });
    expect(RATE_LIMITS.tokenIp).toEqual({ limit: 10, windowMs: 15 * 60_000 });
    expect(RATE_LIMITS.taxonomyMatchUser).toEqual({ limit: 30, windowMs: 60_000 });
  });
});
