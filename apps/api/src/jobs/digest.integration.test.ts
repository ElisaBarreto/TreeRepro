import { sql } from 'drizzle-orm';
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
import { createRole, systemRoleId } from '../../test/helpers/roles.ts';
import { createUser } from '../../test/helpers/users.ts';
import type { DbTransaction } from '../db/client.ts';
import { computeDigest, DIGEST_LIST_LIMIT, type DigestWindow, digestRecipients } from './digest.ts';

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

      const digest = await computeDigest(tx, windowAround(at));

      expect(digest.counts).toMatchObject({
        records: 2,
        contests: 1,
        complements: 1,
        validations: 3,
        disputes: 1,
        withdrawals: 1,
        // RFC-75 lands in plan 12c; until then there is nothing to count.
        proposals: 0,
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
