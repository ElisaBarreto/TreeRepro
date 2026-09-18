import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureLogger } from '../../test/helpers/logger.ts';
import {
  DIGEST_FIRST_TICK_MS,
  DIGEST_LIST_LIMIT,
  DIGEST_MIN_INTERVAL_MS,
  DIGEST_TICK_MS,
  type DigestCounts,
  type DigestRunResult,
  hasActivity,
  isDigestDue,
  startDigestTimer,
} from './digest.ts';

const HOUR = 3_600_000;
const now = new Date('2026-09-18T06:00:00Z');
const ago = (ms: number): Date => new Date(now.getTime() - ms);

/** A `completed` run that ended `ms` ago, having covered the window up to then. */
const success = (ms: number) => ({
  finishedAt: ago(ms),
  detail: { windowEnd: ago(ms).toISOString() },
});

const ZERO: DigestCounts = {
  records: 0,
  contests: 0,
  complements: 0,
  validations: 0,
  disputes: 0,
  withdrawals: 0,
  proposals: 0,
  pendingGroups: 0,
  disputedNow: 0,
};

describe('RFC-74 R2 isDigestDue', () => {
  it('the interval is 23 h 30 min, so an hourly tick lands once a day', () => {
    expect(DIGEST_MIN_INTERVAL_MS).toBe(23.5 * HOUR);
  });

  it('the first run ever is due and covers the last 24 h', () => {
    expect(isDigestDue(null, now)).toEqual({ due: true, windowStart: ago(24 * HOUR) });
  });

  it('a success 23 h ago postpones the tick', () => {
    expect(isDigestDue(success(23 * HOUR), now).due).toBe(false);
  });

  it('a success 24 h ago is due, and the window starts where that run stopped', () => {
    // This is also what makes a failed run harmless: `isDigestDue` is only ever
    // given a `completed` or `skipped` run, because the caller asks
    // `latestRun(db, 'digest', ['completed', 'skipped'])`. That the status
    // filter really skips a newer failed run is Task 2's
    // `runs.integration.test.ts`, against a real `job_runs` table; nothing at
    // this level can verify it, since a failed run cannot even be expressed here.
    const last = success(24 * HOUR);
    expect(isDigestDue(last, now)).toEqual({
      due: true,
      windowStart: new Date(last.detail.windowEnd),
    });
  });

  it('a success 23 h 35 min ago is already due: the threshold is not a hard-coded 24 h', () => {
    expect(isDigestDue(success(23.5 * HOUR + 5 * 60_000), now).due).toBe(true);
  });

  it('a success that recorded no window end falls back to the last 24 h', () => {
    // Ruling C / RFC-74 R6: a `DIGEST_ENABLED=false` tick records
    // `{ reason: 'disabled' }` and is a `skipped` run, so it is a `lastSuccess`
    // candidate carrying no window at all.
    expect(
      isDigestDue({ finishedAt: ago(25 * HOUR), detail: { reason: 'disabled' } }, now),
    ).toEqual({ due: true, windowStart: ago(24 * HOUR) });
  });

  it('a window end that is not a usable timestamp falls back to the last 24 h', () => {
    expect(
      isDigestDue({ finishedAt: ago(25 * HOUR), detail: { windowEnd: 'not a date' } }, now),
    ).toEqual({ due: true, windowStart: ago(24 * HOUR) });
  });

  it('a run that never finished cannot postpone anything', () => {
    expect(isDigestDue({ finishedAt: null, detail: {} }, now)).toEqual({
      due: true,
      windowStart: ago(24 * HOUR),
    });
  });
});

