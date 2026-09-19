import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';
import {
  createAnnotation,
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { useTestDb, withRollback } from '../../test/helpers/db.ts';
import { captureLogger } from '../../test/helpers/logger.ts';
import { createFakeMailer } from '../../test/helpers/mail.ts';
import { createRole, systemRoleId } from '../../test/helpers/roles.ts';
import { createUser } from '../../test/helpers/users.ts';
import type { DbTransaction } from '../db/client.ts';
import { auditLog } from '../db/schema/audit-log.ts';
import { jobRuns } from '../db/schema/job-runs.ts';
import { speciesProposals } from '../db/schema/proposals.ts';
import type { Mailer, MailMessage } from '../mail/mailer.ts';
import {
  computeDigest,
  DIGEST_ATTEMPT_GUARD_MS,
  DIGEST_LIST_LIMIT,
  DIGEST_MIN_INTERVAL_MS,
  type DigestRunResult,
  type DigestWindow,
  digestRecipients,
  isDigestDue,
  repeatedRunId,
  runDigest,
} from './digest.ts';
import { latestRun } from './runs.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * **Every fixture here is backdated, and every test owns its own offset.**
 *
 * `computeDigest` counts over a time window across the whole dataset, and the
 * integration suites share one database and run in parallel: a window near
 * `now()` would count fifteen other suites' records, annotations and
 * withdrawals. Backdating moves this file's rows into a stretch of time no
 * other suite writes into — `trait_records.created_at` and
 * `record_annotations.created_at` are column defaults, not triggers, so an
 * explicit value is accepted, and migration `0012_dataset_append_only.sql`
 * guards `UPDATE`, `DELETE` and `TRUNCATE` only, never `INSERT`.
 *
 * One shared offset would not be enough: two tests of this very file would
 * then land in each other's window. Each test therefore takes its own anchor
 * from the list below — several days apart, so the one-hour windows around
 * them cannot overlap — and `covers only its own backdated rows` asserts that
 * separation directly, which a grep at authoring time cannot.
 */
const ANCHOR_DAYS = {
  counts: 211,
  exclusivityLate: 223,
  exclusivityEarly: 227,
  queues: 229,
  lists: 233,
  // Task 4's `runDigest` tests. Each takes its own offset for the same reason
  // as the four above, and none of them reuses one: the windows are one hour
  // either side of the anchor and the anchors are days apart.
  runCompleted: 239,
  runQuiet: 241,
  runFailedSend: 251,
  runNotDue: 257,
  runRoundTrip: 263,
  runFailedSendMessage: 269,
  runFailedSendAuth: 271,
  runStillRunning: 277,
  runStaleRunning: 281,
  runQueryError: 283,
  runFailedAfterSend: 289,
  runStaleFailed: 293,
  runRepeat: 307,
  runNotARepeat: 311,
  runNoRepeatFlag: 313,
} as const;

const anchor = (daysAgo: number): Date => new Date(Date.now() - daysAgo * DAY);

/** One hour either side of `at`: wide enough for a fixture, far from every other anchor. */
const windowAround = (at: Date): DigestWindow => ({
  start: new Date(at.getTime() - HOUR),
  end: new Date(at.getTime() + HOUR),
});

/**
 * Freezes the transaction's snapshot, and fails loudly if the driver ever
 * stops honouring the request.
 *
 * `pendingGroups` and `disputedNow` are current dataset-wide counts (RFC-65 R8,
 * R10) that no window can isolate, so the only honest assertion about them is a
 * before/after delta — and a delta is only comparable while a sibling suite
 * cannot commit between the two reads. Same guard, and the same shared
 * `withRollback`, as `workspace/dashboard.integration.test.ts` and
 * `dataset/coverage.integration.test.ts`.
 */
async function freezeSnapshot(tx: DbTransaction): Promise<void> {
  await tx.execute(sql`set transaction isolation level repeatable read`);
  const [isolation] = (await tx.execute(sql`show transaction_isolation`)) as unknown as [
    { transaction_isolation: string } | undefined,
  ];
  expect(isolation?.transaction_isolation).toBe('repeatable read');
}

/** A species, a trait of its own with three levels, a reference and an import batch. */
async function scene(tx: DbTransaction) {
  const [species, trait, reference, batch] = await Promise.all([
    createSpecies(tx),
    createTrait(tx, { levels: ['alpha', 'beta', 'gamma'] }),
    createReference(tx),
    createImportBatch(tx),
  ]);
  const level = (key: string): string => {
    const found = trait.levels.find((l) => l.key === key);
    if (!found) throw new Error(`scene: no level ${key}`);
    return found.id;
  };
  return { species, trait, reference, batch, level };
}

describe('RFC-74 R3 computeDigest', () => {
  const t = useTestDb();

  it("counts the window's activity and lists the contests and the disputes", async () => {
    await withRollback(t.db, async (tx) => {
      const at = anchor(ANCHOR_DAYS.counts);
      const s = await scene(tx);
      const [{ user: ada }, { user: grace }] = await Promise.all([
        createUser(tx, { name: 'Ada Lovelace', password: null }),
        createUser(tx, { name: 'Grace Hopper', password: null }),
      ]);

      // The contested record arrives by import, so it is not a "manual record
      // created" and the window's `records` is the two responses alone.
      const base = await createRecord(tx, {
        speciesId: s.species.id,
        traitId: s.trait.id,
        valueText: 'alpha',
        levelId: s.level('alpha'),
        // An import row still needs a reference (`trait_records_reference_check`).
        primaryReferenceId: s.reference.id,
        importBatchId: s.batch.id,
        createdAt: at,
      });
      const contest = await createRecord(tx, {
        speciesId: s.species.id,
        traitId: s.trait.id,
        valueText: 'beta',
        levelId: s.level('beta'),
        primaryReferenceId: s.reference.id,
        origin: 'manual',
        createdBy: ada.id,
        intent: 'contest',
        respondsToRecordId: base.id,
        createdAt: at,
      });
      const complement = await createRecord(tx, {
        speciesId: s.species.id,
        traitId: s.trait.id,
        valueText: 'gamma',
        levelId: s.level('gamma'),
        primaryReferenceId: s.reference.id,
        origin: 'manual',
        createdBy: grace.id,
        intent: 'complement',
        respondsToRecordId: base.id,
        createdAt: at,
      });
      await Promise.all([
        createAnnotation(tx, {
          recordId: base.id,
          actorId: ada.id,
          kind: 'confirm',
          createdAt: at,
        }),
        createAnnotation(tx, {
          recordId: base.id,
          actorId: grace.id,
          kind: 'confirm',
          createdAt: at,
        }),
        createAnnotation(tx, {
          recordId: complement.id,
          actorId: ada.id,
          kind: 'confirm',
          createdAt: at,
        }),
        createAnnotation(tx, {
          recordId: base.id,
          actorId: grace.id,
          kind: 'dispute',
          note: 'The reference says otherwise',
          createdAt: at,
        }),
        // RFC-74 R3 counts human disputes only.
        createAnnotation(tx, {
          recordId: complement.id,
          actorId: ada.id,
          kind: 'dispute',
          note: 'auto',
          generated: true,
          createdAt: at,
        }),
        createAnnotation(tx, {
          recordId: complement.id,
          actorId: grace.id,
          kind: 'withdraw',
          note: 'Wrong species',
          createdAt: at,
        }),
      ]);

      // RFC-75 R7: one proposal created inside the window. Backdated like
      // every other row of this test, so no sibling suite's proposal — all of
      // which are written at `now()` — can fall into it.
      await tx.insert(speciesProposals).values({
        proposedName: `Testus digestus ${randomBytes(6).toString('hex')}`,
        proposerId: ada.id,
        createdAt: at,
      });

      const digest = await computeDigest(tx, windowAround(at));

      expect(digest.counts).toMatchObject({
        records: 2,
        contests: 1,
        complements: 1,
        validations: 3,
        disputes: 1,
        withdrawals: 1,
        proposals: 1,
      });
      expect(digest.window).toEqual(windowAround(at));

      // The names are decrypted on read by the column type (RFC-40 R8), which
      // is what the recipients are meant to read.
      expect(digest.contests).toEqual([
        {
          speciesId: s.species.id,
          speciesName: s.species.canonicalName,
          traitKey: s.trait.key,
          valueText: 'beta',
          actorName: 'Ada Lovelace',
          recordId: contest.id,
          createdAt: at,
        },
      ]);
      expect(digest.disputes).toEqual([
        {
          speciesId: s.species.id,
          speciesName: s.species.canonicalName,
          traitKey: s.trait.key,
          valueText: 'alpha',
          actorName: 'Grace Hopper',
          recordId: base.id,
          createdAt: at,
        },
      ]);
    });
  });

  it('lists the ten newest of each and leaves the eleventh out, while the counts stay uncapped', async () => {
    // Ruling E and both halves of R3's "the 10 newest": the cap AND the order.
    // Eleven contests and eleven disputes, two minutes apart inside one window,
    // so dropping `limit` shows an eleventh item and flipping the sort shows
    // the ten oldest — either way the expected arrays below stop matching.
    await withRollback(t.db, async (tx) => {
      const at = anchor(ANCHOR_DAYS.lists);
      const s = await scene(tx);
      const { user } = await createUser(tx, { name: 'Ada Lovelace', password: null });
      /** Index 0 is the newest; index 10 is the one that must fall off both lists. */
      const staggered = (index: number): Date => new Date(at.getTime() - index * 2 * 60_000);
      const label = (what: string, index: number): string =>
        `${what}-${String(index).padStart(2, '0')}`;

      const base = await createRecord(tx, {
        speciesId: s.species.id,
        traitId: s.trait.id,
        valueText: 'alpha',
        levelId: s.level('alpha'),
        primaryReferenceId: s.reference.id,
        importBatchId: s.batch.id,
        createdAt: staggered(11),
      });
      // Oldest first, so the uuidv7 ids rise with `created_at` and the id
      // tiebreak in the query can never disagree with the timestamps.
      for (let index = 10; index >= 0; index--) {
        await createRecord(tx, {
          speciesId: s.species.id,
          traitId: s.trait.id,
          valueText: label('contest', index),
          primaryReferenceId: s.reference.id,
          origin: 'manual',
          createdBy: user.id,
          intent: 'contest',
          respondsToRecordId: base.id,
          createdAt: staggered(index),
        });
        const disputed = await createRecord(tx, {
          speciesId: s.species.id,
          traitId: s.trait.id,
          valueText: label('dispute', index),
          primaryReferenceId: s.reference.id,
          origin: 'manual',
          createdBy: user.id,
          createdAt: staggered(index),
        });
        await createAnnotation(tx, {
          recordId: disputed.id,
          actorId: user.id,
          kind: 'dispute',
          note: 'Needs a second reference',
          createdAt: staggered(index),
        });
      }

      const digest = await computeDigest(tx, windowAround(at));

      const newestTen = (what: string): string[] =>
        Array.from({ length: DIGEST_LIST_LIMIT }, (_, index) => label(what, index));
      expect(digest.contests).toHaveLength(DIGEST_LIST_LIMIT);
      expect(digest.contests.map((c) => c.valueText)).toEqual(newestTen('contest'));
      expect(digest.disputes).toHaveLength(DIGEST_LIST_LIMIT);
      expect(digest.disputes.map((d) => d.valueText)).toEqual(newestTen('dispute'));
      // The cap is on the lists alone: R3's counts describe the whole window.
      expect(digest.counts).toMatchObject({ contests: 11, disputes: 11 });
    });
  });

  it('covers only its own backdated rows: two offsets never see each other', async () => {
    // The test Ruling Q asks for. A grep cannot catch a future sibling suite
    // wandering into this file's range, and one shared offset would make two
    // of this file's own tests count each other's rows; this fails loudly if
    // either ever happens.
    await withRollback(t.db, async (tx) => {
      const early = anchor(ANCHOR_DAYS.exclusivityEarly);
      const late = anchor(ANCHOR_DAYS.exclusivityLate);
      const s = await scene(tx);
      const { user } = await createUser(tx, { password: null });

      const one = await createRecord(tx, {
        speciesId: s.species.id,
        traitId: s.trait.id,
        valueText: 'alpha',
        levelId: s.level('alpha'),
        primaryReferenceId: s.reference.id,
        origin: 'manual',
        createdBy: user.id,
        createdAt: late,
      });
      await createAnnotation(tx, {
        recordId: one.id,
        actorId: user.id,
        kind: 'confirm',
        createdAt: late,
      });

      const other = await createSpecies(tx);
      for (const valueText of ['alpha', 'beta']) {
        const record = await createRecord(tx, {
          speciesId: other.id,
          traitId: s.trait.id,
          valueText,
          levelId: s.level(valueText),
          primaryReferenceId: s.reference.id,
          origin: 'manual',
          createdBy: user.id,
          createdAt: early,
        });
        await createAnnotation(tx, {
          recordId: record.id,
          actorId: user.id,
          kind: 'confirm',
          createdAt: early,
        });
      }

      const lateDigest = await computeDigest(tx, windowAround(late));
      expect(lateDigest.counts).toMatchObject({ records: 1, validations: 1 });
      const earlyDigest = await computeDigest(tx, windowAround(early));
      expect(earlyDigest.counts).toMatchObject({ records: 2, validations: 2 });
    });
  });

  it('reports the queue sizes as they stand now, outside the window', async () => {
    await withRollback(t.db, async (tx) => {
      // The snapshot must be frozen before anything else reads.
      await freezeSnapshot(tx);
      const at = anchor(ANCHOR_DAYS.queues);
      // Well outside the window: the two queue numbers are current counts
      // (RFC-65 R8, R10), so they must move even when nothing was created in
      // the window at all.
      const before = new Date(at.getTime() - 3 * DAY);
      const s = await scene(tx);
      const { user } = await createUser(tx, { password: null });

      const baseline = await computeDigest(tx, windowAround(at));

      // One unharmonisable import value that nothing supersedes: one pending
      // group (RFC-65 R8).
      await createRecord(tx, {
        speciesId: s.species.id,
        traitId: s.trait.id,
        valueText: 'alfa/beta',
        primaryReferenceId: s.reference.id,
        importBatchId: s.batch.id,
        createdAt: before,
      });
      // One record whose only standing stance is a dispute: one disputed
      // record (RFC-65 R10).
      const disputed = await createRecord(tx, {
        speciesId: s.species.id,
        traitId: s.trait.id,
        valueText: 'alpha',
        levelId: s.level('alpha'),
        primaryReferenceId: s.reference.id,
        origin: 'manual',
        createdBy: user.id,
        createdAt: before,
      });
      await createAnnotation(tx, {
        recordId: disputed.id,
        actorId: user.id,
        kind: 'dispute',
        note: 'Needs a second reference',
        createdAt: before,
      });

      const after = await computeDigest(tx, windowAround(at));
      expect(after.counts.pendingGroups).toBe(baseline.counts.pendingGroups + 1);
      expect(after.counts.disputedNow).toBe(baseline.counts.disputedNow + 1);
      // Nothing of this landed in the window, and R4's activity sum is the
      // window's alone.
      expect(after.counts).toMatchObject({ records: 0, disputes: 0, validations: 0 });
      expect(after.contests).toEqual([]);
      expect(after.disputes).toEqual([]);
    });
  });
});

describe('RFC-74 R4 digestRecipients', () => {
  const t = useTestDb();

  it('answers the active holders of records.review and of the admin role, once each', async () => {
    await withRollback(t.db, async (tx) => {
      // The seeded roles, so that the grants R4 depends on are asserted rather
      // than assumed: `manager` holds `records.review` and `contributor` does
      // not (migration 0016). An ad-hoc role covers R4's "through ANY role".
      const [manager, contributor, admin] = await Promise.all([
        systemRoleId(tx, 'manager'),
        systemRoleId(tx, 'contributor'),
        systemRoleId(tx, 'admin'),
      ]);
      const customRole = await createRole(tx, { permissions: ['records.review'] });

      const [
        seededManager,
        customReviewer,
        administrator,
        both,
        suspendedManager,
        invitedManager,
        plainContributor,
        roleless,
      ] = await Promise.all([
        createUser(tx, { name: 'Rita Reviewer', password: null, roles: [manager] }),
        createUser(tx, { password: null, roles: [customRole.id] }),
        createUser(tx, { password: null, roles: [admin] }),
        createUser(tx, { password: null, roles: [customRole.id, admin] }),
        createUser(tx, { status: 'suspended', password: null, roles: [manager] }),
        createUser(tx, { status: 'invited', password: null, roles: [manager] }),
        createUser(tx, { password: null, roles: [contributor] }),
        createUser(tx, { password: null }),
      ]);

      const recipients = await digestRecipients(tx);
      const ids = recipients.map((r) => r.id);

      expect(ids).toContain(seededManager.user.id);
      expect(ids).toContain(customReviewer.user.id);
      // `admin` is the seeded system role, not a permission key: the admin
      // holds every permission without a `role_permissions` row for any of them.
      expect(ids).toContain(administrator.user.id);
      expect(ids).toContain(both.user.id);
      // R4 says `active`, so an invited holder is out as well as a suspended one.
      expect(ids).not.toContain(suspendedManager.user.id);
      expect(ids).not.toContain(invitedManager.user.id);
      expect(ids).not.toContain(plainContributor.user.id);
      expect(ids).not.toContain(roleless.user.id);
      // Two qualifying roles are still one recipient, and so one e-mail (R5).
      expect(ids.filter((id) => id === both.user.id)).toHaveLength(1);

      // Name and address arrive decrypted from the column type (RFC-40 R8).
      expect(recipients.find((r) => r.id === seededManager.user.id)).toEqual({
        id: seededManager.user.id,
        email: seededManager.email,
        name: 'Rita Reviewer',
      });
    });
  });
});

/**
 * **`runDigest` reads and writes "the latest digest run", which no test in a
 * shared database may own.** Four things keep the tests below apart from each
 * other and from every sibling suite:
 *
 * - `withRollback`, so no `digest` run they write is ever committed — this
 *   file is the only one that writes any, and none of them escapes it;
 * - `freezeSnapshot`, so a sibling committing between two dataset-wide reads
 *   (`digestRecipients` here and the one inside `runDigest`) cannot make the
 *   two disagree;
 * - its own anchor per test, exactly as the `computeDigest` tests above: the
 *   window `runDigest` computes ends at the injected `now`, so `now` sits at
 *   the test's own anchor and the seeded previous run stops an hour before it;
 * - `expect(row.id).toBe(result.runId)` wherever a test reads a run back, so a
 *   foreign row winning the ordering fails loudly instead of being silently
 *   asserted on.
 *
 * The recipient count is the one number that cannot be scoped: `runDigest`
 * mails every active reviewer in the dataset, and a sibling suite's committed
 * manager is one. It is therefore asserted against `digestRecipients` read in
 * the same frozen snapshot, never against a literal.
 */

/** The origin the record drawer links in the mail are built from (R5). */
const APP_ORIGIN = 'https://digest.test';

/**
 * The `completed` run `runDigest` will find as its last success, placed so the
 * window it hands out is exactly `windowAround(at)`: it stopped at `at - 1 h`,
 * and finished two days before that — well beyond `DIGEST_MIN_INTERVAL_MS`
 * before the injected `now` of `at + 1 h`, so the tick is due.
 *
 * `started_at` is in the past here, unlike the future-dated rows of
 * `runs.integration.test.ts`: the run `runDigest` opens must OUTRANK this one,
 * or `latestRun` would answer the seed when the round trip reads back.
 */
async function seedLastRun(tx: DbTransaction, at: Date): Promise<void> {
  const windowEnd = new Date(at.getTime() - HOUR);
  const finishedAt = new Date(windowEnd.getTime() - 2 * DAY);
  const [row] = await tx
    .insert(jobRuns)
    .values({
      kind: 'digest',
      startedAt: finishedAt,
      finishedAt,
      status: 'completed',
      detail: {
        windowStart: new Date(windowEnd.getTime() - DAY).toISOString(),
        windowEnd: windowEnd.toISOString(),
      },
    })
    .returning({ id: jobRuns.id });
  if (!row) throw new Error('seedLastRun: no row');
}

/** One manual record at `at`: enough for `hasActivity`, and inside `windowAround(at)`. */
async function activityAt(tx: DbTransaction, at: Date): Promise<void> {
  const s = await scene(tx);
  const { user } = await createUser(tx, { password: null });
  await createRecord(tx, {
    speciesId: s.species.id,
    traitId: s.trait.id,
    valueText: 'alpha',
    levelId: s.level('alpha'),
    primaryReferenceId: s.reference.id,
    origin: 'manual',
    createdBy: user.id,
    createdAt: at,
  });
}

/** Two active holders of the seeded `manager` role, which carries `records.review`. */
async function twoRecipients(tx: DbTransaction): Promise<{ id: string; email: string }[]> {
  const manager = await systemRoleId(tx, 'manager');
  const created = await Promise.all([
    createUser(tx, { password: null, roles: [manager] }),
    createUser(tx, { password: null, roles: [manager] }),
  ]);
  return created.map((c) => ({ id: c.user.id, email: c.email }));
}

/** Narrows the id of a tick that wrote a run, failing loudly when it wrote none. */
function runIdOf(result: DigestRunResult): string {
  if (result.runId === null) throw new Error(`expected a job run, got "${result.status}"`);
  return result.runId;
}

/** A mailer that rejects for one address and records every other send. */
function mailerRejecting(address: string): { mailer: Mailer; sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    mailer: {
      async send(message) {
        if (message.to === address) throw new Error('smtp: mailbox unavailable');
        sent.push(message);
      },
    },
  };
}

