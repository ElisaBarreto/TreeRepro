import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import {
  createAnnotation,
  createContest,
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { exportScene, parseCsv, readAll, unzip } from '../../test/helpers/export.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { createDb } from '../db/client.ts';
import { traitLevels } from '../db/schema/dictionary.ts';
import {
  ANNOTATION_COLUMNS,
  annotationRowsQuery,
  annotationsCsv,
  csvRow,
  datasetZip,
  RECORD_COLUMNS,
  recordsCsv,
} from './export.ts';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Rejects after `ms` if `promise` has not settled by then. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    }),
  ]);
}

describe('RFC-66 R2, R3 records.csv and annotations.csv', () => {
  const t = useTestDb();

  it('R2 one row per visible record, with references, counts and the contested flag', async () => {
    const s = await exportScene(t.db);
    const csv = parseCsv(await readAll(recordsCsv(t.db, UNRESTRICTED, { scope: 'all' })));
    expect(csv.bom).toBe(true);
    expect(`${csv.header}\r\n`).toBe(csvRow(RECORD_COLUMNS));
    const byCode = new Map(csv.rows.map((r) => [r[0], r]));
    expect(byCode.get(s.code.r1)).toEqual([
      s.code.r1,
      s.family.name,
      s.genus.name,
      s.sp.canonicalName,
      'wcvp',
      expect.any(String),
      s.cat.key,
      '',
      'red',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      `${s.ref1.citationKey}; ${s.ref2.citationKey}`,
      'manual',
      '',
      '',
      'true',
      '2',
      // k4 (Val Two, red) is withdrawn and does not count.
      '1',
      expect.stringMatching(ISO),
    ]);
    // RFC-63 R14: a categorical contest applies to every record of the level it names.
    expect(byCode.get(s.code.r1b)?.slice(20, 23)).toEqual(['true', '0', '1']);
    // k2 created no record and still contests blue.
    expect(byCode.get(s.code.r2)?.slice(20, 23)).toEqual(['true', '0', '1']);
    // c1 is a blue record of k1: no responds_to, and itself on a level k2 contests.
    expect(byCode.get(s.code.c1)?.slice(8, 9)).toEqual(['blue']);
    expect(byCode.get(s.code.c1)?.slice(18, 23)).toEqual(['contest', '', 'true', '0', '1']);
    // Six quantitative fields; a resolved contest no longer flags, but still counts.
    expect(byCode.get(s.code.r3)?.slice(7, 16)).toEqual([
      'mm',
      '',
      '12.5',
      '1',
      '20',
      '10',
      '2.5',
      '8',
      '',
    ]);
    expect(byCode.get(s.code.r3)?.slice(20, 23)).toEqual(['false', '0', '1']);
    expect(byCode.get(s.code.c2)?.slice(9, 10)).toEqual(['99']);
    expect(byCode.get(s.code.c2)?.slice(18, 23)).toEqual(['contest', s.code.r3, 'false', '0', '0']);
    // Pending shown to a reviewer, with its raw value.
    expect(byCode.get(s.code.p)?.slice(8, 16)).toEqual(['', '', '', '', '', '', '', 'reddish']);
    // Withdrawn records leave the file (RFC-63 R13).
    expect(byCode.has(s.code.w)).toBe(false);
    expect(byCode.has(s.code.c1w)).toBe(false);
  });

  it('R3 records.csv orders one species by trait key, then record_code', async () => {
    const s = await exportScene(t.db);
    const csv = parseCsv(await readAll(recordsCsv(t.db, UNRESTRICTED, { scope: 'all' })));
    const mine = csv.rows.filter((r) => r[3] === s.sp.canonicalName).map((r) => `${r[6]} ${r[0]}`);
    expect(mine).toHaveLength(7);
    expect(mine).toEqual([...mine].sort());
  });

  it('R2 RFC-33 R2: a viewer without records.review gets no pending record', async () => {
    const s = await exportScene(t.db);
    const csv = parseCsv(await readAll(recordsCsv(t.db, RESTRICTED, { scope: 'all' })));
    const codes = csv.rows.map((r) => r[0]);
    expect(codes).toContain(s.code.r1);
    expect(codes).not.toContain(s.code.p);
  });

  it('R2 annotations.csv: one row per validation and per contested record, user names only', async () => {
    const s = await exportScene(t.db);
    const text = await readAll(annotationsCsv(t.db, UNRESTRICTED, { scope: 'all' }));
    const csv = parseCsv(text);
    expect(csv.bom).toBe(true);
    expect(`${csv.header}\r\n`).toBe(csvRow(ANNOTATION_COLUMNS));
    const codes = new Set(Object.values(s.code));
    const mine = csv.rows.filter((r) => codes.has(r[0] ?? ''));
    for (const r of mine) expect(r[3]).toMatch(ISO);
    // No row for w (withdrawn record) nor for k4 (withdrawn contest); c1w, withdrawn, is not listed.
    expect(mine.map((r) => [r[0], r[1], r[2], r[4], r[5]])).toEqual(
      expect.arrayContaining([
        [s.code.r1, 'validation', 'Val One', '', ''],
        [s.code.r1, 'validation', 'Val Two', s.ref2.citationKey, ''],
        [s.code.r1, 'contest', 'Con Tester', '', s.code.c1],
        [s.code.r1b, 'contest', 'Con Tester', '', s.code.c1],
        [s.code.r2, 'contest', 'Con Two', '', ''],
        [s.code.c1, 'contest', 'Con Two', '', ''],
        [s.code.r3, 'contest', 'Con Tester', '', s.code.c2],
      ]),
    );
    expect(mine).toHaveLength(7);
    // R3: record_code, then date.
    const keys = mine.map((r) => `${r[0]} ${r[3]}`);
    expect(keys).toEqual([...keys].sort());
    expect(text).not.toContain(s.val1Email);
  });

  it('R2 RFC-33 R2: a contest naming an inactive level is hidden from a viewer without dataset.read_inactive', async () => {
    const s = await exportScene(t.db);
    const { user } = await createUser(t.db, { name: 'Con Hidden' });
    const [off] = await t.db
      .insert(traitLevels)
      .values({ traitId: s.cat.id, key: 'off', sortOrder: 9, active: false })
      .returning({ id: traitLevels.id });
    if (!off) throw new Error('no level');
    await createContest(t.db, {
      speciesId: s.sp.id,
      traitId: s.cat.id,
      createdBy: user.id,
      levelIds: [s.red, off.id],
    });
    const hidden = (v: typeof RESTRICTED) =>
      readAll(annotationsCsv(t.db, v, { scope: 'all' })).then((text) =>
        parseCsv(text).rows.filter((r) => r[2] === 'Con Hidden' && r[0] === s.code.r1),
      );
    expect(await hidden(RESTRICTED)).toHaveLength(0);
    expect(await hidden(UNRESTRICTED)).toHaveLength(1);
  });

  it('R4 the ZIP holds records.csv then annotations.csv, each a BOM-led RFC 4180 file', async () => {
    const s = await exportScene(t.db);
    const zip = datasetZip(t.db, UNRESTRICTED, { scope: 'all', now: new Date() });
    const files = await unzip(await new Response(zip).arrayBuffer());
    expect([...files.keys()]).toEqual(['records.csv', 'annotations.csv']);
    const records = parseCsv(files.get('records.csv') ?? '');
    const annotations = parseCsv(files.get('annotations.csv') ?? '');
    expect(records.bom && annotations.bom).toBe(true);
    expect(`${records.header}\r\n`).toBe(csvRow(RECORD_COLUMNS));
    expect(`${annotations.header}\r\n`).toBe(csvRow(ANNOTATION_COLUMNS));
    expect(records.rows.map((r) => r[0])).toContain(s.code.r1);
    expect(annotations.rows.map((r) => r[5])).toContain(s.code.c1);
  });
});

