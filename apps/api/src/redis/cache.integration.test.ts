import { describe, expect, it, vi } from 'vitest';
import { useTestApp } from '../../test/helpers/app.ts';
import { cachedJson, cacheGeneration, forgetCached, STALE_RETENTION_SECONDS } from './cache.ts';

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

  it('a forget during a fill discards it: it stores nothing, and a later call computes afresh', async () => {
    const key = `${prefix()}:forgotten`;
    const started = gate();
    const fill = gate();
    const stale = cachedJson(t.redis, key, 60, async () => {
      started.open();
      await fill.wait;
      return 'before the write';
    });
    await started.wait;
    await forgetCached(t.redis, key);

    // Arrives after the forget: it must not join the discarded fill.
    const fresh = await cachedJson(t.redis, key, 60, async () => 'after the write');
    expect(fresh.value).toBe('after the write');

    fill.open();
    // The caller that joined before the forget still gets its answer…
    expect((await stale).value).toBe('before the write');
    // …but it is never written back over the fresh entry.
    expect(JSON.parse((await t.redis.get(key)) ?? 'null')).toEqual(fresh);
  });

  it('a forget during a fill with no later call leaves the key empty', async () => {
    const key = `${prefix()}:forgotten-alone`;
    const started = gate();
    const fill = gate();
    const stale = cachedJson(t.redis, key, 60, async () => {
      started.open();
      await fill.wait;
      return 'before the write';
    });
    await started.wait;
    await forgetCached(t.redis, key);
    fill.open();
    await stale;
    expect(await t.redis.get(key)).toBeNull();
  });

  it('a call whose inputs predate a forget answers them but stores nothing', async () => {
    const key = `${prefix()}:generation`;
    const generation = cacheGeneration(t.redis, key);
    // The write commits and drops the key while the caller is still reading its inputs.
    await forgetCached(t.redis, key);
    const answer = await cachedJson(t.redis, key, 60, async () => 'stale inputs', { generation });
    expect(answer.value).toBe('stale inputs');
    expect(await t.redis.get(key)).toBeNull();
    // A call that reads its inputs now caches as usual.
    const fresh = await cachedJson(t.redis, key, 60, async () => 'fresh inputs', {
      generation: cacheGeneration(t.redis, key),
    });
    expect(JSON.parse((await t.redis.get(key)) ?? 'null')).toEqual(fresh);
  });

  it('a forget during the GET keeps a fresh call from joining the stale fill', async () => {
    const key = `${prefix()}:forget-during-get`;
    // The stale call sends its GET in this tick; the forget is queued behind it.
    const stale = cachedJson(t.redis, key, 60, async () => 'stale inputs', {
      generation: cacheGeneration(t.redis, key),
    });
    const forgotten = forgetCached(t.redis, key);
    const fresh = cachedJson(t.redis, key, 60, async () => 'fresh inputs', {
      generation: cacheGeneration(t.redis, key),
    });
    await forgotten;
    expect((await stale).value).toBe('stale inputs');
    expect((await fresh).value).toBe('fresh inputs');
    expect(JSON.parse((await t.redis.get(key)) ?? 'null')?.value).toBe('fresh inputs');
  });

  describe('staleWhileRevalidate', () => {
    const swr = { staleWhileRevalidate: true };
    /** Writes an entry computed `ageSeconds` ago, as an earlier fill would have left it. */
    const seed = async (key: string, value: unknown, ageSeconds: number) => {
      const entry = { value, computedAt: new Date(Date.now() - ageSeconds * 1000).toISOString() };
      await t.redis.set(key, JSON.stringify(entry), 'EX', 3600);
      return entry;
    };
    /** Lets every continuation of a settled fill run; a SET it sent is ahead of the next command. */
    const settle = async () => {
      await new Promise((resolve) => setImmediate(resolve));
      await t.redis.ping();
    };

    it('keeps the entry for the window plus the retention, and answers a fresh one without computing', async () => {
      const key = `${prefix()}:swr-fresh`;
      let calls = 0;
      const compute = async () => {
        calls += 1;
        return { n: calls };
      };
      const first = await cachedJson(t.redis, key, 60, compute, swr);
      const second = await cachedJson(t.redis, key, 60, compute, swr);
      expect(second).toEqual(first);
      expect(calls).toBe(1);
      const ttl = await t.redis.ttl(key);
      expect(ttl).toBeGreaterThan(STALE_RETENTION_SECONDS);
      expect(ttl).toBeLessThanOrEqual(60 + STALE_RETENTION_SECONDS);
    });

    it('answers a stale entry without awaiting the one fill it starts, then the refreshed entry', async () => {
      const key = `${prefix()}:swr-stale`;
      const old = await seed(key, { n: 0 }, 120);
      const started = gate();
      const fill = gate();
      let calls = 0;
      const compute = async () => {
        calls += 1;
        started.open();
        await fill.wait;
        return { n: calls };
      };

      // Ten stale reads at once: each answers the stored entry while the fill
      // is still held, and together they start one compute.
      const stale = await Promise.all(
        Array.from({ length: 10 }, () => cachedJson(t.redis, key, 60, compute, swr)),
      );
      for (const entry of stale) expect(entry).toEqual(old);
      await started.wait;
      // A read that arrives while the fill is in flight does not wait for it either.
      expect(await cachedJson(t.redis, key, 60, compute, swr)).toEqual(old);
      expect(calls).toBe(1);

      fill.open();
      await vi.waitFor(async () => {
        expect((await cachedJson(t.redis, key, 60, compute, swr)).value).toEqual({ n: 1 });
      });
      expect(calls).toBe(1);
      const ttl = await t.redis.ttl(key);
      expect(ttl).toBeGreaterThan(STALE_RETENTION_SECONDS);
    });

    it('a failing background fill keeps the stale entry, raises nothing, and the next read tries again', async () => {
      const key = `${prefix()}:swr-failing`;
      const old = await seed(key, 'old', 120);
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      let calls = 0;
      const compute = async () => {
        calls += 1;
        if (calls === 1) throw new Error('refresh failed');
        return 'new';
      };
      try {
        expect(await cachedJson(t.redis, key, 60, compute, swr)).toEqual(old);
        await settle();
        expect(calls).toBe(1);
        expect(unhandled).toEqual([]);
        expect(JSON.parse((await t.redis.get(key)) ?? 'null')).toEqual(old);

        // The failure released the key: this read still answers the stale
        // entry and starts the second fill, which succeeds.
        expect(await cachedJson(t.redis, key, 60, compute, swr)).toEqual(old);
        await vi.waitFor(async () => {
          expect((await cachedJson(t.redis, key, 60, compute, swr)).value).toBe('new');
        });
        expect(calls).toBe(2);
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });

    it('a forget during a background fill discards it: nothing is stored', async () => {
      const key = `${prefix()}:swr-forgotten`;
      const old = await seed(key, 'before the write', 120);
      const started = gate();
      const fill = gate();
      const compute = async () => {
        started.open();
        await fill.wait;
        return 'computed before the write';
      };
      expect(await cachedJson(t.redis, key, 60, compute, swr)).toEqual(old);
      await started.wait;
      await forgetCached(t.redis, key);
      // The forget deleted the stale entry too.
      expect(await t.redis.get(key)).toBeNull();
      fill.open();
      await settle();
      expect(await t.redis.get(key)).toBeNull();
    });

    it('a true miss computes inside the call, and a call during that fill joins it', async () => {
      const key = `${prefix()}:swr-miss`;
      const started = gate();
      const fill = gate();
      let calls = 0;
      const compute = async () => {
        calls += 1;
        started.open();
        await fill.wait;
        return { n: calls };
      };
      const first = cachedJson(t.redis, key, 60, compute, swr);
      await started.wait;
      const late = cachedJson(t.redis, key, 60, compute, swr);
      await t.redis.ping();
      fill.open();
      expect(await late).toEqual(await first);
      expect(calls).toBe(1);
    });

    it('without the option an entry is answered whatever its age and nothing is refreshed', async () => {
      const key = `${prefix()}:no-swr`;
      const old = await seed(key, 'old', 120);
      let calls = 0;
      const compute = async () => {
        calls += 1;
        return 'new';
      };
      expect(await cachedJson(t.redis, key, 60, compute)).toEqual(old);
      await settle();
      expect(calls).toBe(0);
      expect(JSON.parse((await t.redis.get(key)) ?? 'null')).toEqual(old);
      // Once Redis has expired it, the call computes and stores for the ttl alone.
      await t.redis.del(key);
      expect((await cachedJson(t.redis, key, 60, compute)).value).toBe('new');
      expect(await t.redis.ttl(key)).toBeLessThanOrEqual(60);
    });
  });
});
