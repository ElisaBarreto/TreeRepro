import { randomBytes, randomUUID } from 'node:crypto';
import { dashboardSchema, type PermissionKey } from '@treerepro/contracts';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import {
  addPlotSpecies,
  createAnnotation,
  createPlot,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { useTestDb, withRollback } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED } from '../../test/helpers/visibility.ts';
import type { Visibility } from '../access/visibility.ts';
import { countOpenProposals } from '../dataset/proposals.ts';
import { countContested, countDisputed, countPendingGroups } from '../dataset/queues.ts';
import type { DbTransaction } from '../db/client.ts';
import { speciesProposals } from '../db/schema/proposals.ts';
import { species } from '../db/schema/taxa.ts';
import { cachedJson, forgetCached } from '../redis/cache.ts';
import { createRedis, type Redis } from '../redis/client.ts';
import {
  computeDatasetStats,
  type DashboardViewer,
  getDashboard,
  traitsWithData,
} from './dashboard.ts';

/**
 * READ THIS BEFORE ASSERTING A DATASET COUNT FROM ANY SUITE.
 *
 * Several tests below call `getDashboard` on a rolled-back `repeatable read`
 * transaction, and `getDashboard` writes two fixed keys that every caller in
 * the run shares:
 *
 * - `stats:dataset`, the longest ttl in the suite at one hour; and
 * - `coverage:totals:<u|r>`, ten minutes, written by `curationSection` →
 *   `coverageTotals` for any viewer holding `records.review` — which the
 *   curation test below is.
 *
 * Whichever caller finds such a key cold fills it, and when that caller is one
 * of these tests the entry it publishes counts rows from a frozen snapshot
 * that were never committed, for the whole of that ttl.
 *
 * Nothing asserts those values today — this file proves the dataset counts
 * through the uncached `computeDatasetStats` as a delta, proves the entry
 * semantics on a random key, and compares the curation queues against the
 * services themselves rather than against a fixture — so it cannot fail now.
 * But a later plan (11c's coverage page, which is about coverage totals, or
 * 12a's getting-started card) that asserts `dataset.recordCount`,
 * `dataset.speciesCount` or `curation.coverage.*` against a fixture of its own
 * will fail here, rarely and for a whole ttl at a time, and the cause will not
 * be in its own file. Assert the uncached function, or a delta, and leave the
 * shared entries alone.
 */

/**
 * Freezes the transaction's snapshot so the dataset-wide denominators below
 * (the visible active trait count) cannot move under the assertions while a
 * sibling suite commits, and fails loudly if `withRollback` ever stops opening
 * a plain transaction — the same guard `coverage.integration.test.ts` uses.
 */
async function freezeSnapshot(tx: DbTransaction): Promise<void> {
  await tx.execute(sql`set transaction isolation level repeatable read`);
  const [isolation] = (await tx.execute(sql`show transaction_isolation`)) as unknown as [
    { transaction_isolation: string } | undefined,
  ];
  expect(isolation?.transaction_isolation).toBe('repeatable read');
}

const permissions = (...keys: PermissionKey[]): ReadonlySet<PermissionKey> => new Set(keys);

/**
 * Three species in one plot, three active traits and one inactive one; two
 * cells hold a record, one confirmed and one not. A third record sits on a
 * cell that already holds one and is withdrawn, so both halves of the
 * awaiting-validation predicate are exercised: an implementation that excluded
 * only `confirm` would count it and fail. It shares its cell deliberately —
 * a withdrawn record on a cell of its own would move the missing-cell and
 * ranking numbers this fixture also pins.
 *
 * Everything is created here with random names, so every assertion below is
 * about this fixture alone.
 */
