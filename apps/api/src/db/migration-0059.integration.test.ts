import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTrait, createTraitCategory } from '../../test/helpers/dataset.ts';
import { createDb, type Db } from './client.ts';
import { migrationsFolder, runMigrations } from './migrator.ts';

/**
 * Migration 0059 tags every existing region snapshot row as TreeRepro's and
 * puts the platform into each table's key (RFC-78 R7, plan 15f). Migrated to
 * 0058, seeded, then migrated the rest of the way exactly as the deploy does.
 */
describe('RFC-78 R7 migration 0059 makes the existing snapshot TreeRepro’s', () => {
  const DB_NAME = 'treerepro_migration_0059_test';
  let admin: { db: Db; close: () => Promise<void> } | undefined;
  let handle: { db: Db; close: () => Promise<void> } | undefined;
  let url = '';
  let upTo58 = '';

  beforeAll(async () => {
    const superuser = inject('superuserDatabaseUrl');
    admin = createDb(superuser, { max: 1 });
    await admin.db.$client.unsafe(`drop database if exists ${DB_NAME}`);
    await admin.db.$client.unsafe(`create database ${DB_NAME}`);
    const u = new URL(superuser);
    u.pathname = `/${DB_NAME}`;
    url = u.toString();
    upTo58 = await mkdtemp(join(tmpdir(), 'migrations-0058-'));
    await cp(migrationsFolder(), upTo58, { recursive: true });
    const journalPath = join(upTo58, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
      entries: { idx: number }[];
    };
    journal.entries = journal.entries.filter((e) => e.idx < 59);
    await writeFile(journalPath, JSON.stringify(journal));
    await runMigrations(url, upTo58);
    handle = createDb(url, { max: 1 });
  }, 120_000);

  afterAll(async () => {
    await handle?.close();
    await admin?.db.$client.unsafe(`drop database if exists ${DB_NAME}`);
    await admin?.close();
    if (upTo58) await rm(upTo58, { recursive: true, force: true });
  });

  it('backfills treerepro, drops the default, checks the value and keys every table by platform', async () => {
    const db = handle?.db as Db;
    const client = db.$client;
    const { key: categoryKey } = await createTraitCategory(db);
    const trait = await createTrait(db, { key: 'm0059_cat', categoryKey, levels: ['red'] });
    const level = trait.levels[0]?.id as string;
    await client`insert into region_completeness values (${trait.id}, 'AAA', 2, 10, 4)`;
    await client`insert into region_continuous values (${trait.id}, 'AAA', 3, 5, 1, 4, 1, 9, 20)`;
    await client`insert into region_categorical values (${trait.id}, ${level}, 'AAA', 1, 2)`;
    await client`insert into region_snapshot (computed_at) values ('2026-11-01T03:00:00Z')`;

    await runMigrations(url, migrationsFolder());

    for (const table of [
      'region_completeness',
      'region_continuous',
      'region_categorical',
      'region_snapshot',
    ]) {
      const rows = (await client.unsafe(`select platform from ${table}`)) as {
        platform: string;
      }[];
      expect(rows, table).toEqual([{ platform: 'treerepro' }]);
    }
    // The same trait × region for the other platform is a row of its own.
    await client`insert into region_completeness (platform, trait_id, area_code_l3, species_with_data, wcvp_species, wcvp_tree_species)
      values ('plantrepro', ${trait.id}, 'AAA', 5, 10, 4)`;
    await client`insert into region_snapshot (platform, computed_at) values ('plantrepro', now())`;
    expect(await client`select 1 from region_snapshot`).toHaveLength(2);
    await expect(
      client`insert into region_snapshot (platform, computed_at) values ('plantrepro', now())`,
    ).rejects.toThrow(/region_snapshot_id_platform_pk/);
    // No default: an insert must state the platform; the check holds.
    await expect(
      client`insert into region_continuous (trait_id, area_code_l3, n_species, mean, median, min, max)
        values (${trait.id}, 'BBB', 1, 1, 1, 1, 1)`,
    ).rejects.toThrow(/null value/);
    await expect(
      client`insert into region_categorical (platform, trait_id, level_id, area_code_l3, n_species_with_level, n_species_with_trait)
        values ('shrubrepro', ${trait.id}, ${level}, 'BBB', 1, 1)`,
    ).rejects.toThrow(/region_categorical_platform_check/);
  });
});
