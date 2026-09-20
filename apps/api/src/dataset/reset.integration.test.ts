import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDb, type Db } from '../db/client.ts';
import { runMigrations } from '../db/migrator.ts';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { importBatches, importRejects } from '../db/schema/imports.ts';
import { traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { families, genera, species, speciesNames } from '../db/schema/taxa.ts';
import { IMPORT_COLUMNS, importRecords } from './import.ts';
import { isReplaceAllowed } from './reset.ts';
import { seedDictionary } from './seed.ts';

const FIXTURE = fileURLToPath(
  new URL('../../test/fixtures/import/records-small.csv', import.meta.url),
);

describe('RFC-64 R12 importRecords --replace', () => {
  // Every other integration file shares one database, and these tests empty it.
  // Truncating that shared database would break whatever is running in a
  // parallel worker, so this file provisions a database of its own in the same
  // container and never touches the shared one. The connection is the
  // container superuser because the reset disables the RFC-63 R4 append-only
  // triggers, which needs ownership; in the real stack that role is
  // `treerepro_migrator` (RFC-64 R12), and `treerepro_app` can do none of it.
  const DB_NAME = 'treerepro_reset_test';
  let handle: { db: Db; close: () => Promise<void> } | undefined;
  let admin: { db: Db; close: () => Promise<void> } | undefined;
  let dbUrl = '';
  const t = { db: undefined as unknown as Db };

  beforeAll(async () => {
    const superuser = inject('superuserDatabaseUrl');
    admin = createDb(superuser, { max: 1 });
    await admin.db.$client.unsafe(`drop database if exists ${DB_NAME}`);
    await admin.db.$client.unsafe(`create database ${DB_NAME}`);
    const url = new URL(superuser);
    url.pathname = `/${DB_NAME}`;
    await runMigrations(url.toString());
    dbUrl = url.toString();
    handle = createDb(dbUrl, { max: 2 }); // R13 reserves one for the lock
    // RFC-62 R2: the importer refuses outright without a dictionary.
    await seedDictionary(handle.db);
    t.db = handle.db;
  }, 120_000);

  afterAll(async () => {
    await handle?.close();
    await admin?.db.$client.unsafe(`drop database if exists ${DB_NAME}`);
    await admin?.close();
  });

  async function counts() {
    return {
      batches: (await t.db.select().from(importBatches)).length,
      rejects: (await t.db.select().from(importRejects)).length,
      records: (await t.db.select().from(traitRecords)).length,
      species: (await t.db.select().from(species)).length,
      genera: (await t.db.select().from(genera)).length,
      families: (await t.db.select().from(families)).length,
      names: (await t.db.select().from(speciesNames)).length,
      refs: (await t.db.select().from(bibliographicReferences)).length,
      traits: (await t.db.select().from(traits)).length,
      levels: (await t.db.select().from(traitLevels)).length,
    };
  }

  it('clears what an earlier import loaded and keeps the trait dictionary', async () => {
    const first = await importRecords(t.db, { filePath: FIXTURE, force: true });
    const before = await counts();
    expect(before.records).toBeGreaterThan(0);
    expect(before.species).toBeGreaterThan(0);
    expect(before.refs).toBeGreaterThan(0);

    // Same file: without --replace this is refused by R3, which --replace waives.
    const second = await importRecords(t.db, { filePath: FIXTURE, replace: true });
    const after = await counts();

    // Only the replacing batch survives; the earlier one is gone (R12).
    expect(after.batches).toBe(1);
    const [only] = await t.db.select().from(importBatches);
    expect(only?.id).toBe(second.id);
    expect(only?.mode).toBe('replace');
    expect(second.id).not.toBe(first.id);

    // The dataset is the new load, not the sum of two loads.
    expect(after.records).toBe(before.records);
    expect(after.species).toBe(before.species);
    expect(after.genera).toBe(before.genera);
    expect(after.families).toBe(before.families);
    expect(after.names).toBe(before.names);
    expect(after.refs).toBe(before.refs);
    expect(after.rejects).toBe(before.rejects);

    // Every record belongs to the new batch.
    const foreign = (await t.db.select().from(traitRecords)).filter(
      (r) => r.importBatchId !== second.id,
    );
    expect(foreign).toEqual([]);

    // The dictionary is untouched — the import would refuse outright without it.
    expect(after.traits).toBe(before.traits);
    expect(after.levels).toBe(before.levels);
  });

  it('an import that fails after the wipe leaves the previous dataset in place', async () => {
    const first = await importRecords(t.db, { filePath: FIXTURE, replace: true });
    const before = await counts();
    expect(before.batches).toBe(1);

    // The oversized-reference failure of RFC-64 R9: it happens during the
    // catalog inserts, well after the wipe, so the rollback has to undo both.
    const dir = await mkdtemp(join(tmpdir(), 'reset-'));
    const file = join(dir, 'overflow.csv');
    const hugeRef = randomBytes(3000).toString('hex');
    const row = IMPORT_COLUMNS.map((c) =>
      c === 'primary_reference'
        ? hugeRef
        : c === 'wcvp_species'
          ? 'Fixturia alba'
          : c === 'final_standard_trait'
            ? 'flower_color'
            : c === 'trait_value_type'
              ? 'categorical'
              : c === 'harmonised_value'
                ? 'blue'
                : '',
    ).join(',');
    await writeFile(file, `${IMPORT_COLUMNS.join(',')}\n${row}\n`, 'utf8');

    await expect(importRecords(t.db, { filePath: file, replace: true })).rejects.toThrow();

    const after = await counts();
    expect(after.records).toBe(before.records);
    expect(after.species).toBe(before.species);
    expect(after.refs).toBe(before.refs);
    // The first batch survived the rolled-back wipe; the failed run is recorded.
    const batches = await t.db.select().from(importBatches);
    expect(batches.some((b) => b.id === first.id)).toBe(true);
    expect(batches.some((b) => b.status === 'failed')).toBe(true);
  });

  it('append is the default and leaves earlier batches alone', async () => {
    const baseline = await importRecords(t.db, { filePath: FIXTURE, replace: true });
    const appended = await importRecords(t.db, { filePath: FIXTURE, force: true });
    const batches = await t.db.select().from(importBatches);
    // The append left the replacing batch alone: both rows are still here.
    expect(batches.map((b) => b.id).sort()).toEqual([baseline.id, appended.id].sort());
    // `mode` is an operational column, not part of the RFC-64 R11 payload.
    const byId = new Map(batches.map((b) => [b.id, b.mode]));
    expect(byId.get(baseline.id)).toBe('replace');
    expect(byId.get(appended.id)).toBe('append');
  });

  it('R12 refuses a replacing import at the boundary, not only in the CLI', async () => {
    // `importRecords` is exported; a caller that is not the CLI must not be
    // able to reach the wipe in production.
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(importRecords(t.db, { filePath: FIXTURE, replace: true })).rejects.toMatchObject(
        { name: 'ImportRefusedError', reason: 'replace_not_allowed' },
      );
    } finally {
      process.env.NODE_ENV = previous;
    }
    // Refused before anything was written: the dataset is still there.
    expect((await counts()).records).toBeGreaterThan(0);
  });

  it('R13 serialises concurrent imports so neither loses its batch', async () => {
    await importRecords(t.db, { filePath: FIXTURE, replace: true });
    // Without the lock a replacing run deletes the other run's batch row while
    // it is still going, and that run ends with 'batch vanished'.
    // Two CLI runs are two processes with two pools. Sharing one pool here
    // would deadlock on connections, not on the lock: each run reserves one
    // connection for R13 and needs another for its own work.
    const other = createDb(dbUrl, { max: 2 });
    let a: Awaited<ReturnType<typeof importRecords>>;
    let b: Awaited<ReturnType<typeof importRecords>>;
    try {
      [a, b] = await Promise.all([
        importRecords(t.db, { filePath: FIXTURE, replace: true }),
        importRecords(other.db, { filePath: FIXTURE, force: true }),
      ]);
    } finally {
      await other.close();
    }
    expect(a.status).toBe('completed');
    expect(b.status).toBe('completed');
    const batches = await t.db.select().from(importBatches);
    // The replacing run survives either order: if it went first the append
    // added to it, and if it went second it deleted the append's batch. The
    // appending run's row only survives the first order, so asserting on it
    // would make this test depend on who won the lock.
    expect(batches.map((x) => x.id)).toEqual(expect.arrayContaining([a.id]));
    expect(batches.every((x) => x.status === 'completed')).toBe(true);
  }, 60_000);

  it('refuses in production only', () => {
    expect(isReplaceAllowed('production')).toBe(false);
    expect(isReplaceAllowed('development')).toBe(true);
    expect(isReplaceAllowed('test')).toBe(true);
  });
});