async function plotFixture(tx: DbTransaction) {
  const { user: viewer } = await createUser(tx);
  const { user: manager } = await createUser(tx);
  const reference = await createReference(tx);
  // A second source: the claim key of RFC-63 is (species, trait, value, raw
  // value, references), so a second record on one cell needs one.
  const secondReference = await createReference(tx);
  const plot = await createPlot(tx);
  const one = await createSpecies(tx);
  const two = await createSpecies(tx);
  const three = await createSpecies(tx);
  const outside = await createSpecies(tx);
  await addPlotSpecies(tx, plot.id, [one.id, two.id, three.id]);
  const traitA = await createTrait(tx, { levels: ['alpha'] });
  const traitB = await createTrait(tx, { levels: ['alpha'] });
  const traitC = await createTrait(tx, { levels: ['alpha'] });
  const traitOff = await createTrait(tx, { levels: ['alpha'], active: false });
  const record = (
    speciesId: string,
    trait: { id: string; levels: { id: string; key: string }[] },
    createdBy: string,
    referenceId: string = reference.id,
  ) =>
    createRecord(tx, {
      speciesId,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: referenceId,
      origin: 'manual',
      createdBy,
    });
  // Confirmed: it holds a cell but never awaits the viewer's validation.
  const confirmed = await record(one.id, traitA, viewer.id);
  await createAnnotation(tx, { recordId: confirmed.id, actorId: manager.id, kind: 'confirm' });
  // The one record awaiting validation.
  const awaiting = await record(one.id, traitB, viewer.id);
  // Withdrawn: it shares `awaiting`'s cell, so it changes no count but the
  // one it must change — the other half of the predicate (RFC-72 R1, spec §7).
  const withdrawn = await record(one.id, traitB, manager.id, secondReference.id);
  await createAnnotation(tx, { recordId: withdrawn.id, actorId: manager.id, kind: 'withdraw' });
  // Invisible to a restricted viewer: an inactive trait, and a species that is
  // in no plot of the viewer (RFC-33, RFC-72 R2).
  const onInactiveTrait = await record(one.id, traitOff, manager.id);
  const onOutsideSpecies = await record(outside.id, traitA, manager.id);

  const viewerScope: DashboardViewer = {
    id: viewer.id,
    permissions: permissions('dataset.read'),
    scope: { plots: [plot], restricted: true },
  };
  const visibility: Visibility = { inactive: false, plotIds: [plot.id] };
  return {
    viewer,
    manager,
    plot,
    species: { one, two, three, outside },
    traitA,
    traitB,
    traitC,
    traitOff,
    reference,
    secondReference,
    confirmed,
    awaiting,
    withdrawn,
    onInactiveTrait,
    onOutsideSpecies,
    viewerScope,
    visibility,
  };
}

/** The visible active trait count of the frozen snapshot. */
async function activeTraitCount(tx: DbTransaction): Promise<number> {
  const [row] = (await tx.execute(
    sql`select count(*)::int as n from traits t where t.active`,
  )) as unknown as [{ n: number } | undefined];
  if (!row) throw new Error('the trait oracle returned no row');
  return row.n;
}

