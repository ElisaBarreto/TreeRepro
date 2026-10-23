import { randomBytes, randomInt } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { describe, expect, it } from 'vitest';
import { createImportBatch } from '../../test/helpers/dataset.ts';
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

/** A record code no other test in the shared database uses. */
const freshId = () => `EB_${randomInt(100_000_000, 999_999_999)}`;

describe('RFC-64 importRecords', () => {
  const t = useTestDb();

  async function recordsAt(batchId: string, rowNo: number) {
    return t.db
      .select()
      .from(traitRecords)
      .where(and(eq(traitRecords.importBatchId, batchId), eq(traitRecords.importRowNo, rowNo)))
      .orderBy(traitRecords.valueText);
  }

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
      rowsTotal: 27,
      // issue #299: rows 7 and 22 repeat row 1's claim but are observations of their own
      rowsInserted: 25,
      rowsDuplicate: 0,
      rowsRejected: 3,
      rowsPending: 6,
      runBy: null,
      error: null,
    });
    expect(batch.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(batch.finishedAt).not.toBeNull();
    // clock_timestamp(), not now()/transaction_timestamp() — the real
    // guarantee is the function choice; this is a cheap sanity check.
    expect(new Date(batch.finishedAt as string).getTime()).toBeGreaterThanOrEqual(
      new Date(batch.startedAt).getTime(),
    );
    expect(batch.unknownLevels).toEqual(
      expect.arrayContaining([{ trait: 'pollinator_group', value: 'bees', count: 1 }]),
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
      recordCode: 'EB_1',
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
    // R6 a categorical value containing ';' reports several states: one record per part,
    // each harmonised on its own, both keeping the staged row's raw_value.
    const split = await recordsAt(batch.id, 4);
    expect(split).toHaveLength(2);
    expect(split[0]).toMatchObject({
      recordCode: 'EB_4a',
      harmonisation: 'harmonised',
      valueText: 'shrub',
      rawValue: 'shrub/tree',
    });
    expect(split[1]).toMatchObject({
      recordCode: 'EB_4b',
      harmonisation: 'harmonised',
      valueText: 'tree',
      rawValue: 'shrub/tree',
    });
    expect(split[0]?.levelId).not.toBe(split[1]?.levelId);
    expect(await recordAt(batch.id, 5)).toMatchObject({
      harmonisation: 'not_numeric',
      numericValue: null,
    });
    expect(await recordAt(batch.id, 6)).toMatchObject({
      harmonisation: 'empty',
      valueText: '',
      rawValue: null,
    });
    // row 1's claim again: another observation, stored (issue #299)
    expect(await recordAt(batch.id, 7)).toMatchObject({ valueText: 'blue', recordCode: 'EB_7' });
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
    expect(await recordAt(batch.id, 22)).toMatchObject({ valueText: 'blue', recordCode: 'EB_22' });
    expect(await recordAt(batch.id, 23)).toMatchObject({
      levelId: darkBlue?.id,
      valueText: 'DARK_BLUE',
      harmonisation: 'harmonised',
    });
    expect(await recordAt(batch.id, 24)).toMatchObject({ numericValue: 100 });
    expect(await recordAt(batch.id, 25)).toMatchObject({ numericValue: -0.5 });
    const row2 = await recordAt(batch.id, 2);
    expect(row2?.primaryReferenceId).not.toBe(row2?.secondaryReferenceId);

    // R6 number rule: bounded exponent and magnitude, no numeric overflow on either
    const overLong = await t.db
      .select({
        harmonisation: traitRecords.harmonisation,
        numericValue: traitRecords.numericValue,
      })
      .from(traitRecords)
      .where(
        and(
          eq(traitRecords.importBatchId, batch.id),
          inArray(traitRecords.valueText, ['1e200000', '1e400']),
        ),
      );
    expect(overLong).toHaveLength(2);
    for (const row of overLong) {
      expect(row.harmonisation).toBe('not_numeric');
      expect(row.numericValue).toBeNull();
    }

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
    // R2, R7: every column of the file, ID included.
    expect(Object.keys(rejects[0]?.raw ?? {}).sort()).toEqual([...IMPORT_COLUMNS].sort());
    expect(rejects[0]?.raw).toMatchObject({ ID: 'EB_12' });

    // R10 report
    const report = await batchReport(t.db, batch.id);
    expect(report.harmonisation).toEqual({
      harmonised: 19,
      unknown_level: 1,
      multi_value: 0,
      not_numeric: 4,
      empty: 1,
    });
    expect(report.rejectReasons).toMatchObject({
      no_species_name: 1,
      unknown_trait: 1,
      no_reference: 1,
    });

    // R3 same file again is refused; --force imports zero new rows
    await expect(importRecords(t.db, { filePath: FIXTURE })).rejects.toMatchObject({
      name: 'ImportRefusedError',
      reason: 'already_imported',
      batchId: batch.id,
    });
    // R14: every row whose ID is stored is skipped — the 24 rows with records,
    // row 4 included although its records are EB_4a/EB_4b — and the fixture's
    // own three rejects reject again. No second record anywhere.
    const forced = await importRecords(t.db, { filePath: FIXTURE, force: true });
    expect(forced).toMatchObject({
      rowsTotal: 27,
      rowsInserted: 0,
      rowsDuplicate: 0,
      rowsRejected: 3,
      rowsAlreadyImported: 24,
      rowsFiltered: 0,
      rowsPending: 0,
    });
    expect((await batchReport(t.db, forced.id)).rejectReasons).toMatchObject({
      no_species_name: 1,
      unknown_trait: 1,
      no_reference: 1,
      duplicate_record_id: 0,
      invalid_record_id: 0,
    });
    expect(batch.rowsAlreadyImported).toBe(0);

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
    // RFC-11 R10: the rejects sort either way.
    const descending = await listImportRejects(t.db, {
      batchId: batch.id,
      sort: 'row',
      order: 'desc',
      limit: 50,
    });
    expect(descending.data.map((r) => r.rowNo)).toEqual([14, 13, 12]);
  });

  it('R11 sorts the batches by a column either way, the cursor tied to it (RFC-11 R10)', async () => {
    const k = Math.random().toString(16).slice(2);
    const aa = await createImportBatch(t.db, { fileName: `aa-${k}.csv` });
    const zz = await createImportBatch(t.db, { fileName: `zz-${k}.csv` });
    const ids = async (sort: 'file' | 'started', order: 'asc' | 'desc') => {
      const out: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await listImportBatches(t.db, { sort, order, limit: 100, cursor });
        out.push(...page.data.map((b) => b.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return out.filter((id) => id === aa.id || id === zz.id);
    };
    expect(await ids('file', 'asc')).toEqual([aa.id, zz.id]);
    expect(await ids('file', 'desc')).toEqual([zz.id, aa.id]);
    const first = await listImportBatches(t.db, { sort: 'file', limit: 1 });
    await expect(
      listImportBatches(t.db, {
        sort: 'file',
        order: 'desc',
        limit: 1,
        cursor: first.nextCursor ?? undefined,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('R6 collapses internal whitespace so a multi-word level still matches', async () => {
    // `sexual_system` has the level `hermaphrodite or monoecious`. Trimming alone leaves the
    // doubled space, and the match is an equality on the key, so the value
    // would land as unknown_level.
    const dir = await mkdtemp(join(tmpdir(), 'import-ws-'));
    const file = join(dir, 'whitespace.csv');
    const row = IMPORT_COLUMNS.map((c) =>
      c === 'ID'
        ? freshId()
        : c === 'primary_reference'
          ? 'WSREF'
          : c === 'wcvp_species'
            ? 'Fixturia spatia'
            : c === 'final_standard_trait'
              ? 'sexual_system'
              : c === 'trait_value_type'
                ? 'categorical'
                : c === 'harmonised_value'
                  ? 'hermaphrodite   or  monoecious'
                  : '',
    ).join(',');
    await writeFile(file, `${IMPORT_COLUMNS.join(',')}\n${row}\n`, 'utf8');

    const batch = await importRecords(t.db, { filePath: file });
    const [record] = await t.db
      .select()
      .from(traitRecords)
      .where(eq(traitRecords.importBatchId, batch.id));
    expect(record).toMatchObject({
      harmonisation: 'harmonised',
      valueText: 'hermaphrodite or monoecious',
    });
    expect(record?.levelId).not.toBeNull();
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
    // A well-formed row (37 fields, the empty one being `species`; passes COPY and R7's checks) whose
    // reference is too large — and incompressible, so TOAST can't shrink it
    // under the limit — to fit a btree index entry. The bibliographic
    // references insert runs after the species catalog insert, so its
    // failure gives the rollback something real to undo. (RFC-64 R6 now
    // bounds every quantitative value below the numeric cast's own overflow
    // point, so that former trigger — an unbounded exponent — no longer
    // reaches Postgres at all; this is a different, still-genuine failure.)
    const hugeRef = randomBytes(3000).toString('hex');
    await writeFile(
      file,
      `${header}\n${freshId()},,${hugeRef},${hugeRef},Overflowia numerica,,,,,,,,,Plant height,plant_height,plant_form,1,quantitative_or_text,1${','.repeat(18)}\n`,
    );
    await expect(importRecords(t.db, { filePath: file })).rejects.toThrow();
    const [batch] = await t.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.fileName, 'overflow.csv'));
    expect(batch?.status).toBe('failed');
    expect(batch?.error).toMatch(/index row size|exceeds btree/i);
    expect(
      await t.db.select().from(species).where(eq(species.canonicalName, 'Overflowia numerica')),
    ).toEqual([]);
  });

  it('R9 a malformed row fails the batch within the idle timeout instead of hanging', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'import-'));
    const file = join(dir, 'broken.csv');
    const header = IMPORT_COLUMNS.join(',');
    // 38 fields on the data row: COPY refuses the file. postgres.js 3.4.9 can
    // leave the write hanging on this (see the JSDoc on `pipelineWithIdleGuard`
    // in import.ts); either the driver recovers on its own with the real
    // PostgresError, or the idle guard aborts it — both are acceptable here,
    // but it must not take anywhere near the default 60s idle timeout.
    await writeFile(
      file,
      `${header}\n${freshId()},,Fix_X,Fix_X,Broken sp,Fixturia,Fixturaceae,,,,,,,t,flower_color,flower_color,x,categorical,x${','.repeat(18)},EXTRA\n`,
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

  it('R5 a whitespace-only wcvp_species falls through to gbif_species for both the name and its source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'import-'));
    const file = join(dir, 'tab-only.csv');
    const header = IMPORT_COLUMNS.join(',');
    const gbifName = `Tabby gbif-${randomBytes(4).toString('hex')}`;
    // wcvp_species is a quoted tab: `trim()` alone (space only) leaves it
    // non-empty, so `name_source` must be decided on the same
    // whitespace-collapsing normalisation as `species_name`, not on the raw
    // column — otherwise this row would wrongly get `name_source = 'wcvp'`
    // while `species_name` itself already fell through to `gbif_species`.
    const row = IMPORT_COLUMNS.map((c) =>
      c === 'ID' ? freshId() : c === 'wcvp_species' ? '"\t"' : c === 'gbif_species' ? gbifName : '',
    ).join(',');
    await writeFile(file, `${header}\n${row}\n`);
    await importRecords(t.db, { filePath: file });
    const [created] = await t.db.select().from(species).where(eq(species.canonicalName, gbifName));
    expect(created).toMatchObject({ nameSource: 'gbif', canonicalName: gbifName });
  });
  /** One records-file line: `ID`, a petal_length value, and a species of its own. */
  function idLine(name: string, id: string, value: string, overrides: Record<string, string> = {}) {
    return IMPORT_COLUMNS.map((c) =>
      c in overrides
        ? (overrides[c] as string)
        : c === 'ID'
          ? id
          : c === 'primary_reference'
            ? 'IDREF'
            : c === 'wcvp_species'
              ? name
              : c === 'final_standard_trait'
                ? 'petal_length'
                : c === 'trait_value_type'
                  ? 'quantitative_or_text'
                  : c === 'harmonised_value'
                    ? value
                    : '',
    ).join(',');
  }

  async function writeRecords(prefix: string, lines: string[]) {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    const file = join(dir, `${prefix}${randomBytes(4).toString('hex')}.csv`);
    await writeFile(file, `${IMPORT_COLUMNS.join(',')}\n${lines.join('\n')}\n`, 'utf8');
    return file;
  }

  async function rejectsOf(batchId: string) {
    return t.db
      .select({
        rowNo: importRejects.rowNo,
        reason: importRejects.reason,
        raw: importRejects.rawRow,
      })
      .from(importRejects)
      .where(eq(importRejects.batchId, batchId))
      .orderBy(asc(importRejects.rowNo));
  }

  it('R2, R7, R8 spec R-2: ID required, ^EB_[0-9]+$, not carried by an earlier row of the file', async () => {
    const n = randomInt(100_000_000, 999_999_000);
    const name = `Fixturia identica-${randomBytes(4).toString('hex')}`;
    const file = await writeRecords('import-id-', [
      idLine(name, '', '1'),
      idLine(name, 'EB_x', '2'),
      idLine(name, 'TR_5', '3'),
      idLine(name, `EB_${n}`, '4'),
      idLine(name, `EB_${n}`, '5'),
      idLine(name, `EB_${n + 1}`, '6'),
    ]);

    const batch = await importRecords(t.db, { filePath: file });
    expect(batch).toMatchObject({
      rowsTotal: 6,
      rowsInserted: 2,
      rowsRejected: 4,
      rowsDuplicate: 0,
      rowsAlreadyImported: 0,
      rowsFiltered: 0,
    });
    const rejects = await rejectsOf(batch.id);
    expect(rejects.map((r) => [r.rowNo, r.reason])).toEqual([
      [1, 'invalid_record_id'],
      [2, 'invalid_record_id'],
      [3, 'invalid_record_id'],
      [5, 'duplicate_record_id'],
    ]);
    expect(rejects[1]?.raw).toMatchObject({ ID: 'EB_x', harmonised_value: '2' });
    expect(await recordAt(batch.id, 4)).toMatchObject({ recordCode: `EB_${n}`, numericValue: 4 });
    expect(await recordAt(batch.id, 6)).toMatchObject({
      recordCode: `EB_${n + 1}`,
      numericValue: 6,
    });
  });

  it('R7 an older reason outranks an ID problem', async () => {
    const name = `Fixturia ordinata-${randomBytes(4).toString('hex')}`;
    const file = await writeRecords('import-order-', [
      idLine(name, 'EB_bad', '1', { final_standard_trait: 'not_a_trait' }),
    ]);
    const batch = await importRecords(t.db, { filePath: file });
    expect((await rejectsOf(batch.id)).map((r) => r.reason)).toEqual(['unknown_trait']);
  });

  it('R14 an incremental file: stored IDs (bare or split) are skipped, new IDs are added', async () => {
    const n = randomInt(100_000_000, 999_999_000);
    const name = `Fixturia incrementa-${randomBytes(4).toString('hex')}`;
    const splitRow = (id: string) =>
      idLine(name, id, 'shrub;tree', {
        final_standard_trait: 'growth_form',
        trait_value_type: 'categorical',
      });
    const first = await importRecords(t.db, {
      filePath: await writeRecords('import-inc1-', [
        idLine(name, `EB_${n}`, '1'),
        splitRow(`EB_${n + 1}`),
        idLine(name, `EB_${n + 3}`, '7'),
      ]),
    });
    expect(first).toMatchObject({ rowsInserted: 4, rowsAlreadyImported: 0 });
    expect((await recordsAt(first.id, 2)).map((r) => r.recordCode)).toEqual([
      `EB_${n + 1}a`,
      `EB_${n + 1}b`,
    ]);

    // The full file again, grown by two rows. Stored rows are skipped even with a
    // changed value or no species name at all: the skip comes before every other
    // reason. An ID that is new is imported.
    const second = await importRecords(t.db, {
      filePath: await writeRecords('import-inc2-', [
        idLine(name, `EB_${n}`, '99'),
        splitRow(`EB_${n + 1}`),
        idLine(name, `EB_${n + 3}`, '5', { wcvp_species: '' }),
        idLine(name, `EB_${n + 2}`, '3'),
        idLine(name, 'EB_oops', '4'),
      ]),
    });
    expect(second).toMatchObject({
      rowsTotal: 5,
      rowsInserted: 1,
      rowsRejected: 1,
      rowsDuplicate: 0,
      rowsAlreadyImported: 3,
      rowsFiltered: 0,
    });
    expect((await rejectsOf(second.id)).map((r) => [r.rowNo, r.reason])).toEqual([
      [5, 'invalid_record_id'],
    ]);
    expect(await recordAt(second.id, 4)).toMatchObject({
      recordCode: `EB_${n + 2}`,
      numericValue: 3,
    });
    const stored = await t.db
      .select({ code: traitRecords.recordCode, value: traitRecords.numericValue })
      .from(traitRecords)
      .where(inArray(traitRecords.recordCode, [`EB_${n}`, `EB_${n + 1}a`, `EB_${n + 1}b`]))
      .orderBy(asc(traitRecords.recordCode));
    expect(stored.map((r) => r.code)).toEqual([`EB_${n}`, `EB_${n + 1}a`, `EB_${n + 1}b`]);
    expect(stored[0]?.value).toBe(1);
  });

  it('R14 a split row stored only as a later part (its part a lost to an earlier claim) is already imported', async () => {
    const n = randomInt(100_000_000, 999_999_000);
    const name = `Fixturia partialis-${randomBytes(4).toString('hex')}`;
    const categorical = (id: string, value: string) =>
      idLine(name, id, value, {
        final_standard_trait: 'growth_form',
        trait_value_type: 'categorical',
      });
    // Row 2's part a (`shrub`) repeats row 1's claim; both parts are stored all the same (issue #299).
    const lines = [categorical(`EB_${n}`, 'shrub'), categorical(`EB_${n + 1}`, 'shrub;tree')];
    const first = await importRecords(t.db, {
      filePath: await writeRecords('import-part1-', lines),
    });
    expect((await recordsAt(first.id, 2)).map((r) => r.recordCode).sort()).toEqual([
      `EB_${n + 1}a`,
      `EB_${n + 1}b`,
    ]);

    // The same file again: both rows are already imported, none a duplicate.
    const same = await importRecords(t.db, {
      filePath: await writeRecords('import-part2-', lines),
      force: true,
    });
    expect(same).toMatchObject({ rowsInserted: 0, rowsDuplicate: 0, rowsAlreadyImported: 2 });

    // A changed value: part b would be a new claim reusing `EB_<n+1>b`; it is skipped instead.
    const changed = await importRecords(t.db, {
      filePath: await writeRecords('import-part3-', [categorical(`EB_${n + 1}`, 'shrub;liana-x')]),
    });
    expect(changed).toMatchObject({
      status: 'completed',
      rowsInserted: 0,
      rowsRejected: 0,
      rowsAlreadyImported: 1,
      rowsFiltered: 0,
    });
  });

  it('R14 a stored EB_<n>0 does not mark EB_<n> as imported', async () => {
    const n = randomInt(10_000_000, 99_999_999);
    const name = `Fixturia decima-${randomBytes(4).toString('hex')}`;
    await importRecords(t.db, {
      filePath: await writeRecords('import-dec1-', [idLine(name, `EB_${n}0`, '1')]),
    });
    const next = await importRecords(t.db, {
      filePath: await writeRecords('import-dec2-', [idLine(name, `EB_${n}`, '2')]),
    });
    expect(next).toMatchObject({ rowsInserted: 1, rowsAlreadyImported: 0 });
  });

  it('R7, R14 a stored ID repeated within the file is rejected on its repeat, not skipped', async () => {
    const n = randomInt(100_000_000, 999_999_000);
    const name = `Fixturia repetita-${randomBytes(4).toString('hex')}`;
    await importRecords(t.db, {
      filePath: await writeRecords('import-rep1-', [idLine(name, `EB_${n}`, '1')]),
    });
    const again = await importRecords(t.db, {
      filePath: await writeRecords('import-rep2-', [
        idLine(name, `EB_${n}`, '1'),
        idLine(name, `EB_${n}`, '2'),
      ]),
    });
    expect(again).toMatchObject({
      rowsTotal: 2,
      rowsInserted: 0,
      rowsRejected: 1,
      rowsAlreadyImported: 1,
      rowsFiltered: 0,
      rowsDuplicate: 0,
    });
    expect((await rejectsOf(again.id)).map((r) => [r.rowNo, r.reason])).toEqual([
      [2, 'duplicate_record_id'],
    ]);
  });

  describe('RFC-64 R6 statistics', () => {
    type Column = (typeof IMPORT_COLUMNS)[number];
    /** One records-file line keyed by column name, joined in file order; a cell with a comma is quoted. */
    const statLine = (cells: Partial<Record<Column, string>>) =>
      IMPORT_COLUMNS.map((c) => {
        const v = cells[c] ?? '';
        return v.includes(',') ? `"${v}"` : v;
      }).join(',');

    it('R2, R5-R7 reads the value, the statistic columns, range, spread, sample size, unit, provenance and order', async () => {
      const tag = randomBytes(4).toString('hex');
      const family = `Statisticaceae${tag}`;
      const name = `Statistica mensura-${tag}`;
      const n = randomInt(100_000_000, 999_999_000);
      let next = 0;
      const base = (cells: Partial<Record<Column, string>>) =>
        statLine({
          ID: `EB_${n + next++}`,
          primary_reference: 'STATREF',
          wcvp_species: name,
          wcvp_family: family,
          final_standard_trait: 'seed_mass_dry',
          trait_value_type: 'quantitative',
          ...cells,
        });
      const categorical = { final_standard_trait: 'flower_color', trait_value_type: 'categorical' };
      const lines = [
        // 1 A: a mean from its own column with its range and spread;
        // taxon_order, unit, summary_source and records_behind_row are only provenance
        base({
          harmonised_value: '',
          mean: '9.3',
          min: '6.2',
          max: '18.8',
          sd: '0.5',
          se: '0.1',
          sample_size: '30',
          summary_source: 'reported_by_study',
          unit: 'mg / seed',
          unit_harmonisation_status: 'converted_or_already_target',
          source_folder: 'GIFT',
          file_name: 'seeds.csv',
          wcvp_taxonomic_status: 'exact',
          gbif_genus: 'Statistica',
          gbif_family: 'Statisticaceae',
          taxon_order: 'Rosales',
          records_behind_row: '4',
        }),
        // 2 B: a bound alone, no midpoint computed
        base({ harmonised_value: '', min: '4', max: '8', gbif_order: 'Sapindales' }),
        // 3 C: a median alone, with a spread around it
        base({ median: '7', se: '0.2' }),
        // 4 D: harmonised_value is the single value, whatever else the row holds
        base({ harmonised_value: '5', statistic: 'single_or_unspecified' }),
        // 5 E: every split part keeps the row's provenance; a categorical row
        // ignores the statistic columns
        base({
          ...categorical,
          harmonised_value: 'black;brown',
          min: '3',
          mean: 'abc',
          unit_harmonisation_status: 'not_applicable',
          source_folder: 'X',
          gbif_genus: 'Statistica',
          gbif_family: 'Statisticaceae',
          taxon_order: 'Rosales',
          unit: 'RHS colour chart',
          summary_source: 'derived_from_records',
          records_behind_row: '2',
        }),
        // 6 F: a measurement and the study's mean and median on one row
        base({ harmonised_value: '5', mean: '6', median: '5.5' }),
        // 7-25 rejects
        base({ harmonised_value: '1', statistic: 'min' }),
        base({ harmonised_value: '1', min: '20', max: '4' }),
        base({ harmonised_value: '1', sd: '1,5' }),
        base({ harmonised_value: '1', sd: '-1' }),
        base({ harmonised_value: '1', sample_size: '0' }),
        base({ harmonised_value: '1', sample_size: '2.5' }),
        base({ harmonised_value: 'abc', sd: '1' }),
        base({ harmonised_value: '', sd: '1' }),
        base({ harmonised_value: '1', unit_harmonisation_status: 'weird' }),
        base({ harmonised_value: '2.4', statistic: 'derived_midpoint', min: '0.8', max: '4.0' }),
        // 17, 18: mean and median have their own columns now
        base({ harmonised_value: '5', statistic: 'mean' }),
        base({ harmonised_value: '5', statistic: 'median' }),
        // 19, 20: mean and median follow the number rule
        base({ harmonised_value: '1', mean: '1,5' }),
        base({ median: 'abc' }),
        // 21: a value that is not a number beside a mean
        base({ harmonised_value: 'abc', mean: '2' }),
        // 22, 23: summary_source and records_behind_row are checked on every row
        base({ ...categorical, harmonised_value: 'white', summary_source: 'weird' }),
        base({ ...categorical, harmonised_value: 'white', records_behind_row: '0' }),
        base({ harmonised_value: '1', records_behind_row: '2.5' }),
        base({ harmonised_value: '1', records_behind_row: '9999999999' }),
        // 26 unknown trait outranks invalid_measurement
        base({ harmonised_value: '1', final_standard_trait: 'not_a_trait', statistic: 'min' }),
        // 27 a later row of the family with another order does not change it
        base({ harmonised_value: '7', gbif_order: 'Fabales' }),
      ];
      const batch = await importRecords(t.db, {
        filePath: await writeRecords('import-stat-', lines),
      });
      expect(batch).toMatchObject({ status: 'completed', rowsTotal: 27, rowsRejected: 20 });

      expect(await recordAt(batch.id, 1)).toMatchObject({
        harmonisation: 'harmonised',
        numericValue: null,
        meanValue: 9.3,
        medianValue: null,
        minValue: 6.2,
        maxValue: 18.8,
        sdValue: 0.5,
        seValue: 0.1,
        n: 30,
        valueText: 'min=6.2;max=18.8;mean=9.3;sd=0.5;se=0.1;n=30',
        unitStatus: 'converted_or_already_target',
        sourceFolder: 'GIFT',
        sourceFile: 'seeds.csv',
        taxonomicStatus: 'exact',
        gbifGenus: 'Statistica',
        gbifFamily: 'Statisticaceae',
        taxonOrder: 'Rosales',
        unit: 'mg / seed',
        summarySource: 'reported_by_study',
        recordsBehindRow: 4,
      });
      expect(await recordAt(batch.id, 2)).toMatchObject({
        harmonisation: 'harmonised',
        numericValue: null,
        meanValue: null,
        medianValue: null,
        minValue: 4,
        maxValue: 8,
        valueText: 'min=4;max=8',
        gbifGenus: null,
        gbifFamily: null,
        taxonOrder: null,
        unit: null,
        summarySource: null,
        recordsBehindRow: null,
      });
      expect(await recordAt(batch.id, 3)).toMatchObject({
        harmonisation: 'harmonised',
        numericValue: null,
        meanValue: null,
        medianValue: 7,
        seValue: 0.2,
        valueText: 'median=7;se=0.2',
      });
      expect(await recordAt(batch.id, 4)).toMatchObject({
        harmonisation: 'harmonised',
        numericValue: 5,
        meanValue: null,
        medianValue: null,
        valueText: '5',
      });
      const parts = await recordsAt(batch.id, 5);
      expect(parts).toHaveLength(2);
      for (const part of parts) {
        expect(part).toMatchObject({
          harmonisation: 'harmonised',
          minValue: null,
          meanValue: null,
          unitStatus: 'not_applicable',
          sourceFolder: 'X',
          gbifGenus: 'Statistica',
          gbifFamily: 'Statisticaceae',
          taxonOrder: 'Rosales',
          unit: 'RHS colour chart',
          summarySource: 'derived_from_records',
          recordsBehindRow: 2,
        });
      }
      expect(await recordAt(batch.id, 6)).toMatchObject({
        harmonisation: 'harmonised',
        numericValue: 5,
        meanValue: 6,
        medianValue: 5.5,
        valueText: 'single=5;mean=6;median=5.5',
      });

      const rejects = await rejectsOf(batch.id);
      expect(rejects.map((r) => [r.rowNo, r.reason])).toEqual([
        ...Array.from({ length: 19 }, (_, i) => [i + 7, 'invalid_measurement']),
        [26, 'unknown_trait'],
      ]);
      for (const reject of rejects) {
        expect(Object.keys(reject.raw ?? {}).sort()).toEqual([...IMPORT_COLUMNS].sort());
      }
      expect(rejects[2]?.raw).toMatchObject({ sd: '1,5', harmonised_value: '1' });
      expect(rejects[9]?.raw).toMatchObject({ statistic: 'derived_midpoint' });
      expect(rejects[12]?.raw).toMatchObject({ mean: '1,5' });
      expect(rejects[15]?.raw).toMatchObject({ summary_source: 'weird' });
      expect((await batchReport(t.db, batch.id)).rejectReasons).toMatchObject({
        invalid_measurement: 19,
        unknown_trait: 1,
      });

      // R5: the first non-empty gbif_order (never taxon_order) fills a null
      // order_name; a set one is never changed.
      const orderOf = async () =>
        (await t.db.select().from(families).where(eq(families.name, family)))[0]?.orderName;
      expect(await orderOf()).toBe('Sapindales');
      await importRecords(t.db, {
        filePath: await writeRecords('import-stat2-', [
          base({ harmonised_value: '8', gbif_order: 'Malvales' }),
        ]),
      });
      expect(await orderOf()).toBe('Sapindales');
    });

    it('R6, R7 outlier_flag is stored on every record of the row and checked on every row (#281, v1 values #288)', async () => {
      const tag = randomBytes(4).toString('hex');
      const n = randomInt(100_000_000, 999_999_000);
      let next = 0;
      const base = (cells: Partial<Record<Column, string>>) =>
        statLine({
          ID: `EB_${n + next++}`,
          primary_reference: 'OUTREF',
          wcvp_species: `Outlieria rara-${tag}`,
          wcvp_family: `Outlieriaceae${tag}`,
          final_standard_trait: 'seed_mass_dry',
          trait_value_type: 'quantitative',
          ...cells,
        });
      const categorical = { final_standard_trait: 'flower_color', trait_value_type: 'categorical' };
      const lines = [
        base({ harmonised_value: '1', outlier_flag: 'unit_factor' }),
        // trimmed and collapsed like every provenance column
        base({ harmonised_value: '2', outlier_flag: '  trait_extreme ' }),
        // every split part keeps the row's flag
        base({
          ...categorical,
          harmonised_value: 'black;brown',
          outlier_flag: 'unit_factor;trait_extreme',
        }),
        base({ harmonised_value: '3' }),
        // 5, 6 rejects: case matters, and the check runs on a categorical row too
        base({ harmonised_value: '4', outlier_flag: 'Trait_extreme' }),
        base({ ...categorical, harmonised_value: 'white', outlier_flag: 'weird' }),
        // 7, 8 rejects: the pre-v1 values are gone
        base({ harmonised_value: '5', outlier_flag: 'species_disagreement' }),
        base({ harmonised_value: '6', outlier_flag: 'both' }),
        // 9: bounds the source inverted, left out by the pipeline (issue #303)
        base({ harmonised_value: '7', outlier_flag: 'bounds_inverted' }),
      ];
      const batch = await importRecords(t.db, {
        filePath: await writeRecords('import-outlier-', lines),
      });
      expect(batch).toMatchObject({ status: 'completed', rowsTotal: 9, rowsRejected: 4 });
      expect(await recordAt(batch.id, 9)).toMatchObject({ outlierFlag: 'bounds_inverted' });
      expect(await recordAt(batch.id, 1)).toMatchObject({ outlierFlag: 'unit_factor' });
      // the flag stays out of value_text (RFC-63 R3)
      expect(await recordAt(batch.id, 2)).toMatchObject({
        outlierFlag: 'trait_extreme',
        valueText: '2',
      });
      const parts = await recordsAt(batch.id, 3);
      expect(parts).toHaveLength(2);
      for (const part of parts)
        expect(part).toMatchObject({ outlierFlag: 'unit_factor;trait_extreme' });
      expect(await recordAt(batch.id, 4)).toMatchObject({ outlierFlag: null });
      const rejects = await rejectsOf(batch.id);
      expect(rejects.map((r) => [r.rowNo, r.reason])).toEqual([
        [5, 'invalid_measurement'],
        [6, 'invalid_measurement'],
        [7, 'invalid_measurement'],
        [8, 'invalid_measurement'],
      ]);
      expect(rejects[0]?.raw).toMatchObject({ outlier_flag: 'Trait_extreme' });
    });

    it('RFC-63 R3, R15: a single 5, a mean 5 and a median 5 from the same source are three claims', async () => {
      const tag = randomBytes(4).toString('hex');
      const n = randomInt(100_000_000, 999_999_000);
      let next = 0;
      const row = (cells: Partial<Record<Column, string>>) =>
        statLine({
          ID: `EB_${n + next++}`,
          primary_reference: 'STATREF',
          wcvp_species: `Statistica gemella-${tag}`,
          final_standard_trait: 'seed_mass_dry',
          trait_value_type: 'quantitative',
          original_value_clean: '5',
          ...cells,
        });
      const batch = await importRecords(t.db, {
        filePath: await writeRecords('import-stat-claim-', [
          row({ harmonised_value: '5', statistic: 'single_or_unspecified' }),
          row({ mean: '5' }),
          row({ median: '5' }),
          // an empty statistic is a single value: row 1's claim, another observation (issue #299)
          row({ harmonised_value: '5' }),
          // RFC-63 R15 order: single, min, max, mean, median, sd, se, n
          row({ harmonised_value: '9.3', min: '6.2', max: '18.8' }),
          row({ median: '4', sd: '1', sample_size: '3' }),
          // unit, summary_source and records_behind_row stay out of the claim, which only its row makes new
          row({ harmonised_value: '5', unit: 'g', summary_source: 'reported_by_study' }),
        ]),
      });
      expect(batch).toMatchObject({ status: 'completed', rowsInserted: 7, rowsDuplicate: 0 });
      expect(await recordAt(batch.id, 1)).toMatchObject({ numericValue: 5, valueText: '5' });
      expect(await recordAt(batch.id, 2)).toMatchObject({ meanValue: 5, valueText: 'mean=5' });
      expect(await recordAt(batch.id, 3)).toMatchObject({ medianValue: 5, valueText: 'median=5' });
      expect(await recordAt(batch.id, 4)).toMatchObject({ numericValue: 5, valueText: '5' });
      expect(await recordAt(batch.id, 5)).toMatchObject({
        valueText: 'single=9.3;min=6.2;max=18.8',
      });
      expect(await recordAt(batch.id, 6)).toMatchObject({ valueText: 'median=4;sd=1;n=3' });
      expect(await recordAt(batch.id, 7)).toMatchObject({ valueText: '5', unit: 'g' });
    });

    it('R7 invalid_measurement: the statistic columns are checked on a quantitative trait only', async () => {
      const tag = randomBytes(4).toString('hex');
      const n = randomInt(100_000_000, 999_999_000);
      let next = 0;
      const row = (cells: Partial<Record<Column, string>>) =>
        statLine({
          ID: `EB_${n + next++}`,
          primary_reference: 'STATREF',
          wcvp_species: `Statistica scopa-${tag}`,
          final_standard_trait: 'seed_mass_dry',
          trait_value_type: 'quantitative',
          ...cells,
        });
      const categorical = { final_standard_trait: 'flower_color', trait_value_type: 'categorical' };
      const batch = await importRecords(t.db, {
        filePath: await writeRecords('import-stat-scope-', [
          row({ ...categorical, harmonised_value: 'black', sd: 'abc' }),
          row({ ...categorical, harmonised_value: 'brown', min: '20', max: '4' }),
          row({ ...categorical, harmonised_value: 'blue', mean: 'abc', median: '-1,2' }),
          row({ harmonised_value: '', sample_size: '30' }),
          row({ harmonised_value: '1', sample_size: '9999999999' }),
        ]),
      });
      expect(batch).toMatchObject({ status: 'completed', rowsInserted: 3, rowsRejected: 2 });
      for (const rowNo of [1, 2, 3]) {
        expect(await recordAt(batch.id, rowNo)).toMatchObject({
          harmonisation: 'harmonised',
          minValue: null,
          maxValue: null,
          meanValue: null,
          medianValue: null,
          sdValue: null,
        });
      }
      expect((await rejectsOf(batch.id)).map((r) => [r.rowNo, r.reason])).toEqual([
        [4, 'invalid_measurement'],
        [5, 'invalid_measurement'],
      ]);
    });
  });

  describe('RFC-64 R2, R4, R5 release v1: by name, Parquet, --trees-only (#288)', () => {
    type Cells = Record<string, string | boolean | null>;
    const tag = () => randomBytes(4).toString('hex');
    /** A row of IMPORT_COLUMNS plus is_tree_species, from a few cells. */
    const row = (cells: Cells): Cells => ({
      ...Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, ''])),
      is_tree_species: true,
      primary_reference: 'V1REF',
      final_standard_trait: 'flower_color',
      trait_value_type: 'categorical',
      harmonised_value: 'blue',
      ...cells,
    });
    const columnsOf = (rows: Cells[]) => Object.keys(rows[0] as Cells);
    async function writeCsv(rows: Cells[]) {
      const dir = await mkdtemp(join(tmpdir(), 'v1-csv-'));
      const file = join(dir, 'observations.csv');
      const columns = columnsOf(rows).reverse(); // names, not positions
      const cell = (v: Cells[string]) => (v === null ? '' : `"${String(v).replaceAll('"', '""')}"`);
      const body = rows.map((r) => columns.map((c) => cell(r[c] ?? null)).join(','));
      await writeFile(
        file,
        `${columns.join(',')},sheet\n${body.map((b) => `${b},Sheet1`).join('\n')}\n`,
      );
      return file;
    }
    async function writeParquet(rows: Cells[]) {
      const dir = await mkdtemp(join(tmpdir(), 'v1-pq-'));
      const file = join(dir, 'observations.parquet');
      const columnData = columnsOf(rows).map((name) =>
        name === 'is_tree_species'
          ? { name, data: rows.map((r) => r[name] as boolean | null), type: 'BOOLEAN' as const }
          : {
              name,
              data: rows.map((r) => (r[name] === '' ? null : (r[name] as string))),
              type: 'STRING' as const,
            },
      );
      await writeFile(file, Buffer.from(parquetWriteBuffer({ columnData })));
      return file;
    }
    async function speciesOf(batchId: string) {
      return t.db
        .select({
          rowNo: traitRecords.importRowNo,
          name: species.canonicalName,
          source: species.nameSource,
        })
        .from(traitRecords)
        .innerJoin(species, eq(species.id, traitRecords.speciesId))
        .where(eq(traitRecords.importBatchId, batchId))
        .orderBy(asc(traitRecords.importRowNo));
    }

    it('R5 the species name is the species column; name_source still follows wcvp_species and gbif_species', async () => {
      const k = tag();
      const file = await writeCsv([
        row({
          ID: freshId(),
          species: `Resolvia vera-${k}`,
          wcvp_species: `Resolvia vera-${k}`,
          primary_source_species_name: `Resolvia verra-${k}`,
        }),
        row({ ID: freshId(), species: `Gbifia sola-${k}`, gbif_species: `Gbifia sola-${k}` }),
        row({
          ID: freshId(),
          species: `Rawia nuda-${k}`,
          primary_source_species_name: `Rawia nuda L.-${k}`,
        }),
        row({ ID: freshId(), wcvp_species: `Fallbackia antiqua-${k}` }),
      ]);
      const batch = await importRecords(t.db, { filePath: file });
      expect(batch).toMatchObject({
        status: 'completed',
        rowsTotal: 4,
        rowsRejected: 0,
        rowsFiltered: 0,
      });
      expect((await speciesOf(batch.id)).map((r) => [r.name, r.source])).toEqual([
        [`Resolvia vera-${k}`, 'wcvp'],
        [`Gbifia sola-${k}`, 'gbif'],
        [`Rawia nuda-${k}`, 'original'],
        [`Fallbackia antiqua-${k}`, 'wcvp'],
      ]);
    });

    it('R4 --trees-only stages every row and keeps only is_tree_species true, counting the rest as filtered', async () => {
      const k = tag();
      const file = await writeCsv([
        row({ ID: freshId(), species: `Arboria alta-${k}`, is_tree_species: 'TRUE' }),
        row({ ID: freshId(), species: `Herbia humilis-${k}`, is_tree_species: 'FALSE' }),
        row({
          ID: freshId(),
          species: `Arboria alta-${k}`,
          harmonised_value: 'red',
          is_tree_species: ' true ',
        }),
        row({ ID: freshId(), species: `Nescia ignota-${k}`, is_tree_species: null }),
      ]);
      const all = await importRecords(t.db, { filePath: file, force: true });
      expect(all).toMatchObject({ rowsTotal: 4, rowsFiltered: 0, rowsDuplicate: 0 });
      const trees = await importRecords(t.db, {
        filePath: await writeCsv([
          // a value the first import did not claim, so nothing here is a duplicate
          row({
            ID: freshId(),
            species: `Arboria alta-${k}`,
            harmonised_value: 'white',
            is_tree_species: 'TRUE',
          }),
          row({ ID: freshId(), species: `Herbia humilis-${k}`, is_tree_species: 'FALSE' }),
          row({ ID: freshId(), species: `Nescia ignota-${k}`, is_tree_species: null }),
        ]),
        treesOnly: true,
      });
      expect(trees).toMatchObject({
        status: 'completed',
        rowsTotal: 3,
        rowsFiltered: 2,
        rowsDuplicate: 0,
        rowsRejected: 0,
      });
      expect((await speciesOf(trees.id)).map((r) => r.name)).toEqual([`Arboria alta-${k}`]);
    });

    it('R2 --trees-only without an is_tree_species column is refused before any batch row', async () => {
      const file = await writeRecords('v1-notree-', [`${IMPORT_COLUMNS.map(() => '').join(',')}`]);
      const before = (await t.db.select().from(importBatches)).length;
      await expect(importRecords(t.db, { filePath: file, treesOnly: true })).rejects.toMatchObject({
        name: 'ImportRefusedError',
        reason: 'header_mismatch',
      });
      expect((await t.db.select().from(importBatches)).length).toBe(before);
    });

    it('R4 a Parquet file imports like its CSV twin: nulls, booleans, commas and quotes', async () => {
      // Each file names its own species, so neither import's claims duplicate the other's.
      const rows = (k: string, ids: string[]) => [
        row({
          ID: ids[0] as string,
          species: `Parquetia prima-${k}`,
          original_value_clean: 'blue, "sky"',
          is_tree_species: true,
        }),
        row({ ID: ids[1] as string, species: `Parquetia secunda-${k}`, is_tree_species: false }),
        row({
          ID: ids[2] as string,
          species: `Parquetia prima-${k}`,
          final_standard_trait: 'seed_mass_dry',
          trait_value_type: 'quantitative_or_text',
          harmonised_value: '12.5',
          sample_size: '3',
          unit_harmonisation_status: 'not_numeric',
          outlier_flag: 'unit_factor',
          is_tree_species: true,
        }),
      ];
      const fromCsv = await importRecords(t.db, {
        filePath: await writeCsv(rows(tag(), [freshId(), freshId(), freshId()])),
        treesOnly: true,
      });
      const fromParquet = await importRecords(t.db, {
        filePath: await writeParquet(rows(tag(), [freshId(), freshId(), freshId()])),
        treesOnly: true,
      });
      for (const batch of [fromCsv, fromParquet]) {
        expect(batch).toMatchObject({
          status: 'completed',
          rowsTotal: 3,
          rowsFiltered: 1,
          rowsRejected: 0,
        });
      }
      const shape = async (batchId: string) =>
        (
          await t.db
            .select({
              rowNo: traitRecords.importRowNo,
              valueText: traitRecords.valueText,
              raw: traitRecords.rawValue,
              n: traitRecords.n,
              unitStatus: traitRecords.unitStatus,
              outlierFlag: traitRecords.outlierFlag,
              harmonisation: traitRecords.harmonisation,
            })
            .from(traitRecords)
            .where(eq(traitRecords.importBatchId, batchId))
            .orderBy(asc(traitRecords.importRowNo))
        ).map(({ rowNo: _r, ...rest }) => rest);
      const parquetShape = await shape(fromParquet.id);
      expect(parquetShape).toEqual(await shape(fromCsv.id));
      expect(parquetShape).toContainEqual(
        expect.objectContaining({ unitStatus: 'not_numeric', outlierFlag: 'unit_factor', n: 3 }),
      );
    });
  });
});
