import { randomUUID } from 'node:crypto';
import { platformHealthSchema } from '@treerepro/contracts';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  createAcceptedValue,
  createAnnotation,
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { useTestDb, withRollback } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { countOpenProposals } from '../dataset/proposals.ts';
import { countContested, countDisputed, countPendingGroups } from '../dataset/queues.ts';
import type { DbTransaction } from '../db/client.ts';
import { auditLog } from '../db/schema/audit-log.ts';
import { jobRuns } from '../db/schema/job-runs.ts';
import { speciesProposals } from '../db/schema/proposals.ts';
import { species } from '../db/schema/taxa.ts';
import { cachedJson, forgetCached } from '../redis/cache.ts';
import { createRedis, type Redis } from '../redis/client.ts';
import { computePlatformHealth, platformHealth } from './health.ts';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * READ `apps/api/src/workspace/dashboard.integration.test.ts:40-66` BEFORE
 * CHANGING ANY ASSERTION BELOW.
 *
 * Every number `computePlatformHealth` answers is a global count over a
 * database that every integration file in the run shares, and `platformHealth`
 * publishes them under `health`, one fixed key with a sixty second ttl that
 * every caller in the run reads. So:
 *
 * - the numbers are asserted as DELTAS around this file's own fixture, taken
 *   through the UNCACHED `computePlatformHealth` inside `withRollback` plus a
 *   `repeatable read` snapshot — the fixture is invisible to siblings because
 *   it rolls back, and siblings' commits are invisible to the delta because
 *   the snapshot is frozen. Never a literal, never the cached function;
 * - the queue counters are compared against the services themselves, not
 *   against a fixture of this file's own (the `queues.integration.test.ts`
 *   precedent);
 * - the cache MECHANISM is proved on a random key of this test's own, and the
 *   real `health` key only by bounds no concurrent caller can falsify. The
 *   `health` key is never deleted here: deleting it opens a window a sibling
 *   suite wins, and the entry read back would hold their numbers.
 */

/** `set transaction isolation level repeatable read`, checked to have bound. */
async function freezeSnapshot(tx: DbTransaction): Promise<void> {
  await tx.execute(sql`set transaction isolation level repeatable read`);
  const [isolation] = (await tx.execute(sql`show transaction_isolation`)) as unknown as [
    { transaction_isolation: string } | undefined,
  ];
  expect(isolation?.transaction_isolation).toBe('repeatable read');
}

/** The database's own `current_date`, which decides what `byDay` calls today. */
async function todayInDb(tx: DbTransaction): Promise<string> {
  const [row] = (await tx.execute(
    sql`select to_char(current_date, 'YYYY-MM-DD') as today`,
  )) as unknown as [{ today: string } | undefined];
  if (!row) throw new Error('todayInDb: no row');
  return row.today;
}

/** The 14 day strings `byDay` must carry, built in JS so the SQL is not its own oracle. */
function fourteenDaysEnding(today: string): string[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: 14 }, (_, i) =>
    new Date(end - (13 - i) * DAY).toISOString().slice(0, 10),
  );
}