describe('RFC-74 R3, R4 hasActivity', () => {
  it('an idle window has no activity', () => {
    expect(hasActivity(ZERO)).toBe(false);
  });

  it.each([
    'records',
    'contests',
    'complements',
    'validations',
    'disputes',
    'withdrawals',
    'proposals',
  ] as const)('%s alone is activity', (key) => {
    expect(hasActivity({ ...ZERO, [key]: 1 })).toBe(true);
  });

  it.each(['pendingGroups', 'disputedNow'] as const)(
    'the current queue size %s is not activity: R4 sums the window only',
    (key) => {
      expect(hasActivity({ ...ZERO, [key]: 7 })).toBe(false);
    },
  );
});

describe('RFC-74 R3 list size', () => {
  it('caps each list at ten items', () => {
    expect(DIGEST_LIST_LIMIT).toBe(10);
  });
});

describe('RFC-74 R2 startDigestTimer', () => {
  afterEach(() => vi.useRealTimers());

  /** What `runDigest` answers on a tick that sent a digest. */
  const completed = (): DigestRunResult => ({
    runId: 'a-run-id',
    status: 'completed',
    recipients: 2,
    failed: 0,
  });

  it('waits for the initial delay, then ticks every interval, and stops', async () => {
    vi.useFakeTimers();
    const { logger, lines } = captureLogger();
    const run = vi.fn<() => Promise<DigestRunResult>>().mockResolvedValue(completed());

    const timer = startDigestTimer({ run, logger, intervalMs: 10, initialDelayMs: 5 });

    // R2: the first tick is NOT at start — unlike the retention timer, the
    // digest waits, so a restart loop cannot hammer the mailer.
    await vi.advanceTimersByTimeAsync(4);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(run).toHaveBeenCalledTimes(2);

    timer.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
    expect((lines as { msg: string }[]).filter((l) => l.msg === 'digest run')).toHaveLength(2);
  });

  it('logs a failing run and never throws out of the tick', async () => {
    vi.useFakeTimers();
    const { logger, lines } = captureLogger();
    const run = vi
      .fn<() => Promise<DigestRunResult>>()
      .mockRejectedValueOnce(new Error('mailer unreachable'))
      .mockResolvedValue(completed());

    const timer = startDigestTimer({ run, logger, intervalMs: 10, initialDelayMs: 0 });

    // The tick is fired and forgotten, so a throw would surface as an
    // unhandled rejection and fail this test.
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    const logs = lines as { level: number; msg: string }[];
    expect(logs.find((l) => l.msg === 'digest run failed')?.level).toBe(50);
    // A failed tick must not stop the schedule.
    await vi.advanceTimersByTimeAsync(10);
    expect(run).toHaveBeenCalledTimes(2);
    expect(logs.find((l) => l.msg === 'digest run')).toBeDefined();
    timer.stop();
  });

  it('a tick that was not due is logged below info: 23 ticks a day do nothing', async () => {
    vi.useFakeTimers();
    const { logger, lines } = captureLogger();
    const run = vi
      .fn<() => Promise<DigestRunResult>>()
      .mockResolvedValue({ runId: null, status: 'not_due', recipients: 0, failed: 0 });

    const timer = startDigestTimer({ run, logger, intervalMs: 10, initialDelayMs: 0 });
    await vi.advanceTimersByTimeAsync(0);

    const logs = lines as { level: number; msg: string }[];
    expect(logs.filter((l) => l.msg === 'digest run')).toHaveLength(0);
    expect(logs.find((l) => l.msg === 'digest tick')?.level).toBe(20);
    timer.stop();
  });

  it('defaults to an hourly tick a minute after start (R2)', async () => {
    vi.useFakeTimers();
    const run = vi.fn<() => Promise<DigestRunResult>>().mockResolvedValue(completed());

    const timer = startDigestTimer({ run, logger: captureLogger().logger });

    expect(DIGEST_FIRST_TICK_MS).toBe(60_000);
    expect(DIGEST_TICK_MS).toBe(60 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(DIGEST_FIRST_TICK_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DIGEST_TICK_MS);
    expect(run).toHaveBeenCalledTimes(2);
    timer.stop();
  });
});
