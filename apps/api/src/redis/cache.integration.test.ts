import { describe, expect, it } from 'vitest';
import { useTestApp } from '../../test/helpers/app.ts';
import { cachedJson, forgetCached } from './cache.ts';

/**
 * One-shot signal. As `started`, a `compute` opens it on entry so the test
 * knows the fill is running; as `fill`, a `compute` waits on it so the fill
 * cannot finish before every concurrent miss has been read from Redis.
 */
function gate(): { open: () => void; wait: Promise<void> } {
  let open = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, wait };
}

describe('RFC-10 R15 cachedJson', () => {
  const t = useTestApp();
  const prefix = () => `cache-test:${Math.random().toString(16).slice(2)}`;

  it('computes once per key, expires with the ttl, and forgetCached forces a recompute', async () => {
    const keyA = `${prefix()}:a`;
    const keyB = `${prefix()}:b`;
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

  it('concurrent misses on one key share one fill and answer the same entry', async () => {
    const key = `${prefix()}:shared`;
    const started = gate();
    const fill = gate();
    let calls = 0;
    const compute = async () => {
      calls += 1;
      started.open();
      await fill.wait;
      return { n: calls };
    };

    // The ten GETs leave in this synchronous tick, ahead of any SET the fill
    // could send, so every one of them is a miss. The PING queues behind them
    // on the one connection: when it answers, every GET has answered and its
    // caller has joined the fill.
    const pending = Promise.all(
      Array.from({ length: 10 }, () => cachedJson(t.redis, key, 60, compute)),
    );
    await started.wait;
    await t.redis.ping();
    expect(calls).toBe(1);
    // A caller that enters while the fill is running joins it before reading Redis.
    const late = cachedJson(t.redis, key, 60, compute);
    fill.open();

    const entries = [...(await pending), await late];
    expect(calls).toBe(1);
    for (const entry of entries) expect(entry).toEqual(entries[0]);
    expect(entries[0]?.value).toEqual({ n: 1 });
    expect(JSON.parse((await t.redis.get(key)) ?? 'null')).toEqual(entries[0]);
  });

  it('a failed fill rejects every waiter, stores nothing, and releases the key', async () => {
    const key = `${prefix()}:failing`;
    const started = gate();
    const fill = gate();
    let calls = 0;
    const compute = async () => {
      calls += 1;
      started.open();
      await fill.wait;
      if (calls === 1) throw new Error('fill failed');
      return { n: calls };
    };

    const pending = Array.from({ length: 3 }, () => cachedJson(t.redis, key, 60, compute));
    await started.wait;
    // A rejected fill releases the key without a Redis round trip, so a GET
    // answered after that would start a fill of its own (as it should); the
    // PING barrier makes all three join before the fill fails.
    await t.redis.ping();
    // Enters while the fill is running: it must join that fill — and fail with
    // it — rather than read Redis after the failure released the key and
    // start a fill of its own.
    const late = cachedJson(t.redis, key, 60, compute);
    fill.open();

    const settled = await Promise.allSettled([...pending, late]);
    expect(settled.map((s) => s.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected']);
    for (const s of settled) {
      if (s.status === 'rejected') expect((s.reason as Error).message).toBe('fill failed');
    }
    expect(calls).toBe(1);
    expect(await t.redis.get(key)).toBeNull();

    const retried = await cachedJson(t.redis, key, 60, compute);
    expect(retried.value).toEqual({ n: 2 });
    expect(calls).toBe(2);
  });

  it('a fill in flight never blocks a different key', async () => {
    const slowKey = `${prefix()}:slow`;
    const fastKey = `${prefix()}:fast`;
    const slow = gate();

    const slowPending = cachedJson(t.redis, slowKey, 60, async () => {
      await slow.wait;
      return 'slow';
    });
    const fast = await cachedJson(t.redis, fastKey, 60, async () => 'fast');
    expect(fast.value).toBe('fast');

    slow.open();
    expect((await slowPending).value).toBe('slow');
  });
});
