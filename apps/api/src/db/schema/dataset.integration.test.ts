import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  levelByKey,
  traitByKey,
} from '../../../test/helpers/dataset.ts';
import { unwrapDbError, useTestDb, withRollback } from '../../../test/helpers/db.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { acceptedValues, recordAnnotations } from './curation.ts';
import { traitCategories, traitLevels, traits } from './dictionary.ts';
import { importBatches } from './imports.ts';
import { traitRecords } from './records.ts';
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

  it('R1 species.active defaults to true', async () => {
    await withRollback(t.db, async (tx) => {
      const [sp1] = await tx
        .insert(species)
        .values({ canonicalName: `Act-${rand()}`, nameSource: 'wcvp' })
        .returning();
      expect(sp1?.active).toBe(true);
    });
  });
});

describe('RFC-68 R1 import batch kind', () => {
  const t = useTestDb();

  it('defaults to records and is checked', async () => {
    await withRollback(t.db, async (tx) => {
      const [b] = await tx
        .insert(importBatches)
        .values({ fileName: 'x.csv', fileSha256: 'a'.repeat(64) })
        .returning();
      expect(b?.kind).toBe('records');
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp
              .insert(importBatches)
              .values({ fileName: 'y.csv', fileSha256: 'b'.repeat(64), kind: 'nope' as never }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
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

describe('RFC-63 R1-R3 trait_records constraints', () => {
  const t = useTestDb();

  it('R2 requires a reference and the origin columns that match the origin', async () => {
    await withRollback(t.db, async (tx) => {
      const sp1 = await createSpecies(tx);
      const trait = await traitByKey(tx, 'flower_color');
      const batch = await createImportBatch(tx);
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values({
              speciesId: sp1.id,
              traitId: trait.id,
              valueText: 'blue',
              harmonisation: 'unknown_level',
              origin: 'import',
              importBatchId: batch.id,
              importRowNo: 1,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' }); // no reference
      const ref = await createReference(tx);
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values({
              speciesId: sp1.id,
              traitId: trait.id,
              valueText: 'blue',
              harmonisation: 'unknown_level',
              origin: 'import',
              primaryReferenceId: ref.id,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' }); // import without batch
      const { user } = await createUser(tx);
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values({
              speciesId: sp1.id,
              traitId: trait.id,
              valueText: 'blue',
              harmonisation: 'unknown_level',
              origin: 'manual',
              createdBy: user.id,
              secondaryReferenceId: ref.id,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' }); // manual needs the primary reference
    });
  });

  it('R2 harmonised needs a level or a number, never both', async () => {
    await withRollback(t.db, async (tx) => {
      const sp1 = await createSpecies(tx);
      const trait = await traitByKey(tx, 'flower_color');
      const level = await levelByKey(tx, trait.id, 'blue');
      const ref = await createReference(tx);
      const batch = await createImportBatch(tx);
      const base = {
        speciesId: sp1.id,
        traitId: trait.id,
        valueText: 'blue',
        origin: 'import' as const,
        importBatchId: batch.id,
        importRowNo: 1,
        primaryReferenceId: ref.id,
      };
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values({ ...base, harmonisation: 'harmonised' }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values({
              ...base,
              harmonisation: 'harmonised',
              levelId: level.id,
              numericValue: 1,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      const [ok] = await tx
        .insert(traitRecords)
        .values({ ...base, harmonisation: 'harmonised', levelId: level.id })
        .returning();
      expect(ok?.levelId).toBe(level.id);
    });
  });

  it('R3 an identical claim is refused, nulls not distinct', async () => {
    await withRollback(t.db, async (tx) => {
      const sp1 = await createSpecies(tx);
      const trait = await traitByKey(tx, 'flower_color');
      const ref = await createReference(tx);
      const batch = await createImportBatch(tx);
      const claim = {
        speciesId: sp1.id,
        traitId: trait.id,
        valueText: 'blueish',
        harmonisation: 'unknown_level' as const,
        origin: 'import' as const,
        importBatchId: batch.id,
        importRowNo: 1,
        primaryReferenceId: ref.id,
      };
      await tx.insert(traitRecords).values(claim);
      await expect(
        unwrapDbError(
          tx.transaction((sp) => sp.insert(traitRecords).values({ ...claim, importRowNo: 2 })),
        ),
      ).rejects.toMatchObject({ code: '23505', constraint_name: 'trait_records_claim_key' });
      // a different raw value is a different claim
      await tx.insert(traitRecords).values({ ...claim, importRowNo: 3, rawValue: 'Blueish' });
    });
  });

  it('R1, R2 supersedes_record_id: a manual record may inherit references from the pending record it supersedes; imports never supersede', async () => {
    await withRollback(t.db, async (tx) => {
      const sp1 = await createSpecies(tx);
      const trait = await traitByKey(tx, 'flower_color');
      const level = await levelByKey(tx, trait.id, 'blue');
      const ref = await createReference(tx);
      const batch = await createImportBatch(tx);
      const { user } = await createUser(tx);
      // an import row with only a secondary reference, unharmonised
      const pending = await createRecord(tx, {
        speciesId: sp1.id,
        traitId: trait.id,
        valueText: 'blues',
        secondaryReferenceId: ref.id,
        importBatchId: batch.id,
      });
      // a manual row with no primary reference is refused unless it supersedes a record
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values({
              speciesId: sp1.id,
              traitId: trait.id,
              valueText: 'blue',
              levelId: level.id,
              harmonisation: 'harmonised',
              secondaryReferenceId: ref.id,
              origin: 'manual',
              createdBy: user.id,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      const [mapped] = await tx
        .insert(traitRecords)
        .values({
          speciesId: sp1.id,
          traitId: trait.id,
          valueText: 'blue',
          levelId: level.id,
          harmonisation: 'harmonised',
          secondaryReferenceId: ref.id,
          origin: 'manual',
          createdBy: user.id,
          supersedesRecordId: pending.id,
        })
        .returning();
      expect(mapped?.supersedesRecordId).toBe(pending.id);
      // an import row never supersedes
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values({
              speciesId: sp1.id,
              traitId: trait.id,
              valueText: 'x',
              harmonisation: 'unknown_level',
              primaryReferenceId: ref.id,
              origin: 'import',
              importBatchId: batch.id,
              importRowNo: 99,
              supersedesRecordId: pending.id,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      // the foreign key holds
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values({
              speciesId: sp1.id,
              traitId: trait.id,
              valueText: 'blue',
              levelId: level.id,
              harmonisation: 'harmonised',
              primaryReferenceId: ref.id,
              origin: 'manual',
              createdBy: user.id,
              supersedesRecordId: '00000000-0000-7000-8000-000000000000',
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });
  });

  it('R2 a level or a number implies harmonised (converse check)', async () => {
    await withRollback(t.db, async (tx) => {
      const sp1 = await createSpecies(tx);
      const trait = await traitByKey(tx, 'flower_color');
      const level = await levelByKey(tx, trait.id, 'blue');
      const ref = await createReference(tx);
      const batch = await createImportBatch(tx);
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values({
              speciesId: sp1.id,
              traitId: trait.id,
              valueText: 'blue',
              levelId: level.id,
              harmonisation: 'unknown_level',
              primaryReferenceId: ref.id,
              origin: 'import',
              importBatchId: batch.id,
              importRowNo: 1,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});

describe('RFC-63 R4 append-only records and curation tables', () => {
  const t = useTestDb();
  const su = useTestDb({ role: 'superuser' });

  it('treerepro_app holds SELECT and INSERT but neither UPDATE, DELETE nor TRUNCATE', async () => {
    for (const table of ['trait_records', 'record_annotations', 'accepted_values']) {
      const rows = await t.db.execute(sql`
        select privilege_type, has_table_privilege('treerepro_app', ${table}, privilege_type) as granted
        from unnest(array['SELECT', 'INSERT', 'DELETE', 'UPDATE', 'TRUNCATE']) as privilege_type
      `);
      expect(Object.fromEntries(rows.map((r) => [r.privilege_type, r.granted])), table).toEqual({
        SELECT: true,
        INSERT: true,
        DELETE: false,
        UPDATE: false,
        TRUNCATE: false,
      });
    }
  });

  it('the trigger refuses UPDATE and DELETE even for the owner', async () => {
    await withRollback(su.db, async (tx) => {
      const sp1 = await createSpecies(tx);
      const trait = await traitByKey(tx, 'flower_color');
      const ref = await createReference(tx);
      const batch = await createImportBatch(tx);
      const record = await createRecord(tx, {
        speciesId: sp1.id,
        traitId: trait.id,
        valueText: 'x',
        harmonisation: 'unknown_level',
        primaryReferenceId: ref.id,
        importBatchId: batch.id,
      });
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.update(traitRecords).set({ valueText: 'y' }).where(eq(traitRecords.id, record.id)),
          ),
        ),
      ).rejects.toMatchObject({ code: '42501', message: 'trait_records is append-only' });
      await expect(
        unwrapDbError(
          tx.transaction((sp) => sp.delete(traitRecords).where(eq(traitRecords.id, record.id))),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('R7 an accepted value must point at a record of the same species and trait', async () => {
    await withRollback(t.db, async (tx) => {
      const sp1 = await createSpecies(tx);
      const sp2 = await createSpecies(tx);
      const trait = await traitByKey(tx, 'flower_color');
      const ref = await createReference(tx);
      const batch = await createImportBatch(tx);
      const { user } = await createUser(tx);
      const record = await createRecord(tx, {
        speciesId: sp1.id,
        traitId: trait.id,
        valueText: 'x',
        harmonisation: 'unknown_level',
        primaryReferenceId: ref.id,
        importBatchId: batch.id,
      });
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(acceptedValues).values({
              speciesId: sp2.id,
              traitId: trait.id,
              recordId: record.id,
              decision: 'accepted',
              actorId: user.id,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(acceptedValues).values({
              speciesId: sp1.id,
              traitId: trait.id,
              decision: 'accepted',
              actorId: user.id,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' }); // accepted without a record
      const [ok] = await tx
        .insert(acceptedValues)
        .values({
          speciesId: sp1.id,
          traitId: trait.id,
          recordId: record.id,
          decision: 'accepted',
          actorId: user.id,
        })
        .returning();
      expect(ok?.id).toBeDefined();
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp
              .insert(recordAnnotations)
              .values({ recordId: record.id, actorId: user.id, kind: 'dispute' }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' }); // dispute needs a note
    });
  });

  it('RFC-64 R3 import batches default to running with zero counts', async () => {
    await withRollback(t.db, async (tx) => {
      const [batch] = await tx
        .insert(importBatches)
        .values({ fileName: 'x.csv', fileSha256: 'a'.repeat(64) })
        .returning();
      expect(batch?.status).toBe('running');
      expect(batch?.rowsTotal).toBe(0);
      expect(batch?.unknownLevels).toEqual([]);
    });
  });
});
