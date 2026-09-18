import type { Dictionary } from '@treerepro/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
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

    const keysOf = (d: Dictionary) => d.flatMap((c) => c.traits).map((tr) => tr.key);

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

describe('RFC-62 R5 dictionary speciesCount', () => {
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
   * The map is served through `cachedJson` under a fixed key per viewer
   * class (RFC-62 R5), so every parallel test file that reads the dictionary
   * shares it. Forgetting it right before reading forces a fresh scan that
   * includes this test's own just-inserted rows; assertions only ever look
   * up this test's own trait id, never a total, so a sibling test's traits
   * in the same scan cannot break them.
   */
  async function forgetCounts() {
    await forgetCached(redis, 'dictionary:species-counts:u', 'dictionary:species-counts:r');
  }

  it('counts visible species with a species_trait_coverage row, cached 600s per viewer class', async () => {
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

    await forgetCounts();
    const unrestricted = await getDictionary({ db: t.db, redis }, UNRESTRICTED);
    const uTrait = unrestricted.flatMap((c) => c.traits).find((tr) => tr.id === trait.id);
    expect(uTrait?.speciesCount).toBe(2);

    const restricted = await getDictionary({ db: t.db, redis }, RESTRICTED);
    const rTrait = restricted.flatMap((c) => c.traits).find((tr) => tr.id === trait.id);
    expect(rTrait?.speciesCount).toBe(1);

    // Separate cache entries per viewer class, each with the RFC-62 R5 TTL.
    const uTtl = await redis.ttl('dictionary:species-counts:u');
    const rTtl = await redis.ttl('dictionary:species-counts:r');
    expect(uTtl).toBeGreaterThan(0);
    expect(uTtl).toBeLessThanOrEqual(600);
    expect(rTtl).toBeGreaterThan(0);
    expect(rTtl).toBeLessThanOrEqual(600);
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
});
