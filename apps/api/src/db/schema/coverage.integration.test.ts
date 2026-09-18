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
    const first = await row();
    expect(first).toMatchObject({ recordCount: 1, harmonisedCount: 1 });
    // One record: the window is a point, so both ends are its `created_at`.
    expect(first?.firstRecordAt).toEqual(first?.lastRecordAt);
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
    const second = await row();
    expect(second).toMatchObject({ recordCount: 2, harmonisedCount: 1 });
    // `first_record_at` is not in the DO UPDATE list, so it never moves.
    expect(second?.firstRecordAt).toEqual(first?.firstRecordAt);
    expect(second?.lastRecordAt.getTime()).toBeGreaterThanOrEqual(
      first?.lastRecordAt.getTime() as number,
    );
    expect(await count()).toBe(1);
    // A backdated record pins both halves of RFC-69 R2 deterministically: it is
    // older than the whole window, so `greatest()` has to keep the stored
    // `last_record_at`, and `first_record_at` must stay put rather than follow
    // the new minimum. Plain `EXCLUDED.last_record_at` would fail here.
    await t.db.insert(traitRecords).values({
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'yyy',
      harmonisation: 'unknown_level',
      origin: 'manual',
      createdBy: user.id,
      primaryReferenceId: ref.id,
      createdAt: new Date('2000-01-01T00:00:00.000Z'),
    });
    const third = await row();
    expect(third).toMatchObject({ recordCount: 3, harmonisedCount: 1 });
    expect(third?.firstRecordAt).toEqual(first?.firstRecordAt);
    expect(third?.lastRecordAt).toEqual(second?.lastRecordAt);
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
    // The multi-row FILTER path: both rows of the statement are harmonised.
    expect(row?.harmonisedCount).toBe(2);
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

describe('RFC-69 R3 migration backfill', () => {
  // The backfill runs once over the whole production table, so it is exercised
  // here on synthetic rows the trigger never saw. The migration itself cannot
  // demonstrate it: the harness migrates an empty database, so both R3
  // statements run over zero rows.
  const su = useTestDb({ role: 'superuser' });

  it('rebuilds coverage and trait_count from records the trigger never saw', async () => {
    await withRollback(su.db, async (tx) => {
      // `SET LOCAL session_replication_role = replica` suppresses the statement
      // trigger for THIS transaction only — unlike `ALTER TABLE ... DISABLE
      // TRIGGER`, which is catalogue-wide DDL and would silently stop
      // maintaining coverage for every test file running in parallel against
      // the same database. Nothing here is visible to another session, and the
      // whole transaction is rolled back. It needs the superuser connection the
      // harness offers (test/helpers/db.ts); it also suspends foreign-key
      // triggers, which is harmless because every id below is a real row.
      await tx.execute(sql`set local session_replication_role = replica`);
      const { user } = await createUser(tx);
      const ref = await createReference(tx);
      const trait = await createTrait(tx, { levels: ['a', 'b'] });
      const other = await createTrait(tx);
      const sp1 = await createSpecies(tx);
      const oldest = new Date('2019-03-04T05:06:07.000Z');
      const newest = new Date('2021-08-09T10:11:12.000Z');
      await tx.insert(traitRecords).values([
        {
          speciesId: sp1.id,
          traitId: trait.id,
          valueText: 'a',
          levelId: trait.levels[0]?.id,
          harmonisation: 'harmonised' as const,
          origin: 'manual' as const,
          createdBy: user.id,
          primaryReferenceId: ref.id,
          createdAt: oldest,
        },
        {
          speciesId: sp1.id,
          traitId: trait.id,
          valueText: 'zzz',
          harmonisation: 'unknown_level' as const,
          origin: 'manual' as const,
          createdBy: user.id,
          primaryReferenceId: ref.id,
          createdAt: newest,
        },
        {
          speciesId: sp1.id,
          traitId: other.id,
          valueText: 'alpha',
          levelId: other.levels[0]?.id,
          harmonisation: 'harmonised' as const,
          origin: 'manual' as const,
          createdBy: user.id,
          primaryReferenceId: ref.id,
          createdAt: newest,
        },
      ]);
      // The trigger was suspended, so nothing exists to be found yet.
      expect(
        await tx
          .select()
          .from(speciesTraitCoverage)
          .where(eq(speciesTraitCoverage.speciesId, sp1.id)),
      ).toHaveLength(0);

      // Both statements verbatim from migration 0022_coverage.sql. The first is
      // `ON CONFLICT DO NOTHING`, so the rows every sibling test already has
      // are left alone; the second recomputes `trait_count` for every species
      // from the table, which is a no-op for anyone whose trigger already ran.
      await tx.execute(sql`
        INSERT INTO species_trait_coverage (species_id, trait_id, record_count, harmonised_count, first_record_at, last_record_at)
        SELECT species_id, trait_id, count(*), count(*) FILTER (WHERE harmonisation = 'harmonised'), min(created_at), max(created_at)
        FROM trait_records GROUP BY 1, 2
        ON CONFLICT DO NOTHING`);
      await tx.execute(sql`
        UPDATE species s SET trait_count = c.n
        FROM (SELECT species_id, count(*) AS n FROM species_trait_coverage GROUP BY 1) c
        WHERE s.id = c.species_id`);

      const [covered] = await tx
        .select()
        .from(speciesTraitCoverage)
        .where(
          and(
            eq(speciesTraitCoverage.speciesId, sp1.id),
            eq(speciesTraitCoverage.traitId, trait.id),
          ),
        );
      expect(covered).toMatchObject({ recordCount: 2, harmonisedCount: 1 });
      expect(covered?.firstRecordAt).toEqual(oldest);
      expect(covered?.lastRecordAt).toEqual(newest);
      const [single] = await tx
        .select()
        .from(speciesTraitCoverage)
        .where(
          and(
            eq(speciesTraitCoverage.speciesId, sp1.id),
            eq(speciesTraitCoverage.traitId, other.id),
          ),
        );
      expect(single).toMatchObject({ recordCount: 1, harmonisedCount: 1 });
      const [counted] = await tx
        .select({ n: species.traitCount })
        .from(species)
        .where(eq(species.id, sp1.id));
      expect(counted?.n).toBe(2);
    });
  });
});
