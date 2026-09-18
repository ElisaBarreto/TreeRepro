import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  addPlotSpecies,
  createAcceptedValue,
  createGenus,
  createPlot,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { traitCategories } from '../db/schema/dictionary.ts';
import { species } from '../db/schema/taxa.ts';
import { forgetCached } from '../redis/cache.ts';
import { createRedis, type Redis } from '../redis/client.ts';
import { ensurePersonalObservation } from './references.ts';
import { getTraitDetail, listTraitSpecies } from './trait-page.ts';

/** Both viewer classes of RFC-62 R7's distribution cache, for a `finally`. */
const cacheKeys = (traitId: string) => [
  `trait:${traitId}:distribution:u`,
  `trait:${traitId}:distribution:r`,
];

type Actor = { id: string };

/** The level of a trait this test file created, by key. */
function levelOf(trait: { levels: { id: string; key: string }[] }, key: string) {
  const level = trait.levels.find((l) => l.key === key);
  if (!level) throw new Error(`levelOf: ${key} is not a level of the trait`);
  return level;
}

async function record(
  db: DbExecutor,
  input: {
    actor: Actor;
    speciesId: string;
    traitId: string;
    valueText: string;
    levelId?: string;
    numericValue?: number;
    harmonisation?: 'harmonised' | 'not_numeric' | 'unknown_level';
    referenceId: string;
  },
) {
  return createRecord(db, {
    speciesId: input.speciesId,
    traitId: input.traitId,
    valueText: input.valueText,
    levelId: input.levelId,
    numericValue: input.numericValue,
    harmonisation: input.harmonisation,
    primaryReferenceId: input.referenceId,
    origin: 'manual',
    createdBy: input.actor.id,
  });
}

