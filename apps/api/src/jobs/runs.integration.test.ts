import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useTestDb, withRollback } from '../../test/helpers/db.ts';
import { jobRuns } from '../db/schema/job-runs.ts';
import { finishRun, latestRun, recordRunDetail, startRun } from './runs.ts';

const HOUR = 3_600_000;

/**
 * Every other integration file shares this database, and `job_runs` has only
 * two kinds, so "the newest run" is not a fact a test may own (Ruling I). The
 * rows below are given `started_at` in the FUTURE: `startRun` only ever writes
 * `now()`, so no concurrent suite can produce a row that outranks them.
 */
const marker = (): string => randomBytes(8).toString('hex');

describe('RFC-74 R1 startRun / finishRun', () => {
  const t = useTestDb();

  it('startRun inserts a running row of the given kind', async () => {
    await withRollback(t.db, async (tx) => {
      const id = await startRun(tx, 'digest');
      const [row] = await tx.select().from(jobRuns).where(eq(jobRuns.id, id));
      expect(row).toMatchObject({ kind: 'digest', status: 'running', detail: {}, error: null });
      expect(row?.finishedAt).toBeNull();
    });
  });

  it('finishRun sets finished_at, the status and the detail', async () => {
    await withRollback(t.db, async (tx) => {
      const id = await startRun(tx, 'audit_purge');
      await finishRun(tx, id, { status: 'completed', detail: { purged: 7 } });
      const [row] = await tx.select().from(jobRuns).where(eq(jobRuns.id, id));
      expect(row).toMatchObject({ status: 'completed', detail: { purged: 7 }, error: null });
      expect(row?.finishedAt).toBeInstanceOf(Date);
      expect(row?.finishedAt?.getTime()).toBeGreaterThanOrEqual(row?.startedAt.getTime() ?? 0);
    });
  });

  it('finishRun throws when the id closes no row', async () => {
    await withRollback(t.db, async (tx) => {
      // RFC-74 R7: the grant is table-wide, so only the code can hold
      // finishRun to "its own row by id". An UPDATE matching nothing does not
      // abort the transaction, which is exactly why it must not pass silently.
      await expect(finishRun(tx, randomUUID(), { status: 'completed' })).rejects.toThrow(
        /finishRun: no job run/,
      );
    });
  });

  it('finishRun records a failure with its message', async () => {
    await withRollback(t.db, async (tx) => {
      const id = await startRun(tx, 'digest');
      await finishRun(tx, id, { status: 'failed', error: 'mailer unreachable' });
      const [row] = await tx.select().from(jobRuns).where(eq(jobRuns.id, id));
      expect(row).toMatchObject({ status: 'failed', error: 'mailer unreachable', detail: {} });
      expect(row?.finishedAt).toBeInstanceOf(Date);
    });
  });

  it('recordRunDetail writes detail while leaving the run open (RFC-74 R2)', async () => {
    await withRollback(t.db, async (tx) => {
      const id = await startRun(tx, 'digest');
      await recordRunDetail(tx, id, { windowStart: 'a', windowEnd: 'b', phase: 'sending' });
      const [row] = await tx.select().from(jobRuns).where(eq(jobRuns.id, id));
      // The whole point: the run is still `running` and still unfinished, so
      // nothing about this write can be mistaken for a terminal state.
      expect(row).toMatchObject({
        status: 'running',
        error: null,
        detail: { windowStart: 'a', windowEnd: 'b', phase: 'sending' },
      });
      expect(row?.finishedAt).toBeNull();
      // And `finishRun` replaces it wholesale afterwards: `phase` never
      // survives into a finished row.
      await finishRun(tx, id, { status: 'completed', detail: { windowEnd: 'b', recipients: 2 } });
      const [done] = await tx.select().from(jobRuns).where(eq(jobRuns.id, id));
      expect(done?.detail).toEqual({ windowEnd: 'b', recipients: 2 });
    });
  });

  it('a failed close keeps the detail the run had already recorded (RFC-74 R2)', async () => {
    await withRollback(t.db, async (tx) => {
      const id = await startRun(tx, 'digest');
      await recordRunDetail(tx, id, { windowStart: 'a', phase: 'sending' });
      // No detail passed: the run threw, and its own failure must not erase
      // the evidence that it had begun mailing — that record is the whole
      // input to the next run's repeat check.
      await finishRun(tx, id, { status: 'failed', error: 'audit insert rejected' });
      const [row] = await tx.select().from(jobRuns).where(eq(jobRuns.id, id));
      expect(row).toMatchObject({
        status: 'failed',
        error: 'audit insert rejected',
        detail: { windowStart: 'a', phase: 'sending' },
      });
    });
  });

  it('recordRunDetail throws when the id updates no row', async () => {
    await withRollback(t.db, async (tx) => {
      await expect(recordRunDetail(tx, randomUUID(), { phase: 'sending' })).rejects.toThrow(
        /recordRunDetail: no job run/,
      );
    });
  });
});

describe('RFC-74 R2 latestRun', () => {
  const t = useTestDb();

  it('answers the newest run of the kind by started_at, and filters by status when asked', async () => {
    await withRollback(t.db, async (tx) => {
      const mine = marker();
      const at = (hours: number): Date => new Date(Date.now() + hours * HOUR);
      const [older] = await tx
        .insert(jobRuns)
        .values({
          kind: 'digest',
          startedAt: at(1),
          finishedAt: at(1),
          status: 'completed',
          detail: { mine },
        })
        .returning({ id: jobRuns.id });
      const [newer] = await tx
        .insert(jobRuns)
        .values({
          kind: 'digest',
          startedAt: at(2),
          finishedAt: at(2),
          status: 'failed',
          detail: { mine },
        })
        .returning({ id: jobRuns.id });

      const any = await latestRun(tx, 'digest');
      expect(any?.id).toBe(newer?.id);
      expect(any?.detail).toEqual({ mine });

      const successful = await latestRun(tx, 'digest', ['completed', 'skipped']);
      expect(successful?.id).toBe(older?.id);
      expect(successful?.status).toBe('completed');
    });
  });

  it('ignores a newer run of another kind', async () => {
    await withRollback(t.db, async (tx) => {
      const mine = marker();
      const [digestRun] = await tx
        .insert(jobRuns)
        .values({
          kind: 'digest',
          startedAt: new Date(Date.now() + 4 * HOUR),
          status: 'completed',
          detail: { mine },
        })
        .returning({ id: jobRuns.id });
      // Newer than the digest run, so only the kind filter can keep it out.
      await tx.insert(jobRuns).values({
        kind: 'audit_purge',
        startedAt: new Date(Date.now() + 5 * HOUR),
        status: 'completed',
        detail: { mine },
      });
      const found = await latestRun(tx, 'digest');
      expect(found?.id).toBe(digestRun?.id);
      expect(found?.kind).toBe('digest');
    });
  });
});
