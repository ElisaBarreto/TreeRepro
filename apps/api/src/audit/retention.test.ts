import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureLogger } from '../../test/helpers/logger.ts';
import { RETENTION_INTERVAL_MS, startRetentionTimer } from './retention.ts';

describe('RFC-42 R4 retention timer', () => {
  afterEach(() => vi.useRealTimers());

  it('purges at start and every 24 hours, logs both counts, survives a failure, and stops', async () => {
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
    // RFC-42 R6: same schedule, so every tick attempts it — including the one
    // whose audit purge threw.
    expect(purgeRuns).toHaveBeenCalledTimes(3);
  });

  it('purges job_runs on a tick whose audit purge threw, and never throws itself', async () => {
    vi.useFakeTimers();
    const { logger, lines } = captureLogger();
    const purge = vi.fn<() => Promise<number>>().mockRejectedValue(new Error('db down'));
    const purgeRuns = vi.fn<() => Promise<number>>().mockResolvedValue(4);
    const timer = startRetentionTimer({ purge, purgeRuns, logger });
    // The tick is fired and forgotten (`void run()`), so a throw out of it
    // would surface as an unhandled rejection and fail this test.
    await vi.advanceTimersByTimeAsync(0);
    expect(purge).toHaveBeenCalledTimes(1);
    // RFC-42 R6: a broken audit_log_purge() is exactly when job_runs fills
    // fastest; it must not also stop job_runs from being purged.
    expect(purgeRuns).toHaveBeenCalledTimes(1);
    const logs = lines as { level: number; msg: string; job?: string }[];
    expect(logs.find((l) => l.msg === 'audit retention failed')).toMatchObject({
      level: 50,
      job: 'audit_log',
    });
    // No happy-path line: half a run is not a run.
    expect(logs.filter((l) => l.msg === 'audit retention run')).toHaveLength(0);
    timer.stop();
  });

  it('logs a failing job_runs purge on its own and keeps the audit purge', async () => {
    vi.useFakeTimers();
    const { logger, lines } = captureLogger();
    const purge = vi.fn<() => Promise<number>>().mockResolvedValue(2);
    const purgeRuns = vi.fn<() => Promise<number>>().mockRejectedValue(new Error('no function'));
    const timer = startRetentionTimer({ purge, purgeRuns, logger });
    await vi.advanceTimersByTimeAsync(0);
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purgeRuns).toHaveBeenCalledTimes(1);
    const logs = lines as { level: number; msg: string; job?: string }[];
    expect(logs.find((l) => l.msg === 'audit retention failed')).toMatchObject({
      level: 50,
      job: 'job_runs',
    });
    expect(logs.filter((l) => l.msg === 'audit retention run')).toHaveLength(0);
    timer.stop();
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
