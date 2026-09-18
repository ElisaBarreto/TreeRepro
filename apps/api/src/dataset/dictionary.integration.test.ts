import type { Dictionary } from '@treerepro/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  addPlotSpecies,
  createPlot,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import type { Visibility } from '../access/visibility.ts';
import { traitCategories, traitLevels, traits } from '../db/schema/dictionary.ts';
import { species } from '../db/schema/taxa.ts';
import { forgetCached } from '../redis/cache.ts';
import { createRedis, type Redis } from '../redis/client.ts';
import { getDictionary, getTrait } from './dictionary.ts';

describe('RFC-62 R5 getDictionary', () => {
  const t = useTestDb();
  let redis: Redis;
  beforeAll(async () => {
    redis = createRedis(inject('redisUrl'));
    await redis.connect();
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('groups traits by category in dictionary order with their levels', async () => {
    const dictionary = await getDictionary({ db: t.db, redis }, UNRESTRICTED);
    expect(dictionary[0]?.key).toBe('dispersal');
    const flower = dictionary.find((c) => c.key === 'flower_color');
    const trait = flower?.traits.find((tr) => tr.key === 'flower_color');
    expect(trait).toMatchObject({ valueType: 'categorical', unit: null, active: true });
    // The seed script numbers levels with SQL `with ordinality`, which is 1-based.
    expect(trait?.levels[0]).toMatchObject({ key: 'black', sortOrder: 1, active: true });
    expect(trait?.levels.map((l) => l.key)).toContain('yellow');
    const keys = flower?.traits.map((tr) => tr.key) ?? [];
    expect(keys).toEqual([...keys].sort());
  });
});

describe('RFC-33 R3, RFC-62 R5 dictionary by viewer', () => {
  const t = useTestDb();
  let redis: Redis;
  beforeAll(async () => {
    redis = createRedis(inject('redisUrl'));
    await redis.connect();
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('omits an inactive trait and inactive levels for a restricted viewer', async () => {
    const trait = await createTrait(t.db, { levels: ['on', 'off'] });
    const offLevel = trait.levels[1] as { id: string };
    await t.db.update(traitLevels).set({ active: false }).where(eq(traitLevels.id, offLevel.id));
    const inactive = await createTrait(t.db, { active: false });
    const flat = (d: Dictionary) => d.flatMap((c) => c.traits);
    const restricted = flat(await getDictionary({ db: t.db, redis }, RESTRICTED));
    expect(restricted.find((x) => x.id === inactive.id)).toBeUndefined();
    expect(restricted.find((x) => x.id === trait.id)?.levels.map((l) => l.key)).toEqual(['on']);
    const unrestricted = flat(await getDictionary({ db: t.db, redis }, UNRESTRICTED));
    expect(unrestricted.find((x) => x.id === inactive.id)?.active).toBe(false);
    expect(unrestricted.find((x) => x.id === trait.id)?.levels).toHaveLength(2);
    expect(await getTrait(t.db, RESTRICTED, inactive.id)).toBeNull();
  });
});

describe('RFC-62 R5 dictionary filters', () => {
  const t = useTestDb();
  let redis: Redis;
  beforeAll(async () => {
    redis = createRedis(inject('redisUrl'));
    await redis.connect();
  });
  afterAll(async () => {
    await redis.quit();
  });

  const keysOf = (d: Dictionary) => d.flatMap((c) => c.traits).map((tr) => tr.key);

  it('filters by categoryKey, valueType, and a case-insensitive q on key or description', async () => {
    const suffix = Math.random().toString(16).slice(2);
    const alphaKey = `filter_alpha_${suffix}`;
    const betaKey = `filter_beta_${suffix}`;
    const alpha = await createTrait(t.db, {
      key: alphaKey,
      categoryKey: 'flower_color',
      valueType: 'categorical',
    });
    await t.db
      .update(traits)
      .set({ description: `Alpha marker ${suffix}` })
      .where(eq(traits.id, alpha.id));
    await createTrait(t.db, {
      key: betaKey,
      categoryKey: 'plant_form',
      valueType: 'quantitative',
    });

    const byCategory = await getDictionary({ db: t.db, redis }, UNRESTRICTED, {
      categoryKey: 'flower_color',
    });
    expect(keysOf(byCategory)).toContain(alphaKey);
    expect(keysOf(byCategory)).not.toContain(betaKey);

    const byValueType = await getDictionary({ db: t.db, redis }, UNRESTRICTED, {
      valueType: 'quantitative',
    });
    expect(keysOf(byValueType)).toContain(betaKey);
    expect(keysOf(byValueType)).not.toContain(alphaKey);

    const byKeySubstring = await getDictionary({ db: t.db, redis }, UNRESTRICTED, {
      q: alphaKey.toUpperCase(),
    });
    expect(keysOf(byKeySubstring)).toEqual([alphaKey]);

    const byDescriptionSubstring = await getDictionary({ db: t.db, redis }, UNRESTRICTED, {
      q: `MARKER ${suffix}`,
    });
    expect(keysOf(byDescriptionSubstring)).toEqual([alphaKey]);
  });

  it('ANDs categoryKey, valueType and q together rather than ORing them', async () => {
    const suffix = Math.random().toString(16).slice(2);
    const qTerm = `and_target_${suffix}`;
    // Matches all three conditions.
    const target = await createTrait(t.db, {
      key: qTerm,
      categoryKey: 'flower_color',
      valueType: 'categorical',
    });
    // Matches categoryKey and q, wrong valueType.
    await createTrait(t.db, {
      key: `${qTerm}_wrong_value_type`,
      categoryKey: 'flower_color',
      valueType: 'quantitative',
    });
    // Matches valueType and q, wrong categoryKey.
    await createTrait(t.db, {
      key: `${qTerm}_wrong_category`,
      categoryKey: 'plant_form',
      valueType: 'categorical',
    });
    // Matches categoryKey and valueType, wrong q.
    await createTrait(t.db, {
      key: `unrelated_${suffix}`,
      categoryKey: 'flower_color',
      valueType: 'categorical',
    });

    const dictionary = await getDictionary({ db: t.db, redis }, UNRESTRICTED, {
      categoryKey: 'flower_color',
      valueType: 'categorical',
      q: qTerm,
    });
    // If the predicate ORed instead of ANDed, every one of the four traits
    // above would satisfy at least one condition and all would appear.
    expect(keysOf(dictionary)).toEqual([target.key]);
  });
});

describe('RFC-62 R5 dictionary filters prune empty categories', () => {
  const t = useTestDb();
  let redis: Redis;
  beforeAll(async () => {
    redis = createRedis(inject('redisUrl'));
    await redis.connect();
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('once a filter is applied, a category it empties out is pruned from the answer', async () => {
    const own = await createTrait(t.db, { categoryKey: 'flower_color' });
    const dictionary = await getDictionary({ db: t.db, redis }, UNRESTRICTED, {
      categoryKey: 'flower_color',
    });
    // Every category other than flower_color has none of its traits match
    // the categoryKey filter, so it is pruned outright rather than kept
    // with an empty traits array.
    expect(dictionary.map((c) => c.key)).toEqual(['flower_color']);
    expect(dictionary[0]?.traits.some((tr) => tr.id === own.id)).toBe(true);
  });

  it('without a filter, a category with no visible traits still appears, unchanged', async () => {
    const key = `test_category_${Math.random().toString(16).slice(2)}`;
    await t.db.insert(traitCategories).values({ key, label: 'Test category', sortOrder: 999 });
    const dictionary = await getDictionary({ db: t.db, redis }, UNRESTRICTED);
    const category = dictionary.find((c) => c.key === key);
    expect(category).toMatchObject({ key, label: 'Test category', traits: [] });
  });
});

describe('RFC-62 R5 dictionary speciesCount is read from the cache', () => {
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
   * `dictionary:species-counts:<u|r>` is a fixed key (RFC-62 R5), shared by
   * every parallel test and route call that reads the dictionary in this
   * run, and `cachedJson` stores the whole per-viewer-class map as one blob.
   * Two things follow:
   *
   * 1. `forgetCached`-then-read raced a sibling's own scan for that same key
   *    (a sibling could win the miss→scan→write cycle between the forget and
   *    the read, so the read's "hit" would be someone else's value, not this
   *    test's) — so this seeds the key directly instead.
   * 2. A seed must never be a bare single-trait entry: since the whole map
   *    is one blob, a bare entry would silently replace every other trait's
   *    count with an implicit 0 for up to the 10-minute TTL, corrupting any
   *    concurrent reader in the same viewer class. `visibility` first
   *    ensures the key holds a real, complete map (computed fresh, or
   *    already warm from an earlier test — either way every trait but this
   *    one keeps its true count); only then is this test's trait id
   *    overridden with the sentinel and the *whole* map written back. The
   *    key is deleted once `fn` settles, in a `finally`, so neither a
   *    passing nor a failing assertion leaves the seed behind — the window
   *    is bounded to this call, not the TTL, and the next reader just gets
   *    an ordinary cache miss (a real rescan, never corrupted data).
   */
  async function withSeededCount(
    visibility: Visibility,
    key: string,
    traitId: string,
    sentinel: number,
    fn: () => Promise<void>,
  ): Promise<void> {
    await getDictionary({ db: t.db, redis }, visibility); // ensures `key` holds a real map
    const cached = await redis.get(key);
    const entry = cached
      ? (JSON.parse(cached) as { value: [string, number][]; computedAt: string })
      : { value: [] as [string, number][], computedAt: new Date().toISOString() };
    const map = new Map(entry.value);
    map.set(traitId, sentinel);
    await redis.set(
      key,
      JSON.stringify({ value: [...map], computedAt: entry.computedAt }),
      'EX',
      600,
    );
    try {
      await fn();
    } finally {
      await redis.del(key);
    }
  }

  it('attaches the exact cached number to its trait, per viewer class, without disturbing any other trait', async () => {
    const trait = await createTrait(t.db);
    const uSentinel = 111111;
    const rSentinel = 222222;

    // A second trait with a real, known, non-zero coverage count: if the
    // seed replaced the whole map instead of merging into it, this trait's
    // count would silently read back as 0 instead of 1.
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const other = await createTrait(t.db);
    const otherSpecies = await createSpecies(t.db);
    await createRecord(t.db, {
      speciesId: otherSpecies.id,
      traitId: other.id,
      valueText: other.levels[0]?.key ?? 'x',
      levelId: other.levels[0]?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    // The one place this file forces a rescan: `other`'s coverage row is
    // already committed by this point, so whichever caller's scan runs next
    // (this test's or a sibling's) is guaranteed to see it — unlike the
    // forget-then-assert-an-exact-value pattern this replaces elsewhere,
    // nothing here depends on winning a race for a *specific* computedAt.
    await forgetCached(redis, 'dictionary:species-counts:u');

    await withSeededCount(
      UNRESTRICTED,
      'dictionary:species-counts:u',
      trait.id,
      uSentinel,
      async () => {
        const unrestricted = await getDictionary({ db: t.db, redis }, UNRESTRICTED);
        const traits = unrestricted.flatMap((c) => c.traits);
        expect(traits.find((tr) => tr.id === trait.id)?.speciesCount).toBe(uSentinel);
        // The other trait keeps its own true count: the seed merged into the
        // real map rather than replacing it wholesale.
        expect(traits.find((tr) => tr.id === other.id)?.speciesCount).toBe(1);
      },
    );

    await withSeededCount(
      RESTRICTED,
      'dictionary:species-counts:r',
      trait.id,
      rSentinel,
      async () => {
        const restricted = await getDictionary({ db: t.db, redis }, RESTRICTED);
        expect(
          restricted.flatMap((c) => c.traits).find((tr) => tr.id === trait.id)?.speciesCount,
        ).toBe(rSentinel);
      },
    );

    // The seed does not outlive the call it served. The key itself cannot be
    // asserted absent: it is fixed and shared (RFC-62 R5), and every sibling
    // reading `GET /api/traits` repopulates it — legitimately — between the
    // `finally` above and this line. What must be gone is the *sentinel*, and
    // no other test ever writes one, so whatever comes back here is a real
    // count: this trait has no coverage row, so it is 0.
    const countOf = (d: Dictionary) =>
      d.flatMap((c) => c.traits).find((tr) => tr.id === trait.id)?.speciesCount;
    const afterUnrestricted = countOf(await getDictionary({ db: t.db, redis }, UNRESTRICTED));
    expect(afterUnrestricted).not.toBe(uSentinel);
    expect(afterUnrestricted).toBe(0);
    const afterRestricted = countOf(await getDictionary({ db: t.db, redis }, RESTRICTED));
    expect(afterRestricted).not.toBe(rSentinel);
    expect(afterRestricted).toBe(0);
  });
});

describe('RFC-62 R5 getTrait speciesCount', () => {
  const t = useTestDb();

  it('counts visible species directly (no cache): every insert shows up on the next call', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db);
    const level = trait.levels[0]?.id as string;
    const levelKey = trait.levels[0]?.key as string;
    const activeSpecies = await createSpecies(t.db);
    const inactiveSpecies = await createSpecies(t.db);
    await t.db.update(species).set({ active: false }).where(eq(species.id, inactiveSpecies.id));
    for (const speciesId of [activeSpecies.id, inactiveSpecies.id]) {
      await createRecord(t.db, {
        speciesId,
        traitId: trait.id,
        valueText: levelKey,
        levelId: level,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
    }

    expect((await getTrait(t.db, UNRESTRICTED, trait.id))?.speciesCount).toBe(2);
    expect((await getTrait(t.db, RESTRICTED, trait.id))?.speciesCount).toBe(1);

    const anotherSpecies = await createSpecies(t.db);
    await createRecord(t.db, {
      speciesId: anotherSpecies.id,
      traitId: trait.id,
      valueText: levelKey,
      levelId: level,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    expect((await getTrait(t.db, UNRESTRICTED, trait.id))?.speciesCount).toBe(3);
  });

  it('is plot-blind: a plot-bound viewer counts species outside their plots too', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db);
    const level = trait.levels[0]?.id as string;
    const levelKey = trait.levels[0]?.key as string;
    const plot = await createPlot(t.db);
    const insidePlot = await createSpecies(t.db);
    const outsidePlot = await createSpecies(t.db);
    await addPlotSpecies(t.db, plot.id, [insidePlot.id]);
    for (const speciesId of [insidePlot.id, outsidePlot.id]) {
      await createRecord(t.db, {
        speciesId,
        traitId: trait.id,
        valueText: levelKey,
        levelId: level,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
    }

    const plotBound = { inactive: false, plotIds: [plot.id] };
    // A viewer bound to `plot` (which contains only `insidePlot`) still
    // counts `outsidePlot`, and gets the same number as a restricted viewer
    // with no plot restriction at all: speciesCount is a global summary
    // (RFC-62 R5), not scoped to the plots this particular viewer can see.
    expect((await getTrait(t.db, plotBound, trait.id))?.speciesCount).toBe(2);
    expect((await getTrait(t.db, RESTRICTED, trait.id))?.speciesCount).toBe(2);
  });
});