describe('RFC-66 R9 platform scope', () => {
  const t = useTestDb();

  it('records.csv keeps the TR_ records only; annotations.csv keeps validations on EB_ records', async () => {
    const trait = await createTrait(t.db, { levels: ['red'] });
    const level = trait.levels[0]?.id as string;
    const ref = await createReference(t.db);
    const sp = await createSpecies(t.db);
    const { user } = await createUser(t.db, { name: 'Val Platform' });
    const tr = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      levelId: level,
      valueText: 'red',
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    const batch = await createImportBatch(t.db);
    const importedRef = await createReference(t.db);
    const eb = `EB_7${Math.floor(Math.random() * 1e12)}`;
    const [imported] = await t.db.execute<{ id: string }>(sql`
      insert into trait_records (record_code, species_id, trait_id, level_id, value_text,
        harmonisation, origin, import_batch_id, import_row_no, primary_reference_id)
      values (${eb}, ${sp.id}, ${trait.id}, ${level}, 'red', 'harmonised', 'import',
        ${batch.id}, 1, ${importedRef.id})
      returning id`);
    if (!imported) throw new Error('no imported record');
    await createAnnotation(t.db, { recordId: imported.id, actorId: user.id, kind: 'confirm' });
    const trCode = (
      await t.db.execute<{ record_code: string }>(
        sql`select record_code from trait_records where id = ${tr.id}`,
      )
    )[0]?.record_code;
    expect(trCode).toMatch(/^TR_/);

    const codes = async (scope: 'all' | 'platform') =>
      parseCsv(await readAll(recordsCsv(t.db, UNRESTRICTED, { scope }))).rows.map((r) => r[0]);
    expect(await codes('all')).toEqual(expect.arrayContaining([trCode, eb]));
    const platform = await codes('platform');
    expect(platform).toContain(trCode);
    expect(platform).not.toContain(eb);
    expect(platform.every((c) => !c?.startsWith('EB_'))).toBe(true);

    const annotations = parseCsv(
      await readAll(annotationsCsv(t.db, UNRESTRICTED, { scope: 'platform' })),
    ).rows;
    expect(annotations.filter((r) => r[0] === eb).map((r) => [r[1], r[2]])).toEqual([
      ['validation', 'Val Platform'],
    ]);

    // annotationRowsQuery's origin filter, for 13k.
    const manualOnly = await t.db.execute<{ record_code: string }>(
      annotationRowsQuery(UNRESTRICTED, { recordOrigin: 'manual' }),
    );
    expect(manualOnly.map((r) => r.record_code)).not.toContain(eb);
    const importOnly = await t.db.execute<{ record_code: string }>(
      annotationRowsQuery(UNRESTRICTED, { recordOrigin: 'import' }),
    );
    expect(importOnly.map((r) => r.record_code)).toContain(eb);
  });
});

