import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createAnnotation,
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
  createVisibilityFixture,
  levelByKey,
  traitByKey,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { traitLevels } from '../db/schema/dictionary.ts';
import { speciesTraitSummary } from './summary.ts';

describe('RFC-63 R10 speciesTraitSummary', () => {
  const t = useTestDb();

  it('aggregates per category and trait: counts, levels, numeric stats, validated', async () => {
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
    await createAnnotation(t.db, { recordId: b1.id, actorId: user.id, kind: 'confirm' });

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
        { levelId: blue.id, key: 'blue', count: 2, validationCount: 1, contested: false },
        { levelId: red.id, key: 'red', count: 1, validationCount: 0, contested: false },
      ],
      numeric: null,
      validated: true,
      contested: false,
    });
    const petalSummary = summary?.[0]?.traits.find((tr) => tr.trait.key === 'petal_length');
    expect(petalSummary).toMatchObject({
      recordCount: 4,
      harmonisationCounts: { harmonised: 3, notNumeric: 1 },
      levels: null,
      numeric: [
        {
          unit: petal.unit,
          means: {
            single: expect.closeTo(7 / 3, 10),
            mean: null,
            median: null,
            min: null,
            max: null,
          },
          count: 3,
        },
      ],
      validated: false,
    });
    // A withdrawn record is no longer a validated one (spec R-1).
    await createAnnotation(t.db, { recordId: b1.id, actorId: user.id, kind: 'withdraw' });
    expect((await speciesTraitSummary(t.db, UNRESTRICTED, sp1.id))?.[1]?.traits[0]?.validated).toBe(
      false,
    );
    expect(await speciesTraitSummary(t.db, UNRESTRICTED, (await createSpecies(t.db)).id)).toEqual(
      [],
    );
  });

  it('RFC-63 R10 numeric: a mean per field, never pooled across fields (issue #234)', async () => {
    const { user } = await createUser(t.db);
    const sp1 = await createSpecies(t.db);
    const petal = await traitByKey(t.db, 'petal_length');
    const ref = await createReference(t.db);
    const manual = {
      speciesId: sp1.id,
      traitId: petal.id,
      primaryReferenceId: ref.id,
      origin: 'manual' as const,
      createdBy: user.id,
    };
    await createRecord(t.db, { ...manual, valueText: '5', numericValue: 5 });
    await createRecord(t.db, { ...manual, valueText: 'min=2;max=8', minValue: 2, maxValue: 8 });
    await createRecord(t.db, {
      ...manual,
      valueText: 'mean=4;sd=1;n=10',
      meanValue: 4,
      sdValue: 1,
      n: 10,
    });
    const summary = await speciesTraitSummary(t.db, UNRESTRICTED, sp1.id);
    const numeric = summary?.flatMap((c) => c.traits).find((x) => x.trait.id === petal.id)?.numeric;
    expect(numeric).toEqual([
      { unit: petal.unit, means: { single: 5, mean: 4, median: null, min: 2, max: 8 }, count: 3 },
    ]);
  });

  it('RFC-63 R10 numeric: the median is its own field, averaged over the records that hold one (issues #232, #234)', async () => {
    const sp1 = await createSpecies(t.db);
    const petal = await traitByKey(t.db, 'petal_length');
    const ref = await createReference(t.db);
    const imported = {
      speciesId: sp1.id,
      traitId: petal.id,
      primaryReferenceId: ref.id,
      importBatchId: (await createImportBatch(t.db)).id,
    };
    await createRecord(t.db, { ...imported, valueText: '5', numericValue: 5 });
    await createRecord(t.db, { ...imported, valueText: 'median=20', medianValue: 20 });
    await createRecord(t.db, {
      ...imported,
      valueText: 'mean=2;median=100',
      meanValue: 2,
      medianValue: 100,
    });
    const summary = await speciesTraitSummary(t.db, UNRESTRICTED, sp1.id);
    const numeric = summary?.flatMap((c) => c.traits).find((x) => x.trait.id === petal.id)?.numeric;
    expect(numeric).toEqual([
      {
        unit: petal.unit,
        means: { single: 5, mean: 2, median: 60, min: null, max: null },
        count: 3,
      },
    ]);
  });

  it('RFC-63 R10 numeric: a study summary repeated on its measurement records counts once (issue #257)', async () => {
    const sp1 = await createSpecies(t.db);
    const petal = await traitByKey(t.db, 'petal_length');
    const [studyA, studyB] = [await createReference(t.db), await createReference(t.db)];
    const importBatchId = (await createImportBatch(t.db)).id;
    const imported = { speciesId: sp1.id, traitId: petal.id, importBatchId };
    // Study A: three measurements, each row repeating the study's summary.
    for (const v of [10, 11, 12]) {
      await createRecord(t.db, {
        ...imported,
        primaryReferenceId: studyA.id,
        valueText: `single=${v};min=10;max=14;mean=12;median=11`,
        numericValue: v,
        meanValue: 12,
        medianValue: 11,
        minValue: 10,
        maxValue: 14,
      });
    }
    // Study B: the same mean as A, through another reference — it counts on its own.
    await createRecord(t.db, {
      ...imported,
      primaryReferenceId: studyB.id,
      valueText: 'min=18;max=22;mean=20;median=19',
      meanValue: 20,
      medianValue: 19,
      minValue: 18,
      maxValue: 22,
    });
    const summary = await speciesTraitSummary(t.db, UNRESTRICTED, sp1.id);
    const numeric = summary?.flatMap((c) => c.traits).find((x) => x.trait.id === petal.id)?.numeric;
    // mean (12 + 20) / 2 = 16, not (12 + 12 + 12 + 20) / 4 = 14; single keeps every measurement.
    expect(numeric).toEqual([
      { unit: petal.unit, means: { single: 11, mean: 16, median: 15, min: 14, max: 18 }, count: 4 },
    ]);
  });

  it('RFC-63 R10 numeric: one entry per effective unit, never averaged across units (issue #258)', async () => {
    const sp1 = await createSpecies(t.db);
    const colour = await createTrait(t.db, { valueType: 'quantitative', unit: 'rgb_0_255' });
    const ref = await createReference(t.db);
    const imported = {
      speciesId: sp1.id,
      traitId: colour.id,
      primaryReferenceId: ref.id,
      importBatchId: (await createImportBatch(t.db)).id,
    };
    // No unit: the trait's. The same study mean in one unit counts once, in another on its own.
    await createRecord(t.db, { ...imported, valueText: '200', numericValue: 200, meanValue: 1 });
    for (const [v, unit] of [
      [100, 'rgb_0_255'],
      [60, 'rgb_0_255'],
      [0.5, 'proportion_0_1'],
      [0.3, 'proportion_0_1'],
      [5, 'munsell_hue'],
      [7, 'munsell_hue'],
    ] as const) {
      await createRecord(t.db, {
        ...imported,
        valueText: String(v),
        numericValue: v,
        meanValue: 1,
        unit,
      });
    }
    await createRecord(t.db, {
      ...imported,
      valueText: '550',
      numericValue: 550,
      unit: 'nm',
      unitStatus: 'needs_unit_check',
    });
    const summary = await speciesTraitSummary(t.db, UNRESTRICTED, sp1.id);
    const numeric = summary
      ?.flatMap((c) => c.traits)
      .find((x) => x.trait.id === colour.id)?.numeric;
    const means = (single: unknown) => ({ single, mean: 1, median: null, min: null, max: null });
    expect(numeric).toEqual([
      { unit: 'rgb_0_255', means: means(120), count: 3 },
      { unit: 'munsell_hue', means: means(6), count: 2 },
      { unit: 'proportion_0_1', means: means(expect.closeTo(0.4, 10)), count: 2 },
    ]);
  });

  it('RFC-63 R10 a field no record holds is null: a range-only trait has only min and max', async () => {
    const { user } = await createUser(t.db);
    const sp1 = await createSpecies(t.db);
    const petal = await traitByKey(t.db, 'petal_length');
    const ref = await createReference(t.db);
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: petal.id,
      valueText: 'min=1;max=3',
      minValue: 1,
      maxValue: 3,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    const summary = await speciesTraitSummary(t.db, UNRESTRICTED, sp1.id);
    expect(summary?.flatMap((c) => c.traits).find((x) => x.trait.id === petal.id)?.numeric).toEqual(
      [
        {
          unit: petal.unit,
          means: { single: null, mean: null, median: null, min: 1, max: 3 },
          count: 1,
        },
      ],
    );
  });

  it('RFC-63 R10 leaves records whose unit needs checking out of every mean and the count', async () => {
    const { user } = await createUser(t.db);
    const sp1 = await createSpecies(t.db);
    const petal = await traitByKey(t.db, 'petal_length');
    const ref = await createReference(t.db);
    const manual = {
      speciesId: sp1.id,
      traitId: petal.id,
      primaryReferenceId: ref.id,
      origin: 'manual' as const,
      createdBy: user.id,
    };
    await createRecord(t.db, {
      ...manual,
      valueText: '10',
      numericValue: 10,
      unitStatus: 'converted_or_already_target',
    });
    await createRecord(t.db, {
      ...manual,
      valueText: '1000',
      numericValue: 1000,
      unitStatus: 'needs_unit_check',
    });
    await createRecord(t.db, {
      ...manual,
      valueText: 'min=4',
      minValue: 4,
      unitStatus: 'unit_missing',
    });

    const summary = await speciesTraitSummary(t.db, UNRESTRICTED, sp1.id);
    const petalSummary = summary?.flatMap((c) => c.traits).find((x) => x.trait.id === petal.id);
    expect(petalSummary?.numeric).toEqual([
      {
        unit: petal.unit,
        means: { single: 10, mean: null, median: null, min: 4, max: null },
        count: 2,
      },
    ]);
    expect(petalSummary?.recordCount).toBe(3);
  });

  it('RFC-63 R10 never lets sd, se or n enter a mean', async () => {
    const { user } = await createUser(t.db);
    const sp1 = await createSpecies(t.db);
    const petal = await traitByKey(t.db, 'petal_length');
    const ref = await createReference(t.db);
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: petal.id,
      valueText: '10',
      numericValue: 10,
      sdValue: 50,
      seValue: 70,
      n: 30,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });

    const summary = await speciesTraitSummary(t.db, UNRESTRICTED, sp1.id);
    const petalSummary = summary?.flatMap((c) => c.traits).find((x) => x.trait.id === petal.id);
    expect(petalSummary?.numeric).toEqual([
      {
        unit: petal.unit,
        means: { single: 10, mean: null, median: null, min: null, max: null },
        count: 1,
      },
    ]);
  });

  it('RFC-63 R10 answers a null numeric spread when the only harmonised record needs a unit check', async () => {
    const { user } = await createUser(t.db);
    const sp1 = await createSpecies(t.db);
    const petal = await traitByKey(t.db, 'petal_length');
    const ref = await createReference(t.db);
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: petal.id,
      valueText: '1000',
      numericValue: 1000,
      unitStatus: 'needs_unit_check',
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });

    const summary = await speciesTraitSummary(t.db, UNRESTRICTED, sp1.id);
    const petalSummary = summary?.flatMap((c) => c.traits).find((x) => x.trait.id === petal.id);
    expect(petalSummary?.numeric).toBeNull();
    expect(petalSummary?.recordCount).toBe(1);
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

  it('RFC-70 R7 missingOnly lists only the visible traits with no record, as empty summaries', async () => {
    const { user } = await createUser(t.db);
    // The fixture already carries one visible record on the active trait of
    // the shown species, and one on its inactive trait.
    const f = await createVisibilityFixture(t.db, user.id);

    // Without `missingOnly` only the traits with records show up: both of
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

    // `missingOnly` walks the whole dictionary instead and keeps only the
    // traits the viewer may see that have no visible record for the species.
    const restricted = await speciesTraitSummary(t.db, RESTRICTED, f.shownSpecies.id, {
      missingOnly: true,
    });
    const restrictedTraits = restricted?.flatMap((c) => c.traits) ?? [];
    const restrictedIds = restrictedTraits.map((x) => x.trait.id);
    // The active trait has a record: it is not missing, so it is left out.
    expect(restrictedIds).not.toContain(f.activeTrait.id);
    // RFC-33 R3: the inactive trait stays hidden from a restricted viewer.
    expect(restrictedIds).not.toContain(f.inactiveTrait.id);
    expect(restrictedIds.length).toBeGreaterThan(0);
    expect(restrictedTraits.every((x) => x.recordCount === 0)).toBe(true);
    // Dictionary order, and no empty category.
    expect(restricted?.map((c) => c.category.key)).toEqual([
      ...new Set(restricted?.map((c) => c.category.key)),
    ]);
    expect(restricted?.every((c) => c.traits.length > 0)).toBe(true);

    const unrestricted = await speciesTraitSummary(t.db, UNRESTRICTED, f.shownSpecies.id, {
      missingOnly: true,
    });
    const unrestrictedTraits = unrestricted?.flatMap((c) => c.traits) ?? [];
    const unrestrictedIds = unrestrictedTraits.map((x) => x.trait.id);
    // Both fixture traits carry a record visible to this viewer.
    expect(unrestrictedIds).not.toContain(f.activeTrait.id);
    expect(unrestrictedIds).not.toContain(f.inactiveTrait.id);
    expect(unrestricted?.every((c) => c.traits.length > 0)).toBe(true);

    // A trait the species has no record for: zeroed counts, not
    // validated, and — being categorical — an empty level distribution rather
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
      validated: false,
      contested: false,
    });
    const petal = await traitByKey(t.db, 'petal_length');
    expect(unrestrictedTraits.find((x) => x.trait.id === petal.id)?.levels).toBeNull();
  });

  it('RFC-33 R2, 13e ruling: a confirmed record that is pending or on an inactive level does not validate its species × trait', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const batch = await createImportBatch(t.db);

    // A confirmed but still-pending (not harmonised) record: not validated.
    const spPending = await createSpecies(t.db);
    const traitPending = await createTrait(t.db, { valueType: 'quantitative', unit: 'mm' });
    const pending = await createRecord(t.db, {
      speciesId: spPending.id,
      traitId: traitPending.id,
      valueText: 'not a number',
      harmonisation: 'not_numeric',
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    await createAnnotation(t.db, { recordId: pending.id, actorId: user.id, kind: 'confirm' });
    const pendingSummary = await speciesTraitSummary(t.db, UNRESTRICTED, spPending.id);
    expect(
      pendingSummary?.flatMap((c) => c.traits).find((x) => x.trait.id === traitPending.id)
        ?.validated,
    ).toBe(false);

    // A confirmed, harmonised record whose level is later deactivated: not
    // validated for any viewer, even one who can still see the record
    // (RFC-33 R2's level clause, viewer-blind here — 13e ruling on
    // `validatedPairsSql`).
    const spInactiveLevel = await createSpecies(t.db);
    const traitWithLevel = await createTrait(t.db, { levels: ['on'] });
    const onLevelId = traitWithLevel.levels[0]?.id as string;
    const onInactiveLevel = await createRecord(t.db, {
      speciesId: spInactiveLevel.id,
      traitId: traitWithLevel.id,
      valueText: 'on',
      levelId: onLevelId,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await createAnnotation(t.db, {
      recordId: onInactiveLevel.id,
      actorId: user.id,
      kind: 'confirm',
    });
    await t.db.update(traitLevels).set({ active: false }).where(eq(traitLevels.id, onLevelId));
    const inactiveLevelSummary = await speciesTraitSummary(t.db, UNRESTRICTED, spInactiveLevel.id);
    expect(
      inactiveLevelSummary?.flatMap((c) => c.traits).find((x) => x.trait.id === traitWithLevel.id)
        ?.validated,
    ).toBe(false);

    // Control: a confirmed, harmonised record on an active level does
    // validate — the two cases above are not "always false".
    const spControl = await createSpecies(t.db);
    const traitControl = await createTrait(t.db, { levels: ['on'] });
    const control = await createRecord(t.db, {
      speciesId: spControl.id,
      traitId: traitControl.id,
      valueText: 'on',
      levelId: traitControl.levels[0]?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await createAnnotation(t.db, { recordId: control.id, actorId: user.id, kind: 'confirm' });
    const controlSummary = await speciesTraitSummary(t.db, UNRESTRICTED, spControl.id);
    expect(
      controlSummary?.flatMap((c) => c.traits).find((x) => x.trait.id === traitControl.id)
        ?.validated,
    ).toBe(true);
  });
});
