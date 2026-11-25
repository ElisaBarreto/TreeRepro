import type { Redis } from './client.ts';

/** What `cachedJson` stores under a key and answers on a hit. */
interface CachedEntry<T> {
  value: T;
  computedAt: string;
}

/**
 * Fills in flight, per Redis client: a miss that arrives while `key` is being
 * computed awaits that fill instead of starting its own. A background refresh
 * of a stale entry (`staleWhileRevalidate`) is registered here too, so stale
 * reads start one. An entry lives only as long as its fill (removed when it
 * settles, success or failure), so this holds nothing between misses. Keyed
 * by client because the cache scope is the client's Redis, not the process.
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
 * How many times `forgetCached` has dropped each key, per Redis client. A
 * fill stores its result only if the count is unchanged since its inputs
 * were read. One small number per key ever forgotten (a few per user).
 */
const generations = new WeakMap<Redis, Map<string, number>>();

function generationsOf(redis: Redis): Map<string, number> {
  let gens = generations.get(redis);
  if (!gens) {
    gens = new Map();
    generations.set(redis, gens);
  }
  return gens;
}

/**
 * The key's forget count, to read before the inputs of a `compute` that are
 * gathered outside it, and to pass to `cachedJson` as `generation`.
 * @rfc RFC-10 R15
 */
export function cacheGeneration(redis: Redis, key: string): number {
  return generationsOf(redis).get(key) ?? 0;
}

/**
 * How long a `staleWhileRevalidate` entry stays in Redis past its freshness
 * window: 30 days.
 * @rfc RFC-10 R15
 */
export const STALE_RETENTION_SECONDS = 30 * 24 * 60 * 60;

/**
 * Caches `compute`'s result as `{ value, computedAt }` JSON under `key` for
 * `ttlSeconds`; a hit answers the stored entry without calling `compute`.
 * Concurrent misses on one key share one fill (single-flight, in-process):
 * the first runs `compute`, the rest await the same promise and answer the
 * same entry; a rejected fill rejects every waiter, stores nothing, and
 * releases the key so the next call computes again.
 *
 * With `staleWhileRevalidate`, `ttlSeconds` is the entry's freshness window
 * and Redis keeps it `STALE_RETENTION_SECONDS` longer: a call that finds an
 * entry older than the window answers it at once and starts one background
 * fill, whose failure is swallowed (the next call starts another); only a key
 * with nothing stored is computed inside the call.
 * @rfc RFC-10 R15
 */
export async function cachedJson<T>(
  redis: Redis,
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
  options?: { generation?: number; staleWhileRevalidate?: boolean },
): Promise<CachedEntry<T>> {
  const fills = fillsOf(redis);
  const since = options?.generation ?? cacheGeneration(redis, key);
  // The caller read its inputs before a forget: answer from them, but share
  // and store nothing, since they may predate the write (issue #417).
  const uncached = async (): Promise<CachedEntry<T>> => ({
    value: await compute(),
    computedAt: new Date().toISOString(),
  });
  if (since !== cacheGeneration(redis, key)) return uncached();
  // Before the GET as well as after it: a caller that enters while the key is
  // being filled joins that fill outright. Reading Redis first would let a
  // fill that fails while the GET is pending release the key, so the GET's
  // miss would start a second compute for a request that arrived in time.
  // With `staleWhileRevalidate` the fill may be a background refresh, which a
  // reader must not wait for: it reads Redis anyway and joins this fill (the
  // one it saw on entry, even if it has failed since) only if nothing is stored.
  const swr = options?.staleWhileRevalidate === true;
  const active = fills.get(key) as Promise<CachedEntry<T>> | undefined;
  if (active && !swr) return active;
  const run = async (): Promise<CachedEntry<T>> => {
    const entry: CachedEntry<T> = { value: await compute(), computedAt: new Date().toISOString() };
    // A `forgetCached` while computing: the result predates the write that
    // caused the forget, so it must not be stored (issue #417).
    if (cacheGeneration(redis, key) === since)
      await redis.set(
        key,
        JSON.stringify(entry),
        'EX',
        ttlSeconds + (swr ? STALE_RETENTION_SECONDS : 0),
      );
    return entry;
  };
  const startFill = (): Promise<CachedEntry<T>> => {
    // `fill` is read only after the first `await`, once it is assigned.
    const fill = run().finally(() => {
      if (fills.get(key) === fill) fills.delete(key);
    });
    fills.set(key, fill);
    return fill;
  };
  const cached = await redis.get(key);
  if (cached !== null) {
    const entry = JSON.parse(cached) as CachedEntry<T>;
    // Past its window: answer it now and refresh it behind the reader's back,
    // unless a refresh is already running or a forget happened during the GET
    // (the same two checks a miss makes below). Nobody awaits this fill, so
    // its rejection is swallowed here; the key is released and the next read
    // starts another.
    if (
      swr &&
      Date.now() - Date.parse(entry.computedAt) > ttlSeconds * 1000 &&
      since === cacheGeneration(redis, key) &&
      !fills.has(key)
    )
      startFill().catch(() => undefined);
    return entry;
  }
  // Again after the GET: a forget during it must not let this call register a
  // fill that a caller with fresh inputs would then join.
  if (since !== cacheGeneration(redis, key)) return uncached();
  const pending = active ?? fills.get(key);
  if (pending) return pending as Promise<CachedEntry<T>>;
  return startFill();
}

/**
 * Deletes the given keys so the next `cachedJson` call recomputes, and
 * discards their fills in flight in this process: they store nothing, and
 * later calls do not join them. It also bumps each key's generation, so a
 * call whose inputs were read before the forget stores nothing either. The fills are dropped before the `DEL` is
 * sent, so a `SET` already on the connection is deleted by it.
 * @rfc RFC-10 R15
 */
export async function forgetCached(redis: Redis, ...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const fills = fillsOf(redis);
  const gens = generationsOf(redis);
  for (const key of keys) {
    fills.delete(key);
    gens.set(key, (gens.get(key) ?? 0) + 1);
  }
  await redis.del(...keys);
}
