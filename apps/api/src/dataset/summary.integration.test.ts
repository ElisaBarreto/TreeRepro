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
});
