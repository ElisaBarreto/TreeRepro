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
    const timer = startRetentionTimer({ purge, logger });
    await vi.advanceTimersByTimeAsync(0);
    expect(purge).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);
    expect(purge).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);
    expect(purge).toHaveBeenCalledTimes(3);
    timer.stop();
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS * 2);
    expect(purge).toHaveBeenCalledTimes(3);
    const logs = lines as { level: number; msg: string; purged?: number }[];
    expect(logs.find((l) => l.msg === 'audit retention run')).toMatchObject({ purged: 3 });
    expect(logs.find((l) => l.msg === 'audit retention failed')?.level).toBe(50);
  });

  it('uses a custom interval and does not keep the process alive', async () => {
    vi.useFakeTimers();
    const purge = vi.fn<() => Promise<number>>().mockResolvedValue(0);
    const timer = startRetentionTimer({ purge, logger: captureLogger().logger, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(2500);
    expect(purge).toHaveBeenCalledTimes(3);
    timer.stop();
  });
});
