import type { Logger } from '../logger.ts';
import { bumpCacheEpoch, forgetCached } from '../redis/cache.ts';
import type { Redis } from '../redis/client.ts';
import { sanitizeError } from './errors.ts';

/**
 * Best-effort `forgetCached`: a route calls this only after its mutation has
 * already committed, so a `DEL` that fails (a transient command timeout, a
 * failover) must not turn a successful write into a 500 the client might
 * retry. The failure is logged at warning through the request logger with
 * `key` and `context` so the stale entry can be traced to its cause and its
 * actor; the caller's own success response is returned regardless.
 *
 * Sessions live in Redis too, so a *total* outage already fails
 * authentication before a route handler is reached — this only covers a
 * single command failing after auth has already succeeded. The entry
 * self-heals at its ttl either way.
 * @rfc RFC-72 R1
 */
export async function forgetCachedBestEffort(
  logger: Logger,
  redis: Redis,
  key: string | readonly string[],
  context: Record<string, unknown>,
): Promise<void> {
  try {
    await forgetCached(redis, ...(typeof key === 'string' ? [key] : key));
  } catch (err) {
    logger.warn(
      { key, ...context, err: sanitizeError(err instanceof Error ? err : new Error(String(err))) },
      'cache invalidation failed after a committed write; entry left stale until its ttl',
    );
  }
}

/**
 * Best-effort `bumpCacheEpoch`, for a route whose committed write changed what
 * a viewer class may see: a failing `INCR` must not turn that write into a 500.
 * It is logged at warning; the stale-while-revalidate entries then keep being
 * answered until they are next recomputed.
 * @rfc RFC-33 R12
 */
export async function bumpCacheEpochBestEffort(
  logger: Logger,
  redis: Redis,
  context: Record<string, unknown>,
): Promise<void> {
  try {
    await bumpCacheEpoch(redis);
  } catch (err) {
    logger.warn(
      { ...context, err: sanitizeError(err instanceof Error ? err : new Error(String(err))) },
      'cache epoch bump failed after a committed visibility change; cached aggregates may be answered stale',
    );
  }
}
