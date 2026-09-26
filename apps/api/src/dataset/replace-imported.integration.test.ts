import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  createAnnotation,
  createContest,
  createRecord,
  createReference,
  levelByKey,
  traitByKey,
} from '../../test/helpers/dataset.ts';
import { createUser } from '../../test/helpers/users.ts';
import { createDb, type Db } from '../db/client.ts';
import { runMigrations } from '../db/migrator.ts';
import { contestEvents, contestLevels, contestRecords, contests } from '../db/schema/contests.ts';
import { speciesTraitCoverage } from '../db/schema/coverage.ts';
import { recordAnnotations } from '../db/schema/curation.ts';
import { importBatches } from '../db/schema/imports.ts';
import { traitRecords } from '../db/schema/records.ts';
import { referenceTraits } from '../db/schema/reference-traits.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { species } from '../db/schema/taxa.ts';
import { IMPORT_COLUMNS, importRecords } from './import.ts';
import { seedDictionary } from './seed.ts';

const SPECIES = 'Fixturia relinka';

/** One import line: `ID`, a trait value of SPECIES, its citation keys. Defaults to a categorical `flower_color` value. */
function line(
  id: string,
  value: string,
  primary = 'REL_A',
  secondary = '',
  trait = 'flower_color',
  type: 'categorical' | 'quantitative' = 'categorical',
): string {
  const cells: Partial<Record<(typeof IMPORT_COLUMNS)[number], string>> = {
    ID: id,
    primary_reference: primary,
    secondary_reference: secondary,
    wcvp_species: SPECIES,
    wcvp_genus: 'Fixturia',
    wcvp_family: 'Fixturaceae',
    final_standard_trait: trait,
    trait_value_type: type,
    harmonised_value: value,
  };
  return IMPORT_COLUMNS.map((c) => cells[c] ?? '').join(',');
}

const csv = (...lines: string[]) => `${IMPORT_COLUMNS.join(',')}\n${lines.join('\n')}\n`;