describe('RFC-72 R1 getDashboard over the viewer plots', () => {
  const t = useTestDb();
  let redis: Redis;
  beforeAll(async () => {
    // A Redis logical database of this suite's own. Every test below calls
    // `getDashboard` inside a frozen, rolled-back transaction, and
    // `getDashboard` fills fixed keys every suite shares —
    // `dictionary:species-counts:r` (read by `traitsWithData` for every
    // viewer), `stats:dataset`. On database 0 those fills would publish rows
    // that are never committed to every other suite for up to an hour. On
    // database 1, flushed before each test, they reach no one, and each test
    // reads counts of its own snapshot.
    redis = createRedis(`${inject('redisUrl')}/1`);
    await redis.connect();
  });
  beforeEach(async () => {
    await redis.flushdb();
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('answers the plot scope, the missing cells and the records awaiting validation', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const f = await plotFixture(tx);
      const traits = await activeTraitCount(tx);

      const dashboard = await getDashboard({ db: tx, redis }, f.visibility, f.viewerScope);

      expect(dashboard.scope).toEqual({
        plots: [{ id: f.plot.id, code: f.plot.code, name: f.plot.name, speciesCount: 3 }],
        speciesCount: 3,
        restricted: true,
      });
      // Three plot species over every visible active trait, less the two cells
      // that hold a record. The trait count is dataset-wide, so it is read
      // from the snapshot rather than written as a literal; the fixture's own
      // arithmetic is the `3 * traits - 2`.
      expect(dashboard.contributor.missingCells).toBe(3 * traits - 2);
      expect(dashboard.contributor.awaitingValidation).not.toBeNull();
      expect(dashboard.contributor.awaitingValidation?.count).toBe(1);
      expect(dashboard.contributor.awaitingValidation?.records.map((r) => r.id)).toEqual([
        f.awaiting.id,
      ]);
      // Only the viewer's own manual records count towards the summary.
      expect(dashboard.contributor.summary.records).toBe(2);
    });
  });

  it('RFC-33: a plot-bound viewer awaits validation only on species of their plots', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const f = await plotFixture(tx);

      const dashboard = await getDashboard({ db: tx, redis }, f.visibility, f.viewerScope);
      const ids = dashboard.contributor.awaitingValidation?.records.map((r) => r.id) ?? [];

      expect(ids).not.toContain(f.onOutsideSpecies.id);
      expect(ids).not.toContain(f.onInactiveTrait.id);
      expect(ids).not.toContain(f.confirmed.id);
      expect(ids).not.toContain(f.withdrawn.id);
      const speciesIds = (dashboard.contributor.awaitingValidation?.records ?? []).map(
        (r) => r.speciesId,
      );
      expect(speciesIds).not.toContain(f.species.outside.id);
      for (const speciesId of speciesIds) {
        expect([f.species.one.id, f.species.two.id, f.species.three.id]).toContain(speciesId);
      }
    });
  });

  it('ranks the traits by the species holding data, dataset-wide, and skips inactive traits', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const f = await plotFixture(tx);

      // The ranking without the ten-entry cut: the dashboard's own top ten is
      // filled by whatever the run's other suites have committed, so the
      // fixture's own traits are asserted on the full list (RFC-72 R1).
      const ranking = await traitsWithData({ db: tx, redis }, f.visibility);
      const at = (traitId: string) => ranking.findIndex((r) => r.trait.id === traitId);
      const countOf = (traitId: string) =>
        ranking.find((r) => r.trait.id === traitId)?.speciesCount;

      // A is held by `one` and by `outside`, a species in none of the
      // viewer's plots: the ranking is a dataset-wide statistic, open to a
      // plot-bound viewer (spec R-18 names `speciesCountsByTrait`).
      expect(countOf(f.traitA.id)).toBe(2);
      // B's second record is withdrawn but shares `awaiting`'s cell.
      expect(countOf(f.traitB.id)).toBe(1);
      expect(at(f.traitA.id)).toBeLessThan(at(f.traitB.id));
      // C has no data and the inactive trait is invisible: neither is ranked.
      expect(at(f.traitC.id)).toBe(-1);
      expect(at(f.traitOff.id)).toBe(-1);
      expect(ranking.every((r) => r.speciesCount > 0)).toBe(true);
      expect(ranking.map((r) => r.speciesCount)).toEqual(
        [...ranking.map((r) => r.speciesCount)].sort((a, b) => b - a),
      );
      expect(ranking.find((r) => r.trait.id === f.traitA.id)).toEqual({
        trait: {
          id: f.traitA.id,
          key: f.traitA.key,
          valueType: f.traitA.valueType,
          unit: f.traitA.unit,
        },
        category: expect.objectContaining({ key: expect.any(String), label: expect.any(String) }),
        speciesCount: 2,
      });

      const dashboard = await getDashboard({ db: tx, redis }, f.visibility, f.viewerScope);
      expect(dashboard.contributor.topTraitsWithData.length).toBeLessThanOrEqual(10);
      expect(dashboard.contributor.topTraitsWithData).toEqual(ranking.slice(0, 10));
    });
  });

  it('ranks the same traits for a viewer restricted to no plots at all as for the rest of their visibility class', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const f = await plotFixture(tx);

      // The ranking is plot-blind (Spec note 3): restricting a viewer to zero
      // plots narrows nothing here, the same as `GET /api/traits`.
      const unbound = await traitsWithData({ db: tx, redis }, RESTRICTED);
      const noPlots = await traitsWithData({ db: tx, redis }, { inactive: false, plotIds: [] });
      const bound = await traitsWithData({ db: tx, redis }, f.visibility);
      expect(noPlots.some((r) => r.trait.id === f.traitA.id)).toBe(true);
      expect(noPlots).toEqual(unbound);
      expect(bound).toEqual(unbound);
    });
  });

  it('answers curation only to a viewer who reviews, with the queue counts of RFC-65', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const f = await plotFixture(tx);

      const contributor = await getDashboard({ db: tx, redis }, f.visibility, f.viewerScope);
      expect(contributor.curation).toBeNull();

      // RFC-75 R7: one open proposal of this test's own, so the queue number
      // is not trivially the sibling suites' standing total. The snapshot is
      // frozen, so `openProposals` cannot move underneath the comparison.
      const openBefore = await countOpenProposals(tx);
      await tx.insert(speciesProposals).values({
        proposedName: `Testus dashboardus ${randomBytes(6).toString('hex')}`,
        proposerId: f.manager.id,
      });

      const manager: DashboardViewer = {
        id: f.manager.id,
        permissions: permissions('dataset.read', 'records.review', 'taxa.manage'),
        scope: { plots: [f.plot], restricted: true },
      };
      const reviewed = await getDashboard({ db: tx, redis }, f.visibility, manager);
      expect(reviewed.curation).not.toBeNull();
      // The queue numbers are dataset-wide; the oracle is the very service
      // each queue page counts with, read from this same frozen snapshot, so
      // no concurrent commit can falsify the comparison.
      expect(reviewed.curation?.queues).toEqual({
        pendingGroups: await countPendingGroups(tx, f.visibility),
        disputed: await countDisputed(tx, f.visibility),
        contested: await countContested(tx, f.visibility),
        proposals: openBefore + 1,
      });
      // The contract is strict at every nested object, so parsing a viewer who
      // has all four sections populated is what proves the answer carries no
      // field RFC-72 R1 does not name, and none it does missing.
      const parsed = dashboardSchema.safeParse(reviewed);
      expect(parsed.error?.issues.map((i) => i.path.join('.'))).toBeUndefined();
      expect(parsed.success).toBe(true);
      expect(reviewed.scope).not.toBeNull();
      expect(reviewed.contributor.awaitingValidation).not.toBeNull();
      expect(Object.keys(reviewed.curation?.coverage ?? {}).sort()).toEqual([
        'cells',
        'percentValidated',
        'percentWithData',
        'validated',
        'withData',
      ]);
      expect(reviewed.curation?.coverage.percentWithData).toBeLessThanOrEqual(100);
      expect(reviewed.curation?.coverage.percentValidated).toBeLessThanOrEqual(100);

      // RFC-75 R7: the proposals queue is `taxa.manage` work — that is what
      // `GET /api/species/proposals` requires (RFC-75 R3). A reviewer who
      // does not hold it is counting a queue the API would refuse them, so
      // the number is 0 while the record queues, which are theirs, still
      // count.
      const reviewerOnly: DashboardViewer = {
        ...manager,
        permissions: permissions('dataset.read', 'records.review'),
      };
      const withoutTaxa = await getDashboard({ db: tx, redis }, f.visibility, reviewerOnly);
      expect(withoutTaxa.curation?.queues.proposals).toBe(0);
      expect(withoutTaxa.curation?.queues.pendingGroups).toBe(
        reviewed.curation?.queues.pendingGroups,
      );
    });
  });

  /**
   * RFC-40 R1: PII is never persisted in the clear, in Postgres or in Redis.
   * The contributor entry is the one place a colleague's name could reach a
   * Redis value, through `awaitingValidation.records[].createdBy.name` — so
   * the entry stores record ids and the items are re-hydrated per request.
   * Both names are random, so a substring hit in the stored JSON can only be
   * this fixture's own.
   */
  it('RFC-40 R1: the per-viewer entry holds record ids, never a name in the clear', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const viewerName = `Viewer ${randomUUID()}`;
      const authorName = `Author ${randomUUID()}`;
      const { user: viewer } = await createUser(tx, { name: viewerName });
      const { user: author } = await createUser(tx, { name: authorName });
      const reference = await createReference(tx);
      const plot = await createPlot(tx);
      const one = await createSpecies(tx);
      await addPlotSpecies(tx, plot.id, [one.id]);
      const traitOne = await createTrait(tx, { levels: ['alpha'] });
      const traitTwo = await createTrait(tx, { levels: ['alpha'] });
      const write = (trait: { id: string; levels: { id: string; key: string }[] }) =>
        createRecord(tx, {
          speciesId: one.id,
          traitId: trait.id,
          valueText: 'alpha',
          levelId: trait.levels[0]?.id,
          primaryReferenceId: reference.id,
          origin: 'manual',
          createdBy: author.id,
        });
      // `trait_records.id` is a uuidv7, so the second write is the newer one.
      const older = await write(traitOne);
      const newer = await write(traitTwo);
      const viewerScope: DashboardViewer = {
        id: viewer.id,
        permissions: permissions('dataset.read'),
        scope: { plots: [plot], restricted: true },
      };
      const visibility: Visibility = { inactive: false, plotIds: [plot.id] };
      const key = `dashboard:${viewer.id}`;

      try {
        const first = await getDashboard({ db: tx, redis }, visibility, viewerScope);
        const records = first.contributor.awaitingValidation?.records ?? [];
        // The answer carries the author's name, newest first…
        expect(records.map((r) => r.id)).toEqual([newer.id, older.id]);
        expect(records.map((r) => r.createdBy)).toEqual([
          { id: author.id, name: authorName },
          { id: author.id, name: authorName },
        ]);

        // …and the Redis value behind it carries neither name.
        const raw = await redis.get(key);
        expect(raw).not.toBeNull();
        expect(raw).not.toContain(authorName);
        expect(raw).not.toContain(viewerName);
        expect(raw).toContain(newer.id);
        expect(raw).toContain(older.id);

        // The second call is served from that entry and still answers whole
        // items, in the same order: the re-hydration is not a first-call path.
        const second = await getDashboard({ db: tx, redis }, visibility, viewerScope);
        expect(second.contributor.awaitingValidation).toEqual(first.contributor.awaitingValidation);
      } finally {
        await forgetCached(redis, key);
      }
    });
  });

  it('serves the contributor section from the per-viewer entry until it is forgotten', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const f = await plotFixture(tx);
      // `dashboard:<viewer id>` is keyed by a user this test created, so no
      // other caller in the run can write or read it.
      const key = `dashboard:${f.viewer.id}`;
      try {
        const first = await getDashboard({ db: tx, redis }, f.visibility, f.viewerScope);
        expect(first.contributor.summary.records).toBe(2);
        expect(await redis.get(key)).not.toBeNull();
        const ttl = await redis.ttl(key);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(300);

        await createRecord(tx, {
          speciesId: f.species.two.id,
          traitId: f.traitC.id,
          valueText: 'alpha',
          levelId: f.traitC.levels[0]?.id,
          primaryReferenceId: f.reference.id,
          origin: 'manual',
          createdBy: f.viewer.id,
        });
        const cached = await getDashboard({ db: tx, redis }, f.visibility, f.viewerScope);
        expect(cached.contributor.summary.records).toBe(2);

        await forgetCached(redis, key);
        const fresh = await getDashboard({ db: tx, redis }, f.visibility, f.viewerScope);
        expect(fresh.contributor.summary.records).toBe(3);
      } finally {
        await forgetCached(redis, key);
      }
    });
  });
});