describe('RFC-62 R7 getTraitDetail', () => {
  const t = useTestDb();
  let redis: Redis;
  beforeAll(async () => {
    redis = createRedis(inject('redisUrl'));
    await redis.connect();
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('answers the trait with its category, the species that have it and the level distribution, most species first', async () => {
    const { user } = await createUser(t.db);
    const first = await createReference(t.db);
    const second = await createReference(t.db);
    const trait = await createTrait(t.db, {
      categoryKey: 'flower_color',
      levels: ['alpha', 'beta', 'gamma'],
    });
    const alpha = levelOf(trait, 'alpha');
    const beta = levelOf(trait, 'beta');
    const [one, two, three] = await Promise.all([
      createSpecies(t.db),
      createSpecies(t.db),
      createSpecies(t.db),
    ]);
    // `alpha`: three records over two species; `beta`: one record on a third;
    // `gamma`: no record at all, so it is absent from the distribution.
    await record(t.db, {
      actor: user,
      speciesId: one.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: alpha.id,
      referenceId: first.id,
    });
    await record(t.db, {
      actor: user,
      speciesId: one.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: alpha.id,
      referenceId: second.id,
    });
    await record(t.db, {
      actor: user,
      speciesId: two.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: alpha.id,
      referenceId: first.id,
    });
    await record(t.db, {
      actor: user,
      speciesId: three.id,
      traitId: trait.id,
      valueText: 'beta',
      levelId: beta.id,
      referenceId: first.id,
    });

    try {
      const detail = await getTraitDetail({ db: t.db, redis }, UNRESTRICTED, trait.id);
      const [category] = await t.db
        .select()
        .from(traitCategories)
        .where(eq(traitCategories.key, 'flower_color'));
      expect(detail?.id).toBe(trait.id);
      expect(detail?.category).toEqual({ key: 'flower_color', label: category?.label });
      expect(detail?.speciesWithData).toBe(3);
      expect(detail?.speciesMissing).toBeGreaterThanOrEqual(0);
      expect(detail?.acceptedCount).toBe(0);
      expect(detail?.distribution).toEqual({
        levels: [
          { level: { id: alpha.id, key: 'alpha' }, speciesCount: 2, recordCount: 3 },
          { level: { id: beta.id, key: 'beta' }, speciesCount: 1, recordCount: 1 },
        ],
      });
      expect(detail?.computedAt).toEqual(expect.any(String));
    } finally {
      await forgetCached(redis, ...cacheKeys(trait.id));
    }
  });

  it('counts the species whose current accepted value is on the trait, not every decision ever made', async () => {
    const { user } = await createUser(t.db);
    const reference = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['alpha'] });
    const alpha = levelOf(trait, 'alpha');
    const one = await createSpecies(t.db);
    const two = await createSpecies(t.db);
    const claim = { traitId: trait.id, valueText: 'alpha', levelId: alpha.id };
    const firstRecord = await record(t.db, {
      actor: user,
      speciesId: one.id,
      referenceId: reference.id,
      ...claim,
    });
    const secondRecord = await record(t.db, {
      actor: user,
      speciesId: two.id,
      referenceId: reference.id,
      ...claim,
    });

    try {
      const detail = async () => await getTraitDetail({ db: t.db, redis }, UNRESTRICTED, trait.id);
      expect((await detail())?.acceptedCount).toBe(0);

      await createAcceptedValue(t.db, {
        speciesId: one.id,
        traitId: trait.id,
        actorId: user.id,
        recordId: firstRecord.id,
      });
      await createAcceptedValue(t.db, {
        speciesId: two.id,
        traitId: trait.id,
        actorId: user.id,
        recordId: secondRecord.id,
      });
      expect((await detail())?.acceptedCount).toBe(2);

      // The newest decision for a species wins: clearing it takes that
      // species back out of the count.
      await createAcceptedValue(t.db, {
        speciesId: two.id,
        traitId: trait.id,
        actorId: user.id,
        decision: 'cleared',
      });
      expect((await detail())?.acceptedCount).toBe(1);
    } finally {
      await forgetCached(redis, ...cacheKeys(trait.id));
    }
  });

  it('drops one species from speciesMissing as soon as that species has a record', async () => {
    const { user } = await createUser(t.db);
    const reference = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['alpha'] });
    const alpha = levelOf(trait, 'alpha');
    const fourth = await createSpecies(t.db);

    try {
      // `speciesMissing` counts every visible active species without a record
      // on the trait, so sibling test files creating species of their own
      // could move it between two plain reads. One repeatable-read
      // transaction freezes the snapshot at its first statement: this test's
      // own writes are visible inside it, no one else's are, so "one more
      // species with data" is exactly "one fewer species missing".
      await t.db.transaction(
        async (tx) => {
          const before = await getTraitDetail({ db: tx, redis }, UNRESTRICTED, trait.id);
          expect(before?.speciesWithData).toBe(0);
          expect(before?.speciesMissing).toBeGreaterThan(0);

          await record(tx, {
            actor: user,
            speciesId: fourth.id,
            traitId: trait.id,
            valueText: 'alpha',
            levelId: alpha.id,
            referenceId: reference.id,
          });
          await forgetCached(redis, ...cacheKeys(trait.id));

          const after = await getTraitDetail({ db: tx, redis }, UNRESTRICTED, trait.id);
          expect(after?.speciesWithData).toBe(1);
          expect(after?.speciesMissing).toBe((before?.speciesMissing ?? 0) - 1);
        },
        { isolationLevel: 'repeatable read' },
      );
    } finally {
      await forgetCached(redis, ...cacheKeys(trait.id));
    }
  });

  it('counts one population on both sides: with-data plus missing is every visible species, inactive ones included', async () => {
    const { user } = await createUser(t.db);
    const reference = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['alpha'] });
    const alpha = levelOf(trait, 'alpha');
    // One species with a record on the trait; one with no record at all that
    // only a `dataset.read_inactive` viewer can see.
    const covered = await createSpecies(t.db);
    const hidden = await createSpecies(t.db);
    await t.db.update(species).set({ active: false }).where(eq(species.id, hidden.id));
    await record(t.db, {
      actor: user,
      speciesId: covered.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: alpha.id,
      referenceId: reference.id,
    });

    try {
      // Sibling test files create species continuously, so these totals are
      // only comparable inside one repeatable-read snapshot.
      await t.db.transaction(
        async (tx) => {
          const unrestricted = await getTraitDetail({ db: tx, redis }, UNRESTRICTED, trait.id);
          const [all] = (await tx.execute(
            sql`select count(*)::int as n from species`,
          )) as unknown as { n: number }[];
          // RFC-62 R7: both figures are over "visible species", so together
          // they account for every species this viewer sees — an inactive
          // species without a coverage row falls into neither otherwise.
          expect((unrestricted?.speciesWithData ?? 0) + (unrestricted?.speciesMissing ?? 0)).toBe(
            all?.n,
          );

          const [inactive] = (await tx.execute(
            sql`select count(*)::int as n from species where not active`,
          )) as unknown as { n: number }[];
          expect(inactive?.n).toBeGreaterThan(0);
          // A restricted viewer never sees an inactive species, so the whole
          // difference between the two viewers' missing counts is exactly
          // the inactive species — `hidden` among them.
          const restricted = await getTraitDetail({ db: tx, redis }, RESTRICTED, trait.id);
          expect((unrestricted?.speciesMissing ?? 0) - (restricted?.speciesMissing ?? 0)).toBe(
            inactive?.n,
          );
        },
        { isolationLevel: 'repeatable read' },
      );
    } finally {
      await forgetCached(redis, ...cacheKeys(trait.id));
    }
  });

  it('answers min, median and max over the harmonised numbers of a quantitative trait', async () => {
    const { user } = await createUser(t.db);
    const reference = await createReference(t.db);
    const trait = await createTrait(t.db, { valueType: 'quantitative', unit: 'mm' });
    const [one, two, three] = await Promise.all([
      createSpecies(t.db),
      createSpecies(t.db),
      createSpecies(t.db),
    ]);
    for (const [s, value] of [
      [one, 1],
      [two, 2],
      [three, 6],
    ] as const) {
      await record(t.db, {
        actor: user,
        speciesId: s.id,
        traitId: trait.id,
        valueText: String(value),
        numericValue: value,
        referenceId: reference.id,
      });
    }
    // Pending harmonisation (RFC-63 R5): it is a record of the trait, but it
    // carries no number, so it is outside the distribution.
    await record(t.db, {
      actor: user,
      speciesId: one.id,
      traitId: trait.id,
      valueText: 'tall',
      harmonisation: 'not_numeric',
      referenceId: reference.id,
    });

    try {
      const detail = await getTraitDetail({ db: t.db, redis }, UNRESTRICTED, trait.id);
      expect(detail?.distribution).toEqual({
        numeric: { min: 1, median: 2, max: 6, speciesCount: 3 },
      });
    } finally {
      await forgetCached(redis, ...cacheKeys(trait.id));
    }
  });

  it('answers a null numeric spread while no record of a quantitative trait is harmonised', async () => {
    const trait = await createTrait(t.db, { valueType: 'quantitative', unit: 'mm' });
    try {
      const detail = await getTraitDetail({ db: t.db, redis }, UNRESTRICTED, trait.id);
      expect(detail?.distribution).toEqual({ numeric: null });
      expect(detail?.speciesWithData).toBe(0);
    } finally {
      await forgetCached(redis, ...cacheKeys(trait.id));
    }
  });

  it('serves the distribution from the cache for ten minutes: the same computedAt until the key is forgotten', async () => {
    const trait = await createTrait(t.db, { levels: ['alpha'] });
    try {
      const first = await getTraitDetail({ db: t.db, redis }, UNRESTRICTED, trait.id);
      const second = await getTraitDetail({ db: t.db, redis }, UNRESTRICTED, trait.id);
      expect(second?.computedAt).toBe(first?.computedAt);

      await forgetCached(redis, `trait:${trait.id}:distribution:u`);
      const third = await getTraitDetail({ db: t.db, redis }, UNRESTRICTED, trait.id);
      expect(third?.computedAt).not.toBe(first?.computedAt);
    } finally {
      await forgetCached(redis, ...cacheKeys(trait.id));
    }
  });

  it('hides an inactive trait from a restricted viewer and leaves inactive species out of its numbers', async () => {
    const { user } = await createUser(t.db);
    const reference = await createReference(t.db);
    const inactiveTrait = await createTrait(t.db, { active: false });
    const trait = await createTrait(t.db, { levels: ['alpha'] });
    const alpha = levelOf(trait, 'alpha');
    const shown = await createSpecies(t.db);
    const hidden = await createSpecies(t.db);
    await t.db.update(species).set({ active: false }).where(eq(species.id, hidden.id));
    for (const s of [shown, hidden]) {
      await record(t.db, {
        actor: user,
        speciesId: s.id,
        traitId: trait.id,
        valueText: 'alpha',
        levelId: alpha.id,
        referenceId: reference.id,
      });
    }

    try {
      expect(await getTraitDetail({ db: t.db, redis }, RESTRICTED, inactiveTrait.id)).toBeNull();
      expect(
        await getTraitDetail({ db: t.db, redis }, UNRESTRICTED, inactiveTrait.id),
      ).not.toBeNull();

      const restricted = await getTraitDetail({ db: t.db, redis }, RESTRICTED, trait.id);
      expect(restricted?.speciesWithData).toBe(1);
      expect(restricted?.distribution).toEqual({
        levels: [{ level: { id: alpha.id, key: 'alpha' }, speciesCount: 1, recordCount: 1 }],
      });

      const unrestricted = await getTraitDetail({ db: t.db, redis }, UNRESTRICTED, trait.id);
      expect(unrestricted?.speciesWithData).toBe(2);
      expect(unrestricted?.distribution).toEqual({
        levels: [{ level: { id: alpha.id, key: 'alpha' }, speciesCount: 2, recordCount: 2 }],
      });
    } finally {
      await forgetCached(redis, ...cacheKeys(trait.id), ...cacheKeys(inactiveTrait.id));
    }
  });

  it('answers null for a trait that does not exist', async () => {
    expect(
      await getTraitDetail(
        { db: t.db, redis },
        UNRESTRICTED,
        '00000000-0000-7000-8000-000000000000',
      ),
    ).toBeNull();
  });

  it('counts globally: a plot-bound viewer sees the numbers of the whole dataset', async () => {
    const { user } = await createUser(t.db);
    const reference = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['alpha'] });
    const alpha = levelOf(trait, 'alpha');
    const plot = await createPlot(t.db);
    const inside = await createSpecies(t.db);
    const outside = await createSpecies(t.db);
    await addPlotSpecies(t.db, plot.id, [inside.id]);
    for (const s of [inside, outside]) {
      const written = await record(t.db, {
        actor: user,
        speciesId: s.id,
        traitId: trait.id,
        valueText: 'alpha',
        levelId: alpha.id,
        referenceId: reference.id,
      });
      // The only accepted value is on the species outside the plot.
      if (s === outside) {
        await createAcceptedValue(t.db, {
          speciesId: s.id,
          traitId: trait.id,
          actorId: user.id,
          recordId: written.id,
        });
      }
    }

    try {
      // RFC-62 R7: every number of the header is a global summary and a
      // plot-bound viewer reads the restricted cache class, so all of them
      // count the species outside their plots (the species lists of R8 do
      // not). The two reads share one repeatable-read snapshot: sibling test
      // files create species of their own, and `speciesMissing` counts every
      // one of them, so only a frozen snapshot makes the two viewers exactly
      // comparable.
      await t.db.transaction(
        async (tx) => {
          const plotBound = await getTraitDetail(
            { db: tx, redis },
            { inactive: false, plotIds: [plot.id] },
            trait.id,
          );
          expect(plotBound?.speciesWithData).toBe(2);
          expect(plotBound?.acceptedCount).toBe(1);
          expect(plotBound?.distribution).toEqual({
            levels: [{ level: { id: alpha.id, key: 'alpha' }, speciesCount: 2, recordCount: 2 }],
          });
          // Down to the last field, a plot-bound viewer's header is the
          // header of a restricted viewer with no plot restriction at all.
          const restricted = await getTraitDetail({ db: tx, redis }, RESTRICTED, trait.id);
          expect(plotBound).toEqual(restricted);
        },
        { isolationLevel: 'repeatable read' },
      );
    } finally {
      await forgetCached(redis, ...cacheKeys(trait.id));
    }
  });
});

