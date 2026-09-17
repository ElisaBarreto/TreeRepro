import { describe, expect, it } from 'vitest';
import {
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  createVisibilityFixture,
  levelByKey,
  traitByKey,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { acceptedValues } from '../db/schema/curation.ts';
import { speciesTraitSummary } from './summary.ts';

describe('RFC-63 R10 speciesTraitSummary', () => {
  const t = useTestDb();

  it('aggregates per category and trait: counts, levels, numeric stats, accepted value', async () => {
    const sp1 = await createSpecies(t.db);
    const color = await traitByKey(t.db, 'flower_color');
    const blue = await levelByKey(t.db, color.id, 'blue');
    const red = await levelByKey(t.db, color.id, 'red');
    const petal = await traitByKey(t.db, 'petal_length');
    const ref = await createReference(t.db);
    const batch = await createImportBatch(t.db);
    const { user } = await createUser(t.db);
    const b1 = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: color.id,
      valueText: 'blue',
      levelId: blue.id,
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: color.id,
      valueText: 'blue',
      levelId: blue.id,
      rawValue: 'BLUE',
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: color.id,
      valueText: 'red',
      levelId: red.id,
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: color.id,
      valueText: 'blue;red',
      harmonisation: 'multi_value',
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    for (const v of [1, 2, 4]) {
      await createRecord(t.db, {
        speciesId: sp1.id,
        traitId: petal.id,
        valueText: String(v),
        numericValue: v,
        primaryReferenceId: ref.id,
        importBatchId: batch.id,
      });
    }
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: petal.id,
      valueText: 'long',
      harmonisation: 'not_numeric',
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    await t.db.insert(acceptedValues).values({
      speciesId: sp1.id,
      traitId: color.id,
      recordId: b1.id,
      decision: 'accepted',
      actorId: user.id,
    });

    const summary = await speciesTraitSummary(t.db, UNRESTRICTED, sp1.id);
    expect(summary?.map((c) => c.category.key)).toEqual(['flower', 'flower_color']);
    const colorSummary = summary?.[1]?.traits[0];
    expect(colorSummary).toEqual({
      trait: { id: color.id, key: 'flower_color', valueType: 'categorical', unit: null },
      recordCount: 4,
      harmonisationCounts: {
        harmonised: 3,
        unknownLevel: 0,
        multiValue: 1,
        notNumeric: 0,
        empty: 0,
      },
      levels: [
        { levelId: blue.id, key: 'blue', count: 2 },
        { levelId: red.id, key: 'red', count: 1 },
      ],
      numeric: null,
      accepted: { recordId: b1.id, valueText: 'blue', decidedAt: expect.any(String) },
    });
    const petalSummary = summary?.[0]?.traits.find((tr) => tr.trait.key === 'petal_length');
    expect(petalSummary).toMatchObject({
      recordCount: 4,
      harmonisationCounts: { harmonised: 3, notNumeric: 1 },
      levels: null,
      numeric: { min: 1, median: 2, max: 4, count: 3 },
      accepted: null,
    });
    await t.db
      .insert(acceptedValues)
      .values({ speciesId: sp1.id, traitId: color.id, decision: 'cleared', actorId: user.id });
    expect(
      (await speciesTraitSummary(t.db, UNRESTRICTED, sp1.id))?.[1]?.traits[0]?.accepted,
    ).toBeNull();
    expect(await speciesTraitSummary(t.db, UNRESTRICTED, (await createSpecies(t.db)).id)).toEqual(
      [],
    );
  });

  it('RFC-33 R3 omits the inactive trait and answers null for the hidden species to a restricted viewer', async () => {
    const { user } = await createUser(t.db);
    const f = await createVisibilityFixture(t.db, user.id);
    const restricted = await speciesTraitSummary(t.db, RESTRICTED, f.shownSpecies.id);
    expect(restricted?.flatMap((c) => c.traits).map((x) => x.trait.id)).toEqual([f.activeTrait.id]);
    expect(await speciesTraitSummary(t.db, RESTRICTED, f.hiddenSpecies.id)).toBeNull();
    const unrestricted = await speciesTraitSummary(t.db, UNRESTRICTED, f.shownSpecies.id);
    expect(unrestricted?.flatMap((c) => c.traits)).toHaveLength(2);
  });

  it('RFC-70 R7 includeMissing lists every visible trait, with empty summaries for missing ones', async () => {
    const { user } = await createUser(t.db);
    // The fixture already carries one visible record on the active trait of
    // the shown species, and one on its inactive trait.
    const f = await createVisibilityFixture(t.db, user.id);

    // Without `includeMissing` only the traits with records show up: both of
    // the fixture's traits to an unrestricted viewer, the active one alone to
    // a restricted one (RFC-33 R3).
    const defaultSum = await speciesTraitSummary(t.db, UNRESTRICTED, f.shownSpecies.id);
    expect(
      defaultSum
        ?.flatMap((c) => c.traits)
        .map((x) => x.trait.id)
        .sort(),
    ).toEqual([f.activeTrait.id, f.inactiveTrait.id].sort());
    const defaultRestricted = await speciesTraitSummary(t.db, RESTRICTED, f.shownSpecies.id);
    expect(defaultRestricted?.flatMap((c) => c.traits).map((x) => x.trait.id)).toEqual([
      f.activeTrait.id,
    ]);

    // `includeMissing` walks the whole dictionary instead, so every trait the
    // viewer may see appears, with an empty summary when it has no record.
    const restricted = await speciesTraitSummary(t.db, RESTRICTED, f.shownSpecies.id, {
      includeMissing: true,
    });
    const restrictedTraits = restricted?.flatMap((c) => c.traits) ?? [];
    const restrictedIds = restrictedTraits.map((x) => x.trait.id);
    expect(restrictedIds).toContain(f.activeTrait.id);
    // RFC-33 R3: the inactive trait stays hidden from a restricted viewer.
    expect(restrictedIds).not.toContain(f.inactiveTrait.id);
    expect(restrictedIds.length).toBeGreaterThan(1);
    expect(restrictedTraits.find((x) => x.trait.id === f.activeTrait.id)?.recordCount).toBe(1);
    // Dictionary order: categories keep the order `getDictionary` answers in.
    expect(restricted?.map((c) => c.category.key)).toEqual([
      ...new Set(restricted?.map((c) => c.category.key)),
    ]);

    const unrestricted = await speciesTraitSummary(t.db, UNRESTRICTED, f.shownSpecies.id, {
      includeMissing: true,
    });
    const unrestrictedTraits = unrestricted?.flatMap((c) => c.traits) ?? [];
    expect(unrestrictedTraits.map((x) => x.trait.id)).toContain(f.inactiveTrait.id);
    expect(unrestrictedTraits.find((x) => x.trait.id === f.activeTrait.id)?.recordCount).toBe(1);

    // A trait the species has no record for: zeroed counts, no accepted
    // value, and — being categorical — an empty level distribution rather
    // than `null`, which stays the marker of a quantitative trait (RFC-63 R10).
    const colour = await traitByKey(t.db, 'flower_color');
    expect(unrestrictedTraits.find((x) => x.trait.id === colour.id)).toEqual({
      trait: { id: colour.id, key: 'flower_color', valueType: 'categorical', unit: null },
      recordCount: 0,
      harmonisationCounts: {
        harmonised: 0,
        unknownLevel: 0,
        multiValue: 0,
        notNumeric: 0,
        empty: 0,
      },
      levels: [],
      numeric: null,
      accepted: null,
    });
    const petal = await traitByKey(t.db, 'petal_length');
    expect(unrestrictedTraits.find((x) => x.trait.id === petal.id)?.levels).toBeNull();
  });
});