describe('RFC-72 R1 getDashboard without plots', () => {
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
   * This fixture is committed rather than rolled back, and deliberately so:
   * the no-plots ranking reads `dictionary:species-counts:<u|r>`, a fixed key
   * shared with `GET /api/traits`. Computing that map inside a frozen
   * transaction would store a snapshot of uncommitted rows under it for ten
   * minutes and hand a sibling suite counts it cannot see. On the pool, every
   * row the map counts is committed and the entry stays true.
   */
  it('has no scope, no missing cells and no validation queue, and ranks the traits with data', async () => {
    const { user } = await createUser(t.db);
    const reference = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['alpha'] });
    const withData = await createSpecies(t.db);
    await createSpecies(t.db);
    await createSpecies(t.db);
    await createSpecies(t.db);
    await createRecord(t.db, {
      speciesId: withData.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: user.id,
    });
    const viewer: DashboardViewer = {
      id: user.id,
      permissions: permissions('dataset.read'),
      scope: { plots: [], restricted: false },
    };

    const dashboard = await getDashboard({ db: t.db, redis }, RESTRICTED, viewer);

    expect(dashboard.scope).toBeNull();
    expect(dashboard.contributor.missingCells).toBeNull();
    expect(dashboard.contributor.awaitingValidation).toBeNull();
    // The ranking reads the shared `dictionary:species-counts:r` entry
    // (committed rows only, see above), so only its shape is this test's to
    // assert: at most ten, every entry holding data, most data first.
    const top = dashboard.contributor.topTraitsWithData;
    expect(top.length).toBeLessThanOrEqual(10);
    expect(top.every((r) => r.speciesCount > 0)).toBe(true);
    expect(top.map((r) => r.speciesCount)).toEqual(
      [...top.map((r) => r.speciesCount)].sort((a, b) => b - a),
    );
  });
});

