import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createUser } from '../../test/helpers/users.ts';
import { createDb, type Db } from './client.ts';
import { migrationsFolder, runMigrations } from './migrator.ts';

/**
 * Migration 0058 makes every existing species a reviewed tree and gives the
 * proposals a stated plant type (RFC-60 R1, RFC-75 R1, plan 15d). Migrated to
 * 0057, seeded, then migrated the rest of the way exactly as the deploy does.
 */
describe('RFC-60 R1 migration 0058 makes every existing species a reviewed tree', () => {
  const DB_NAME = 'treerepro_migration_0058_test';
  let admin: { db: Db; close: () => Promise<void> } | undefined;
  let handle: { db: Db; close: () => Promise<void> } | undefined;
  let url = '';
  let upTo57 = '';

  beforeAll(async () => {
    const superuser = inject('superuserDatabaseUrl');
    admin = createDb(superuser, { max: 1 });
    await admin.db.$client.unsafe(`drop database if exists ${DB_NAME}`);
    await admin.db.$client.unsafe(`create database ${DB_NAME}`);
    const u = new URL(superuser);
    u.pathname = `/${DB_NAME}`;
    url = u.toString();
    upTo57 = await mkdtemp(join(tmpdir(), 'migrations-0057-'));
    await cp(migrationsFolder(), upTo57, { recursive: true });
    const journalPath = join(upTo57, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
      entries: { idx: number }[];
    };
    journal.entries = journal.entries.filter((e) => e.idx < 58);
    await writeFile(journalPath, JSON.stringify(journal));
    await runMigrations(url, upTo57);
    handle = createDb(url, { max: 1 });
  }, 120_000);

  afterAll(async () => {
    await handle?.close();
    await admin?.db.$client.unsafe(`drop database if exists ${DB_NAME}`);
    await admin?.close();
    if (upTo57) await rm(upTo57, { recursive: true, force: true });
  });

  it('backfills tree / reviewed, leaves proposals null, drops the defaults and checks the values', async () => {
    const db = handle?.db as Db;
    const client = db.$client;
    const [sp] = (await client`
      insert into species (canonical_name, name_source, active)
      values ('Migratia m0058', 'wcvp', false) returning id`) as [{ id: string }];
    const proposer = (await createUser(db)).user.id;
    await client`insert into species_proposals (proposed_name, proposer_id)
      values ('Propositia m0058', ${proposer})`;

    await runMigrations(url, migrationsFolder());

    const [row] = (await client`
      select plant_type, plant_type_status, active from species where id = ${sp.id}`) as [
      { plant_type: string; plant_type_status: string; active: boolean },
    ];
    expect(row).toEqual({ plant_type: 'tree', plant_type_status: 'reviewed', active: false });
    const [proposal] = (await client`
      select plant_type from species_proposals where proposed_name = 'Propositia m0058'`) as [
      { plant_type: string | null },
    ];
    expect(proposal.plant_type).toBeNull();

    // No default: an insert must state both; the checks hold.
    await expect(
      client`insert into species (canonical_name, name_source) values ('Nullia m0058', 'wcvp')`,
    ).rejects.toThrow(/null value/);
    await expect(
      client`insert into species (canonical_name, name_source, plant_type, plant_type_status)
        values ('Shrubia m0058', 'wcvp', 'shrub', 'reviewed')`,
    ).rejects.toThrow(/species_plant_type_check/);
    await expect(
      client`insert into species (canonical_name, name_source, plant_type, plant_type_status)
        values ('Statia m0058', 'wcvp', 'tree', 'maybe')`,
    ).rejects.toThrow(/species_plant_type_status_check/);
    await expect(
      client`update species_proposals set plant_type = 'shrub' where proposed_name = 'Propositia m0058'`,
    ).rejects.toThrow(/species_proposals_plant_type_check/);
    const [index] = (await client`
      select indexdef from pg_indexes where indexname = 'species_plant_type_idx'`) as [
      { indexdef: string },
    ];
    expect(index.indexdef).toContain('(plant_type, plant_type_status)');
  });
});