describe('RFC-52 R1 computePlatformHealth', () => {
  const t = useTestDb();

  it('moves every counter by its own fixture alone, on a frozen snapshot', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const before = await computePlatformHealth(tx);
      const today = await todayInDb(tx);

      // Users: one of each status. Every other row below is created by
      // `author`, so the active delta is exactly one.
      const { user: author } = await createUser(tx);
      const { user: invitee } = await createUser(tx, { status: 'invited' });
      await createUser(tx, { status: 'suspended' });

      // Sign-ins: two entries for `author` inside seven days collapse to one
      // distinct actor; `invitee`'s twenty-day-old entry only reaches thirty.
      await tx.insert(auditLog).values([
        { actorUserId: author.id, action: 'auth.login.success', at: new Date(Date.now() - HOUR) },
        { actorUserId: author.id, action: 'auth.login.success', at: new Date(Date.now() - DAY) },
        {
          actorUserId: invitee.id,
          action: 'auth.login.success',
          at: new Date(Date.now() - 20 * DAY),
        },
      ]);

      // Dataset: two species and two traits, one of each inactive.
      const reference = await createReference(tx);
      const traitOn = await createTrait(tx, { levels: ['alpha'] });
      const traitOff = await createTrait(tx, { levels: ['alpha'], active: false });
      const speciesOn = await createSpecies(tx);
      const speciesOff = await createSpecies(tx);
      await tx.update(species).set({ active: false }).where(eq(species.id, speciesOff.id));

      // Four records on four distinct cells, two of them accepted. The fourth
      // is an IMPORTED record, which pins the reading of `activity.records7d`
      // and of `byDay.records`: every record of the window, whatever its
      // origin, not the digest's manual-only count (RFC-74 R3). `dataset.records`
      // counts imports too, and an import is exactly the kind of activity an
      // administrator opens this page to see.
      const batch = await createImportBatch(tx);
      const cells: { speciesId: string; trait: typeof traitOn }[] = [
        { speciesId: speciesOn.id, trait: traitOn },
        { speciesId: speciesOn.id, trait: traitOff },
        { speciesId: speciesOff.id, trait: traitOn },
      ];
      const records: string[] = [];
      for (const cell of cells) {
        const record = await createRecord(tx, {
          speciesId: cell.speciesId,
          traitId: cell.trait.id,
          valueText: 'alpha',
          levelId: cell.trait.levels[0]?.id,
          primaryReferenceId: reference.id,
          origin: 'manual',
          createdBy: author.id,
        });
        records.push(record.id);
      }
      await createRecord(tx, {
        speciesId: speciesOff.id,
        traitId: traitOff.id,
        valueText: 'alpha',
        levelId: traitOff.levels[0]?.id,
        primaryReferenceId: reference.id,
        origin: 'import',
        importBatchId: batch.id,
      });
      for (const [index, cell] of cells.slice(0, 2).entries()) {
        await createAcceptedValue(tx, {
          speciesId: cell.speciesId,
          traitId: cell.trait.id,
          actorId: author.id,
          decision: 'accepted',
          recordId: records[index],
        });
      }

      // Two annotations, both today.
      for (const recordId of records.slice(0, 2)) {
        await createAnnotation(tx, { recordId, actorId: author.id, kind: 'confirm' });
      }

      // RFC-52 R1 / ruling R-H: two proposals created now, only one still
      // open. `activity.proposals7d` must see both, `queues.proposals` one.
      await tx.insert(speciesProposals).values([
        { proposedName: `Testus proposal-${randomUUID()}`, proposerId: author.id },
        {
          proposedName: `Testus proposal-${randomUUID()}`,
          proposerId: author.id,
          status: 'rejected',
          decidedBy: author.id,
          decidedAt: new Date(),
        },
      ]);

      const after = await computePlatformHealth(tx);

      // Users.
      expect(after.users.active - before.users.active).toBe(1);
      expect(after.users.invited - before.users.invited).toBe(1);
      expect(after.users.suspended - before.users.suspended).toBe(1);
      expect(after.users.signedInLast7d - before.users.signedInLast7d).toBe(1);
      expect(after.users.signedInLast30d - before.users.signedInLast30d).toBe(2);

      // Dataset.
      expect(after.dataset.species - before.dataset.species).toBe(2);
      expect(after.dataset.activeSpecies - before.dataset.activeSpecies).toBe(1);
      expect(after.dataset.traits - before.dataset.traits).toBe(2);
      expect(after.dataset.activeTraits - before.dataset.activeTraits).toBe(1);
      expect(after.dataset.references - before.dataset.references).toBe(1);
      expect(after.dataset.records - before.dataset.records).toBe(4);
      // RFC-52 R1: `coverageCells` is coverage's `withData` (cells holding at
      // least one record), `acceptedCells` its `accepted` — not the grid size,
      // which would make the web meter a constant one.
      //
      // Both are measured over the ACTIVE catalog, which is what the four
      // cells of the fixture are for: only (speciesOn, traitOn) is active on
      // both axes, so of the four cells that gained a record exactly one is
      // counted, and of the two that gained an accepted value exactly one.
      // Under the full grid these would be 4 and 2 — the numbers this file
      // asserted while health asked for `UNRESTRICTED`.
      expect(after.dataset.coverageCells - before.dataset.coverageCells).toBe(1);
      expect(after.dataset.acceptedCells - before.dataset.acceptedCells).toBe(1);
      expect(after.dataset.acceptedCells).toBeLessThanOrEqual(after.dataset.coverageCells);
      // The invariant RFC-52 R1 states, and the denominator the health page's
      // completeness meter divides by: a coverage scope wider than the active
      // catalog breaks it, so this is the assertion that stops that regression
      // coming back. `species * traits` here would pass either way and pin
      // nothing.
      expect(after.dataset.coverageCells).toBeLessThanOrEqual(
        after.dataset.activeSpecies * after.dataset.activeTraits,
      );

      // Activity.
      expect(after.activity.records7d - before.activity.records7d).toBe(4);
      expect(after.activity.annotations7d - before.activity.annotations7d).toBe(2);
      expect(after.activity.proposals7d - before.activity.proposals7d).toBe(2);

      // byDay: exactly fourteen consecutive days ending today, no gaps, and
      // today carries this fixture's rows.
      expect(after.activity.byDay).toHaveLength(14);
      expect(after.activity.byDay.map((d) => d.day)).toEqual(fourteenDaysEnding(today));
      const last = after.activity.byDay[13];
      const lastBefore = before.activity.byDay[13];
      expect(last?.day).toBe(today);
      expect((last?.records ?? 0) - (lastBefore?.records ?? 0)).toBe(4);
      expect((last?.annotations ?? 0) - (lastBefore?.annotations ?? 0)).toBe(2);

      // Queues: the four plan 11b counters over the unrestricted visibility
      // (ruling R-I), compared against the services rather than a literal.
      expect(after.queues).toEqual({
        pendingGroups: await countPendingGroups(tx, UNRESTRICTED),
        disputed: await countDisputed(tx, UNRESTRICTED),
        contested: await countContested(tx, UNRESTRICTED),
        proposals: await countOpenProposals(tx),
      });
      // RFC-52 R1: the queue is a STATUS, so only the open proposal moves it,
      // while `activity.proposals7d` above is a CREATION window and moved by
      // two. The same fixture separates the two numbers in one assertion pair.
      expect(after.queues.proposals - before.queues.proposals).toBe(1);
    });
  });

  it('answers the newest run of each job kind, never an older one', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const mine = randomUUID();
      // Future-dated, as `runs.integration.test.ts` does, so these rows
      // outrank anything a sibling committed before this snapshot opened. The
      // base is captured once: `Date.now()` per call would make the expected
      // `startedAt` below differ from the inserted one by the elapsed
      // milliseconds.
      const base = Date.now();
      const at = (hours: number): Date => new Date(base + hours * HOUR);
      await tx.insert(jobRuns).values({
        kind: 'digest',
        startedAt: at(1),
        finishedAt: at(1),
        status: 'completed',
        detail: { mine, which: 'older' },
      });
      await tx.insert(jobRuns).values({
        kind: 'digest',
        startedAt: at(2),
        finishedAt: null,
        status: 'failed',
        detail: { mine, which: 'newer' },
        error: 'boom',
      });
      await tx.insert(jobRuns).values({
        kind: 'audit_purge',
        startedAt: at(3),
        finishedAt: at(3),
        status: 'skipped',
        detail: { mine },
      });

      const health = await computePlatformHealth(tx);
      expect(health.jobs.digest).toEqual({
        startedAt: at(2).toISOString(),
        finishedAt: null,
        status: 'failed',
        detail: { mine, which: 'newer' },
        error: 'boom',
      });
      expect(health.jobs.auditPurge).toMatchObject({ status: 'skipped', detail: { mine } });
    });
  });

  it('answers the five newest import batches and no runBy on any of them', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const created: string[] = [];
      for (let i = 0; i < 6; i += 1) created.push((await createImportBatch(tx)).id);
      const newestFirst = [...created].reverse();

      const health = await computePlatformHealth(tx);
      expect(health.imports.map((batch) => batch.id)).toEqual(newestFirst.slice(0, 5));
      // R2: a name is PII, so the RFC-64 R11 item arrives without `runBy`.
      for (const batch of health.imports) expect(batch).not.toHaveProperty('runBy');
    });
  });

  it('answers a payload `platformHealthSchema` accepts', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const value = await computePlatformHealth(tx);
      // `platformHealthSchema` is strict, so an extra key anywhere fails here.
      expect(() =>
        platformHealthSchema.parse({ ...value, computedAt: new Date().toISOString() }),
      ).not.toThrow();
    });
  });
});

