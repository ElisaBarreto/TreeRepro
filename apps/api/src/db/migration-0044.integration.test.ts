import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  createImportBatch,
  createReference,
  createSpecies,
  createTrait,
  createTraitCategory,
} from '../../test/helpers/dataset.ts';
import { createDb, type Db } from './client.ts';
import { migrationsFolder, runMigrations } from './migrator.ts';

/**
 * Migration 0044 moves an imported value labelled `mean` or `median` into its
 * own field and rewrites its `value_text` (RFC-63 R15, issue #232). It runs
 * against a database of its own: migrated to 0043, seeded with labelled rows,
 * then migrated the rest of the way exactly as the deploy does.
 */
describe('RFC-63 R3, R15 migration 0044 moves labelled values into their own field', () => {
  const DB_NAME = 'treerepro_migration_0044_test';
  let admin: { db: Db; close: () => Promise<void> } | undefined;
  let handle: { db: Db; close: () => Promise<void> } | undefined;
  let url = '';
  let upTo43 = '';

  beforeAll(async () => {
    const superuser = inject('superuserDatabaseUrl');
    admin = createDb(superuser, { max: 1 });
    await admin.db.$client.unsafe(`drop database if exists ${DB_NAME}`);
    await admin.db.$client.unsafe(`create database ${DB_NAME}`);
    const u = new URL(superuser);
    u.pathname = `/${DB_NAME}`;
    url = u.toString();
    // A copy of the migrations folder whose journal stops at 0043.
    upTo43 = await mkdtemp(join(tmpdir(), 'migrations-0043-'));
    await cp(migrationsFolder(), upTo43, { recursive: true });
    const journalPath = join(upTo43, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
      entries: { idx: number }[];
    };
    journal.entries = journal.entries.filter((e) => e.idx < 44);
    await writeFile(journalPath, JSON.stringify(journal));
    await runMigrations(url, upTo43);
    handle = createDb(url, { max: 1 });
  }, 120_000);

  afterAll(async () => {
    await handle?.close();
    await admin?.db.$client.unsafe(`drop database if exists ${DB_NAME}`);
    await admin?.close();
    if (upTo43) await rm(upTo43, { recursive: true, force: true });
  });

  it('rewrites the table without firing the append-only trigger; the claim key holds afterwards', async () => {
    const db = handle?.db as Db;
    const client = db.$client;
    // The tables the helpers write are unchanged by 0044; trait_records is
    // seeded in its 0043 shape, with `statistic`.
    const sp = await createSpecies(db);
    const ref = await createReference(db);
    const batch = await createImportBatch(db);
    const category = await createTraitCategory(db);
    const trait = await createTrait(db, { valueType: 'quantitative', categoryKey: category.key });
    const seed = async (
      code: string,
      row: {
        statistic: string | null;
        numeric: string | null;
        valueText: string;
        raw: string;
        min?: string;
        max?: string;
        sd?: string;
        n?: number;
      },
    ) =>
      client.unsafe(
        `insert into trait_records (record_code, species_id, trait_id, value_text, harmonisation,
           numeric_value, min_value, max_value, sd_value, n, statistic, raw_value,
           primary_reference_id, origin, import_batch_id, import_row_no)
         values ($1, $2, $3, $4, 'harmonised', $5, $6, $7, $8, $9, $10, $11, $12, 'import', $13,
           (select coalesce(max(import_row_no), 0) + 1 from trait_records))`,
        [
          code,
          sp.id,
          trait.id,
          row.valueText,
          row.numeric,
          row.min ?? null,
          row.max ?? null,
          row.sd ?? null,
          row.n ?? null,
          row.statistic,
          row.raw,
          ref.id,
          batch.id,
        ],
      );
    // What the 0043 import stored: the value in numeric_value, labelled.
    await seed('EB_1', { statistic: 'mean', numeric: '9.3', valueText: '9.3', raw: '9.3' });
    await seed('EB_2', { statistic: 'median', numeric: '9.3', valueText: '9.3', raw: '9.3' });
    await seed('EB_3', {
      statistic: 'single_or_unspecified',
      numeric: '9.3',
      valueText: '9.3',
      raw: '9.3',
    });
    await seed('EB_4', {
      statistic: 'median',
      numeric: '7',
      valueText: 'single=7;sd=1;n=3',
      raw: '7',
      sd: '1',
      n: 3,
    });
    await seed('EB_5', {
      statistic: 'derived_midpoint',
      numeric: '2.4',
      valueText: 'single=2.4;min=0.8;max=4.0',
      raw: '0.8-4.0',
      min: '0.8',
      max: '4.0',
    });
    // A midpoint with no bound to fall back on stays a single value: nulling
    // it would leave a harmonised record with no value (trait_records_harmonised_check).
    await seed('EB_6', { statistic: 'derived_midpoint', numeric: '3', valueText: '3', raw: '3' });
    await seed('EB_7', {
      statistic: null,
      numeric: '3',
      valueText: 'single=3;min=1;max=5',
      raw: '1-5',
      min: '1',
      max: '5',
    });
    // A bounded midpoint whose cleared form would repeat a bound-only claim of
    // the same source keeps its number as a single value.
    await seed('EB_8', {
      statistic: null,
      numeric: null,
      valueText: 'min=10;max=20',
      raw: '10-20',
      min: '10',
      max: '20',
    });
    await seed('EB_9', {
      statistic: 'derived_midpoint',
      numeric: '15',
      valueText: 'single=15;min=10;max=20',
      raw: '10-20',
      min: '10',
      max: '20',
    });
    // Two midpoints of the same bounds: the smallest id is cleared, the other keeps its number.
    await seed('EB_10', {
      statistic: 'derived_midpoint',
      numeric: '35',
      valueText: 'single=35;min=30;max=40',
      raw: '30-40',
      min: '30',
      max: '40',
    });
    await seed('EB_11', {
      statistic: 'derived_midpoint',
      numeric: '36',
      valueText: 'single=36;min=30;max=40',
      raw: '30-40',
      min: '30',
      max: '40',
    });
    const filenode = async () =>
      (
        await client.unsafe<{ f: string }[]>(
          `select pg_relation_filenode('trait_records')::text as f`,
        )
      )[0]?.f;
    const before = await filenode();

    // The append-only trigger raises on any UPDATE, so a migration that
    // updated a row would fail here.
    await runMigrations(url);

    // Nothing else in 0044 rewrites trait_records: a new file is the USING rewrite.
    expect(await filenode()).not.toBe(before);
    const rows = await client.unsafe<Record<string, unknown>[]>(`
      select record_code as code, value_text as text, numeric_value::text as single,
        mean_value::text as mean, median_value::text as median,
        min_value::text as min, max_value::text as max
      from trait_records order by length(record_code), record_code`);
    expect(rows).toEqual([
      {
        code: 'EB_1',
        text: 'mean=9.3',
        single: null,
        mean: '9.3',
        median: null,
        min: null,
        max: null,
      },
      {
        code: 'EB_2',
        text: 'median=9.3',
        single: null,
        mean: null,
        median: '9.3',
        min: null,
        max: null,
      },
      { code: 'EB_3', text: '9.3', single: '9.3', mean: null, median: null, min: null, max: null },
      {
        code: 'EB_4',
        text: 'median=7;sd=1;n=3',
        single: null,
        mean: null,
        median: '7',
        min: null,
        max: null,
      },
      {
        code: 'EB_5',
        text: 'min=0.8;max=4.0',
        single: null,
        mean: null,
        median: null,
        min: '0.8',
        max: '4.0',
      },
      { code: 'EB_6', text: '3', single: '3', mean: null, median: null, min: null, max: null },
      {
        code: 'EB_7',
        text: 'single=3;min=1;max=5',
        single: '3',
        mean: null,
        median: null,
        min: '1',
        max: '5',
      },
      {
        code: 'EB_8',
        text: 'min=10;max=20',
        single: null,
        mean: null,
        median: null,
        min: '10',
        max: '20',
      },
      {
        code: 'EB_9',
        text: 'single=15;min=10;max=20',
        single: '15',
        mean: null,
        median: null,
        min: '10',
        max: '20',
      },
      {
        code: 'EB_10',
        text: 'min=30;max=40',
        single: null,
        mean: null,
        median: null,
        min: '30',
        max: '40',
      },
      {
        code: 'EB_11',
        text: 'single=36;min=30;max=40',
        single: '36',
        mean: null,
        median: null,
        min: '30',
        max: '40',
      },
    ]);
    const [{ key }] = (await client.unsafe(`
      select count(*)::int as key from pg_constraint
      where conrelid = 'trait_records'::regclass and conname = 'trait_records_claim_key'`)) as unknown as [
      { key: number },
    ];
    expect(key).toBe(1);
  });
});
