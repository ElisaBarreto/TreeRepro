import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useTestDb } from '../../test/helpers/db.ts';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { importBatches, importRejects } from '../db/schema/imports.ts';
import { traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { families, genera, species, speciesNames } from '../db/schema/taxa.ts';
import {
  batchReport,
  IMPORT_COLUMNS,
  importRecords,
  listImportBatches,
  listImportRejects,
} from './import.ts';

const FIXTURE = fileURLToPath(
  new URL('../../test/fixtures/import/records-small.csv', import.meta.url),
);

describe('RFC-64 importRecords', () => {
  const t = useTestDb();

  async function recordAt(batchId: string, rowNo: number) {
    const [row] = await t.db
      .select()
      .from(traitRecords)
      .where(and(eq(traitRecords.importBatchId, batchId), eq(traitRecords.importRowNo, rowNo)));
    return row;
  }

  it('R3-R10 loads the fixture: counts, catalogs, harmonisation, rejects, duplicates, idempotency', async () => {
    const batch = await importRecords(t.db, { filePath: FIXTURE });
    expect(batch).toMatchObject({
      fileName: 'records-small.csv',
      status: 'completed',
      rowsTotal: 25,
      rowsInserted: 20,
      rowsDuplicate: 2,
      rowsRejected: 3,
      rowsPending: 5,
      runBy: null,
      error: null,
    });
    expect(batch.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(batch.finishedAt).not.toBeNull();
    expect(batch.unknownLevels).toEqual(
      expect.arrayContaining([
        { trait: 'pollinator_group', value: 'bees', count: 1 },
        { trait: 'growth_form', value: 'shrub;tree', count: 1 },
      ]),
    );

    // R5 taxonomy
    const [family] = await t.db.select().from(families).where(eq(families.name, 'Fixturaceae'));
    const [genus] = await t.db.select().from(genera).where(eq(genera.name, 'Fixturia'));
    expect(genus?.familyId).toBe(family?.id);
    const bySpecies = async (name: string) =>
      (await t.db.select().from(species).where(eq(species.canonicalName, name)))[0];
    expect((await bySpecies('Fixturia alba'))?.nameSource).toBe('wcvp');
    expect(await bySpecies('Fixturia gbifonly')).toMatchObject({
      nameSource: 'gbif',
      genusId: null,
    });
    expect(await bySpecies('Fixturia originalis')).toMatchObject({
      nameSource: 'original',
      genusId: null,
    });
    expect((await bySpecies('Fixturia spacey'))?.genusId).toBe(genus?.id);
    expect(await bySpecies('Orphania sola')).toMatchObject({ nameSource: 'wcvp', genusId: null });
    const rubra = await bySpecies('Fixturia rubra');
    const alternatives = await t.db
      .select({ name: speciesNames.name, key: speciesNames.gbifUsageKey })
      .from(speciesNames)
      .where(eq(speciesNames.speciesId, rubra?.id as string))
      .orderBy(asc(speciesNames.name));
    expect(alternatives).toEqual([
      { name: 'Fixturia rubrum', key: '1004' },
      { name: 'Fixturia synonyma', key: '1005' },
    ]);
    const alba = await bySpecies('Fixturia alba');
    expect(
      await t.db
        .select()
        .from(speciesNames)
        .where(eq(speciesNames.speciesId, alba?.id as string)),
    ).toEqual([]);

    // R5 references
    const keys = (
      await t.db
        .select({ key: bibliographicReferences.citationKey })
        .from(bibliographicReferences)
        .where(eq(bibliographicReferences.citationKey, 'TRYX'))
    ).map((r) => r.key);
    expect(keys).toEqual(['TRYX']);

    // R6 harmonisation
    const [flowerColor] = await t.db.select().from(traits).where(eq(traits.key, 'flower_color'));
    const [darkBlue] = await t.db
      .select()
      .from(traitLevels)
      .where(
        and(eq(traitLevels.traitId, flowerColor?.id as string), eq(traitLevels.key, 'dark_blue')),
      );
    expect(await recordAt(batch.id, 1)).toMatchObject({
      harmonisation: 'harmonised',
      valueText: 'blue',
      rawValue: 'Blue',
      originalTraitName: 'Flower colour',
      rawCategory: 'flower_color',
    });
    expect(await recordAt(batch.id, 2)).toMatchObject({
      harmonisation: 'harmonised',
      numericValue: 12.5,
      levelId: null,
    });
    expect(await recordAt(batch.id, 3)).toMatchObject({
      harmonisation: 'unknown_level',
      levelId: null,
    });
    expect(await recordAt(batch.id, 4)).toMatchObject({ harmonisation: 'multi_value' });
    expect(await recordAt(batch.id, 5)).toMatchObject({
      harmonisation: 'not_numeric',
      numericValue: null,
    });
    expect(await recordAt(batch.id, 6)).toMatchObject({
      harmonisation: 'empty',
      valueText: '',
      rawValue: null,
    });
    expect(await recordAt(batch.id, 7)).toBeUndefined(); // duplicate of 1
    expect(await recordAt(batch.id, 8)).toMatchObject({
      rawValue: 'BLUE',
      harmonisation: 'harmonised',
    });
    expect(await recordAt(batch.id, 20)).toMatchObject({
      harmonisation: 'not_numeric',
      valueText: '1,5',
    });
    const row21 = await recordAt(batch.id, 21);
    const [primary] = await t.db
      .select()
      .from(bibliographicReferences)
      .where(eq(bibliographicReferences.id, row21?.primaryReferenceId as string));
    expect(primary?.citationKey.startsWith('Kühn, I., W. Durka')).toBe(true);
    expect(await recordAt(batch.id, 22)).toBeUndefined(); // duplicate of 1 after trimming
    expect(await recordAt(batch.id, 23)).toMatchObject({
      levelId: darkBlue?.id,
      valueText: 'DARK_BLUE',
      harmonisation: 'harmonised',
    });
    expect(await recordAt(batch.id, 24)).toMatchObject({ numericValue: 100 });
    expect(await recordAt(batch.id, 25)).toMatchObject({ numericValue: -0.5 });
    const row2 = await recordAt(batch.id, 2);
    expect(row2?.primaryReferenceId).not.toBe(row2?.secondaryReferenceId);

    // R7 rejects
    const rejects = await t.db
      .select({
        rowNo: importRejects.rowNo,
        reason: importRejects.reason,
        raw: importRejects.rawRow,
      })
      .from(importRejects)
      .where(eq(importRejects.batchId, batch.id))
      .orderBy(asc(importRejects.rowNo));
    expect(rejects.map((r) => [r.rowNo, r.reason])).toEqual([
      [12, 'no_species_name'],
      [13, 'unknown_trait'],
      [14, 'no_reference'],
    ]);
    expect(rejects[1]?.raw).toMatchObject({
      final_standard_trait: 'not_a_trait',
      wcvp_species: 'Fixturia alba',
    });
    expect(Object.keys(rejects[0]?.raw ?? {})).toHaveLength(15);

    // R10 report
    const report = await batchReport(t.db, batch.id);
    expect(report.harmonisation).toEqual({
      harmonised: 15,
      unknown_level: 1,
      multi_value: 1,
      not_numeric: 2,
      empty: 1,
    });
    expect(report.rejectReasons).toEqual({ no_species_name: 1, unknown_trait: 1, no_reference: 1 });

    // R3 same file again is refused; --force imports zero new rows
    await expect(importRecords(t.db, { filePath: FIXTURE })).rejects.toMatchObject({
      name: 'ImportRefusedError',
      reason: 'already_imported',
      batchId: batch.id,
    });
    const forced = await importRecords(t.db, { filePath: FIXTURE, force: true });
    expect(forced).toMatchObject({
      rowsTotal: 25,
      rowsInserted: 0,
      rowsDuplicate: 22,
      rowsRejected: 3,
      rowsPending: 0,
    });

    // R11 lists
    const page = await listImportBatches(t.db, { limit: 50 });
    const ids = page.data.map((b) => b.id);
    expect(ids.indexOf(forced.id)).toBeLessThan(ids.indexOf(batch.id));
    const first = await listImportRejects(t.db, { batchId: batch.id, limit: 2 });
    expect(first.data.map((r) => r.rowNo)).toEqual([12, 13]);
    expect(first.nextCursor).not.toBeNull();
    const second = await listImportRejects(t.db, {
      batchId: batch.id,
      cursor: first.nextCursor as string,
      limit: 2,
    });
    expect(second.data.map((r) => r.rowNo)).toEqual([14]);
    expect(second.nextCursor).toBeNull();
  });

  it('R2 a wrong header is refused before any batch row exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'import-'));
    const file = join(dir, 'bad-header.csv');
    await writeFile(file, 'species,trait,value\nFixturia alba,flower_color,blue\n');
    await expect(importRecords(t.db, { filePath: file })).rejects.toMatchObject({
      reason: 'header_mismatch',
    });
    expect(
      await t.db.select().from(importBatches).where(eq(importBatches.fileName, 'bad-header.csv')),
    ).toEqual([]);
  });

  it('R9 an insert-time Postgres error rolls back the whole transaction, including catalog inserts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'import-'));
    const file = join(dir, 'overflow.csv');
    const header = IMPORT_COLUMNS.join(',');
    // A well-formed row (15 fields, passes COPY and R7's checks) whose
    // quantitative value matches NUMBER_PATTERN but overflows `numeric` only
    // once cast during the trait_records insert — downstream of every
    // catalog insert (species, in this case), so the rollback has something
    // real to undo.
    await writeFile(
      file,
      `${header}\nOverflowRef,OverflowRef,Overflowia numerica,,,,,,,Plant height,plant_height,plant_form,1e200000,quantitative_or_text,1e200000\n`,
    );
    await expect(importRecords(t.db, { filePath: file })).rejects.toThrow();
    const [batch] = await t.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.fileName, 'overflow.csv'));
    expect(batch?.status).toBe('failed');
    expect(batch?.error).toMatch(/value overflows numeric format/i);
    expect(
      await t.db.select().from(species).where(eq(species.canonicalName, 'Overflowia numerica')),
    ).toEqual([]);
  });

  it('R9 a malformed row fails the batch within the idle timeout instead of hanging', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'import-'));
    const file = join(dir, 'broken.csv');
    const header = IMPORT_COLUMNS.join(',');
    // 16 fields on the data row: COPY refuses the file. postgres.js 3.4.9 can
    // leave the write hanging on this (see the JSDoc on `pipelineWithIdleGuard`
    // in import.ts); either the driver recovers on its own with the real
    // PostgresError, or the idle guard aborts it — both are acceptable here,
    // but it must not take anywhere near the default 60s idle timeout.
    await writeFile(
      file,
      `${header}\nFix_X,Fix_X,Broken sp,Fixturia,Fixturaceae,,,,,t,flower_color,flower_color,x,categorical,x,EXTRA\n`,
    );
    await expect(
      importRecords(t.db, { filePath: file, copyIdleTimeoutMs: 2000 }),
    ).rejects.toThrow();
    const [batch] = await t.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.fileName, 'broken.csv'));
    expect(batch?.status).toBe('failed');
    expect(batch?.error).toMatch(/COPY made no progress|extra data after last expected column/i);
    expect(await t.db.select().from(species).where(eq(species.canonicalName, 'Broken sp'))).toEqual(
      [],
    );
  });
});