/** The ids of every `digest.sent` entry visible right now, to diff a call against. */
async function digestAuditIds(tx: DbTransaction): Promise<string[]> {
  const rows = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(eq(auditLog.action, 'digest.sent'));
  return rows.map((r) => r.id);
}

/** The `job_runs` row a tick wrote, read back by the id it returned. */
async function runRow(tx: DbTransaction, id: string) {
  const [row] = await tx.select().from(jobRuns).where(eq(jobRuns.id, id));
  return row;
}

/** How many `digest` runs this transaction can see, to prove a tick wrote none. */
async function digestRunCount(tx: DbTransaction): Promise<number> {
  const rows = (await tx.execute(
    sql`select count(*)::int as n from job_runs where kind = 'digest'`,
  )) as unknown as [{ n: number } | undefined];
  return rows[0]?.n ?? 0;
}

/**
 * A `digest` run opened at `startedAt` that recorded no success — what a throw
 * in `runDigest`'s tail leaves behind once the sends have gone out. `failed`
 * is the usual outcome (the catch's own `finishRun` succeeds); `running` is
 * what is left when the process dies or `finishRun` is itself what threw.
 * @rfc RFC-74 R2
 */
async function seedAttempt(
  tx: DbTransaction,
  startedAt: Date,
  status: 'running' | 'failed',
  detail: Record<string, unknown> = {},
): Promise<string> {
  const [row] = await tx
    .insert(jobRuns)
    .values({
      kind: 'digest',
      startedAt,
      status,
      detail,
      ...(status === 'failed' ? { finishedAt: startedAt, error: 'Error: seeded' } : {}),
    })
    .returning({ id: jobRuns.id });
  if (!row) throw new Error('seedAttempt: no row');
  return row.id;
}