describe('RFC-62 R8 listTraitSpecies', () => {
  const t = useTestDb();

  it('with: every species that has a record, its count, its accepted value and a summary of its records', async () => {
    const { user } = await createUser(t.db);
    const first = await createReference(t.db);
    const second = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['alpha', 'beta'] });
    const alpha = levelOf(trait, 'alpha');
    const beta = levelOf(trait, 'beta');
    const one = await createSpecies(t.db);
    const accepted = await record(t.db, {
      actor: user,
      speciesId: one.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: alpha.id,
      referenceId: first.id,
    });
    await record(t.db, {
      actor: user,
      speciesId: one.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: alpha.id,
      referenceId: second.id,
    });
    await record(t.db, {
      actor: user,
      speciesId: one.id,
      traitId: trait.id,
      valueText: 'beta',
      levelId: beta.id,
      referenceId: first.id,
    });
    // Pending harmonisation: counted as a record, absent from the summary.
    await record(t.db, {
      actor: user,
      speciesId: one.id,
      traitId: trait.id,
      valueText: 'purple',
      harmonisation: 'unknown_level',
      referenceId: first.id,
    });
    await createAcceptedValue(t.db, {
      speciesId: one.id,
      traitId: trait.id,
      actorId: user.id,
      recordId: accepted.id,
    });

    const { data } = await listTraitSpecies(t.db, UNRESTRICTED, trait.id, {
      mode: 'with',
      limit: 50,
    });
    expect(data.map((s) => s.id)).toEqual([one.id]);
    expect(data[0]).toMatchObject({
      canonicalName: one.canonicalName,
      recordCount: 4,
      accepted: {
        recordId: accepted.id,
        valueText: 'alpha',
        reference: {
          id: first.id,
          citationKey: first.citationKey,
          shortCitation: null,
          kind: 'publication',
        },
      },
      summary: {
        levels: [
          { key: 'alpha', count: 2 },
          { key: 'beta', count: 1 },
        ],
      },
    });
  });

  it('RFC-61 R4, R7 with: an accepted value from a personal observation carries its observer, decrypted', async () => {
    const { user } = await createUser(t.db);
    const { user: observer } = await createUser(t.db, {
      name: `Observer-${Math.random().toString(16).slice(2)}`,
    });
    const observation = await ensurePersonalObservation(t.db, observer.id);
    const trait = await createTrait(t.db, { levels: ['alpha'] });
    const alpha = levelOf(trait, 'alpha');
    const one = await createSpecies(t.db);
    const accepted = await record(t.db, {
      actor: user,
      speciesId: one.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: alpha.id,
      referenceId: observation.id,
    });
    await createAcceptedValue(t.db, {
      speciesId: one.id,
      traitId: trait.id,
      actorId: user.id,
      recordId: accepted.id,
    });

    const { data } = await listTraitSpecies(t.db, UNRESTRICTED, trait.id, {
      mode: 'with',
      limit: 50,
    });
    expect(data.find((s) => s.id === one.id)?.accepted).toEqual({
      recordId: accepted.id,
      valueText: 'alpha',
      reference: {
        id: observation.id,
        citationKey: `personal-observation:${observer.id}`,
        kind: 'personal_observation',
        observer: { id: observer.id, name: observer.name },
        shortCitation: null,
      },
    });
  });

  it('with: a species no curator has decided on carries a null accepted value and a numeric summary', async () => {
    const { user } = await createUser(t.db);
    const reference = await createReference(t.db);
    const trait = await createTrait(t.db, { valueType: 'quantitative', unit: 'mm' });
    const one = await createSpecies(t.db);
    for (const value of [2, 7]) {
      await record(t.db, {
        actor: user,
        speciesId: one.id,
        traitId: trait.id,
        valueText: String(value),
        numericValue: value,
        referenceId: reference.id,
      });
    }

    const { data } = await listTraitSpecies(t.db, UNRESTRICTED, trait.id, {
      mode: 'with',
      limit: 50,
    });
    expect(data[0]).toMatchObject({
      id: one.id,
      recordCount: 2,
      accepted: null,
      summary: { numeric: { min: 2, max: 7 } },
    });
  });

  it('missing: the species with no record on the trait, with nothing to count or summarise', async () => {
    const { user } = await createUser(t.db);
    const reference = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['alpha'] });
    const alpha = levelOf(trait, 'alpha');
    const genus = await createGenus(t.db);
    const withData = await createSpecies(t.db, { genusId: genus.id });
    const without = await createSpecies(t.db, { genusId: genus.id });
    await record(t.db, {
      actor: user,
      speciesId: withData.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: alpha.id,
      referenceId: reference.id,
    });

    // The genus filter keeps the answer to this test's own species: without
    // it, `missing` is every species in the database.
    const { data } = await listTraitSpecies(t.db, UNRESTRICTED, trait.id, {
      mode: 'missing',
      genusId: genus.id,
      limit: 50,
    });
    expect(data.map((s) => s.id)).toEqual([without.id]);
    expect(data[0]).toMatchObject({ recordCount: null, accepted: null, summary: null });
  });

  it('is plot-scoped in both modes: a plot-bound viewer browses only their own plots', async () => {
    const { user } = await createUser(t.db);
    const reference = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['alpha'] });
    const alpha = levelOf(trait, 'alpha');
    const genus = await createGenus(t.db);
    const plot = await createPlot(t.db);
    const insideWith = await createSpecies(t.db, { genusId: genus.id });
    const outsideWith = await createSpecies(t.db, { genusId: genus.id });
    const insideMissing = await createSpecies(t.db, { genusId: genus.id });
    const outsideMissing = await createSpecies(t.db, { genusId: genus.id });
    await addPlotSpecies(t.db, plot.id, [insideWith.id, insideMissing.id]);
    for (const s of [insideWith, outsideWith]) {
      await record(t.db, {
        actor: user,
        speciesId: s.id,
        traitId: trait.id,
        valueText: 'alpha',
        levelId: alpha.id,
        referenceId: reference.id,
      });
    }

    const plotBound = { inactive: false, plotIds: [plot.id] };
    const withData = await listTraitSpecies(t.db, plotBound, trait.id, {
      mode: 'with',
      viewerPlotIds: [plot.id],
      limit: 50,
    });
    expect(withData.data.map((s) => s.id)).toEqual([insideWith.id]);
    expect(withData.data.map((s) => s.id)).not.toContain(outsideWith.id);

    const missing = await listTraitSpecies(t.db, plotBound, trait.id, {
      mode: 'missing',
      genusId: genus.id,
      viewerPlotIds: [plot.id],
      limit: 50,
    });
    expect(missing.data.map((s) => s.id)).toEqual([insideMissing.id]);
    expect(missing.data.map((s) => s.id)).not.toContain(outsideMissing.id);
  });

  it('pages in the order of the species list, without dropping or repeating a species', async () => {
    const { user } = await createUser(t.db);
    const reference = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['alpha'] });
    const alpha = levelOf(trait, 'alpha');
    const names = ['Aaa', 'Bbb', 'Ccc'].map((p) => `${p} ${Math.random().toString(16).slice(2)}`);
    const created = [];
    for (const canonicalName of names) {
      const s = await createSpecies(t.db, { canonicalName });
      created.push(s);
      await record(t.db, {
        actor: user,
        speciesId: s.id,
        traitId: trait.id,
        valueText: 'alpha',
        levelId: alpha.id,
        referenceId: reference.id,
      });
    }

    const first = await listTraitSpecies(t.db, UNRESTRICTED, trait.id, { mode: 'with', limit: 2 });
    expect(first.data.map((s) => s.canonicalName)).toEqual([names[0], names[1]]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await listTraitSpecies(t.db, UNRESTRICTED, trait.id, {
      mode: 'with',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.data.map((s) => s.canonicalName)).toEqual([names[2]]);
    expect(second.nextCursor).toBeNull();
    // Every page carries its enrichment, not only the first.
    expect(second.data[0]?.recordCount).toBe(1);
  });

  it('throws TRAIT_NOT_FOUND for a trait the viewer cannot see', async () => {
    const trait = await createTrait(t.db, { active: false });
    await expect(
      listTraitSpecies(t.db, RESTRICTED, trait.id, { mode: 'with', limit: 50 }),
    ).rejects.toMatchObject({ code: 'TRAIT_NOT_FOUND' });
  });
});