describe('RFC-72 R1 the dataset counts', () => {
  const t = useTestDb();
  let redis: Redis;
  beforeAll(async () => {
    redis = createRedis(inject('redisUrl'));
    await redis.connect();
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('counts active species only, every reference, the references cited as primary and as secondary, and every record, as a delta of its own rows', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      // The counts are dataset-wide: only the delta around this fixture can be
      // asserted, and the frozen snapshot keeps a sibling's commits out of it.
      const before = await computeDatasetStats(tx);
      const { user } = await createUser(tx);
      const reference = await createReference(tx);
      const secondary = await createReference(tx);
      // Cited by nothing: a reference, but neither a primary nor a secondary one.
      await createReference(tx);
      const trait = await createTrait(tx, { levels: ['alpha'] });
      const active = await createSpecies(tx);
      const inactive = await createSpecies(tx);
      await tx.update(species).set({ active: false }).where(eq(species.id, inactive.id));
      for (const speciesId of [active.id, inactive.id]) {
        await createRecord(tx, {
          speciesId,
          traitId: trait.id,
          valueText: 'alpha',
          levelId: trait.levels[0]?.id,
          primaryReferenceId: reference.id,
          secondaryReferenceId: secondary.id,
          origin: 'manual',
          createdBy: user.id,
        });
      }

      const after = await computeDatasetStats(tx);
      expect(after.speciesCount - before.speciesCount).toBe(1);
      expect(after.referenceCount - before.referenceCount).toBe(3);
      // Spec R-18: a reference counts once per role it holds, however many
      // records cite it in that role.
      expect(after.primaryReferenceCount - before.primaryReferenceCount).toBe(1);
      expect(after.secondaryReferenceCount - before.secondaryReferenceCount).toBe(1);
      expect(after.recordCount - before.recordCount).toBe(2);
    });
  });

  /**
   * The entry semantics on a key of this test's own. `stats:dataset` is fixed
   * and shared by every dashboard call in the run (RFC-72 R1): deleting it to
   * watch it refill would open a window a sibling can win, and the entry read
   * back would be their numbers and their `computedAt`. The test below pins
   * the wrapper's key and ttl with assertions no concurrent caller can
   * falsify.
   */
  it('answers the second call from the entry the first one stored, without recomputing', async () => {
    const key = `stats:dataset:test:${randomUUID()}`;
    let computed = 0;
    const compute = () => {
      computed += 1;
      return computeDatasetStats(t.db);
    };
    try {
      const first = await cachedJson(redis, key, 3600, compute);
      const second = await cachedJson(redis, key, 3600, compute);
      expect(computed).toBe(1);
      expect(second.value).toEqual(first.value);
      expect(second.computedAt).toBe(first.computedAt);
    } finally {
      await forgetCached(redis, key);
    }
  });

  it('serves the dashboard dataset section from `stats:dataset` on the second call', async () => {
    const { user } = await createUser(t.db);
    const viewer: DashboardViewer = {
      id: user.id,
      permissions: permissions('dataset.read'),
      scope: { plots: [], restricted: false },
    };
    try {
      const first = await getDashboard({ db: t.db, redis }, RESTRICTED, viewer);
      const second = await getDashboard({ db: t.db, redis }, RESTRICTED, viewer);
      // Nothing here is falsifiable by a sibling: the entry lives an hour, so
      // both calls read the same one whoever wrote it, and the assertion is
      // that the second call did not recompute its own.
      expect(second.dataset.computedAt).toBe(first.dataset.computedAt);
      expect(second.dataset).toEqual(first.dataset);
      const ttl = await redis.ttl('stats:dataset');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(3600);
    } finally {
      await forgetCached(redis, `dashboard:${user.id}`);
    }
  });
});
