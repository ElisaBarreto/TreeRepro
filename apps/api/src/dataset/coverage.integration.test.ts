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
import { forgetCached } from '../redis/cache.ts';
import { createRedis, type Redis } from '../redis/client.ts';
import { computeCoverageTotals, coverageTotals, percentHalfUp } from './coverage.ts';

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
      expect(after.percentWithData).toBe(percentHalfUp(after.withData, after.cells));
      expect(after.percentAccepted).toBe(percentHalfUp(after.accepted, after.cells));
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

  it('answers the second call from the entry the first one stored', async () => {
    // Only the two readings are compared with each other, never with an
    // absolute number: `coverage:totals:r` is a fixed key shared by every
    // caller in the run (RFC-69 R5), so which caller computed the entry is not
    // this test's business — that it is not recomputed is.
    await forgetCached(redis, 'coverage:totals:r');
    const first = await coverageTotals({ db: t.db, redis }, RESTRICTED);
    const firstEntry = await entryOf(redis, 'coverage:totals:r');
    const second = await coverageTotals({ db: t.db, redis }, RESTRICTED);
    const secondEntry = await entryOf(redis, 'coverage:totals:r');
    expect(firstEntry?.value).toEqual(first);
    expect(second).toEqual(first);
    expect(secondEntry?.computedAt).toBe(firstEntry?.computedAt);
    const ttl = await redis.ttl('coverage:totals:r');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it('keys the unrestricted viewer class apart', async () => {
    await forgetCached(redis, 'coverage:totals:u');
    await coverageTotals({ db: t.db, redis }, UNRESTRICTED);
    expect(await entryOf(redis, 'coverage:totals:u')).not.toBeNull();
  });
});
