import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureLogger } from '../../test/helpers/logger.ts';
import {
  DIGEST_ATTEMPT_GUARD_MS,
  DIGEST_FIRST_TICK_MS,
  DIGEST_LIST_LIMIT,
  DIGEST_MIN_INTERVAL_MS,
  DIGEST_TICK_MS,
  type DigestCounts,
  type DigestRunResult,
  hasActivity,
  isDigestDue,
  repeatedRunId,
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
    expect(isDigestDue(null, now, null)).toEqual({ due: true, windowStart: ago(24 * HOUR) });
  });

  it('a success 23 h ago postpones the tick', () => {
    expect(isDigestDue(success(23 * HOUR), now, null).due).toBe(false);
  });

  it('a success 24 h ago is due, and the window starts where that run stopped', () => {
    // This is also what makes a failed run harmless: `isDigestDue` is only ever
    // given a `completed` or `skipped` run, because the caller asks
    // `latestRun(db, 'digest', ['completed', 'skipped'])`. That the status
    // filter really skips a newer failed run is Task 2's
    // `runs.integration.test.ts`, against a real `job_runs` table; nothing at
    // this level can verify it, since a failed run cannot even be expressed here.
    const last = success(24 * HOUR);
    expect(isDigestDue(last, now, null)).toEqual({
      due: true,
      windowStart: new Date(last.detail.windowEnd),
    });
  });

  it('a success 23 h 35 min ago is already due: the threshold is not a hard-coded 24 h', () => {
    expect(isDigestDue(success(23.5 * HOUR + 5 * 60_000), now, null).due).toBe(true);
  });

  it('a success that recorded no window end falls back to the last 24 h', () => {
    // Ruling C / RFC-74 R6: a `DIGEST_ENABLED=false` tick records
    // `{ reason: 'disabled' }` and is a `skipped` run, so it is a `lastSuccess`
    // candidate carrying no window at all.
    expect(
      isDigestDue({ finishedAt: ago(25 * HOUR), detail: { reason: 'disabled' } }, now, null),
    ).toEqual({ due: true, windowStart: ago(24 * HOUR) });
  });

  it('a window end that is not a usable timestamp falls back to the last 24 h', () => {
    expect(
      isDigestDue({ finishedAt: ago(25 * HOUR), detail: { windowEnd: 'not a date' } }, now, null),
    ).toEqual({ due: true, windowStart: ago(24 * HOUR) });
  });

  it('a run that never finished cannot postpone anything', () => {
    expect(isDigestDue({ finishedAt: null, detail: {} }, now, null)).toEqual({
      due: true,
      windowStart: ago(24 * HOUR),
    });
  });
});

