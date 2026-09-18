import { describe, expect, it } from 'vitest';
import { useTestApp } from '../../test/helpers/app.ts';
import { cachedJson, forgetCached } from './cache.ts';

describe('RFC-69 R4 cachedJson', () => {
  const t = useTestApp();

  it('computes once per key, expires with the ttl, and forgetCached forces a recompute', async () => {
    const prefix = `cache-test:${Math.random().toString(16).slice(2)}`;
    const keyA = `${prefix}:a`;
    const keyB = `${prefix}:b`;
    let calls = 0;
    const compute = async () => {
      calls += 1;
      return { n: calls };
    };

    const first = await cachedJson(t.redis, keyA, 60, compute);
    expect(first.value).toEqual({ n: 1 });
    expect(typeof first.computedAt).toBe('string');
    expect(calls).toBe(1);

    const second = await cachedJson(t.redis, keyA, 60, compute);
    expect(second).toEqual(first);
    expect(calls).toBe(1);

    const other = await cachedJson(t.redis, keyB, 60, compute);
    expect(other.value).toEqual({ n: 2 });
    expect(calls).toBe(2);

    const ttl = await t.redis.ttl(keyA);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);

    await forgetCached(t.redis, keyA);
    const afterForget = await cachedJson(t.redis, keyA, 60, compute);
    expect(afterForget.value).toEqual({ n: 3 });
    expect(calls).toBe(3);
  });
});