describe('RFC-52 R1 the `health` entry', () => {
  const t = useTestDb();
  let redis: Redis;
  beforeAll(async () => {
    redis = createRedis(inject('redisUrl'));
    await redis.connect();
  });
  afterAll(async () => {
    await redis.quit();
  });

  /**
   * The entry semantics, on a key of this test's own. `health` is fixed and
   * shared by every caller in the run: deleting it to watch it refill opens a
   * window a sibling wins, and the entry read back would be their numbers and
   * their `computedAt`.
   */
  it('answers the second call from the entry the first one stored, without recomputing', async () => {
    const key = `health:test:${randomUUID()}`;
    let computed = 0;
    const compute = () => {
      computed += 1;
      return computePlatformHealth(t.db);
    };
    try {
      const first = await cachedJson(redis, key, 60, compute);
      const second = await cachedJson(redis, key, 60, compute);
      expect(computed).toBe(1);
      expect(second.value).toEqual(first.value);
      expect(second.computedAt).toBe(first.computedAt);
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    } finally {
      await forgetCached(redis, key);
    }
  });

  it('serves `platformHealth` from the `health` key for a minute', async () => {
    // Nothing here is falsifiable by a concurrent caller: a sibling computing
    // the same fixed key writes the same shape with the same ttl, and no
    // caller anywhere deletes it — including this one.
    const first = await platformHealth({ db: t.db, redis });
    const second = await platformHealth({ db: t.db, redis });
    expect(second.computedAt).toBe(first.computedAt);
    expect(second).toEqual(first);
    const ttl = await redis.ttl('health');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });
});
