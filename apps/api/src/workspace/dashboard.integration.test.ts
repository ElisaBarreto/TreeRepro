import { randomUUID } from 'node:crypto';
import { dashboardSchema, type PermissionKey } from '@treerepro/contracts';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
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
import { countContested, countDisputed, countPendingGroups } from '../dataset/queues.ts';
import type { DbTransaction } from '../db/client.ts';
import { species } from '../db/schema/taxa.ts';
import { cachedJson, forgetCached } from '../redis/cache.ts';
import { createRedis, type Redis } from '../redis/client.ts';
import {
  computeDatasetStats,
  type DashboardViewer,
  getDashboard,
  missingTraitCounts,
} from './dashboard.ts';

/**
 * What the plot fixture below leaves missing on its two half-covered traits.
 * The no-plots case asserts the dataset-wide number for its own trait is at
 * least this: the plot number is a fact about three species, the dataset-wide
 * one is a fact about every visible species and moves as sibling suites
 * commit, so only the inequality can be asserted (RFC-72 R1).
 */
const PLOT_CASE_MISSING = 2;

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
 * cells hold a record, one confirmed and one not. Everything is created here
 * with random names, so every assertion below is about this fixture alone.
 */
async function plotFixture(tx: DbTransaction) {
  const { user: viewer } = await createUser(tx);
  const { user: manager } = await createUser(tx);
  const reference = await createReference(tx);
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
  ) =>
    createRecord(tx, {
      speciesId,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy,
    });
  // Confirmed: it holds a cell but never awaits the viewer's validation.
  const confirmed = await record(one.id, traitA, viewer.id);
  await createAnnotation(tx, { recordId: confirmed.id, actorId: manager.id, kind: 'confirm' });
  // The one record awaiting validation.
  const awaiting = await record(one.id, traitB, viewer.id);
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
    confirmed,
    awaiting,
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
    redis = createRedis(inject('redisUrl'));
    await redis.connect();
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
      const speciesIds = (dashboard.contributor.awaitingValidation?.records ?? []).map(
        (r) => r.speciesId,
      );
      expect(speciesIds).not.toContain(f.species.outside.id);
      for (const speciesId of speciesIds) {
        expect([f.species.one.id, f.species.two.id, f.species.three.id]).toContain(speciesId);
      }
    });
  });

  it('ranks the traits by the plot species that still miss them, and skips inactive traits', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const f = await plotFixture(tx);

      // The ranking without the ten-entry cut: the dashboard's own top ten is
      // filled by whatever the run's other suites have committed, so the
      // fixture's own traits are asserted on the full list (RFC-72 R1).
      const ranking = await missingTraitCounts({ db: tx, redis }, f.visibility, [f.plot.id]);
      const at = (traitId: string) => ranking.findIndex((r) => r.trait.id === traitId);
      const countOf = (traitId: string) =>
        ranking.find((r) => r.trait.id === traitId)?.missingSpeciesCount;

      expect(countOf(f.traitA.id)).toBe(PLOT_CASE_MISSING);
      expect(countOf(f.traitB.id)).toBe(PLOT_CASE_MISSING);
      // No plot species holds a record on C: it misses all three and outranks
      // the two traits one species already covers.
      expect(countOf(f.traitC.id)).toBe(3);
      expect(at(f.traitC.id)).toBeLessThan(at(f.traitA.id));
      expect(at(f.traitC.id)).toBeLessThan(at(f.traitB.id));
      expect(at(f.traitOff.id)).toBe(-1);
      expect(ranking.map((r) => r.missingSpeciesCount)).toEqual(
        [...ranking.map((r) => r.missingSpeciesCount)].sort((a, b) => b - a),
      );
      expect(ranking.find((r) => r.trait.id === f.traitA.id)?.category).toEqual(
        expect.objectContaining({ key: expect.any(String), label: expect.any(String) }),
      );

      const dashboard = await getDashboard({ db: tx, redis }, f.visibility, f.viewerScope);
      expect(dashboard.contributor.topMissingTraits.length).toBeLessThanOrEqual(10);
      expect(dashboard.contributor.topMissingTraits).toEqual(ranking.slice(0, 10));
    });
  });

  it('answers curation only to a viewer who reviews, with the queue counts of RFC-65', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const f = await plotFixture(tx);

      const contributor = await getDashboard({ db: tx, redis }, f.visibility, f.viewerScope);
      expect(contributor.curation).toBeNull();

      const manager: DashboardViewer = {
        id: f.manager.id,
        permissions: permissions('dataset.read', 'records.review'),
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
        proposals: 0,
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
        'accepted',
        'cells',
        'percentAccepted',
        'percentWithData',
        'withData',
      ]);
      expect(reviewed.curation?.coverage.percentWithData).toBeLessThanOrEqual(100);
      expect(reviewed.curation?.coverage.percentAccepted).toBeLessThanOrEqual(100);
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
  it('has no scope, no missing cells and no validation queue, and ranks over the dataset', async () => {
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
    expect(dashboard.contributor.topMissingTraits.length).toBeLessThanOrEqual(10);

    const ranking = await missingTraitCounts({ db: t.db, redis }, RESTRICTED, []);
    const entry = ranking.find((r) => r.trait.id === trait.id);
    // Four active species were just created and only one of them holds a
    // record on this trait, so the dataset-wide number is at least three —
    // never below the plot case, whichever way the shared species-count entry
    // happened to be warmed.
    expect(entry).toBeDefined();
    expect(entry?.missingSpeciesCount).toBeGreaterThanOrEqual(PLOT_CASE_MISSING);
    expect(entry?.trait).toEqual({
      id: trait.id,
      key: trait.key,
      valueType: trait.valueType,
      unit: trait.unit,
    });
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

  it('counts active species only, and every reference and record, as a delta of its own rows', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      // The counts are dataset-wide: only the delta around this fixture can be
      // asserted, and the frozen snapshot keeps a sibling's commits out of it.
      const before = await computeDatasetStats(tx);
      const { user } = await createUser(tx);
      const reference = await createReference(tx);
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
          origin: 'manual',
          createdBy: user.id,
        });
      }

      const after = await computeDatasetStats(tx);
      expect(after.speciesCount - before.speciesCount).toBe(1);
      expect(after.referenceCount - before.referenceCount).toBe(1);
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
