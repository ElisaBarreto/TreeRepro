import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { unwrapDbError, useTestDb, withRollback } from '../../../test/helpers/db.ts';
import { traitCategories, traitLevels, traits } from './dictionary.ts';
import { bibliographicReferences } from './references.ts';
import { families, genera, species, speciesNames } from './taxa.ts';

const rand = () => Math.random().toString(16).slice(2);

describe('RFC-60 R1 taxonomy tables', () => {
  const t = useTestDb();

  it('family, genus and species names are unique; species defaults nothing and requires a name source', async () => {
    await withRollback(t.db, async (tx) => {
      const name = `Fam-${rand()}`;
      const [family] = await tx.insert(families).values({ name }).returning();
      await expect(
        unwrapDbError(tx.transaction((sp) => sp.insert(families).values({ name }))),
      ).rejects.toMatchObject({ code: '23505' });
      const [genus] = await tx
        .insert(genera)
        .values({ name: `Gen-${rand()}`, familyId: family?.id })
        .returning();
      const [sp1] = await tx
        .insert(species)
        .values({ canonicalName: `Gen sp-${rand()}`, nameSource: 'wcvp', genusId: genus?.id })
        .returning();
      expect(sp1?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(sp1?.createdBy).toBeNull();
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp
              .insert(species)
              .values({ canonicalName: `X-${rand()}`, nameSource: 'guess' as never }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('R3 genus and family are nullable (unresolved taxonomy)', async () => {
    await withRollback(t.db, async (tx) => {
      const [genus] = await tx
        .insert(genera)
        .values({ name: `Gen-${rand()}` })
        .returning();
      expect(genus?.familyId).toBeNull();
      const [sp1] = await tx
        .insert(species)
        .values({ canonicalName: `Orphan-${rand()}`, nameSource: 'original' })
        .returning();
      expect(sp1?.genusId).toBeNull();
    });
  });

  it('R4 alternative names are unique per species and default to source gbif', async () => {
    await withRollback(t.db, async (tx) => {
      const [sp1] = await tx
        .insert(species)
        .values({ canonicalName: `Alt-${rand()}`, nameSource: 'wcvp' })
        .returning();
      const [alt] = await tx
        .insert(speciesNames)
        .values({ speciesId: sp1?.id as string, name: 'Other name', gbifUsageKey: '123' })
        .returning();
      expect(alt?.source).toBe('gbif');
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(speciesNames).values({ speciesId: sp1?.id as string, name: 'Other name' }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('R5 a family with genera cannot be deleted', async () => {
    await withRollback(t.db, async (tx) => {
      const [family] = await tx
        .insert(families)
        .values({ name: `Fam-${rand()}` })
        .returning();
      await tx.insert(genera).values({ name: `Gen-${rand()}`, familyId: family?.id });
      // PostgreSQL 18 reports ON DELETE RESTRICT as 23001 (restrict_violation),
      // not 23503 (foreign_key_violation, the ON DELETE NO ACTION code).
      await expect(
        unwrapDbError(
          tx.transaction((sp) => sp.execute(sql`delete from families where id = ${family?.id}`)),
        ),
      ).rejects.toMatchObject({ code: '23001' });
    });
  });

  it('R6 trigram indexes exist for the searches', async () => {
    const rows = await t.db.execute(sql`
      select indexname from pg_indexes
      where indexname in ('species_canonical_name_trgm_idx', 'species_names_name_trgm_idx', 'bibliographic_references_citation_key_trgm_idx')
      order by indexname
    `);
    expect(rows.map((r) => r.indexname)).toEqual([
      'bibliographic_references_citation_key_trgm_idx',
      'species_canonical_name_trgm_idx',
      'species_names_name_trgm_idx',
    ]);
  });
});

describe('RFC-61 R1 bibliographic_references', () => {
  const t = useTestDb();

  it('citation_key is unique, doi is unique when present, metadata is optional', async () => {
    await withRollback(t.db, async (tx) => {
      const key = `Ref_${rand()}`;
      const [ref] = await tx
        .insert(bibliographicReferences)
        .values({ citationKey: key })
        .returning();
      expect(ref?.title).toBeNull();
      expect(ref?.year).toBeNull();
      await expect(
        unwrapDbError(
          tx.transaction((sp) => sp.insert(bibliographicReferences).values({ citationKey: key })),
        ),
      ).rejects.toMatchObject({ code: '23505' });
      const doi = `10.1000/${rand()}`;
      await tx.insert(bibliographicReferences).values({ citationKey: `A_${rand()}`, doi });
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(bibliographicReferences).values({ citationKey: `B_${rand()}`, doi }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' });
      // two references without a DOI coexist
      await tx.insert(bibliographicReferences).values({ citationKey: `C_${rand()}` });
      await tx.insert(bibliographicReferences).values({ citationKey: `D_${rand()}` });
    });
  });
});

describe('RFC-62 R1 dictionary tables', () => {
  const t = useTestDb();

  it('trait keys are unique, value_type is checked, levels are unique per trait case-insensitively', async () => {
    await withRollback(t.db, async (tx) => {
      const category = `cat_${rand()}`;
      await tx.insert(traitCategories).values({ key: category, label: 'Cat', sortOrder: 99 });
      const key = `trait_${rand()}`;
      const [trait] = await tx
        .insert(traits)
        .values({ key, categoryKey: category, valueType: 'categorical', description: 'd' })
        .returning();
      expect(trait?.active).toBe(true);
      expect(trait?.unit).toBeNull();
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traits).values({ key, categoryKey: category, valueType: 'categorical' }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp
              .insert(traits)
              .values({ key: `t_${rand()}`, categoryKey: category, valueType: 'ordinal' as never }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await tx.insert(traitLevels).values({ traitId: trait?.id as string, key: 'Blue' });
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitLevels).values({ traitId: trait?.id as string, key: 'blue' }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('R3 a trait with levels cannot be deleted', async () => {
    await withRollback(t.db, async (tx) => {
      const category = `cat_${rand()}`;
      await tx.insert(traitCategories).values({ key: category, label: 'Cat', sortOrder: 99 });
      const [trait] = await tx
        .insert(traits)
        .values({ key: `trait_${rand()}`, categoryKey: category, valueType: 'categorical' })
        .returning();
      await tx.insert(traitLevels).values({ traitId: trait?.id as string, key: 'x' });
      // PostgreSQL 18 reports ON DELETE RESTRICT as 23001 (restrict_violation),
      // not 23503 (foreign_key_violation, the ON DELETE NO ACTION code).
      await expect(
        unwrapDbError(
          tx.transaction((sp) => sp.execute(sql`delete from traits where id = ${trait?.id}`)),
        ),
      ).rejects.toMatchObject({ code: '23001' });
    });
  });
});
