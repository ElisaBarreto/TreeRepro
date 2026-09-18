import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  createAcceptedValue,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { useTestDb, withRollback } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { species } from '../db/schema/taxa.ts';
import { cachedJson, forgetCached } from '../redis/cache.ts';
import { createRedis, type Redis } from '../redis/client.ts';
import { computeCoverageTotals, coverageTotals } from './coverage.ts';

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
