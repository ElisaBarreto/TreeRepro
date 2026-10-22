import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  levelByKey,
  traitByKey,
} from '../../test/helpers/dataset.ts';
import { seedDictionary } from '../dataset/seed.ts';
import { createDb, type Db } from '../db/client.ts';
import { runMigrations } from '../db/migrator.ts';
import { jobRuns } from '../db/schema/job-runs.ts';
import {
  regionCategorical,
  regionCompleteness,
  regionContinuous,
  regionSnapshot,
} from '../db/schema/region-snapshot.ts';
import { species } from '../db/schema/taxa.ts';
import { isSnapshotDue, runSnapshot } from './snapshot.ts';

describe('RFC-78 R7-R12 weekly snapshot', () => {
  // The WCVP and region tables are global, and other files load and truncate
  // the WCVP tables in parallel, so this file owns a database of its own.
  const DB_NAME = 'treerepro_snapshot_test';
  let handle: { db: Db; close: () => Promise<void> } | undefined;
  let admin: { db: Db; close: () => Promise<void> } | undefined;
  let db: Db;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const superuser = inject('superuserDatabaseUrl');
    admin = createDb(superuser, { max: 1 });
    await admin.db.$client.unsafe(`drop database if exists ${DB_NAME}`);
    await admin.db.$client.unsafe(`create database ${DB_NAME}`);
    const url = new URL(superuser);
    url.pathname = `/${DB_NAME}`;
    await runMigrations(url.toString());
    handle = createDb(url.toString(), { max: 3 });
    db = handle.db;
    await seedDictionary(db);

    // WCVP: R1 holds alpha, beta, gamma and epsilon; R2 holds alpha and zeta.
    await db.$client`
      insert into wcvp_species (plant_name_id, taxon_name, is_tree, file_order) values
        ('1', 'Snapa alpha', true, 1), ('2', 'Snapa beta', true, 2), ('3', 'Snapa gamma', false, 3),
        ('5', 'Snapa epsilon', true, 5), ('6', 'Snapa zeta', false, 6), ('7', 'Snapa eta', true, 7)`;
    await db.$client`insert into wcvp_regions (area_code_l3, name) values ('RG1', 'Region one'), ('RG2', 'Region two')`;
    await db.$client`
      insert into wcvp_distribution (plant_name_id, area_code_l3) values
        ('1', 'RG1'), ('1', 'RG2'), ('2', 'RG1'), ('3', 'RG1'), ('5', 'RG1'), ('6', 'RG2'), ('7', 'RG1')`;

    const petal = await traitByKey(db, 'petal_length');
    const colour = await traitByKey(db, 'flower_color');
    const blue = await levelByKey(db, colour.id, 'blue');
    const red = await levelByKey(db, colour.id, 'red');
    ids.petal = petal.id;
    ids.colour = colour.id;
    ids.blue = blue.id;
    ids.red = red.id;
    const ref = await createReference(db);
    const batch = await createImportBatch(db);
    let row = 0;
    const record = async (name: string, cells: Record<string, unknown>) => {
      const [existing] = await db
        .select({ id: species.id })
        .from(species)
        .where(eq(species.canonicalName, name));
      const speciesId = existing?.id ?? (await createSpecies(db, { canonicalName: name })).id;
      ids[name] = speciesId;
      await createRecord(db, {
        speciesId,
        primaryReferenceId: ref.id,
        importBatchId: batch.id,
        importRowNo: ++row,
        sourceFolder: 'S1',
        ...cells,
      } as Parameters<typeof createRecord>[1]);
    };
    const value = (v: number) => ({ traitId: petal.id, valueText: String(v), numericValue: v });
    const state = (level: { id: string; key: string }) => ({
      traitId: colour.id,
      valueText: level.key,
      levelId: level.id,
    });
    await record('Snapa alpha', value(2));
    await record('Snapa alpha', state(blue));
    await record('Snapa alpha', state(red));
    await record('Snapa beta', value(4));
    await record('Snapa beta', state(blue));
    await record('Snapa gamma', value(10));
    // no WCVP match: counted nowhere
    await record('Snapa delta', state(red));
    // an inactive species is left out (R8)
    await record('Snapa eta', value(1000));
    await db
      .update(species)
      .set({ active: false })
      .where(eq(species.id, ids['Snapa eta'] as string));
  }, 120_000);

  afterAll(async () => {
    await handle?.close();
    await admin?.db.$client.unsafe(`drop database if exists ${DB_NAME}`);
    await admin?.close();
  });

  it('R9-R11 computes completeness, continuous and categorical tables, and records a completed run', async () => {
    const result = await runSnapshot({ db, now: new Date('2026-10-23T03:00:00Z') });
    expect(result.status).toBe('completed');

    const completeness = await db.select().from(regionCompleteness);
    const c = (trait: string, area: string) =>
      completeness.find((r) => r.traitId === ids[trait] && r.areaCodeL3 === area);
    expect(c('petal', 'RG1')).toMatchObject({
      speciesWithData: 3,
      wcvpSpecies: 5,
      wcvpTreeSpecies: 4,
    });
    expect(c('petal', 'RG2')).toMatchObject({
      speciesWithData: 1,
      wcvpSpecies: 2,
      wcvpTreeSpecies: 1,
    });
    expect(c('colour', 'RG1')).toMatchObject({ speciesWithData: 2 });
    expect(c('colour', 'RG2')).toMatchObject({ speciesWithData: 1 });
    expect(completeness).toHaveLength(4);

    const continuous = await db.select().from(regionContinuous);
    const rg1 = continuous.find((r) => r.areaCodeL3 === 'RG1');
    const mean = 16 / 3;
    const sd = Math.sqrt(((2 - mean) ** 2 + (4 - mean) ** 2 + (10 - mean) ** 2) / 2);
    expect(rg1).toMatchObject({ traitId: ids.petal, nSpecies: 3, median: 4, min: 2, max: 10 });
    expect(rg1?.mean).toBeCloseTo(mean, 12);
    expect(rg1?.sd).toBeCloseTo(sd, 12);
    expect(rg1?.cv).toBeCloseTo((100 * sd) / mean, 10);
    expect(continuous.find((r) => r.areaCodeL3 === 'RG2')).toMatchObject({
      nSpecies: 1,
      mean: 2,
      median: 2,
      sd: null,
      cv: null,
    });

    const categorical = await db.select().from(regionCategorical);
    const k = (level: string, area: string) =>
      categorical.find((r) => r.levelId === ids[level] && r.areaCodeL3 === area);
    expect(k('blue', 'RG1')).toMatchObject({ nSpeciesWithLevel: 2, nSpeciesWithTrait: 2 });
    expect(k('red', 'RG1')).toMatchObject({ nSpeciesWithLevel: 1, nSpeciesWithTrait: 2 });
    expect(k('blue', 'RG2')).toMatchObject({ nSpeciesWithLevel: 1, nSpeciesWithTrait: 1 });
    expect(k('red', 'RG2')).toMatchObject({ nSpeciesWithLevel: 1, nSpeciesWithTrait: 1 });
    expect(categorical).toHaveLength(4);

    const [snapshot] = await db.select().from(regionSnapshot);
    expect(snapshot?.computedAt.toISOString()).toBe('2026-10-23T03:00:00.000Z');
    const [run] = await db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.id, result.runId as string));
    expect(run).toMatchObject({ kind: 'snapshot', status: 'completed' });
    expect(run?.detail).toMatchObject({ completeness: 4, continuous: 2, categorical: 4 });
  });

  it('R12 a second run replaces the snapshot, never adding to it', async () => {
    await runSnapshot({ db, now: new Date('2026-10-24T03:00:00Z') });
    expect(await db.select().from(regionCompleteness)).toHaveLength(4);
    expect(await db.select().from(regionSnapshot)).toHaveLength(1);
  });

  it('R12 a run that finds the lock held records itself skipped and changes nothing', async () => {
    const lock = await db.$client.reserve();
    try {
      await lock`select pg_advisory_lock(4665)`;
      const result = await runSnapshot({ db, now: new Date('2026-10-25T03:00:00Z') });
      expect(result.status).toBe('skipped');
      const [run] = await db
        .select()
        .from(jobRuns)
        .where(eq(jobRuns.id, result.runId as string));
      expect(run).toMatchObject({ kind: 'snapshot', status: 'skipped' });
      const [snapshot] = await db.select().from(regionSnapshot);
      expect(snapshot?.computedAt.toISOString()).toBe('2026-10-24T03:00:00.000Z');
    } finally {
      await lock`select pg_advisory_unlock(4665)`;
      lock.release();
    }
  });

  it('R12 onlyIfDue: not due within 7 days of the last completed run, due after', async () => {
    const early = await runSnapshot({ db, now: new Date('2026-10-26T03:00:00Z'), onlyIfDue: true });
    expect(early).toMatchObject({ status: 'not_due', runId: null });
    const late = await runSnapshot({
      db,
      now: new Date(Date.now() + 8 * 86_400_000),
      onlyIfDue: true,
    });
    expect(late.status).toBe('completed');
  });
});

describe('RFC-78 R12 isSnapshotDue', () => {
  it('is due with no completed run, or when the last one finished 7 days ago or more', () => {
    const now = new Date('2026-10-23T12:00:00Z');
    expect(isSnapshotDue(null, now)).toBe(true);
    expect(isSnapshotDue(new Date('2026-10-17T12:00:00Z'), now)).toBe(false);
    expect(isSnapshotDue(new Date('2026-10-16T12:00:00Z'), now)).toBe(true);
  });
});
