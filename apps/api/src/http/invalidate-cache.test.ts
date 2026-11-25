import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../test/helpers/logger.ts';
import type { Redis } from '../redis/client.ts';
import { bumpCacheEpochBestEffort, forgetCachedBestEffort } from './invalidate-cache.ts';

describe('RFC-72 R1 best-effort cache invalidation', () => {
  it('resolves and logs at warning when the underlying DEL fails', async () => {
    const { logger, lines } = captureLogger();
    const redis = {
      del: async () => {
        throw new Error('ECONNRESET');
      },
    } as unknown as Redis;

    await expect(
      forgetCachedBestEffort(
        logger,
        redis,
        ['dashboard:treerepro:actor-1', 'dashboard:plantrepro:actor-1'],
        { actorId: 'actor-1' },
      ),
    ).resolves.toBeUndefined();

    const warning = lines.find((l) => (l as { level: number }).level === 40) as
      | Record<string, unknown>
      | undefined;
    expect(warning).toBeDefined();
    if (!warning) throw new Error('unreachable');
    expect(warning.key).toEqual(['dashboard:treerepro:actor-1', 'dashboard:plantrepro:actor-1']);
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

    await forgetCachedBestEffort(logger, redis, ['dashboard:a', 'dashboard:b'], { actorId: 'x' });
    expect(deleted).toEqual(['dashboard:a', 'dashboard:b']);
    expect(lines).toHaveLength(0);
  });
});

describe('RFC-33 R12 best-effort cache epoch bump', () => {
  it('resolves and logs at warning when the underlying INCR fails', async () => {
    const { logger, lines } = captureLogger();
    const redis = {
      incr: async () => {
        throw new Error('ECONNRESET');
      },
    } as unknown as Redis;

    await expect(
      bumpCacheEpochBestEffort(logger, redis, { traitId: 'trait-1' }),
    ).resolves.toBeUndefined();

    const warning = lines.find((l) => (l as { level: number }).level === 40) as
      | Record<string, unknown>
      | undefined;
    if (!warning) throw new Error('no warning logged');
    expect(warning.traitId).toBe('trait-1');
    expect((warning.err as { message: string }).message).toBe('ECONNRESET');
  });

  it('raises the epoch and does not log when the INCR succeeds', async () => {
    const { logger, lines } = captureLogger();
    const raised: string[] = [];
    const redis = {
      incr: async (key: string) => raised.push(key),
    } as unknown as Redis;

    await bumpCacheEpochBestEffort(logger, redis, { speciesId: 'species-1' });
    expect(raised).toEqual(['cache:epoch']);
    expect(lines).toHaveLength(0);
  });
});
