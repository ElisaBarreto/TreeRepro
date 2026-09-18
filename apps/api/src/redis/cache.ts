import type { Redis } from './client.ts';

/**
 * Caches `compute`'s result as `{ value, computedAt }` JSON under `key` for
 * `ttlSeconds`; a hit answers the stored entry without calling `compute`.
 * @rfc RFC-69 R4
 */
export async function cachedJson<T>(
  redis: Redis,
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<{ value: T; computedAt: string }> {
  const cached = await redis.get(key);
  if (cached !== null) return JSON.parse(cached) as { value: T; computedAt: string };
  const entry = { value: await compute(), computedAt: new Date().toISOString() };
  await redis.set(key, JSON.stringify(entry), 'EX', ttlSeconds);
  return entry;
}

/** Deletes the given keys so the next `cachedJson` call recomputes. @rfc RFC-69 R4 */
export async function forgetCached(redis: Redis, ...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await redis.del(...keys);
}
