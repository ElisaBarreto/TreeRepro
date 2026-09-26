import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asc, desc, eq, sql } from 'drizzle-orm';
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
});
