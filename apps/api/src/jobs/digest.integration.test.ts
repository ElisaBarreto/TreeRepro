import { TransactionRollbackError } from 'drizzle-orm';
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
import type { Db, DbTransaction } from '../db/client.ts';
import { computeDigest, type DigestWindow, digestRecipients } from './digest.ts';

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
} as const;

const anchor = (daysAgo: number): Date => new Date(Date.now() - daysAgo * DAY);

/** One hour either side of `at`: wide enough for a fixture, far from every other anchor. */
const windowAround = (at: Date): DigestWindow => ({
  start: new Date(at.getTime() - HOUR),
  end: new Date(at.getTime() + HOUR),
});

/**
 * `withRollback`, but the transaction also holds one repeatable-read snapshot.
 * `pendingGroups` and `disputedNow` are current dataset-wide counts (RFC-65 R8,
 * R10) that no window can isolate, so the only honest assertion about them is a
 * before/after delta — and a delta is only comparable while a sibling suite
 * cannot commit between the two reads. Same technique as
 * `trait-page.integration.test.ts`.
 */
async function inSnapshot<T>(db: Db, fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  let result: T | undefined;
  let completed = false;
  try {
    await db.transaction(
      async (tx) => {
        result = await fn(tx);
        completed = true;
        tx.rollback();
      },
      { isolationLevel: 'repeatable read' },
    );
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
  if (!completed) throw new Error('inSnapshot: callback did not complete');
  return result as T;
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
    await inSnapshot(t.db, async (tx) => {
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
      const reviewerRole = await createRole(tx, { permissions: ['records.review'] });
      const contributorRole = await createRole(tx, { permissions: ['records.create'] });
      const admin = await systemRoleId(tx, 'admin');

      const [reviewer, administrator, both, suspended, invited, contributor, roleless] =
        await Promise.all([
          createUser(tx, { name: 'Rita Reviewer', password: null, roles: [reviewerRole.id] }),
          createUser(tx, { password: null, roles: [admin] }),
          createUser(tx, { password: null, roles: [reviewerRole.id, admin] }),
          createUser(tx, { status: 'suspended', password: null, roles: [reviewerRole.id] }),
          createUser(tx, { status: 'invited', password: null, roles: [reviewerRole.id] }),
          createUser(tx, { password: null, roles: [contributorRole.id] }),
          createUser(tx, { password: null }),
        ]);

      const recipients = await digestRecipients(tx);
      const ids = recipients.map((r) => r.id);

      expect(ids).toContain(reviewer.user.id);
      expect(ids).toContain(administrator.user.id);
      // `admin` is the seeded system role, not a permission key: the admin
      // holds every permission without a `role_permissions` row for any of them.
      expect(ids).toContain(both.user.id);
      expect(ids).not.toContain(suspended.user.id);
      expect(ids).not.toContain(invited.user.id);
      expect(ids).not.toContain(contributor.user.id);
      expect(ids).not.toContain(roleless.user.id);
      // Two qualifying roles are still one recipient, and so one e-mail (R5).
      expect(ids.filter((id) => id === both.user.id)).toHaveLength(1);

      // Name and address arrive decrypted from the column type (RFC-40 R8).
      expect(recipients.find((r) => r.id === reviewer.user.id)).toEqual({
        id: reviewer.user.id,
        email: reviewer.email,
        name: 'Rita Reviewer',
      });
    });
  });
});
