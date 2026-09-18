import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  addPlotSpecies,
  createAcceptedValue,
  createFamily,
  createGenus,
  createPlot,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
  createTraitCategory,
} from '../../test/helpers/dataset.ts';
import { useTestDb, withRollback } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import type { Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { species } from '../db/schema/taxa.ts';
import { cachedJson, forgetCached } from '../redis/cache.ts';
import { createRedis, type Redis } from '../redis/client.ts';
import {
  computeCoverageMetrics,
  computeCoverageTotals,
  coverageMetrics,
  coverageTop,
  coverageTotals,
} from './coverage.ts';

interface CachedEntry {
  value: Awaited<ReturnType<typeof coverageTotals>>;
  computedAt: string;
}

async function entryOf(redis: Redis, key: string): Promise<CachedEntry | null> {
  const raw = await redis.get(key);
  return raw === null ? null : (JSON.parse(raw) as CachedEntry);
}

describe('RFC-69 R5 coverageTotals over the visible grid', () => {
  const t = useTestDb();

  it('counts visible cells, coverage rows and accepted pairs, and excludes what is inactive', async () => {
    await withRollback(t.db, async (tx) => {
      // The totals are dataset-wide, so they can only be asserted as deltas
      // around this test's own fixture. REPEATABLE READ freezes the snapshot at
      // the first statement below, so rows that sibling test files commit while
      // this test runs stay invisible to it and the delta is exactly the
      // fixture; the transaction then rolls back, so the fixture is never
      // visible to a sibling either.
      await tx.execute(sql`set transaction isolation level repeatable read`);
      // The `set` above binds only while `withRollback` opens a plain
      // transaction; were it ever to become savepoint-based, it would silently
      // stop applying and every delta below would turn into a race. Fail here
      // instead, loudly.
      const [isolation] = (await tx.execute(sql`show transaction_isolation`)) as unknown as [
        { transaction_isolation: string } | undefined,
      ];
      expect(isolation?.transaction_isolation).toBe('repeatable read');
      const before = await computeCoverageTotals(tx, RESTRICTED);
      const beforeInactive = await computeCoverageTotals(tx, UNRESTRICTED);
      const [grid] = (await tx.execute(sql`
        select (select count(*)::int from species s where s.active) as active_species,
               (select count(*)::int from traits t where t.active) as active_traits,
               (select count(*)::int from species) as all_species,
               (select count(*)::int from traits) as all_traits`)) as unknown as [
        { active_species: number; active_traits: number; all_species: number; all_traits: number },
      ];
      if (!grid) throw new Error('the grid oracle returned no row');
      expect(before.cells).toBe(grid.active_species * grid.active_traits);
      expect(beforeInactive.cells).toBe(grid.all_species * grid.all_traits);

      const { user } = await createUser(tx);
      const reference = await createReference(tx);
      const traitOne = await createTrait(tx, { levels: ['a'] });
      const traitTwo = await createTrait(tx, { levels: ['a'] });
      const traitOff = await createTrait(tx, { levels: ['a'], active: false });
      const speciesOne = await createSpecies(tx);
      const speciesTwo = await createSpecies(tx);
      const speciesOff = await createSpecies(tx);
      await tx.update(species).set({ active: false }).where(eq(species.id, speciesOff.id));

      // The newest decision decides, in both directions: accepted then cleared
      // does not count, cleared then accepted does (RFC-65 R11).
      const cell = async (
        speciesId: string,
        trait: { id: string; levels: { id: string; key: string }[] },
        decisions: ('accepted' | 'cleared')[],
      ) => {
        const record = await createRecord(tx, {
          speciesId,
          traitId: trait.id,
          valueText: 'a',
          levelId: trait.levels[0]?.id,
          primaryReferenceId: reference.id,
          origin: 'manual',
          createdBy: user.id,
        });
        for (const decision of decisions) {
          await createAcceptedValue(tx, {
            speciesId,
            traitId: trait.id,
            actorId: user.id,
            decision,
            recordId: decision === 'accepted' ? record.id : null,
          });
        }
      };
      await cell(speciesOne.id, traitOne, ['accepted']);
      await cell(speciesTwo.id, traitOne, ['accepted', 'cleared']);
      await cell(speciesOne.id, traitTwo, ['cleared', 'accepted']);
      await cell(speciesOff.id, traitOne, ['accepted']);
      await cell(speciesOne.id, traitOff, ['accepted']);

      const after = await computeCoverageTotals(tx, RESTRICTED);
      const afterInactive = await computeCoverageTotals(tx, UNRESTRICTED);

      // Two visible species and two visible traits were added; the inactive
      // species and the inactive trait widen only the unrestricted grid.
      expect(after.cells).toBe((grid.active_species + 2) * (grid.active_traits + 2));
      expect(afterInactive.cells).toBe((grid.all_species + 3) * (grid.all_traits + 3));
      expect(after.withData - before.withData).toBe(3);
      expect(afterInactive.withData - beforeInactive.withData).toBe(5);
      expect(after.accepted - before.accepted).toBe(2);
      expect(afterInactive.accepted - beforeInactive.accepted).toBe(4);
      // Both percentages are readings of the whole grid, never of `withData`
      // (`docs/specs/2026-09-17-workspace-design.md` §4 R1): the denominator
      // here is the cell count this test derived from the oracle, and the
      // arithmetic is written out rather than borrowed from the implementation
      // (the half-up rule itself is pinned in coverage.test.ts).
      const cells = (grid.active_species + 2) * (grid.active_traits + 2);
      expect([after.percentWithData, after.percentAccepted]).toEqual([
        Math.floor((after.withData * 200 + cells) / (cells * 2)),
        Math.floor((after.accepted * 200 + cells) / (cells * 2)),
      ]);
    });
  });
});

describe('RFC-69 R5 coverageTotals is cached for ten minutes', () => {
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
   * The entry semantics, on a key of this test's own. `coverage:totals:<u|r>`
   * is fixed and shared by every caller in the run (RFC-69 R5), and deleting
   * it to watch it refill opens a window another caller can win: it misses the
   * key this test just deleted, computes alongside it and `SET`s afterwards, so
   * the entry this test reads back is someone else's numbers and someone
   * else's `computedAt`. A random key takes this test out of that shared
   * resource entirely rather than narrowing the window. What it exercises is
   * the same `cachedJson` call `coverageTotals` delegates to, over the same
   * computation and the same ten-minute ttl; the test below pins the wrapper's
   * key convention against the real key, with assertions no other caller can
   * falsify.
   */
  it('answers the second call from the entry the first one stored, without recomputing', async () => {
    const key = `coverage:totals:test:${randomUUID()}`;
    let computed = 0;
    const compute = () => {
      computed += 1;
      return computeCoverageTotals(t.db, RESTRICTED);
    };
    try {
      const first = await cachedJson(redis, key, 600, compute);
      const second = await cachedJson(redis, key, 600, compute);
      expect(computed).toBe(1);
      expect(second.value).toEqual(first.value);
      expect(second.computedAt).toBe(first.computedAt);
      expect(await entryOf(redis, key)).toEqual(first);
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600);
    } finally {
      await forgetCached(redis, key);
    }
  });

  it('stores each viewer class under the key RFC-69 R5 names', async () => {
    // Nothing here is falsifiable by another caller computing the same fixed
    // key: a concurrent `cachedJson` on it writes the same shape with the same
    // ttl, and no caller anywhere deletes it. The key is never deleted here
    // either, so no window is opened for anyone else.
    const fields = ['accepted', 'cells', 'percentAccepted', 'percentWithData', 'withData'];
    for (const [visibility, key] of [
      [RESTRICTED, 'coverage:totals:r'],
      [UNRESTRICTED, 'coverage:totals:u'],
    ] as const) {
      const totals = await coverageTotals({ db: t.db, redis }, visibility);
      // The wrapper answers `cachedJson`'s `value`, not the entry around it.
      expect(Object.keys(totals).sort()).toEqual(fields);
      const entry = await entryOf(redis, key);
      expect(Object.keys(entry?.value ?? {}).sort()).toEqual(fields);
      expect(typeof entry?.computedAt).toBe('string');
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600);
    }
  });
});

