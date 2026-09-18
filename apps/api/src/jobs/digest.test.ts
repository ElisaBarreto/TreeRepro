import { describe, expect, it } from 'vitest';
import {
  DIGEST_LIST_LIMIT,
  DIGEST_MIN_INTERVAL_MS,
  type DigestCounts,
  hasActivity,
  isDigestDue,
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
