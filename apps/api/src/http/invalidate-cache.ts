import type { Logger } from '../logger.ts';
import { forgetCached } from '../redis/cache.ts';
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
  key: string,
  context: Record<string, unknown>,
): Promise<void> {
  try {
    await forgetCached(redis, key);
  } catch (err) {
    logger.warn(
      { key, ...context, err: sanitizeError(err instanceof Error ? err : new Error(String(err))) },
      'cache invalidation failed after a committed write; entry left stale until its ttl',
    );
  }
}