describe('RFC-74 R2 isDigestDue guards against a run that recorded no success', () => {
  /**
   * A run opened `ms` ago that recorded no success. The caller asks
   * `latestRun(db, 'digest', ['running', 'failed'])`, so this stands for
   * either status — only `started_at` reaches the function.
   */
  const attempt = (ms: number) => ({ startedAt: ago(ms) });

  it('the guard is two ticks, so it outlasts the very next tick rather than landing on it', () => {
    expect(DIGEST_ATTEMPT_GUARD_MS).toBe(2 * DIGEST_TICK_MS);
    // The load-bearing half: the guard is measured from `started_at` and the
    // next tick fires a full tick after the previous one did, so a guard of
    // exactly one tick would expire on the boundary and suppress nothing.
    expect(DIGEST_ATTEMPT_GUARD_MS).toBeGreaterThan(DIGEST_TICK_MS);
    // And it stays far below the success interval: a stuck row must cost one
    // repeated digest, never the digest itself.
    expect(DIGEST_ATTEMPT_GUARD_MS).toBeLessThan(DIGEST_MIN_INTERVAL_MS);
  });

  it('a run that recorded no success minutes ago postpones an otherwise due tick', () => {
    // Exactly the state a throw in `runDigest`'s tail leaves behind: the sends
    // are done, the last success is a day old and still due, and the run row
    // records no success of its own — `failed` normally, `running` when the
    // process died.
    const last = success(24 * HOUR);
    expect(isDigestDue(last, now, null).due).toBe(true);
    expect(isDigestDue(last, now, attempt(5 * 60_000)).due).toBe(false);
  });

  it('postpones the very first tick too, when no success exists at all', () => {
    expect(isDigestDue(null, now, attempt(5 * 60_000)).due).toBe(false);
  });

  it('holds across the next tick, which is when the duplicate would have gone out', () => {
    expect(isDigestDue(success(24 * HOUR), now, attempt(DIGEST_TICK_MS)).due).toBe(false);
  });

  it('an attempt older than the guard postpones nothing: no row can disable the digest', () => {
    const last = success(24 * HOUR);
    expect(isDigestDue(last, now, attempt(DIGEST_ATTEMPT_GUARD_MS)).due).toBe(true);
    expect(isDigestDue(last, now, attempt(7 * 24 * HOUR)).due).toBe(true);
  });

  it('a job that fails on every attempt retries every two ticks, for ever', () => {
    // The `failed` half of the guard must not turn a broken job into a
    // permanently silent one. One tick after a failed attempt the next tick is
    // held; two ticks after it, it runs again — a bounded backoff, not a stop.
    const last = success(24 * HOUR);
    expect(isDigestDue(last, now, attempt(DIGEST_TICK_MS)).due).toBe(false);
    expect(isDigestDue(last, now, attempt(2 * DIGEST_TICK_MS)).due).toBe(true);
  });

  it('never moves the window: a postponed tick still reads the last success back', () => {
    const last = success(24 * HOUR);
    expect(isDigestDue(last, now, attempt(5 * 60_000)).windowStart).toEqual(
      new Date(last.detail.windowEnd),
    );
  });

  it('a run still running does not make a tick due that the interval already refused', () => {
    expect(isDigestDue(success(23 * HOUR), now, attempt(5 * 60_000)).due).toBe(false);
  });
});

describe('RFC-74 R2 repeatedRunId', () => {
  const WINDOW_START = new Date('2026-09-17T06:00:00.000Z');
  const PREVIOUS = '018f2a00-0000-7000-8000-00000000000a';
  const sending = (windowStart: Date) => ({
    id: PREVIOUS,
    detail: {
      windowStart: windowStart.toISOString(),
      windowEnd: now.toISOString(),
      phase: 'sending',
    },
  });

  it('names the previous run when it reached the send phase over the same window', () => {
    expect(repeatedRunId(sending(WINDOW_START), WINDOW_START)).toBe(PREVIOUS);
  });

  it('is null when there is no unsuccessful run at all', () => {
    expect(repeatedRunId(null, WINDOW_START)).toBeNull();
  });

  it('is null when the previous run never reached the send phase', () => {
    // It died in `computeDigest` or `digestRecipients`: its detail is still
    // empty, so nobody was mailed and this run is a fresh attempt, not a
    // repeat. This is why the phase is recorded before the loop and not at
    // `startRun`.
    expect(repeatedRunId({ id: PREVIOUS, detail: {} }, WINDOW_START)).toBeNull();
  });

  it('is null when the previous run was mailing a different window', () => {
    expect(repeatedRunId(sending(ago(48 * HOUR)), WINDOW_START)).toBeNull();
  });

  it('ignores a windowStart that is not a string, exactly as isDigestDue does', () => {
    const odd = { id: PREVIOUS, detail: { windowStart: WINDOW_START, phase: 'sending' } };
    expect(repeatedRunId(odd, WINDOW_START)).toBeNull();
  });

  it('ignores a phase it does not know', () => {
    const detail = { windowStart: WINDOW_START.toISOString(), phase: 'computing' };
    expect(repeatedRunId({ id: PREVIOUS, detail }, WINDOW_START)).toBeNull();
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
