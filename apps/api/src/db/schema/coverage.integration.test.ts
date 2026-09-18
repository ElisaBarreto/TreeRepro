import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../../test/helpers/dataset.ts';
import { unwrapDbError, useTestDb } from '../../../test/helpers/db.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { speciesTraitCoverage } from './coverage.ts';
import { traitRecords } from './records.ts';
import { species } from './taxa.ts';

describe('RFC-69 R1, R2 species_trait_coverage', () => {
  const t = useTestDb();

  it('a first record creates the pair and bumps trait_count; more records only add counts', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const sp1 = await createSpecies(t.db);
    const level = (i: number) => trait.levels[i]?.id as string;
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: level(0),
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    const row = async () =>
      (
        await t.db
          .select()
          .from(speciesTraitCoverage)
          .where(
            and(
              eq(speciesTraitCoverage.speciesId, sp1.id),
              eq(speciesTraitCoverage.traitId, trait.id),
            ),
          )
      )[0];
    const count = async () =>
      (await t.db.select({ n: species.traitCount }).from(species).where(eq(species.id, sp1.id)))[0]
        ?.n;
    expect(await row()).toMatchObject({ recordCount: 1, harmonisedCount: 1 });
    expect(await count()).toBe(1);
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'zzz',
      harmonisation: 'unknown_level',
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    expect(await row()).toMatchObject({ recordCount: 2, harmonisedCount: 1 });
    expect(await count()).toBe(1);
    const other = await createTrait(t.db);
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: other.id,
      valueText: 'alpha',
      levelId: other.levels[0]?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    expect(await count()).toBe(2);
  });

  it('a multi-row insert counts pairs once', async () => {
    const { user } = await createUser(t.db);
    const ref1 = await createReference(t.db);
    const ref2 = await createReference(t.db);
    const trait = await createTrait(t.db);
    const sp1 = await createSpecies(t.db);
    await t.db.insert(traitRecords).values(
      [ref1, ref2].map((r) => ({
        speciesId: sp1.id,
        traitId: trait.id,
        valueText: 'alpha',
        levelId: trait.levels[0]?.id,
        harmonisation: 'harmonised' as const,
        origin: 'manual' as const,
        createdBy: user.id,
        primaryReferenceId: r.id,
      })),
    );
    const [c] = await t.db
      .select({ n: species.traitCount })
      .from(species)
      .where(eq(species.id, sp1.id));
    expect(c?.n).toBe(1);
    const [row] = await t.db
      .select()
      .from(speciesTraitCoverage)
      .where(eq(speciesTraitCoverage.speciesId, sp1.id));
    expect(row?.recordCount).toBe(2);
  });

  it('the app role cannot write the table directly', async () => {
    await expect(
      unwrapDbError(
        t.db.insert(speciesTraitCoverage).values({
          speciesId: '00000000-0000-7000-8000-000000000000',
          traitId: '00000000-0000-7000-8000-000000000001',
          recordCount: 1,
          harmonisedCount: 1,
          firstRecordAt: new Date(),
          lastRecordAt: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
