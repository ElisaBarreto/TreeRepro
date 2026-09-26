import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createAnnotation,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { unwrapDbError, useTestDb, withRollback } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import type { DbExecutor } from '../db/client.ts';
import { speciesTraitCoverage } from '../db/schema/coverage.ts';
import { recordAnnotations } from '../db/schema/curation.ts';
import { recordReferences } from '../db/schema/records.ts';
import { referenceTraits } from '../db/schema/reference-traits.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { species } from '../db/schema/taxa.ts';

async function counters(db: DbExecutor, speciesId: string, traitId: string, refIds: string[]) {
  const [cell] = await db
    .select({
      recordCount: speciesTraitCoverage.recordCount,
      harmonisedCount: speciesTraitCoverage.harmonisedCount,
    })
    .from(speciesTraitCoverage)
    .where(
      and(eq(speciesTraitCoverage.speciesId, speciesId), eq(speciesTraitCoverage.traitId, traitId)),
    );
  const [sp] = await db
    .select({ traitCount: species.traitCount })
    .from(species)
    .where(eq(species.id, speciesId));
  const refs = [];
  for (const id of refIds) {
    const [r] = await db
      .select({
        primary: bibliographicReferences.primaryCount,
        secondary: bibliographicReferences.secondaryCount,
      })
      .from(bibliographicReferences)
      .where(eq(bibliographicReferences.id, id));
    const [rt] = await db
      .select({ n: referenceTraits.recordCount })
      .from(referenceTraits)
      .where(and(eq(referenceTraits.referenceId, id), eq(referenceTraits.traitId, traitId)));
    refs.push({ ...r, byTrait: rt?.n ?? null });
  }
  return { cell: cell ?? null, traitCount: sp?.traitCount, refs };
}