describe('RFC-64 R15 replace-imported (spec R-20)', () => {
  // The run deletes every EB_ record of the database it runs on, so this file
  // provisions a database of its own in the same container, as
  // reset.integration.test.ts does. The superuser stands in for
  // treerepro_migrator (both own the tables and may disable the triggers).
  const DB_NAME = 'treerepro_replace_imported_test';
  let handle: { db: Db; close: () => Promise<void> } | undefined;
  let admin: { db: Db; close: () => Promise<void> } | undefined;
  const t = { db: undefined as unknown as Db };
  const fx = {} as {
    dir: string;
    v2: string;
    bad: string;
    speciesId: string;
    traitId: string;
    qTraitId: string;
    relA: string;
    relB: string;
    alice: string;
    old: Record<string, string>;
    orange: string;
    complement: string;
    qContest: string;
    mapping: string;
    validation: string;
    withdrawal: string;
  };

  /** record_code → id of every imported record. */
  async function importedByCode(): Promise<Record<string, string>> {
    const rows = await t.db
      .select({ id: traitRecords.id, code: traitRecords.recordCode })
      .from(traitRecords)
      .where(eq(traitRecords.origin, 'import'));
    return Object.fromEntries(rows.map((r) => [r.code, r.id]));
  }

  /** Everything a run may change, to prove that a refused or failed one changed nothing. */
  async function snapshot() {
    const records = await t.db
      .select({
        id: traitRecords.id,
        code: traitRecords.recordCode,
        intent: traitRecords.intent,
        respondsTo: traitRecords.respondsToRecordId,
        supersedes: traitRecords.supersedesRecordId,
      })
      .from(traitRecords)
      .orderBy(asc(traitRecords.id));
    const annotations = await t.db
      .select()
      .from(recordAnnotations)
      .orderBy(asc(recordAnnotations.id));
    const coverage = await t.db
      .select()
      .from(speciesTraitCoverage)
      .orderBy(asc(speciesTraitCoverage.speciesId), asc(speciesTraitCoverage.traitId));
    const refs = await t.db
      .select({
        id: bibliographicReferences.id,
        primary: bibliographicReferences.primaryCount,
        secondary: bibliographicReferences.secondaryCount,
      })
      .from(bibliographicReferences)
      .orderBy(asc(bibliographicReferences.id));
    const triggers = await t.db.execute(sql`
      select tgname, tgenabled from pg_trigger
      where tgname like '%append_only' or tgname like '%no_truncate' order by 1`);
    const contestRows = await t.db.select().from(contests).orderBy(asc(contests.id));
    const contestLevelRows = await t.db
      .select()
      .from(contestLevels)
      .orderBy(asc(contestLevels.contestId), asc(contestLevels.levelId));
    const contestRecordRows = await t.db
      .select()
      .from(contestRecords)
      .orderBy(asc(contestRecords.contestId), asc(contestRecords.recordId));
    const contestEventRows = await t.db.select().from(contestEvents).orderBy(asc(contestEvents.id));
    return {
      records,
      annotations,
      coverage,
      refs,
      triggers,
      contests: contestRows,
      contestLevels: contestLevelRows,
      contestRecords: contestRecordRows,
      contestEvents: contestEventRows,
    };
  }

  /** The one sheet a run wrote into `dir`, parsed (no field of the fixture holds a comma). */
  async function sheet(dir: string) {
    const names = await readdir(dir);
    const text = await readFile(join(dir, names[0] as string), 'utf8');
    const [header, ...rows] = text
      .replace(/^\uFEFF/, '')
      .split('\r\n')
      .filter(Boolean);
    return { names, header, rows: rows.map((r) => r.split(',')) };
  }

  beforeAll(async () => {
    const superuser = inject('superuserDatabaseUrl');
    admin = createDb(superuser, { max: 1 });
    await admin.db.$client.unsafe(`drop database if exists ${DB_NAME}`);
    await admin.db.$client.unsafe(`create database ${DB_NAME}`);
    const url = new URL(superuser);
    url.pathname = `/${DB_NAME}`;
    await runMigrations(url.toString());
    handle = createDb(url.toString(), { max: 2 }); // RFC-64 R13 reserves one for the lock
    t.db = handle.db;
    await seedDictionary(t.db);

    fx.dir = await mkdtemp(join(tmpdir(), 'replace-imported-'));
    const v1 = join(fx.dir, 'v1.csv');
    await writeFile(
      v1,
      csv(
        line('EB_1', 'blue'),
        line('EB_2', 'red'),
        line('EB_3', 'white'),
        line('EB_5', 'bluish'),
        line('EB_6', '12', 'REL_A', '', 'diaspore_length', 'quantitative'),
      ),
    );
    // The new file keeps EB_1, EB_3, EB_5 and EB_6, drops EB_2, adds EB_4.
    fx.v2 = join(fx.dir, 'v2.csv');
    await writeFile(
      fx.v2,
      csv(
        line('EB_1', 'blue'),
        line('EB_3', 'white'),
        line('EB_4', 'yellow'),
        line('EB_5', 'bluish'),
        line('EB_6', '12', 'REL_A', '', 'diaspore_length', 'quantitative'),
      ),
    );
    // A valid header, then a row with one field too many: COPY fails after the wipe.
    fx.bad = join(fx.dir, 'bad.csv');
    await writeFile(fx.bad, `${IMPORT_COLUMNS.join(',')}\n${line('EB_1', 'blue')},EXTRA\n`);

    await importRecords(t.db, { filePath: v1 });
    fx.old = await importedByCode();
    const trait = await traitByKey(t.db, 'flower_color');
    fx.traitId = trait.id;
    const q = await traitByKey(t.db, 'diaspore_length');
    fx.qTraitId = q.id;
    const [sp] = await t.db
      .select({ id: species.id })
      .from(species)
      .where(eq(species.canonicalName, SPECIES));
    fx.speciesId = sp?.id as string;
    const [relA] = await t.db
      .select({ id: bibliographicReferences.id })
      .from(bibliographicReferences)
      .where(eq(bibliographicReferences.citationKey, 'REL_A'));
    fx.relA = relA?.id as string;
    fx.relB = (await createReference(t.db, { citationKey: 'REL_B' })).id;
    fx.alice = (await createUser(t.db, { name: 'Alice Relink' })).user.id;
    const bob = (await createUser(t.db, { name: 'Bob Relink' })).user.id;
    const carol = (await createUser(t.db, { name: 'Carol Relink' })).user.id;
    const level = async (key: string) => (await levelByKey(t.db, fx.traitId, key)).id;
    const manual = { speciesId: fx.speciesId, traitId: fx.traitId, origin: 'manual' as const };

    // A TR_ record of its own; a TR_ categorical complement orphaning EB_2; a
    // TR_ quantitative contest re-linked to EB_6; a TR_ harmonisation of the
    // pending EB_5.
    fx.orange = (
      await createRecord(t.db, {
        ...manual,
        valueText: 'orange',
        levelId: await level('orange'),
        primaryReferenceId: fx.relB,
        createdBy: fx.alice,
      })
    ).id;
    fx.complement = (
      await createRecord(t.db, {
        ...manual,
        valueText: 'pink',
        levelId: await level('pink'),
        primaryReferenceId: fx.relB,
        createdBy: bob,
        intent: 'complement' as const,
        respondsToRecordId: fx.old.EB_2 as string,
      })
    ).id;
    fx.qContest = (
      await createRecord(t.db, {
        speciesId: fx.speciesId,
        traitId: q.id,
        origin: 'manual',
        valueText: '15',
        numericValue: 15,
        primaryReferenceId: fx.relB,
        createdBy: bob,
        intent: 'contest',
        respondsToRecordId: fx.old.EB_6 as string,
      })
    ).id;
    await createContest(t.db, {
      speciesId: fx.speciesId,
      traitId: q.id,
      createdBy: bob,
      recordIds: [fx.qContest],
    });
    // A categorical contest untouched by the run — a levels-only contest, no record.
    await createContest(t.db, {
      speciesId: fx.speciesId,
      traitId: fx.traitId,
      createdBy: carol,
      levelIds: [await level('red')],
    });
    fx.mapping = (
      await createRecord(t.db, {
        ...manual,
        valueText: 'light_blue',
        levelId: await level('light_blue'),
        rawValue: 'bluish',
        primaryReferenceId: fx.relA,
        createdBy: fx.alice,
        supersedesRecordId: fx.old.EB_5 as string,
      })
    ).id;
    // A validation of EB_1 (with a reference) and a withdrawal of EB_3.
    fx.validation = (
      await createAnnotation(t.db, {
        recordId: fx.old.EB_1 as string,
        actorId: fx.alice,
        kind: 'confirm',
        referenceId: fx.relB,
      })
    ).id;
    fx.withdrawal = (
      await createAnnotation(t.db, {
        recordId: fx.old.EB_3 as string,
        actorId: carol,
        kind: 'withdraw',
      })
    ).id;
  }, 180_000);

  afterAll(async () => {
    await handle?.close();
    await admin?.db.$client.unsafe(`drop database if exists ${DB_NAME}`);
    await admin?.close();
  });

  it('R12 the total --replace is refused while platform data (a manual record, an annotation or a contest) exists, and nothing changes', async () => {
    const before = await snapshot();
    await expect(importRecords(t.db, { filePath: fx.v2, replace: true })).rejects.toMatchObject({
      name: 'ImportRefusedError',
      reason: 'platform_records_exist',
    });
    expect(await snapshot()).toEqual(before);
    const [batch] = await t.db
      .select({ status: importBatches.status, error: importBatches.error })
      .from(importBatches)
      .orderBy(desc(importBatches.startedAt))
      .limit(1);
    expect(batch?.status).toBe('failed');
    expect(batch?.error).toMatch(/platform data/i);
  });

  it('R15 refuses a sheet directory it cannot write, and both replacing modes at once, before any batch row', async () => {
    const batches = (await t.db.select({ id: importBatches.id }).from(importBatches)).length;
    await expect(
      importRecords(t.db, {
        filePath: fx.v2,
        replaceImported: { sheetDir: join(fx.dir, 'missing') },
      }),
    ).rejects.toMatchObject({ reason: 'sheet_not_writable' });
    // A path that exists but is a regular file is refused the same way.
    await expect(
      importRecords(t.db, {
        filePath: fx.v2,
        replaceImported: { sheetDir: fx.bad },
      }),
    ).rejects.toMatchObject({ reason: 'sheet_not_writable' });
    await expect(
      importRecords(t.db, {
        filePath: fx.v2,
        replace: true,
        replaceImported: { sheetDir: fx.dir },
      }),
    ).rejects.toMatchObject({ reason: 'replace_not_allowed' });
    expect((await t.db.select({ id: importBatches.id }).from(importBatches)).length).toBe(batches);
  });

  it('R15 replaces the EB_ records, keeps the platform, re-links by record_code, writes the sheet, recomputes the counters', async () => {
    const before = await snapshot();
    const platformBefore = await t.db
      .select()
      .from(traitRecords)
      .where(eq(traitRecords.origin, 'manual'))
      .orderBy(asc(traitRecords.id));
    const annotationsBefore = await t.db
      .select()
      .from(recordAnnotations)
      .orderBy(asc(recordAnnotations.id));
    const sheetDir = await mkdtemp(join(tmpdir(), 'replace-sheet-'));

    const batch = await importRecords(t.db, { filePath: fx.v2, replaceImported: { sheetDir } });

    expect(batch).toMatchObject({
      status: 'completed',
      rowsTotal: 5,
      rowsInserted: 5,
      rowsRejected: 0,
      rowsAlreadyImported: 0,
    });
    const [stored] = await t.db
      .select({ mode: importBatches.mode })
      .from(importBatches)
      .where(eq(importBatches.id, batch.id));
    expect(stored?.mode).toBe('replace');

    // EB_: exactly the new file; EB_2 is gone; the kept codes are new rows.
    const eb = await importedByCode();
    expect(Object.keys(eb).sort()).toEqual(['EB_1', 'EB_3', 'EB_4', 'EB_5', 'EB_6']);
    for (const code of ['EB_1', 'EB_3', 'EB_5', 'EB_6']) expect(eb[code]).not.toBe(fx.old[code]);

    // TR_: every record kept with the same id and code; only the links moved.
    const platformAfter = await t.db
      .select()
      .from(traitRecords)
      .where(eq(traitRecords.origin, 'manual'))
      .orderBy(asc(traitRecords.id));
    const unlinked = (r: (typeof platformBefore)[number]) => ({
      ...r,
      intent: null,
      respondsToRecordId: null,
      supersedesRecordId: null,
    });
    expect(platformAfter.map(unlinked)).toEqual(platformBefore.map(unlinked));
    const after = new Map(platformAfter.map((r) => [r.id, r]));
    expect(after.get(fx.orange)).toEqual(platformBefore.find((r) => r.id === fx.orange));
    // The complement's EB_2 is gone: it is now an independent record.
    expect(after.get(fx.complement)).toMatchObject({ intent: null, respondsToRecordId: null });
    // The quantitative contest follows EB_6 to its new row.
    expect(after.get(fx.qContest)).toMatchObject({
      intent: 'contest',
      respondsToRecordId: eb.EB_6,
    });
    // The harmonisation follows EB_5 to its new row.
    expect(after.get(fx.mapping)?.supersedesRecordId).toBe(eb.EB_5);

    // Annotations: same id, actor, kind, note, reference, generated, created_at; new record.
    const annotationsAfter = await t.db
      .select()
      .from(recordAnnotations)
      .orderBy(asc(recordAnnotations.id));
    expect(annotationsAfter).toEqual(
      annotationsBefore.map((a) => ({
        ...a,
        recordId: a.id === fx.validation ? eb.EB_1 : eb.EB_3,
      })),
    );
    // EB_3 is still withdrawn.
    expect(annotationsAfter.find((a) => a.id === fx.withdrawal)).toMatchObject({
      recordId: eb.EB_3,
      kind: 'withdraw',
    });

    // The contest tables are untouched (RFC-63 R4): the quantitative
    // contest's rows and the categorical contest alike; every append-only
    // trigger is back on.
    const whole = await snapshot();
    expect({
      contests: whole.contests,
      contestLevels: whole.contestLevels,
      contestRecords: whole.contestRecords,
      contestEvents: whole.contestEvents,
      triggers: whole.triggers,
    }).toEqual({
      contests: before.contests,
      contestLevels: before.contestLevels,
      contestRecords: before.contestRecords,
      contestEvents: before.contestEvents,
      triggers: before.triggers,
    });

    // Counters, by hand. flower_color's live records: EB_1, EB_4, EB_5
    // (unknown_level, so not harmonised), orange, the complement and the
    // harmonisation; EB_3 is withdrawn. diaspore_length's: EB_6 and the
    // contest, both harmonised. REL_A is primary for EB_1, EB_4, EB_5, the
    // harmonisation (flower_color) and EB_6 (diaspore_length); REL_B for
    // orange, the complement (flower_color) and the contest (diaspore_length).
    // The validation's reference is not a usage.
    const cell = async (traitId: string) =>
      (
        await t.db
          .select({
            recordCount: speciesTraitCoverage.recordCount,
            harmonisedCount: speciesTraitCoverage.harmonisedCount,
          })
          .from(speciesTraitCoverage)
          .where(
            and(
              eq(speciesTraitCoverage.speciesId, fx.speciesId),
              eq(speciesTraitCoverage.traitId, traitId),
            ),
          )
      )[0];
    expect(await cell(fx.traitId)).toEqual({ recordCount: 6, harmonisedCount: 5 });
    expect(await cell(fx.qTraitId)).toEqual({ recordCount: 2, harmonisedCount: 2 });
    const [sp] = await t.db
      .select({ traitCount: species.traitCount })
      .from(species)
      .where(eq(species.id, fx.speciesId));
    expect(sp?.traitCount).toBe(2);
    const usage = async (id: string) => {
      const [ref] = await t.db
        .select({
          primary: bibliographicReferences.primaryCount,
          secondary: bibliographicReferences.secondaryCount,
        })
        .from(bibliographicReferences)
        .where(eq(bibliographicReferences.id, id));
      const byTrait = await t.db
        .select({ traitId: referenceTraits.traitId, n: referenceTraits.recordCount })
        .from(referenceTraits)
        .where(eq(referenceTraits.referenceId, id));
      const n = (traitId: string) => byTrait.find((b) => b.traitId === traitId)?.n ?? null;
      return { ...ref, flower: n(fx.traitId), diaspore: n(fx.qTraitId), traits: byTrait.length };
    };
    expect(await usage(fx.relA)).toEqual({
      primary: 5,
      secondary: 0,
      flower: 4,
      diaspore: 1,
      traits: 2,
    });
    expect(await usage(fx.relB)).toEqual({
      primary: 3,
      secondary: 0,
      flower: 2,
      diaspore: 1,
      traits: 2,
    });
    // And the whole coverage table equals a from-scratch count of live records.
    const [drift] = await t.db.execute(sql`
      with want as (
        select r.species_id, r.trait_id, count(*)::int as n,
          (count(*) filter (where r.harmonisation = 'harmonised'))::int as h
        from trait_records r
        where not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
        group by 1, 2),
      have as (
        select species_id, trait_id, record_count as n, harmonised_count as h from species_trait_coverage)
      select (select count(*) from (
        (select * from want except select * from have)
        union all
        (select * from have except select * from want)) d)::int as rows`);
    expect(drift).toEqual({ rows: 0 });

    // The sheet: final, one file, statuses known; no row for the categorical contest.
    const codeOf = async (id: string) =>
      (
        await t.db
          .select({ code: traitRecords.recordCode })
          .from(traitRecords)
          .where(eq(traitRecords.id, id))
      )[0]?.code;
    const s = await sheet(sheetDir);
    expect(s.names).toEqual([`replace-${batch.id}-annotations.csv`]);
    expect(s.header).toBe('record_code,kind,user_name,date,reference,contest_record_code,status');
    const iso = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(s.rows).toEqual([
      ['EB_1', 'validation', 'Alice Relink', iso, 'REL_B', '', 'relinked'],
      ['EB_2', 'complement', 'Bob Relink', iso, 'REL_B', await codeOf(fx.complement), 'orphan'],
      ['EB_3', 'withdraw', 'Carol Relink', iso, '', '', 'relinked'],
      ['EB_5', 'harmonisation', 'Alice Relink', iso, 'REL_A', await codeOf(fx.mapping), 'relinked'],
      ['EB_6', 'contest', 'Bob Relink', iso, 'REL_B', await codeOf(fx.qContest), 'relinked'],
    ]);
  });

  it('R9, R15 a file that fails after the wipe rolls everything back; the sheet stays, every row pending', async () => {
    const before = await snapshot();
    const sheetDir = await mkdtemp(join(tmpdir(), 'replace-sheet-'));
    await expect(
      importRecords(t.db, {
        filePath: fx.bad,
        replaceImported: { sheetDir },
        copyIdleTimeoutMs: 2000,
      }),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    const s = await sheet(sheetDir);
    expect(s.names).toHaveLength(1); // no .tmp left behind
    expect(s.names[0]).toMatch(/^replace-[0-9a-f-]{36}-annotations\.csv$/);
    // The complement orphaned by the previous run is independent now, so it
    // has no row.
    expect(s.rows.map((r) => [r[0], r[1], r[6]])).toEqual([
      ['EB_1', 'validation', 'pending'],
      ['EB_3', 'withdraw', 'pending'],
      ['EB_5', 'harmonisation', 'pending'],
      ['EB_6', 'contest', 'pending'],
    ]);
    const [failed] = await t.db
      .select({ status: importBatches.status })
      .from(importBatches)
      .where(eq(importBatches.fileName, 'bad.csv'));
    expect(failed?.status).toBe('failed');
  });

  it('R15 refuses to orphan a harmonisation that has no primary reference; nothing changes', async () => {
    // EB_9 names only a secondary reference; its harmonisation inherits exactly that.
    const late = join(fx.dir, 'late.csv');
    await writeFile(late, csv(line('EB_9', 'greyish', '', 'REL_S')));
    await importRecords(t.db, { filePath: late });
    const eb9 = (await importedByCode()).EB_9 as string;
    const [relS] = await t.db
      .select({ id: bibliographicReferences.id })
      .from(bibliographicReferences)
      .where(eq(bibliographicReferences.citationKey, 'REL_S'));
    await createRecord(t.db, {
      speciesId: fx.speciesId,
      traitId: fx.traitId,
      origin: 'manual',
      valueText: 'gray',
      levelId: (await levelByKey(t.db, fx.traitId, 'gray')).id,
      rawValue: 'greyish',
      primaryReferenceId: null,
      secondaryReferenceId: relS?.id as string,
      createdBy: fx.alice,
      supersedesRecordId: eb9,
    });
    const before = await snapshot();
    const sheetDir = await mkdtemp(join(tmpdir(), 'replace-sheet-'));
    // v2 has no EB_9.
    await expect(
      importRecords(t.db, { filePath: fx.v2, replaceImported: { sheetDir } }),
    ).rejects.toThrow(/TR_\d+[a-z]* harmonises EB_9/);
    expect(await snapshot()).toEqual(before);
  });

  it('R15 re-links only to a record of the same species and trait (RFC-63 R2); otherwise the response and the harmonisation are orphans', async () => {
    // EB_7 is a flower_color record with a TR_ complement and a TR_
    // harmonisation; the new file makes EB_7 a diaspore_length value.
    const late = join(fx.dir, 'late7.csv');
    await writeFile(late, csv(line('EB_7', 'purplish')));
    await importRecords(t.db, { filePath: late });
    const eb7 = (await importedByCode()).EB_7 as string;
    const level = async (key: string) => (await levelByKey(t.db, fx.traitId, key)).id;
    const manual = { speciesId: fx.speciesId, traitId: fx.traitId, origin: 'manual' as const };
    const complement = (
      await createRecord(t.db, {
        ...manual,
        valueText: 'white',
        levelId: await level('white'),
        primaryReferenceId: fx.relB,
        createdBy: fx.alice,
        intent: 'complement' as const,
        respondsToRecordId: eb7,
      })
    ).id;
    const mapping = (
      await createRecord(t.db, {
        ...manual,
        valueText: 'gray',
        levelId: await level('gray'),
        rawValue: 'purplish',
        primaryReferenceId: fx.relA,
        createdBy: fx.alice,
        supersedesRecordId: eb7,
      })
    ).id;
    const moved = join(fx.dir, 'moved.csv');
    await writeFile(
      moved,
      csv(
        line('EB_1', 'blue'),
        line('EB_3', 'white'),
        line('EB_4', 'yellow'),
        line('EB_5', 'bluish'),
        line('EB_6', '12', 'REL_A', '', 'diaspore_length', 'quantitative'),
        line('EB_7', '9', 'REL_A', '', 'diaspore_length', 'quantitative'),
        line('EB_9', 'greyish', '', 'REL_S'),
      ),
    );
    const sheetDir = await mkdtemp(join(tmpdir(), 'replace-sheet-'));

    await importRecords(t.db, { filePath: moved, replaceImported: { sheetDir } });

    const rows = await t.db
      .select({
        id: traitRecords.id,
        intent: traitRecords.intent,
        respondsTo: traitRecords.respondsToRecordId,
        supersedes: traitRecords.supersedesRecordId,
      })
      .from(traitRecords)
      .where(eq(traitRecords.origin, 'manual'));
    expect(rows.find((r) => r.id === complement)).toMatchObject({
      intent: null,
      respondsTo: null,
    });
    expect(rows.find((r) => r.id === mapping)).toMatchObject({ supersedes: null });
    const s = await sheet(sheetDir);
    expect(s.rows.filter((r) => r[0] === 'EB_7').map((r) => [r[1], r[6]])).toEqual([
      ['complement', 'orphan'],
      ['harmonisation', 'orphan'],
    ]);
  });
});