/**
 * The fixture of plan 11c's task 2, verbatim: family F with species S1 and an
 * inactive S2, family G with S3; category C with trait T1 and an inactive T2,
 * category D with T3; coverage rows S1xT1, S1xT3, S3xT1 and one accepted pair,
 * S1xT1. The families, the categories, the traits and the plots are this
 * file's own (random names), so every number asserted over a filter that names
 * one of them is exact however many rows sibling test files commit.
 */
async function coverageFixture(tx: DbExecutor) {
  const { user } = await createUser(tx);
  const reference = await createReference(tx);
  const familyF = await createFamily(tx);
  const familyG = await createFamily(tx);
  const genusF = await createGenus(tx, { familyId: familyF.id });
  const genusG = await createGenus(tx, { familyId: familyG.id });
  const speciesOne = await createSpecies(tx, { genusId: genusF.id });
  const speciesTwo = await createSpecies(tx, { genusId: genusF.id });
  await tx.update(species).set({ active: false }).where(eq(species.id, speciesTwo.id));
  const speciesThree = await createSpecies(tx, { genusId: genusG.id });
  const categoryC = await createTraitCategory(tx);
  const categoryD = await createTraitCategory(tx);
  const traitOne = await createTrait(tx, { categoryKey: categoryC.key, levels: ['a'] });
  const traitTwo = await createTrait(tx, {
    categoryKey: categoryC.key,
    levels: ['a'],
    active: false,
  });
  const traitThree = await createTrait(tx, { categoryKey: categoryD.key, levels: ['a'] });

  const cell = async (
    speciesId: string,
    trait: { id: string; levels: { id: string; key: string }[] },
  ) =>
    createRecord(tx, {
      speciesId,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: user.id,
    });
  const acceptedRecord = await cell(speciesOne.id, traitOne);
  await cell(speciesOne.id, traitThree);
  await cell(speciesThree.id, traitOne);
  await createAcceptedValue(tx, {
    speciesId: speciesOne.id,
    traitId: traitOne.id,
    actorId: user.id,
    recordId: acceptedRecord.id,
    decision: 'accepted',
  });

  // Two plots: one holding the whole fixture, so a `plotId` filter selects
  // exactly S1, S2 and S3, and one holding S3 alone.
  const plotAll = await createPlot(tx);
  await addPlotSpecies(tx, plotAll.id, [speciesOne.id, speciesTwo.id, speciesThree.id]);
  const plotThree = await createPlot(tx);
  await addPlotSpecies(tx, plotThree.id, [speciesThree.id]);

  return {
    user,
    familyF,
    familyG,
    categoryC,
    categoryD,
    traitOne,
    traitTwo,
    traitThree,
    speciesOne,
    speciesTwo,
    speciesThree,
    plotAll,
    plotThree,
  };
}

