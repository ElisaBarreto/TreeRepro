import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../../test/helpers/dataset.ts';
import { unwrapDbError, useTestDb, withRollback } from '../../../test/helpers/db.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { traitRecords } from './records.ts';
import { referenceTraits } from './reference-traits.ts';

describe('RFC-61 R9 reference_traits maintained by the trait_records insert trigger', () => {
  const t = useTestDb();

  const countFor = async (referenceId: string, traitId: string) =>
    (
      await t.db
        .select({ n: referenceTraits.recordCount })
        .from(referenceTraits)
        .where(
          and(eq(referenceTraits.referenceId, referenceId), eq(referenceTraits.traitId, traitId)),
        )
    )[0]?.n;

  it('counts a reference in either role, per trait', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const other = await createReference(t.db);
    const traitA = await createTrait(t.db, { levels: ['a', 'b'] });
    const traitB = await createTrait(t.db, { levels: ['a', 'b'] });
    const sp = await createSpecies(t.db);
    const level = (tr: { levels: { id: string }[] }) => tr.levels[0]?.id as string;
    // Primary role on trait A.
    await createRecord(t.db, {
      speciesId: sp.id,
      traitId: traitA.id,
      valueText: 'a',
      levelId: level(traitA),
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    expect(await countFor(ref.id, traitA.id)).toBe(1);
    // Secondary role on trait A: the same pair is bumped, and the primary of
    // this record gets a row of its own.
    await createRecord(t.db, {
      speciesId: sp.id,
      traitId: traitA.id,
      valueText: 'b',
      levelId: traitA.levels[1]?.id,
      primaryReferenceId: other.id,
      secondaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    expect(await countFor(ref.id, traitA.id)).toBe(2);
    expect(await countFor(other.id, traitA.id)).toBe(1);
    // A different trait is a different row.
    await createRecord(t.db, {
      speciesId: sp.id,
      traitId: traitB.id,
      valueText: 'a',
      levelId: level(traitB),
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    expect(await countFor(ref.id, traitB.id)).toBe(1);
    expect(await countFor(ref.id, traitA.id)).toBe(2);
  });

  it('a record naming the same reference in both roles counts once', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const sp = await createSpecies(t.db);
    await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: ref.id,
      secondaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    expect(await countFor(ref.id, trait.id)).toBe(1);
  });

  it('a multi-row insert counts every row of the statement', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const sp = await createSpecies(t.db);
    // `raw_value` differs per row: `trait_records_claim_key` is unique over
    // (species, trait, value_text, raw_value, both references), and the point
    // here is three rows in ONE statement, not three identical claims.
    await t.db.insert(traitRecords).values(
      ['one', 'two', 'three'].map((raw) => ({
        speciesId: sp.id,
        traitId: trait.id,
        valueText: 'a',
        rawValue: raw,
        levelId: trait.levels[0]?.id,
        harmonisation: 'harmonised' as const,
        origin: 'manual' as const,
        createdBy: user.id,
        primaryReferenceId: ref.id,
        secondaryReferenceId: ref.id,
      })),
    );
    expect(await countFor(ref.id, trait.id)).toBe(3);
  });

  it('the app role cannot write the table directly', async () => {
    await expect(
      unwrapDbError(
        t.db.insert(referenceTraits).values({
          referenceId: '00000000-0000-7000-8000-000000000000',
          traitId: '00000000-0000-7000-8000-000000000001',
          recordCount: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('RFC-61 R9 migration backfill', () => {
  // The harness migrates an empty database, so the migration's backfill runs
  // over zero rows. It is exercised here, verbatim, on synthetic records the
  // trigger never saw (the pattern of RFC-69 R3 in coverage.integration.test.ts).
  const su = useTestDb({ role: 'superuser' });

  it('rebuilds the counters from records the trigger never saw', async () => {
    await withRollback(su.db, async (tx) => {
      // Suppresses the statement trigger for THIS transaction only, unlike
      // ALTER TABLE ... DISABLE TRIGGER, which is catalogue-wide DDL and would
      // stop maintaining the table for every test file running in parallel.
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`set local lock_timeout = '5s'`);
      const { user } = await createUser(tx);
      const ref = await createReference(tx);
      const trait = await createTrait(tx, { levels: ['a'] });
      const sp = await createSpecies(tx);
      await tx.insert(traitRecords).values([
        {
          speciesId: sp.id,
          traitId: trait.id,
          valueText: 'a',
          levelId: trait.levels[0]?.id,
          harmonisation: 'harmonised' as const,
          origin: 'manual' as const,
          createdBy: user.id,
          primaryReferenceId: ref.id,
        },
        {
          speciesId: sp.id,
          traitId: trait.id,
          valueText: 'a',
          levelId: trait.levels[0]?.id,
          harmonisation: 'harmonised' as const,
          origin: 'manual' as const,
          createdBy: user.id,
          // Both roles on one record: the backfill must count it once.
          primaryReferenceId: ref.id,
          secondaryReferenceId: ref.id,
        },
      ]);
      expect(
        await tx.select().from(referenceTraits).where(eq(referenceTraits.referenceId, ref.id)),
      ).toHaveLength(0);

      // Verbatim from the references_enriched migration. ON CONFLICT DO NOTHING
      // leaves the rows sibling tests already have alone.
      await tx.execute(sql`
        INSERT INTO reference_traits (reference_id, trait_id, record_count)
        SELECT reference_id, trait_id, count(*) FROM (
          SELECT DISTINCT id, primary_reference_id AS reference_id, trait_id FROM trait_records WHERE primary_reference_id IS NOT NULL
          UNION
          SELECT DISTINCT id, secondary_reference_id, trait_id FROM trait_records WHERE secondary_reference_id IS NOT NULL
        ) x GROUP BY 1, 2
        ON CONFLICT DO NOTHING`);

      const [row] = await tx
        .select()
        .from(referenceTraits)
        .where(eq(referenceTraits.referenceId, ref.id));
      expect(row).toMatchObject({ traitId: trait.id, recordCount: 2 });
    });
  });
});