/** The `digest.sent` row a tick wrote, diffed against the ids taken before it. */
async function digestAuditWrittenSince(tx: DbTransaction, before: Set<string>) {
  const written = (await digestAuditIds(tx)).filter((id) => !before.has(id));
  expect(written).toHaveLength(1);
  const [entry] = await tx
    .select()
    .from(auditLog)
    .where(eq(auditLog.id, written[0] ?? ''));
  return entry;
}

/**
 * The window `runDigest` will cover for a test anchored at `at`: `seedLastRun`
 * stops its window one hour before the anchor, and `isDigestDue` starts the
 * next one exactly there.
 */
const windowStartFor = (at: Date): Date => new Date(at.getTime() - HOUR);

/**
 * The transaction with the `audit_log` insert alone replaced by a rejection.
 * Everything else — `job_runs`, the digest's own queries, the mailer — works,
 * which is exactly the production shape this guard exists for: `recordAudit`
 * runs AFTER every e-mail has gone out, and the catch that follows it writes
 * `failed` successfully.
 */
function dbFailingAuditInsert(tx: DbTransaction, error: Error): DbTransaction {
  return new Proxy(tx, {
    get(target, prop) {
      if (prop === 'insert') {
        return (table: Parameters<DbTransaction['insert']>[0]) =>
          table === auditLog
            ? { values: () => ({ returning: () => Promise.reject(error) }) }
            : target.insert(table);
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * The transaction with its `execute` replaced by a rejection, so a job's own
 * queries fail while `job_runs` stays writable: a real query failure poisons
 * the transaction and `finishRun` can then write nothing at all (which is what
 * `retention.integration.test.ts` asserts), so the stored text could never be
 * read back. Methods are bound to the real transaction; Drizzle's builders use
 * private fields, which a bare `Reflect.get` through the proxy would break.
 */
function dbWithFailingQueries(tx: DbTransaction, error: Error): DbTransaction {
  return new Proxy(tx, {
    get(target, prop) {
      if (prop === 'execute') return () => Promise.reject(error);
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * A Drizzle query error over the encrypted user columns, shaped exactly as the
 * real one: the SQL and its bound parameters both as own properties and in the
 * two-line message, with the driver error on `cause`.
 */
function queryErrorOverUsers(leaked: string): DrizzleQueryError {
  const cause = Object.assign(new Error('permission denied for function pgp_sym_decrypt'), {
    code: '42501',
  });
  return new DrizzleQueryError(
    'select "users"."name", "users"."email" from "users" where "users"."email_bidx" = $1',
    [leaked],
    cause,
  );
}

describe('RFC-74 R2, R5 runDigest', () => {
  const t = useTestDb();

  it('mails every recipient, completes the run with the window and the counts, and audits it with no address', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const at = anchor(ANCHOR_DAYS.runCompleted);
      const now = new Date(at.getTime() + HOUR);
      const windowStart = new Date(at.getTime() - HOUR);
      await seedLastRun(tx, at);
      await activityAt(tx, at);
      const [first, second] = await twoRecipients(tx);
      const mailer = createFakeMailer();
      const { logger } = captureLogger();
      const auditBefore = new Set(await digestAuditIds(tx));

      const result = await runDigest({
        db: tx,
        mailer: mailer.mailer,
        appOrigin: APP_ORIGIN,
        logger,
        enabled: true,
        now,
      });

      // Every active reviewer of the dataset is mailed, so the count is the
      // query's answer in this snapshot — the two below are mine within it.
      const recipients = await digestRecipients(tx);
      expect(result).toMatchObject({
        status: 'completed',
        recipients: recipients.length,
        failed: 0,
      });
      const addressed = mailer.sent.map((m) => m.to);
      expect(addressed).toHaveLength(recipients.length);
      expect(addressed).toContain(first?.email);
      expect(addressed).toContain(second?.email);

      // R5: subject, plain text, and the record drawer links of the window.
      const mail = mailer.sent.find((m) => m.to === first?.email);
      expect(mail?.subject).toBe(`TreeRepro digest — ${now.toISOString().slice(0, 10)}`);
      expect(mail?.text).toContain('Records added (contests and complements included): 1');

      const run = await runRow(tx, runIdOf(result));
      expect(run).toMatchObject({ kind: 'digest', status: 'completed', error: null });
      expect(run?.detail).toEqual({
        windowStart: windowStart.toISOString(),
        windowEnd: now.toISOString(),
        recipients: recipients.length,
        failed: 0,
        counts: {
          records: 1,
          contests: 0,
          complements: 0,
          validations: 0,
          disputes: 0,
          withdrawals: 0,
          proposals: 0,
          // Current dataset-wide queue sizes (RFC-65 R8, R10): no window can
          // isolate them, so only their presence is asserted here.
          pendingGroups: expect.any(Number),
          disputedNow: expect.any(Number),
        },
      });

      const written = (await digestAuditIds(tx)).filter((id) => !auditBefore.has(id));
      expect(written).toHaveLength(1);
      const [entry] = await tx
        .select()
        .from(auditLog)
        .where(eq(auditLog.id, written[0] ?? ''));
      // A background job has no session user; R5's metadata is exactly these four.
      expect(entry?.actorUserId).toBeNull();
      expect(entry?.metadata).toEqual({
        recipients: recipients.length,
        failed: 0,
        windowStart: windowStart.toISOString(),
        windowEnd: now.toISOString(),
      });
      // `assertSafeMetadata` rejects a key named after an address, but a key
      // it does not recognise could still carry one: the row is searched for
      // the addresses themselves, and for any address at all.
      const serialised = JSON.stringify(entry);
      expect(serialised).not.toContain(first?.email);
      expect(serialised).not.toContain(second?.email);
      expect(serialised).not.toMatch(/@/);
    });
  });

  it('skips the run and sends nothing when the window holds no activity (R4)', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const at = anchor(ANCHOR_DAYS.runQuiet);
      const now = new Date(at.getTime() + HOUR);
      await seedLastRun(tx, at);
      await twoRecipients(tx);
      const mailer = createFakeMailer();
      const { logger } = captureLogger();
      const auditBefore = new Set(await digestAuditIds(tx));

      const result = await runDigest({
        db: tx,
        mailer: mailer.mailer,
        appOrigin: APP_ORIGIN,
        logger,
        enabled: true,
        now,
      });

      expect(result).toMatchObject({ status: 'skipped', recipients: 0, failed: 0 });
      expect(mailer.sent).toEqual([]);
      const run = await runRow(tx, runIdOf(result));
      expect(run?.status).toBe('skipped');
      // The window is still recorded: a skipped window must not be covered
      // twice, and `isDigestDue` needs a `windowEnd` to start the next one from.
      // Pinned exactly (not `toMatchObject`): an accidental extra key here
      // would pass a looser assertion.
      expect(run?.detail).toEqual({
        windowStart: new Date(at.getTime() - HOUR).toISOString(),
        windowEnd: now.toISOString(),
        reason: 'no_activity',
        counts: {
          records: 0,
          contests: 0,
          complements: 0,
          validations: 0,
          disputes: 0,
          withdrawals: 0,
          proposals: 0,
          // Current dataset-wide queue sizes (RFC-65 R8, R10): no window can
          // isolate them, so only their presence is asserted here.
          pendingGroups: expect.any(Number),
          disputedNow: expect.any(Number),
        },
      });
      // A SELECT with no ORDER BY: compared as a set, never an array, so an
      // incidental reordering of a page's own audit rows cannot fail this.
      expect(new Set(await digestAuditIds(tx))).toEqual(auditBefore);
    });
  });

  it('counts a rejected send, logs it without the address, and still completes (R5)', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const at = anchor(ANCHOR_DAYS.runFailedSend);
      const now = new Date(at.getTime() + HOUR);
      await seedLastRun(tx, at);
      await activityAt(tx, at);
      const [first, second] = await twoRecipients(tx);
      const unreachable = first?.email ?? '';
      const mailer = mailerRejecting(unreachable);
      const { logger, lines } = captureLogger();

      const result = await runDigest({
        db: tx,
        mailer: mailer.mailer,
        appOrigin: APP_ORIGIN,
        logger,
        enabled: true,
        now,
      });

      const recipients = await digestRecipients(tx);
      // R5: the run completes when every send was ATTEMPTED; one refusal is a
      // number in `detail.failed`, never a `failed` run.
      expect(result).toMatchObject({
        status: 'completed',
        recipients: recipients.length,
        failed: 1,
      });
      expect(mailer.sent.map((m) => m.to)).not.toContain(unreachable);
      expect(mailer.sent.map((m) => m.to)).toContain(second?.email);
      expect(mailer.sent).toHaveLength(recipients.length - 1);

      const run = await runRow(tx, runIdOf(result));
      expect(run?.status).toBe('completed');
      expect(run?.detail).toMatchObject({ failed: 1, recipients: recipients.length });
      expect(run?.error).toBeNull();

      const logs = lines as { level: number; msg: string; recipientId?: string }[];
      const failure = logs.find((l) => l.msg === 'digest send failed');
      expect(failure).toMatchObject({ level: 50, recipientId: first?.id });
      // The log line names the recipient by id; an address in a log would
      // outlive the mail itself (RFC-02 R7).
      expect(JSON.stringify(failure)).not.toContain(unreachable);
    });
  });

  it('drops a rejection message that names an address before it reaches the log (R5)', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const at = anchor(ANCHOR_DAYS.runFailedSendMessage);
      const now = new Date(at.getTime() + HOUR);
      await seedLastRun(tx, at);
      await activityAt(tx, at);
      await twoRecipients(tx);
      const mailer = createFakeMailer();
      // A real SMTP rejection, unlike `mailerRejecting`'s fixed message: the
      // address is IN the message, exactly where `sanitizeError` (which
      // keeps `err.message` verbatim) would carry it into the log if this
      // call did not strip it. RFC-02 R7 redacts by key, not by value, so a
      // key-based guard alone would miss this.
      const leaked = 'someone@example.org';
      // Shaped like nodemailer's own rejection: `code` and `responseCode` are
      // set on the error ITSELF, with no `cause` — `createMailer` awaits
      // `transport.sendMail` and never wraps — which is why reading a code
      // only through `sanitizeError`'s cause path left this line with nothing
      // but a name and a stack in production.
      mailer.failNext(
        Object.assign(new Error(`550 5.1.1 <${leaked}>: Recipient address rejected`), {
          code: 'EENVELOPE',
          responseCode: 550,
        }),
      );
      const { logger, lines } = captureLogger();

      const result = await runDigest({
        db: tx,
        mailer: mailer.mailer,
        appOrigin: APP_ORIGIN,
        logger,
        enabled: true,
        now,
      });

      expect(result).toMatchObject({ status: 'completed', failed: 1 });
      const logs = lines as { msg: string; err?: { code?: string; responseCode?: number } }[];
      const failure = logs.find((l) => l.msg === 'digest send failed');
      expect(failure).toBeDefined();
      // The stack trace `sanitizeError` keeps is safe (node_modules paths of
      // its own carry an "@", e.g. `postgres@3.4.9`) — only the message,
      // where the address actually was, must be gone.
      expect(JSON.stringify(failure)).not.toContain(leaked);
      // And the line must still SAY something. Asserting only the absence of
      // the address is what let the line go contentless: with `message` gone
      // and `code` read from a cause nodemailer never sets, every failed send
      // of a nightly digest logged an identical name and stack, and an
      // operator could not tell expired credentials from a timeout from one
      // bad mailbox.
      expect(failure?.err).toMatchObject({ code: 'EENVELOPE', responseCode: 550 });
    });
  });

  it('logs the diagnosis of an auth failure, which carries no address to leak at all (R5)', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const at = anchor(ANCHOR_DAYS.runFailedSendAuth);
      const now = new Date(at.getTime() + HOUR);
      await seedLastRun(tx, at);
      await activityAt(tx, at);
      await twoRecipients(tx);
      const mailer = createFakeMailer();
      // The scenario that made this worth fixing: SMTP credentials expire and
      // every send of every nightly digest fails the same way. Nothing here is
      // address-shaped, so a redaction that keeps nothing keeps nothing useful.
      mailer.failNext(
        Object.assign(new Error('Invalid login: 535 Authentication credentials invalid'), {
          code: 'EAUTH',
          responseCode: 535,
        }),
      );
      const { logger, lines } = captureLogger();

      const result = await runDigest({
        db: tx,
        mailer: mailer.mailer,
        appOrigin: APP_ORIGIN,
        logger,
        enabled: true,
        now,
      });

      expect(result).toMatchObject({ status: 'completed', failed: 1 });
      const logs = lines as { msg: string; err?: Record<string, unknown> }[];
      const failure = logs.find((l) => l.msg === 'digest send failed');
      expect(failure?.err).toMatchObject({ name: 'Error', code: 'EAUTH', responseCode: 535 });
      // The message is still dropped: the fix restores diagnosis, it does not
      // reopen the channel the address travelled down.
      expect(JSON.stringify(failure)).not.toContain('Invalid login');
    });
  });

  it('skips every tick with reason "disabled" before the due check even runs (R6)', async () => {
    await withRollback(t.db, async (tx) => {
      // Two dataset-wide reads of `digestAuditIds` compared before/after, same
      // as `runQuiet` and `runRoundTrip`: only honest while no sibling suite
      // can commit between them.
      await freezeSnapshot(tx);
      const mailer = createFakeMailer();
      const { logger } = captureLogger();
      const auditBefore = new Set(await digestAuditIds(tx));

      const first = await runDigest({
        db: tx,
        mailer: mailer.mailer,
        appOrigin: APP_ORIGIN,
        logger,
        enabled: false,
      });
      const second = await runDigest({
        db: tx,
        mailer: mailer.mailer,
        appOrigin: APP_ORIGIN,
        logger,
        enabled: false,
      });

      for (const result of [first, second]) {
        expect(result).toMatchObject({ status: 'skipped', recipients: 0, failed: 0 });
        const run = await runRow(tx, runIdOf(result));
        expect(run).toMatchObject({ kind: 'digest', status: 'skipped', error: null });
        // R6 gives the disabled run no window at all; `isDigestDue` then falls
        // back to the last 24 h, which Ruling C accepts.
        expect(run?.detail).toEqual({ reason: 'disabled' });
      }
      // The proof that the flag is read FIRST: the second tick followed the
      // first immediately, so a due check standing in front of it would have
      // refused to write anything at all.
      expect(second.runId).not.toBe(first.runId);
      expect(mailer.sent).toEqual([]);
      expect(new Set(await digestAuditIds(tx))).toEqual(auditBefore);
    });
  });

  it('writes nothing at all on a tick that is not due yet (R2)', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const at = anchor(ANCHOR_DAYS.runNotDue);
      const now = new Date(at.getTime() + HOUR);
      await seedLastRun(tx, at);
      await activityAt(tx, at);
      await twoRecipients(tx);
      const mailer = createFakeMailer();
      const { logger } = captureLogger();
      const tick = { db: tx, mailer: mailer.mailer, appOrigin: APP_ORIGIN, logger, enabled: true };

      const first = await runDigest({ ...tick, now });
      expect(first.status).toBe('completed');
      const sentOnce = mailer.sent.length;
      const runsAfterFirst = await digestRunCount(tx);

      // `finishRun` stamps `finished_at` itself, so the second tick is timed
      // against the row as it was really written: half an hour short of the
      // 23 h 30 min threshold.
      const run = await runRow(tx, runIdOf(first));
      const tooSoon = new Date(
        (run?.finishedAt?.getTime() ?? 0) + DIGEST_MIN_INTERVAL_MS - 30 * 60_000,
      );
      const second = await runDigest({ ...tick, now: tooSoon });

      expect(second).toMatchObject({ status: 'not_due', runId: null, recipients: 0, failed: 0 });
      expect(mailer.sent).toHaveLength(sentOnce);
      expect(await digestRunCount(tx)).toBe(runsAfterFirst);
    });
  });

  it('writes windowEnd in the shape isDigestDue reads back: the next window starts where this one ended', async () => {
    // The round trip of task 4's notes, and the one failure this plan cannot
    // see otherwise. `isDigestDue` reads `detail.windowEnd` as `unknown` and
    // accepts it ONLY as a parseable string; any other shape — a number, a
    // Date that serialises unexpectedly, a nested object — falls back to
    // `now - 24 h`. The window would then reset on every run and a window's
    // activity would be dropped with no error and no failing test anywhere.
    // Asserting the string shape alone does not prove the two halves agree;
    // this feeds the row that was actually written back through the reader.
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const at = anchor(ANCHOR_DAYS.runRoundTrip);
      const now = new Date(at.getTime() + HOUR);
      await seedLastRun(tx, at);
      await activityAt(tx, at);
      await twoRecipients(tx);
      const mailer = createFakeMailer();
      const { logger } = captureLogger();

      const result = await runDigest({
        db: tx,
        mailer: mailer.mailer,
        appOrigin: APP_ORIGIN,
        logger,
        enabled: true,
        now,
      });
      expect(result.status).toBe('completed');

      // Exactly the call the timer makes, and the row must be the one this
      // tick wrote — never a sibling's.
      const last = await latestRun(tx, 'digest', ['completed', 'skipped']);
      expect(last?.id).toBe(runIdOf(result));
      expect(typeof last?.detail.windowEnd).toBe('string');

      const nextTick = new Date((last?.finishedAt?.getTime() ?? 0) + DIGEST_MIN_INTERVAL_MS);
      // No run is left `running` in this transaction — the tick closed its own
      // row — so the guard of R2's amendment has nothing to hold back.
      const next = isDigestDue(last, nextTick, await latestRun(tx, 'digest', ['running']));

      expect(next.due).toBe(true);
      // The window the reader hands out starts exactly where the writer
      // stopped: no gap, no overlap, nothing dropped.
      expect(next.windowStart.getTime()).toBe(now.getTime());
      // And that is not the fallback answering by coincidence.
      expect(next.windowStart.getTime()).not.toBe(nextTick.getTime() - 24 * HOUR);
    });
  });

  it('a digest run left running minutes ago makes the next tick not due (R2)', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const at = anchor(ANCHOR_DAYS.runStillRunning);
      const now = new Date(at.getTime() + HOUR);
      // The exact state a throw after the sends leaves behind: a success from
      // two days ago, well past DIGEST_MIN_INTERVAL_MS and still carrying the
      // window this run already covered, plus a run row nothing will close.
      await seedLastRun(tx, at);
      await activityAt(tx, at);
      await twoRecipients(tx);
      await seedAttempt(tx, new Date(now.getTime() - 5 * 60_000), 'running');
      const mailer = createFakeMailer();
      const { logger } = captureLogger();
      const auditBefore = new Set(await digestAuditIds(tx));
      const runsBefore = await digestRunCount(tx);

      const result = await runDigest({
        db: tx,
        mailer: mailer.mailer,
        appOrigin: APP_ORIGIN,
        logger,
        enabled: true,
        now,
      });

      // Without the guard this is `completed` with two e-mails out — the same
      // window, to the same managers, an hour after the run that already sent
      // it, and again every hour until the database heals.
      expect(result).toMatchObject({ status: 'not_due', runId: null, recipients: 0, failed: 0 });
      expect(mailer.sent).toEqual([]);
      expect(await digestRunCount(tx)).toBe(runsBefore);
      expect(new Set(await digestAuditIds(tx))).toEqual(auditBefore);
    });
  });

  it('a digest run left running past the guard window does not postpone for ever (R2)', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const at = anchor(ANCHOR_DAYS.runStaleRunning);
      const now = new Date(at.getTime() + HOUR);
      await seedLastRun(tx, at);
      await activityAt(tx, at);
      const recipients = await twoRecipients(tx);
      // Nothing ever closes this row. A guard that merely asked "is any run
      // still running" would silence the digest permanently.
      await seedAttempt(tx, new Date(now.getTime() - (DIGEST_ATTEMPT_GUARD_MS + HOUR)), 'running');
      const mailer = createFakeMailer();
      const { logger } = captureLogger();

      const result = await runDigest({
        db: tx,
        mailer: mailer.mailer,
        appOrigin: APP_ORIGIN,
        logger,
        enabled: true,
        now,
      });

      expect(result.status).toBe('completed');
      expect(mailer.sent.map((m) => m.to)).toEqual(
        expect.arrayContaining(recipients.map((r) => r.email)),
      );
    });
  });

  it('stores no SQL and no parameters in job_runs.error when a query fails (R1)', async () => {
    await withRollback(t.db, async (tx) => {
      const at = anchor(ANCHOR_DAYS.runQueryError);
      const now = new Date(at.getTime() + HOUR);
      await seedLastRun(tx, at);
      const mailer = createFakeMailer();
      const { logger } = captureLogger();
      // `digestRecipients` selects the ENCRYPTED `users.name` / `users.email`
      // columns, so a decryption or keyring failure inside `runDigest`'s try
      // block throws a query error whose message is the SQL over those columns
      // and its bound values. `job_runs.error` is durable, plaintext at rest
      // and read straight back out by the health page of RFC-52.
      const leaked = 'ada@example.org';
      const error = queryErrorOverUsers(leaked);

      await expect(
        runDigest({
          db: dbWithFailingQueries(tx, error),
          mailer: mailer.mailer,
          appOrigin: APP_ORIGIN,
          logger,
          enabled: true,
          now,
        }),
      ).rejects.toBe(error);

      // The run this tick opened, read back whatever its status.
      const run = await latestRun(tx, 'digest');
      expect(run).toMatchObject({ kind: 'digest', status: 'failed' });
      const stored = run?.error ?? '';
      expect(stored).not.toContain(leaked);
      expect(stored).not.toContain('Failed query:');
      expect(stored).not.toContain('params:');
      expect(stored).not.toContain('users');
      // Safe, but not empty: the driver's SQLSTATE and its own one-line
      // message are what the health page has to work with. (Drizzle does not
      // set `name` on its query error, so the class name is not among them —
      // `errors.test.ts` pins that.)
      expect(stored).toContain('42501');
      expect(stored).toContain('permission denied for function pgp_sym_decrypt');
      expect(mailer.sent).toEqual([]);
    });
  });

  it('a throw after the sends records failed, not running, and the next tick is still not due (R2)', async () => {
    await withRollback(t.db, async (tx) => {
      const at = anchor(ANCHOR_DAYS.runFailedAfterSend);
      const now = new Date(at.getTime() + HOUR);
      await seedLastRun(tx, at);
      await activityAt(tx, at);
      const recipients = await twoRecipients(tx);
      const mailer = createFakeMailer();
      const { logger } = captureLogger();
      // `recordAudit` is the first thing after the send loop, and it is the
      // realistic post-send failure: the mail is already gone.
      const auditFailure = new Error('audit insert rejected');

      await expect(
        runDigest({
          db: dbFailingAuditInsert(tx, auditFailure),
          mailer: mailer.mailer,
          appOrigin: APP_ORIGIN,
          logger,
          enabled: true,
          now,
        }),
      ).rejects.toBe(auditFailure);

      // The premise this guard was first built on was wrong. The catch's own
      // `finishRun` succeeds here — only `job_runs` is involved and the
      // transaction is healthy — so the run ends `failed`, NOT `running`, and
      // a guard that asked for `['running']` alone would never see it.
      const attempt = await latestRun(tx, 'digest');
      expect(attempt).toMatchObject({ kind: 'digest', status: 'failed' });
      // The writer half of the repeat round trip, and the only test that has
      // it: `recordRunDetail` really ran before the send loop, so the row this
      // throw left behind says it had begun mailing and over which window.
      // Feeding it straight back through the reader proves the two agree —
      // asserting the shape alone would not.
      expect(attempt?.detail).toMatchObject({
        phase: 'sending',
        windowStart: windowStartFor(at).toISOString(),
        windowEnd: now.toISOString(),
      });
      const asRead = { id: attempt?.id ?? '', detail: attempt?.detail ?? {} };
      expect(repeatedRunId(asRead, windowStartFor(at))).toBe(attempt?.id);
      // And the e-mail has already gone out, which is what makes a second tick
      // a duplicate rather than a retry.
      //
      // Containment, never equality: `digestRecipients` is dataset-wide (R3:
      // "unrestricted"), so every `records.review` holder a sibling suite has
      // committed is mailed too. Asserting the exact set would be true only
      // while the database is small — the same reason `counts a rejected send`
      // compares against `digestRecipients(tx)` rather than a literal.
      expect(mailer.sent.map((m) => m.to)).toEqual(
        expect.arrayContaining(recipients.map((r) => r.email)),
      );
      const sentOnce = mailer.sent.length;
      expect(sentOnce).toBeGreaterThanOrEqual(recipients.length);
      // `latestRun(db, 'digest', ['completed', 'skipped'])` still answers the
      // seeded success, whose `finished_at` is two days past the interval — so
      // nothing but the guard can stop the next tick.
      const stillAnswers = await latestRun(tx, 'digest', ['completed', 'skipped']);
      expect(stillAnswers?.id).not.toBe(attempt?.id);

      // Five minutes later, timed against the row as `startRun` really stamped
      // it (the transaction clock), because the guard compares `started_at`.
      const nextTick = new Date((attempt?.startedAt?.getTime() ?? 0) + 5 * 60_000);
      const second = await runDigest({
        db: tx,
        mailer: mailer.mailer,
        appOrigin: APP_ORIGIN,
        logger,
        enabled: true,
        now: nextTick,
      });

      expect(second).toMatchObject({ status: 'not_due', runId: null });
      expect(mailer.sent).toHaveLength(sentOnce);
    });
  });

  it('names the previous run as a repeat, in the log, the run detail, the audit and the e-mail (R2, R5)', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const at = anchor(ANCHOR_DAYS.runRepeat);
      const now = new Date(at.getTime() + HOUR);
      await seedLastRun(tx, at);
      await activityAt(tx, at);
      const recipients = await twoRecipients(tx);
      // The real sequence: a run reached its send loop over THIS window and
      // then died, and the two-tick guard has since expired, so this tick is
      // due and is about to cover the same ground.
      const windowStart = windowStartFor(at);
      const previous = await seedAttempt(
        tx,
        new Date(now.getTime() - (DIGEST_ATTEMPT_GUARD_MS + HOUR)),
        'failed',
        {
          windowStart: windowStart.toISOString(),
          windowEnd: new Date(windowStart.getTime() + HOUR).toISOString(),
          phase: 'sending',
        },
      );
      const mailer = createFakeMailer();
      const { logger, lines } = captureLogger();
      const auditBefore = new Set(await digestAuditIds(tx));

      const result = await runDigest({
        db: tx,
        mailer: mailer.mailer,
        appOrigin: APP_ORIGIN,
        logger,
        enabled: true,
        now,
      });

      expect(result.status).toBe('completed');
      // Containment plus a live count, never a literal set: `digestRecipients`
      // is dataset-wide, so sibling suites' review holders are mailed too.
      const all = await digestRecipients(tx);
      expect(mailer.sent).toHaveLength(all.length);
      expect(mailer.sent.map((m) => m.to)).toEqual(
        expect.arrayContaining(recipients.map((r) => r.email)),
      );

      // 1. the log
      const logs = lines as { level: number; msg: string; repeatOf?: string; runId?: string }[];
      const warned = logs.find((l) => l.msg === 'digest repeats an unfinished run');
      expect(warned).toMatchObject({ level: 40, repeatOf: previous, runId: runIdOf(result) });
      // 2. the run detail
      const run = await runRow(tx, runIdOf(result));
      expect(run?.detail).toMatchObject({ repeatOf: previous });
      // 3. the audit metadata — a uuid, which `assertSafeMetadata` accepts;
      // `recordAudit` runs it for real, so this is the confirmation.
      const entry = await digestAuditWrittenSince(tx, auditBefore);
      expect(entry?.metadata).toMatchObject({ repeatOf: previous });
      expect(JSON.stringify(entry?.metadata)).not.toContain('@');
      // 4. the e-mail body, subject untouched (R5 fixes it)
      const [sent] = mailer.sent;
      expect(sent?.subject).toBe(`TreeRepro digest — ${now.toISOString().slice(0, 10)}`);
      expect(sent?.text.split('\n')[0]).toBe(
        'Resent: the previous run for this window did not finish, so part of this summary may have reached you already.',
      );
    });
  });

  it('a previous run that never reached the send phase is not a repeat (R2)', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const at = anchor(ANCHOR_DAYS.runNotARepeat);
      const now = new Date(at.getTime() + HOUR);
      await seedLastRun(tx, at);
      await activityAt(tx, at);
      await twoRecipients(tx);
      // It died in `computeDigest` or `digestRecipients`: no phase was ever
      // recorded, so nobody was mailed and this is a fresh attempt. A row born
      // with its window at `startRun` could not tell the two apart.
      await seedAttempt(tx, new Date(now.getTime() - (DIGEST_ATTEMPT_GUARD_MS + HOUR)), 'failed');
      const mailer = createFakeMailer();
      const { logger, lines } = captureLogger();
      const auditBefore = new Set(await digestAuditIds(tx));

      const result = await runDigest({
        db: tx,
        mailer: mailer.mailer,
        appOrigin: APP_ORIGIN,
        logger,
        enabled: true,
        now,
      });

      expect(result.status).toBe('completed');
      expect(
        (lines as { msg: string }[]).some((l) => l.msg === 'digest repeats an unfinished run'),
      ).toBe(false);
      const run = await runRow(tx, runIdOf(result));
      expect(run?.detail).not.toHaveProperty('repeatOf');
      const entry = await digestAuditWrittenSince(tx, auditBefore);
      expect(entry?.metadata).not.toHaveProperty('repeatOf');
      expect(mailer.sent[0]?.text).not.toContain('Resent');
    });
  });

  it('an ordinary run says nothing about repeats at all (R2, R5)', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const at = anchor(ANCHOR_DAYS.runNoRepeatFlag);
      const now = new Date(at.getTime() + HOUR);
      await seedLastRun(tx, at);
      await activityAt(tx, at);
      await twoRecipients(tx);
      const mailer = createFakeMailer();
      const { logger, lines } = captureLogger();
      const auditBefore = new Set(await digestAuditIds(tx));

      const result = await runDigest({
        db: tx,
        mailer: mailer.mailer,
        appOrigin: APP_ORIGIN,
        logger,
        enabled: true,
        now,
      });

      expect(result.status).toBe('completed');
      expect(
        (lines as { msg: string }[]).some((l) => l.msg === 'digest repeats an unfinished run'),
      ).toBe(false);
      const run = await runRow(tx, runIdOf(result));
      expect(run?.detail).not.toHaveProperty('repeatOf');
      // The send phase is still recorded on the way through, even when the run
      // finishes: `finishRun` replaces `detail` wholesale afterwards, so the
      // completed row carries the window and the counts, never `phase`.
      expect(run?.detail).not.toHaveProperty('phase');
      expect(run?.detail).toMatchObject({ recipients: expect.any(Number) });
      const entry = await digestAuditWrittenSince(tx, auditBefore);
      expect(entry?.metadata).not.toHaveProperty('repeatOf');
      expect(mailer.sent[0]?.text).not.toContain('Resent');
    });
  });

  it('a failed digest run past the guard window does not postpone for ever (R2)', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const at = anchor(ANCHOR_DAYS.runStaleFailed);
      const now = new Date(at.getTime() + HOUR);
      await seedLastRun(tx, at);
      await activityAt(tx, at);
      const recipients = await twoRecipients(tx);
      // A job that fails on every attempt must back off, never stop: the
      // `failed` half of the guard cannot become a permanent mute.
      await seedAttempt(tx, new Date(now.getTime() - (DIGEST_ATTEMPT_GUARD_MS + HOUR)), 'failed');
      const mailer = createFakeMailer();
      const { logger } = captureLogger();

      const result = await runDigest({
        db: tx,
        mailer: mailer.mailer,
        appOrigin: APP_ORIGIN,
        logger,
        enabled: true,
        now,
      });

      expect(result.status).toBe('completed');
      expect(mailer.sent.map((m) => m.to)).toEqual(
        expect.arrayContaining(recipients.map((r) => r.email)),
      );
    });
  });
});