/** `set transaction isolation level repeatable read`, checked to have bound. */
async function freezeSnapshot(tx: DbExecutor): Promise<void> {
  await tx.execute(sql`set transaction isolation level repeatable read`);
  const [isolation] = (await tx.execute(sql`show transaction_isolation`)) as unknown as [
    { transaction_isolation: string } | undefined,
  ];
  expect(isolation?.transaction_isolation).toBe('repeatable read');
}

describe('RFC-69 R5 coverageMetrics over the visible grid', () => {
  const t = useTestDb();

  it('adds the fixture cells, coverage rows and accepted pairs to the unfiltered grid', async () => {
    await withRollback(t.db, async (tx) => {
      // Unfiltered, the answer is dataset-wide and can only be asserted as a
      // delta around this file's own fixture; the frozen snapshot makes the
      // delta exact even while sibling suites commit (the same reasoning as
      // the `coverageTotals` test above).
      await freezeSnapshot(tx);
      const wideBefore = await computeCoverageMetrics(tx, UNRESTRICTED, {});
      const activeBefore = await computeCoverageMetrics(tx, RESTRICTED, {});
      await coverageFixture(tx);
      const wideAfter = await computeCoverageMetrics(tx, UNRESTRICTED, {});
      const activeAfter = await computeCoverageMetrics(tx, RESTRICTED, {});

      // Unrestricted: three species, three traits, nine new cells, the three
      // coverage rows and the one accepted pair.
      expect(wideAfter.species - wideBefore.species).toBe(3);
      expect(wideAfter.traits - wideBefore.traits).toBe(3);
      expect(wideAfter.cells).toBe((wideBefore.species + 3) * (wideBefore.traits + 3));
      expect(wideAfter.withData - wideBefore.withData).toBe(3);
      expect(wideAfter.accepted - wideBefore.accepted).toBe(1);

      // Restricted: the inactive species and the inactive trait leave the
      // grid, so two species and two traits are added — four cells — while all
      // three coverage rows stay, each joining an active species to an active
      // trait (S1xT1, S1xT3, S3xT1).
      expect(activeAfter.species - activeBefore.species).toBe(2);
      expect(activeAfter.traits - activeBefore.traits).toBe(2);
      expect(activeAfter.cells).toBe((activeBefore.species + 2) * (activeBefore.traits + 2));
      expect(activeAfter.withData - activeBefore.withData).toBe(3);
      expect(activeAfter.accepted - activeBefore.accepted).toBe(1);

      // Unfiltered, `coverageMetrics` and plan 11b's `coverageTotals` are the
      // same five numbers over the same grid, reached by different SQL: this
      // pins them together so a change to one cannot quietly diverge from the
      // other (both viewer classes, over this test's frozen snapshot).
      for (const [visibility, metrics] of [
        [UNRESTRICTED, wideAfter],
        [RESTRICTED, activeAfter],
      ] as const) {
        const totals = await computeCoverageTotals(tx, visibility);
        expect(totals).toEqual({
          cells: metrics.cells,
          withData: metrics.withData,
          accepted: metrics.accepted,
          percentWithData: metrics.percentWithData,
          percentAccepted: metrics.percentAccepted,
        });
      }
    });
  });

  it('answers exact totals, byCategory and byTrait rows over a selection of its own', async () => {
    await withRollback(t.db, async (tx) => {
      const f = await coverageFixture(tx);
      // `plotId` selects exactly S1, S2 and S3 and `categoryKey` exactly T1
      // and T2, so every number below is the fixture's alone: a 3 x 2 grid.
      const m = await computeCoverageMetrics(tx, UNRESTRICTED, {
        plotId: f.plotAll.id,
        categoryKey: f.categoryC.key,
      });
      expect(m).toMatchObject({
        species: 3,
        traits: 2,
        cells: 6,
        withData: 2,
        accepted: 1,
        percentWithData: 33,
        percentAccepted: 17,
      });

      // One category in the selection, with the same numbers as the totals.
      expect(m.byCategory).toEqual([
        {
          category: { key: f.categoryC.key, label: `Test category ${f.categoryC.key}` },
          traits: 2,
          cells: 6,
          withData: 2,
          accepted: 1,
          percentWithData: 33,
          percentAccepted: 17,
        },
      ]);

      // A byTrait row is one trait over the selected species, so its `cells`
      // is the species count (3) and its `species` is its own `withData`
      // (RFC-69 R5): T1 has data for S1 and S3 and one accepted pair, T2 for
      // none.
      const rowOf = (id: string) => m.byTrait.find((r) => r.trait.id === id);
      expect(m.byTrait).toHaveLength(2);
      expect(rowOf(f.traitOne.id)).toEqual({
        trait: {
          id: f.traitOne.id,
          key: f.traitOne.key,
          valueType: f.traitOne.valueType,
          unit: f.traitOne.unit,
        },
        category: { key: f.categoryC.key, label: `Test category ${f.categoryC.key}` },
        species: 2,
        cells: 3,
        withData: 2,
        accepted: 1,
        percentWithData: 67,
        percentAccepted: 33,
      });
      expect(rowOf(f.traitTwo.id)).toMatchObject({
        species: 0,
        cells: 3,
        withData: 0,
        accepted: 0,
        percentWithData: 0,
        percentAccepted: 0,
      });
    });
  });

  it('restricts the species by familyId and by plotId, and the traits by categoryKey', async () => {
    await withRollback(t.db, async (tx) => {
      const f = await coverageFixture(tx);

      // Family F holds S1 and the inactive S2; the two coverage rows and the
      // accepted pair of S1 are all inside it.
      const family = await computeCoverageMetrics(tx, UNRESTRICTED, { familyId: f.familyF.id });
      expect(family.species).toBe(2);
      expect(family.withData).toBe(2);
      expect(family.accepted).toBe(1);
      expect(family.cells).toBe(2 * family.traits);

      // The family filter and the active flag are conjuncts, not alternatives.
      const familyActive = await computeCoverageMetrics(tx, RESTRICTED, { familyId: f.familyF.id });
      expect(familyActive.species).toBe(1);
      expect(familyActive.withData).toBe(2);

      // Category C holds T1 and the inactive T2.
      const category = await computeCoverageMetrics(tx, UNRESTRICTED, {
        categoryKey: f.categoryC.key,
      });
      expect(category.traits).toBe(2);
      expect(category.byTrait.map((r) => r.trait.id).sort()).toEqual(
        [f.traitOne.id, f.traitTwo.id].sort(),
      );

      // The plot holding S3 alone.
      const plot = await computeCoverageMetrics(tx, UNRESTRICTED, { plotId: f.plotThree.id });
      expect(plot.species).toBe(1);
      expect(plot.withData).toBe(1);
      expect(plot.accepted).toBe(0);
    });
  });

  it('refuses a category key that is not a category, as the species list does', async () => {
    await withRollback(t.db, async (tx) => {
      await coverageFixture(tx);
      // The same code, path and message `speciesListConditions` raises for an
      // unknown `categoryKey` (RFC-60 R6), so the two filters answer a typo
      // alike instead of one 400 and one empty grid.
      await expect(
        computeCoverageMetrics(tx, UNRESTRICTED, {
          categoryKey: `no_such_category_${randomUUID()}`,
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        status: 400,
        details: [{ path: 'categoryKey', message: 'Unknown trait category' }],
      });
    });
  });

  it('answers an empty grid for a category that exists and holds no visible trait', async () => {
    await withRollback(t.db, async (tx) => {
      await coverageFixture(tx);
      const empty = await createTraitCategory(tx);
      const m = await computeCoverageMetrics(tx, UNRESTRICTED, { categoryKey: empty.key });
      expect(m).toMatchObject({
        traits: 0,
        cells: 0,
        withData: 0,
        accepted: 0,
        percentWithData: 0,
        percentAccepted: 0,
        byCategory: [],
        byTrait: [],
      });
      expect(m.species).toBeGreaterThan(0);
    });
  });

  it('refuses an unknown family or plot, and a plot the viewer is not assigned to', async () => {
    await withRollback(t.db, async (tx) => {
      const f = await coverageFixture(tx);
      await expect(
        computeCoverageMetrics(tx, UNRESTRICTED, { familyId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'FAMILY_NOT_FOUND', status: 404 });
      await expect(
        computeCoverageMetrics(tx, UNRESTRICTED, { plotId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'PLOT_NOT_FOUND', status: 404 });

      // A plot-bound viewer reads their own plot and is refused another's
      // (RFC-33 R6); the unknown plot is still a 404 for them, existence
      // first.
      const bound: Visibility = { inactive: false, plotIds: [f.plotThree.id] };
      await expect(
        computeCoverageMetrics(tx, bound, { plotId: f.plotAll.id }),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      await expect(
        computeCoverageMetrics(tx, bound, { plotId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'PLOT_NOT_FOUND', status: 404 });
      const own = await computeCoverageMetrics(tx, bound, { plotId: f.plotThree.id });
      expect(own.species).toBe(1);
      expect(own.withData).toBe(1);
    });
  });
});

describe('RFC-69 R7 coverageTop ranks the traits of the unfiltered grid', () => {
  const t = useTestDb();

  it('ranks by ascending withData for missing and by ascending percentAccepted for least_accepted', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const f = await coverageFixture(tx);
      const all = await computeCoverageMetrics(tx, UNRESTRICTED, {});

      // The ranking is over every visible trait in the database, so the items
      // are asserted as the `byTrait` rows of the unfiltered grid, in the
      // order the mode names — never as an absolute list.
      const missing = await coverageTop({ db: tx }, UNRESTRICTED, {
        mode: 'missing',
        limit: all.traits,
      });
      expect(missing).toHaveLength(all.traits);
      expect(missing.map((r) => r.withData)).toEqual(
        [...missing.map((r) => r.withData)].sort((a, b) => a - b),
      );
      const rank = (rows: typeof missing, id: string) => rows.findIndex((r) => r.trait.id === id);
      // T2 has data for none of the fixture's species, T3 for one: the emptier
      // trait ranks first.
      expect(rank(missing, f.traitTwo.id)).toBeGreaterThanOrEqual(0);
      expect(rank(missing, f.traitTwo.id)).toBeLessThan(rank(missing, f.traitThree.id));
      expect(missing.find((r) => r.trait.id === f.traitOne.id)).toEqual(
        all.byTrait.find((r) => r.trait.id === f.traitOne.id),
      );

      const least = await coverageTop({ db: tx }, UNRESTRICTED, {
        mode: 'least_accepted',
        limit: all.traits,
      });
      expect(least.map((r) => r.percentAccepted)).toEqual(
        [...least.map((r) => r.percentAccepted)].sort((a, b) => a - b),
      );
      expect(new Set(least.map((r) => r.trait.id))).toEqual(
        new Set(missing.map((r) => r.trait.id)),
      );

      // `limit` cuts the ranking, and `missing` is the default mode.
      const three = await coverageTop({ db: tx }, UNRESTRICTED, { limit: 3 });
      expect(three).toHaveLength(3);
      expect(three).toEqual(missing.slice(0, 3));
    });
  });
});

describe('RFC-69 R6 coverageMetrics is cached for ten minutes per viewer class and filter', () => {
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
   * Unlike `coverage:totals:<u|r>`, this key carries the filters, and the
   * filter used here is this test's own family: no sibling suite can name the
   * same random uuid, so the entry read back is the one this test wrote and
   * the assertions cannot be falsified by a concurrent caller.
   */
  it('answers the second call with the same filters from the entry the first one stored', async () => {
    await withRollback(t.db, async (tx) => {
      const f = await coverageFixture(tx);
      const key = `coverage:u:${f.familyF.id}:-:-`;
      try {
        const first = await coverageMetrics({ db: tx, redis }, UNRESTRICTED, {
          familyId: f.familyF.id,
        });
        const second = await coverageMetrics({ db: tx, redis }, UNRESTRICTED, {
          familyId: f.familyF.id,
        });
        expect(second).toEqual(first);
        expect(second.computedAt).toBe(first.computedAt);
        expect(first.species).toBe(2);
        const entry = await redis.get(key);
        expect(entry).not.toBeNull();
        const { computedAt, ...value } = first;
        expect(JSON.parse(entry ?? 'null')).toEqual({ value, computedAt });
        const ttl = await redis.ttl(key);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(600);

        // Another filter is another key, computed on its own.
        const other = await coverageMetrics({ db: tx, redis }, UNRESTRICTED, {
          familyId: f.familyG.id,
        });
        expect(other.species).toBe(1);
        expect(await redis.get(`coverage:u:${f.familyG.id}:-:-`)).not.toBeNull();
        // And so is the same filter read by the other viewer class.
        await coverageMetrics({ db: tx, redis }, RESTRICTED, { familyId: f.familyF.id });
        expect(await redis.get(`coverage:r:${f.familyF.id}:-:-`)).not.toBeNull();
      } finally {
        await forgetCached(
          redis,
          key,
          `coverage:u:${f.familyG.id}:-:-`,
          `coverage:r:${f.familyF.id}:-:-`,
        );
      }
    });
  });

  it('keeps a crafted category key off the entry of another filter set', async () => {
    await withRollback(t.db, async (tx) => {
      const f = await coverageFixture(tx);
      // A category key is free text (`coverageQuerySchema`) and a category may
      // be created with any key, so the two strings a key segment must survive
      // are the separator and the absent-filter sentinel. Unescaped, the first
      // is the key of category `x` scoped to that plot — a plot-scoped number
      // this viewer was never authorised for — and the second is the
      // unfiltered key, the entry every viewer of this class reads.
      const separator = await createTraitCategory(tx, { key: `x:${f.plotAll.id}` });
      const sentinel = await createTraitCategory(tx, { key: '-' });
      const separatorCollision = `coverage:u:-:x:${f.plotAll.id}:-`;
      const separatorKey = `coverage:u:-:${encodeURIComponent(separator.key)}:-`;
      // `coverage:u:-:-:-`, the unfiltered key, is what an unescaped `-`
      // would land on; the escaped one is a key of its own.
      const sentinelKey = 'coverage:u:-:%2D:-';
      try {
        const bySeparator = await coverageMetrics({ db: tx, redis }, UNRESTRICTED, {
          categoryKey: separator.key,
        });
        expect(bySeparator.traits).toBe(0);
        expect(await redis.get(separatorCollision)).toBeNull();
        expect(await redis.get(separatorKey)).not.toBeNull();

        const bySentinel = await coverageMetrics({ db: tx, redis }, UNRESTRICTED, {
          categoryKey: sentinel.key,
        });
        // The unfiltered entry is shared by every caller in the run, so it is
        // never asserted absent here (a sibling suite may hold it) and never
        // written from inside this rolled-back fixture. What is asserted is
        // that this call landed on a key of its own, holding its own answer:
        // no visible trait is in category `-`, while the unfiltered grid this
        // same transaction sees holds many.
        expect(bySentinel.traits).toBe(0);
        const stored = await redis.get(sentinelKey);
        expect(stored).not.toBeNull();
        const { computedAt, ...value } = bySentinel;
        expect(JSON.parse(stored ?? 'null')).toEqual({ value, computedAt });
        const unfiltered = await computeCoverageMetrics(tx, UNRESTRICTED, {});
        expect(unfiltered.traits).toBeGreaterThan(0);
      } finally {
        await forgetCached(redis, separatorCollision, separatorKey, sentinelKey);
      }
    });
  });
});
