import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
  levelByKey,
  traitByKey,
} from '../../../test/helpers/dataset.ts';
import { unwrapDbError, useTestDb, withRollback } from '../../../test/helpers/db.ts';
import { randomIsbn } from '../../../test/helpers/isbn.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { recordAnnotations } from './curation.ts';
import { traitCategories, traitLevels, traits } from './dictionary.ts';
import { importBatches } from './imports.ts';
import { plotSpecies, plots, userPlots } from './plots.ts';
import { type NewTraitRecordRow, recordReferences, traitRecords } from './records.ts';
import { referenceTraits } from './reference-traits.ts';
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
      expect(b?.rowsAlreadyImported).toBe(0);
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

  it('RFC-64 R3, R14 rows_already_imported is a bigint not null defaulting to 0', async () => {
    const [col] = await t.db.execute(sql`
      select data_type, is_nullable, column_default from information_schema.columns
      where table_name = 'import_batches' and column_name = 'rows_already_imported'`);
    expect(col).toEqual({ data_type: 'bigint', is_nullable: 'NO', column_default: '0' });
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
    for (const table of ['trait_records', 'record_annotations']) {
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

describe('RFC-67 R1 plot tables', () => {
  const t = useTestDb();

  it('code is unique case-insensitively; coordinates are checked; memberships are keyed', async () => {
    await withRollback(t.db, async (tx) => {
      const code = `P-${rand()}`;
      const [plot] = await tx.insert(plots).values({ code, name: 'Plot' }).returning();
      expect(plot?.description).toBe('');
      await expect(
        unwrapDbError(
          tx.transaction((sp) => sp.insert(plots).values({ code: code.toLowerCase(), name: 'x' })),
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(plots).values({ code: `Q-${rand()}`, name: 'x', latitude: 91 }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      const sp1 = await createSpecies(tx);
      await tx.insert(plotSpecies).values({ plotId: plot?.id as string, speciesId: sp1.id });
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(plotSpecies).values({ plotId: plot?.id as string, speciesId: sp1.id }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' });
      const { user } = await createUser(tx);
      await tx.insert(userPlots).values({ userId: user.id, plotId: plot?.id as string });
      expect(user.restrictToAssignedPlots).toBe(false);
    });
  });
});

describe('RFC-61 R1, R7, R10 reference kinds', () => {
  const t = useTestDb();
  it('personal observation needs an observer, one per user; a publication has none', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp
              .insert(bibliographicReferences)
              .values({ citationKey: `po-${rand()}`, kind: 'personal_observation' }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await tx.insert(bibliographicReferences).values({
        citationKey: `personal-observation:${user.id}`,
        kind: 'personal_observation',
        observerUserId: user.id,
      });
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(bibliographicReferences).values({
              citationKey: `po2-${rand()}`,
              kind: 'personal_observation',
              observerUserId: user.id,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('RFC-61 R10 a book needs a 13-digit ISBN and a citation; an ISBN is unique and only a book has one', async () => {
    await withRollback(t.db, async (tx) => {
      const isbn = randomIsbn();
      const insert = (values: typeof bibliographicReferences.$inferInsert) =>
        unwrapDbError(tx.transaction((sp) => sp.insert(bibliographicReferences).values(values)));
      // A book without an ISBN, without a citation, or with an ISBN-10 left un-normalised.
      for (const values of [
        { citationKey: `b-${rand()}`, kind: 'book' as const, fullCitation: 'Doe (2001). Seeds.' },
        { citationKey: `b-${rand()}`, kind: 'book' as const, isbn },
        {
          citationKey: `b-${rand()}`,
          kind: 'book' as const,
          isbn: '030640615X',
          fullCitation: 'x',
        },
        // A publication carrying an ISBN.
        { citationKey: `b-${rand()}`, isbn, fullCitation: 'Doe (2001). Seeds.' },
      ]) {
        await expect(insert(values)).rejects.toMatchObject({ code: '23514' });
      }
      await tx.insert(bibliographicReferences).values({
        citationKey: `isbn:${isbn}`,
        kind: 'book',
        isbn,
        fullCitation: 'Doe (2001). Seeds.',
      });
      await expect(
        insert({ citationKey: `b-${rand()}`, kind: 'book', isbn, fullCitation: 'Other' }),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});

describe('RFC-63 R1, R2 intent and responses', () => {
  const t = useTestDb();
  it('R2 responds_to needs an intent, a complement needs responds_to; a response must share species and trait', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      const ref = await createReference(tx);
      const trait = await createTrait(tx);
      const other = await createTrait(tx);
      const sp1 = await createSpecies(tx);
      const level = trait.levels[0]?.id as string;
      const base = await createRecord(tx, {
        speciesId: sp1.id,
        traitId: trait.id,
        valueText: 'alpha',
        levelId: level,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
      const row = (valueText: string, extra: Partial<NewTraitRecordRow>): NewTraitRecordRow => ({
        speciesId: sp1.id,
        traitId: trait.id,
        valueText,
        levelId: trait.levels[1]?.id,
        harmonisation: 'harmonised',
        origin: 'manual',
        createdBy: user.id,
        primaryReferenceId: ref.id,
        ...extra,
      });
      // RFC-63 R14: a categorical contest record responds to no record
      const [contest] = await tx
        .insert(traitRecords)
        .values(row('epsilon', { intent: 'contest' }))
        .returning();
      expect(contest).toMatchObject({ intent: 'contest', respondsToRecordId: null });
      // a complement without respondsToRecordId violates the check
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values(row('gamma', { intent: 'complement' })),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      // respondsToRecordId without an intent violates the check
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values(row('delta', { respondsToRecordId: base.id })),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      // response targeting a different trait is rejected by trigger
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values({
              speciesId: sp1.id,
              traitId: other.id,
              valueText: 'alpha',
              levelId: other.levels[0]?.id,
              harmonisation: 'harmonised',
              origin: 'manual',
              createdBy: user.id,
              primaryReferenceId: ref.id,
              intent: 'contest',
              respondsToRecordId: base.id,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: 'P0001' });
      const [ok] = await tx
        .insert(traitRecords)
        .values({
          speciesId: sp1.id,
          traitId: trait.id,
          valueText: 'beta',
          levelId: trait.levels[1]?.id,
          harmonisation: 'harmonised',
          origin: 'manual',
          createdBy: user.id,
          primaryReferenceId: ref.id,
          intent: 'complement',
          respondsToRecordId: base.id,
        })
        .returning();
      expect(ok?.intent).toBe('complement');
    });
  });
  it('R7 an annotation reference is allowed on confirm only; generated defaults to false', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      const ref = await createReference(tx);
      const trait = await createTrait(tx);
      const sp1 = await createSpecies(tx);
      const rec = await createRecord(tx, {
        speciesId: sp1.id,
        traitId: trait.id,
        valueText: 'alpha',
        levelId: trait.levels[0]?.id,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
      const [a] = await tx
        .insert(recordAnnotations)
        .values({ recordId: rec.id, actorId: user.id, kind: 'confirm', referenceId: ref.id })
        .returning();
      expect(a?.generated).toBe(false);
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(recordAnnotations).values({
              recordId: rec.id,
              actorId: user.id,
              kind: 'dispute',
              note: 'n',
              referenceId: ref.id,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});

describe('RFC-71 R4 per-user contribution indexes', () => {
  const t = useTestDb();

  it('record_annotations and trait_records carry the per-user indexes', async () => {
    const rows = await t.db.execute(sql`
      select indexname from pg_indexes
      where indexname in ('record_annotations_actor_idx', 'trait_records_created_by_idx')
      order by indexname
    `);
    expect(rows.map((r) => r.indexname)).toEqual([
      'record_annotations_actor_idx',
      'trait_records_created_by_idx',
    ]);
  });
});

describe('spec R-1 the accepted value is gone from the database', () => {
  const t = useTestDb();

  it('has no accepted_values table, no trigger function for it, and accepted.manage retired (RFC-30 R1: row kept)', async () => {
    const [row] = (await t.db.execute(sql`
      select to_regclass('public.accepted_values')::text as tbl,
        (select count(*)::int from pg_proc where proname = 'accepted_values_match_record') as fn,
        (select description from permissions where key = 'accepted.manage') as perm_description,
        (select description from permissions where key = 'dataset.export') as export_description
    `)) as unknown as [
      {
        tbl: string | null;
        fn: number;
        perm_description: string | null;
        export_description: string;
      },
    ];
    expect(row).toEqual({
      tbl: null,
      fn: 0,
      perm_description: 'Set and clear the accepted value per species and trait (retired)',
      export_description: 'Download the dataset',
    });
  });
});

describe('RFC-63 R12, R15 record code and quantitative fields (spec R-2, R-5)', () => {
  const t = useTestDb();

  it('record_code defaults to TR_<n>, distinct per row, and is unique', async () => {
    await withRollback(t.db, async (tx) => {
      const sp1 = await createSpecies(tx);
      const trait = await traitByKey(tx, 'petal_length');
      const ref = await createReference(tx);
      const { user } = await createUser(tx);
      const base = {
        speciesId: sp1.id,
        traitId: trait.id,
        harmonisation: 'harmonised' as const,
        origin: 'manual' as const,
        createdBy: user.id,
        primaryReferenceId: ref.id,
      };
      const [a] = await tx
        .insert(traitRecords)
        .values({ ...base, valueText: '1', numericValue: 1 })
        .returning();
      const [b] = await tx
        .insert(traitRecords)
        .values({ ...base, valueText: '2', numericValue: 2 })
        .returning();
      expect(a?.recordCode).toMatch(/^TR_\d+$/);
      expect(b?.recordCode).toMatch(/^TR_\d+$/);
      expect(a?.recordCode).not.toBe(b?.recordCode);
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values({
              ...base,
              valueText: '3',
              numericValue: 3,
              recordCode: a?.recordCode as string,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23505', constraint_name: 'trait_records_record_code_key' });
    });
  });

  it('record_code_suffix letters the parts of a split entry: a…z, aa, ab…', async () => {
    const [row] = await t.db.execute(sql`
      select record_code_suffix(1) as a, record_code_suffix(26) as z, record_code_suffix(27) as aa,
        record_code_suffix(28) as ab, record_code_suffix(702) as zz, record_code_suffix(703) as aaa`);
    expect(row).toEqual({ a: 'a', z: 'z', aa: 'aa', ab: 'ab', zz: 'zz', aaa: 'aaa' });
  });

  it('harmonised needs one of single/min/max/mean; min ≤ max; sd ≥ 0; n ≥ 1; never with a level; implies harmonised', async () => {
    await withRollback(t.db, async (tx) => {
      const sp1 = await createSpecies(tx);
      const petal = await traitByKey(tx, 'petal_length');
      const colour = await traitByKey(tx, 'flower_color');
      const blue = await levelByKey(tx, colour.id, 'blue');
      const ref = await createReference(tx);
      const { user } = await createUser(tx);
      const base = {
        speciesId: sp1.id,
        traitId: petal.id,
        origin: 'manual' as const,
        createdBy: user.id,
        primaryReferenceId: ref.id,
      };
      const refused: Partial<NewTraitRecordRow>[] = [
        { valueText: 'sd=1', harmonisation: 'harmonised', sdValue: 1 },
        { valueText: 'min=5;max=2', harmonisation: 'harmonised', minValue: 5, maxValue: 2 },
        { valueText: 'mean=3;sd=-1', harmonisation: 'harmonised', meanValue: 3, sdValue: -1 },
        { valueText: 'mean=3;n=0', harmonisation: 'harmonised', meanValue: 3, n: 0 },
        { valueText: 'min=1', harmonisation: 'not_numeric', minValue: 1 },
        {
          valueText: 'blue',
          harmonisation: 'harmonised',
          traitId: colour.id,
          levelId: blue.id,
          minValue: 1,
        },
      ];
      for (const row of refused) {
        await expect(
          unwrapDbError(
            tx.transaction((sp) =>
              sp.insert(traitRecords).values({ ...base, ...row } as NewTraitRecordRow),
            ),
          ),
          String(row.valueText),
        ).rejects.toMatchObject({ code: '23514' });
      }
      const [ok] = await tx
        .insert(traitRecords)
        .values({
          ...base,
          valueText: 'min=2;max=8;n=3',
          harmonisation: 'harmonised',
          minValue: 2,
          maxValue: 8,
          n: 3,
        })
        .returning();
      expect(ok).toMatchObject({ minValue: 2, maxValue: 8, n: 3, numericValue: null });
    });
  });
});

describe('RFC-63 R16, RFC-61 R4, R9 record_references (spec R-4)', () => {
  const t = useTestDb();

  it('is keyed on both columns and counts as a primary usage and in reference_traits', async () => {
    await withRollback(t.db, async (tx) => {
      const sp1 = await createSpecies(tx);
      const trait = await traitByKey(tx, 'petal_length');
      const primary = await createReference(tx);
      const extra = await createReference(tx);
      const { user } = await createUser(tx);
      const rec = await createRecord(tx, {
        speciesId: sp1.id,
        traitId: trait.id,
        valueText: '1',
        numericValue: 1,
        primaryReferenceId: primary.id,
        origin: 'manual',
        createdBy: user.id,
      });
      await tx.insert(recordReferences).values({ recordId: rec.id, referenceId: extra.id });
      const [counted] = await tx
        .select({ primaryCount: bibliographicReferences.primaryCount })
        .from(bibliographicReferences)
        .where(eq(bibliographicReferences.id, extra.id));
      expect(counted?.primaryCount).toBe(1);
      const [usage] = await tx
        .select({ recordCount: referenceTraits.recordCount })
        .from(referenceTraits)
        .where(
          and(eq(referenceTraits.referenceId, extra.id), eq(referenceTraits.traitId, trait.id)),
        );
      expect(usage?.recordCount).toBe(1);
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(recordReferences).values({ recordId: rec.id, referenceId: extra.id }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('treerepro_app may read and insert record_references but neither update, delete nor truncate', async () => {
    const rows = await t.db.execute(sql`
      select privilege_type, has_table_privilege('treerepro_app', 'record_references', privilege_type) as granted
      from unnest(array['SELECT', 'INSERT', 'DELETE', 'UPDATE', 'TRUNCATE']) as privilege_type
    `);
    expect(Object.fromEntries(rows.map((r) => [r.privilege_type, r.granted]))).toEqual({
      SELECT: true,
      INSERT: true,
      DELETE: false,
      UPDATE: false,
      TRUNCATE: false,
    });
  });
});
