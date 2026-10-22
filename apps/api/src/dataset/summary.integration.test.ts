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

  it('aggregates per category and trait: counts, levels, the RFC-77 summaries, validated', async () => {
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
        {
          levelId: blue.id,
          key: 'blue',
          count: 2,
          validationCount: 1,
          contested: false,
          nSources: 1,
          shareOfRecords: expect.closeTo(2 / 3, 10),
        },
        {
          levelId: red.id,
          key: 'red',
          count: 1,
          validationCount: 0,
          contested: false,
          nSources: 1,
          shareOfRecords: expect.closeTo(1 / 3, 10),
        },
      ],
      continuous: null,
      // RFC-77 R7 (issue #290): the multi_value record is pending and does not count
      categorical: {
        mainStates: ['blue'],
        share: 0.6667,
        majority: true,
        states: ['blue', 'red'],
        nRecords: 3,
      },
      validated: true,
      contested: false,
    });
    const petalSummary = summary?.[0]?.traits.find((tr) => tr.trait.key === 'petal_length');
    expect(petalSummary).toMatchObject({
      recordCount: 4,
      harmonisationCounts: { harmonised: 3, notNumeric: 1 },
      levels: null,
      // RFC-77 R5 (issue #290): one source, so the median of its values
      continuous: {
        median: 2,
        summaryBasis: 'median_of_source_medians',
        mean: expect.closeTo(7 / 3, 10),
        meanBasis: 'central_values',
        sd: expect.closeTo(
          Math.sqrt(((1 - 7 / 3) ** 2 + (2 - 7 / 3) ** 2 + (4 - 7 / 3) ** 2) / 3),
          10,
        ),
        min: 1,
        max: 4,
        nRecords: 3,
        nSources: 1,
        outlierFlags: [],
        unit: petal.unit,
      },
      categorical: null,
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

  it('RFC-77 R8 the summaries follow the viewer: a record on an inactive level is left out for a restricted viewer', async () => {
    const sp = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['open', 'closed'] });
    const [open, closed] = await Promise.all([
      levelByKey(t.db, trait.id, 'open'),
      levelByKey(t.db, trait.id, 'closed'),
    ]);
    const ref = await createReference(t.db);
    const batch = await createImportBatch(t.db);
    for (const [level, n] of [
      [open, 1],
      [closed, 2],
      [closed, 3],
    ] as const) {
      await createRecord(t.db, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText: `${level.key}-${n}`,
        levelId: level.id,
        primaryReferenceId: ref.id,
        importBatchId: batch.id,
        importRowNo: n,
      });
    }
    await t.db.update(traitLevels).set({ active: false }).where(eq(traitLevels.id, closed.id));
    const of = async (v: typeof UNRESTRICTED) =>
      (await speciesTraitSummary(t.db, v, sp.id))
        ?.flatMap((c) => c.traits)
        .find((x) => x.trait.id === trait.id)?.categorical;
    expect(await of(UNRESTRICTED)).toMatchObject({ mainStates: ['closed'], nRecords: 3 });
    expect(await of(RESTRICTED)).toMatchObject({ mainStates: ['open'], share: 1, nRecords: 1 });
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
      continuous: null,
      categorical: null,
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
