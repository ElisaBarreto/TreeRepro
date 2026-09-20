import type { Redis } from './client.ts';

/** What `cachedJson` stores under a key and answers on a hit. */
interface CachedEntry<T> {
  value: T;
  computedAt: string;
}

/**
 * Fills in flight, per Redis client: a miss that arrives while `key` is being
 * computed awaits that fill instead of starting its own. An entry lives only
 * as long as its fill (removed when it settles, success or failure), so this
 * holds nothing between misses. Keyed by client because the cache scope is
 * the client's Redis, not the process.
 */
const inFlight = new WeakMap<Redis, Map<string, Promise<CachedEntry<unknown>>>>();

function fillsOf(redis: Redis): Map<string, Promise<CachedEntry<unknown>>> {
  let fills = inFlight.get(redis);
  if (!fills) {
    fills = new Map();
    inFlight.set(redis, fills);
  }
  return fills;
}

/**
 * Caches `compute`'s result as `{ value, computedAt }` JSON under `key` for
 * `ttlSeconds`; a hit answers the stored entry without calling `compute`.
 * Concurrent misses on one key share one fill (single-flight, in-process):
 * the first runs `compute`, the rest await the same promise and answer the
 * same entry; a rejected fill rejects every waiter, stores nothing, and
 * releases the key so the next call computes again.
 * @rfc RFC-10 R15
 */
export async function cachedJson<T>(
  redis: Redis,
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<CachedEntry<T>> {
  const cached = await redis.get(key);
  if (cached !== null) return JSON.parse(cached) as CachedEntry<T>;
  const fills = fillsOf(redis);
  const pending = fills.get(key);
  if (pending) return pending as Promise<CachedEntry<T>>;
  const fill = (async () => {
    const entry: CachedEntry<T> = { value: await compute(), computedAt: new Date().toISOString() };
    await redis.set(key, JSON.stringify(entry), 'EX', ttlSeconds);
    return entry;
  })().finally(() => fills.delete(key));
  fills.set(key, fill);
  return fill;
}

/** Deletes the given keys so the next `cachedJson` call recomputes. @rfc RFC-10 R15 */
export async function forgetCached(redis: Redis, ...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await redis.del(...keys);
}
