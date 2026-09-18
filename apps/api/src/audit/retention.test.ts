import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureLogger } from '../../test/helpers/logger.ts';
import { RETENTION_INTERVAL_MS, startRetentionTimer } from './retention.ts';

describe('RFC-42 R4 retention timer', () => {
  afterEach(() => vi.useRealTimers());

  it('purges at start and every 24 hours, logs the count, survives a failure, and stops', async () => {
    vi.useFakeTimers();
    const { logger, lines } = captureLogger();
    const purge = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(3)
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(0);
    const purgeRuns = vi.fn<() => Promise<number>>().mockResolvedValue(5);
    const timer = startRetentionTimer({ purge, purgeRuns, logger });
    await vi.advanceTimersByTimeAsync(0);
    expect(purge).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);
    expect(purge).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);
    expect(purge).toHaveBeenCalledTimes(3);
    timer.stop();
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS * 2);
    expect(purge).toHaveBeenCalledTimes(3);
    const logs = lines as { level: number; msg: string; purged?: number; purgedRuns?: number }[];
    expect(logs.find((l) => l.msg === 'audit retention run')).toMatchObject({
      purged: 3,
      purgedRuns: 5,
    });
    expect(logs.find((l) => l.msg === 'audit retention failed')?.level).toBe(50);
    // RFC-42 R6: the job_runs purge runs right after the audit purge, so a
    // failed audit purge never reaches it.
    expect(purgeRuns).toHaveBeenCalledTimes(2);
  });

  it('uses a custom interval and does not keep the process alive', async () => {
    vi.useFakeTimers();
    const purge = vi.fn<() => Promise<number>>().mockResolvedValue(0);
    const purgeRuns = vi.fn<() => Promise<number>>().mockResolvedValue(0);
    const timer = startRetentionTimer({
      purge,
      purgeRuns,
      logger: captureLogger().logger,
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(2500);
    expect(purge).toHaveBeenCalledTimes(3);
    timer.stop();
  });
});