describe('RFC-66 R5 connection safety', () => {
  let handle: ReturnType<typeof createDb> | undefined;

  afterAll(async () => {
    await handle?.close();
  });

  it('a client cancel during an in-flight batch fetch does not leak the pooled connection', async () => {
    handle = createDb(inject('databaseUrl'), { max: 1 });
    const { db } = handle;
    const trait = await createTrait(db, { levels: ['red'] });
    const ref = await createReference(db);
    const { user } = await createUser(db);
    for (let i = 0; i < 5; i++) {
      const sp = await createSpecies(db);
      await createRecord(db, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText: 'red',
        levelId: trait.levels[0]?.id,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
    }

    const reader = recordsCsv(db, UNRESTRICTED, { scope: 'all', batch: 2 }).getReader();
    await reader.read();
    // Do not await this read before cancelling: it races the in-flight batch
    // fetch that `reader.cancel()` must wait for.
    const pending = reader.read();
    await reader.cancel();
    await pending.catch(() => undefined);

    await expect(withTimeout(db.execute(sql`select 1`), 5000)).resolves.toBeDefined();
  });

  it('cancelling the ZIP mid-entry releases the cursor of the entry being written', async () => {
    handle ??= createDb(inject('databaseUrl'), { max: 1 });
    const { db } = handle;
    const trait = await createTrait(db, { valueType: 'quantitative', unit: 'mm' });
    const sp = await createSpecies(db);
    const ref = await createReference(db);
    const { user } = await createUser(db);
    // Enough rows that the cursor is still open when the client goes away:
    // the pipe's buffers and deflate hold far less than 20 000 rows.
    await db.execute(sql`
      insert into trait_records (species_id, trait_id, value_text, numeric_value, harmonisation,
        origin, created_by, primary_reference_id)
      select ${sp.id}, ${trait.id}, g::text, g, 'harmonised', 'manual', ${user.id}, ${ref.id}
      from generate_series(1, 200000) g`);

    const reader = datasetZip(db, UNRESTRICTED, {
      scope: 'all',
      now: new Date(),
      batch: 50,
    }).getReader();
    await reader.read();
    await reader.cancel();

    await expect(withTimeout(db.execute(sql`select 1`), 5000)).resolves.toBeDefined();
  });
});