describe('RFC-69 R2, RFC-61 R4, R9 a withdrawal takes its record out of every counter (RFC-63 R13)', () => {
  const t = useTestDb();

  it('decrements coverage, trait_count, reference usage and reference_traits; the last record empties the cell', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      const refA = await createReference(tx);
      const refB = await createReference(tx);
      const refC = await createReference(tx);
      const trait = await createTrait(tx, { levels: ['a', 'b'] });
      const sp = await createSpecies(tx);
      const [la, lb] = trait.levels as [{ id: string; key: string }, { id: string; key: string }];
      const r1 = await createRecord(tx, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText: 'a',
        levelId: la.id,
        primaryReferenceId: refA.id,
        secondaryReferenceId: refB.id,
        origin: 'manual',
        createdBy: user.id,
      });
      await tx.insert(recordReferences).values({ recordId: r1.id, referenceId: refC.id });
      const r2 = await createRecord(tx, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText: 'b',
        levelId: lb.id,
        primaryReferenceId: refA.id,
        origin: 'manual',
        createdBy: user.id,
      });
      const ids = [refA.id, refB.id, refC.id];

      expect(await counters(tx, sp.id, trait.id, ids)).toEqual({
        cell: { recordCount: 2, harmonisedCount: 2 },
        traitCount: 1,
        refs: [
          { primary: 2, secondary: 0, byTrait: 2 },
          { primary: 0, secondary: 1, byTrait: 1 },
          { primary: 1, secondary: 0, byTrait: 1 },
        ],
      });

      await createAnnotation(tx, { recordId: r1.id, actorId: user.id, kind: 'withdraw' });
      expect(await counters(tx, sp.id, trait.id, ids)).toEqual({
        cell: { recordCount: 1, harmonisedCount: 1 },
        traitCount: 1,
        refs: [
          { primary: 1, secondary: 0, byTrait: 1 },
          { primary: 0, secondary: 0, byTrait: null },
          { primary: 0, secondary: 0, byTrait: null },
        ],
      });

      await createAnnotation(tx, { recordId: r2.id, actorId: user.id, kind: 'withdraw' });
      expect(await counters(tx, sp.id, trait.id, ids)).toEqual({
        cell: null,
        traitCount: 0,
        refs: [
          { primary: 0, secondary: 0, byTrait: null },
          { primary: 0, secondary: 0, byTrait: null },
          { primary: 0, secondary: 0, byTrait: null },
        ],
      });
    });
  });

  it('mirrors the insert for a reference named as primary and secondary, and for a pending record', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      const ref = await createReference(tx);
      const trait = await createTrait(tx, { levels: ['a'] });
      const sp = await createSpecies(tx);
      const both = await createRecord(tx, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText: 'a',
        levelId: trait.levels[0]?.id,
        primaryReferenceId: ref.id,
        secondaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
      const pending = await createRecord(tx, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText: 'zz',
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
      // The insert trigger counts `both` once in reference_traits (0027's DISTINCT triples).
      expect(await counters(tx, sp.id, trait.id, [ref.id])).toEqual({
        cell: { recordCount: 2, harmonisedCount: 1 },
        traitCount: 1,
        refs: [{ primary: 2, secondary: 1, byTrait: 2 }],
      });
      await createAnnotation(tx, { recordId: both.id, actorId: user.id, kind: 'withdraw' });
      expect(await counters(tx, sp.id, trait.id, [ref.id])).toEqual({
        cell: { recordCount: 1, harmonisedCount: 0 },
        traitCount: 1,
        refs: [{ primary: 1, secondary: 0, byTrait: 1 }],
      });
      await createAnnotation(tx, { recordId: pending.id, actorId: user.id, kind: 'withdraw' });
      expect(await counters(tx, sp.id, trait.id, [ref.id])).toEqual({
        cell: null,
        traitCount: 0,
        refs: [{ primary: 0, secondary: 0, byTrait: null }],
      });
    });
  });

  it('withdraws several records in one statement, and a confirm changes no counter', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      const ref = await createReference(tx);
      const trait = await createTrait(tx, { levels: ['a', 'b'] });
      const sp = await createSpecies(tx);
      const record = (key: string, levelId: string | undefined) =>
        createRecord(tx, {
          speciesId: sp.id,
          traitId: trait.id,
          valueText: key,
          levelId,
          primaryReferenceId: ref.id,
          origin: 'manual',
          createdBy: user.id,
        });
      const a = await record('a', trait.levels[0]?.id);
      const b = await record('b', trait.levels[1]?.id);
      await createAnnotation(tx, { recordId: a.id, actorId: user.id, kind: 'confirm' });
      expect((await counters(tx, sp.id, trait.id, [ref.id])).cell).toEqual({
        recordCount: 2,
        harmonisedCount: 2,
      });
      await tx.insert(recordAnnotations).values([
        { recordId: a.id, actorId: user.id, kind: 'withdraw' },
        { recordId: b.id, actorId: user.id, kind: 'withdraw' },
      ]);
      expect(await counters(tx, sp.id, trait.id, [ref.id])).toEqual({
        cell: null,
        traitCount: 0,
        refs: [{ primary: 0, secondary: 0, byTrait: null }],
      });
    });
  });

  it('the app role cannot call the decrement itself; only the trigger does', async () => {
    const [row] = await t.db.execute(sql`
      select has_function_privilege('treerepro_app', 'trait_records_uncount(uuid[])', 'EXECUTE') as uncount`);
    expect(row).toEqual({ uncount: false });
  });

  it('refuses a second withdraw of one record, so nothing is decremented twice', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      const ref = await createReference(tx);
      const trait = await createTrait(tx, { levels: ['a'] });
      const sp = await createSpecies(tx);
      const rec = await createRecord(tx, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText: 'a',
        levelId: trait.levels[0]?.id,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
      await createAnnotation(tx, { recordId: rec.id, actorId: user.id, kind: 'withdraw' });
      await expect(
        unwrapDbError(
          tx.transaction((sp2) =>
            createAnnotation(sp2, { recordId: rec.id, actorId: user.id, kind: 'withdraw' }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('RFC-63 R7 a withdraw carries no note', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      const ref = await createReference(tx);
      const trait = await createTrait(tx, { levels: ['a'] });
      const sp = await createSpecies(tx);
      const rec = await createRecord(tx, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText: 'a',
        levelId: trait.levels[0]?.id,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
      const [row] = await unwrapDbError(
        tx
          .insert(recordAnnotations)
          .values({ recordId: rec.id, actorId: user.id, kind: 'withdraw' })
          .returning({ note: recordAnnotations.note }),
      );
      expect(row).toEqual({ note: null });
    });
  });
});
