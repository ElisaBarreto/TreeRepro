import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../test/helpers/logger.ts';
import type { Redis } from '../redis/client.ts';
import { forgetCachedBestEffort } from './invalidate-cache.ts';

describe('RFC-72 R1 best-effort cache invalidation', () => {
  it('resolves and logs at warning when the underlying DEL fails', async () => {
    const { logger, lines } = captureLogger();
    const redis = {
      del: async () => {
        throw new Error('ECONNRESET');
      },
    } as unknown as Redis;

    await expect(
      forgetCachedBestEffort(logger, redis, 'dashboard:actor-1', { actorId: 'actor-1' }),
    ).resolves.toBeUndefined();

    const warning = lines.find((l) => (l as { level: number }).level === 40) as
      | Record<string, unknown>
      | undefined;
    expect(warning).toBeDefined();
    if (!warning) throw new Error('unreachable');
    expect(warning.key).toBe('dashboard:actor-1');
    expect(warning.actorId).toBe('actor-1');
    expect((warning.err as { message: string }).message).toBe('ECONNRESET');
  });

  it('does not log when the DEL succeeds', async () => {
    const { logger, lines } = captureLogger();
    let deleted: string[] | undefined;
    const redis = {
      del: async (...keys: string[]) => {
        deleted = keys;
        return keys.length;
      },
    } as unknown as Redis;

    await forgetCachedBestEffort(logger, redis, 'dashboard:actor-2', { actorId: 'actor-2' });

    expect(deleted).toEqual(['dashboard:actor-2']);
    expect(lines).toHaveLength(0);
  });
});
