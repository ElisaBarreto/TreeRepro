import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createUser } from '../../test/helpers/users.ts';
import { createDb, type Db } from './client.ts';
import { migrationsFolder, runMigrations } from './migrator.ts';

/**
 * Migration 0057 assigns every existing role to TreeRepro and gives every
 * admin its PlantRepro row (RFC-31 R16, plan 15c). Migrated to 0056, seeded,
 * then migrated the rest of the way exactly as the deploy does.
 */
describe('RFC-31 R16 migration 0057 assigns the existing roles per platform', () => {
  const DB_NAME = 'treerepro_migration_0057_test';
  let admin: { db: Db; close: () => Promise<void> } | undefined;
  let handle: { db: Db; close: () => Promise<void> } | undefined;
  let url = '';
  let upTo56 = '';

  beforeAll(async () => {
    const superuser = inject('superuserDatabaseUrl');
    admin = createDb(superuser, { max: 1 });
    await admin.db.$client.unsafe(`drop database if exists ${DB_NAME}`);
    await admin.db.$client.unsafe(`create database ${DB_NAME}`);
    const u = new URL(superuser);
    u.pathname = `/${DB_NAME}`;
    url = u.toString();
    upTo56 = await mkdtemp(join(tmpdir(), 'migrations-0056-'));
    await cp(migrationsFolder(), upTo56, { recursive: true });
    const journalPath = join(upTo56, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
      entries: { idx: number }[];
    };
    journal.entries = journal.entries.filter((e) => e.idx < 57);
    await writeFile(journalPath, JSON.stringify(journal));
    await runMigrations(url, upTo56);
    handle = createDb(url, { max: 1 });
  }, 120_000);

  afterAll(async () => {
    await handle?.close();
    await admin?.db.$client.unsafe(`drop database if exists ${DB_NAME}`);
    await admin?.close();
    if (upTo56) await rm(upTo56, { recursive: true, force: true });
  });

  it('backfills treerepro, adds plantrepro for admins only, and drops the default', async () => {
    const db = handle?.db as Db;
    const client = db.$client;
    const roleId = async (name: string) =>
      ((await client`select id from roles where name = ${name}`) as [{ id: string }])[0].id;
    const adminRole = await roleId('admin');
    const contributorRole = await roleId('contributor');
    const a = await createUser(db);
    const c = await createUser(db);
    const both = await createUser(db);
    await client`insert into user_roles (user_id, role_id) values
      (${a.user.id}, ${adminRole}), (${c.user.id}, ${contributorRole}),
      (${both.user.id}, ${adminRole}), (${both.user.id}, ${contributorRole})`;
    await client`insert into auth_tokens (user_id, kind, token_hash, expires_at)
      values (${c.user.id}, 'invite', ${'f'.repeat(64)}, now() + interval '1 day')`;

    await runMigrations(url, migrationsFolder());

    const rows = (await client`
      select user_id, role_id, platform from user_roles
      order by user_id, role_id, platform`) as {
      user_id: string;
      role_id: string;
      platform: string;
    }[];
    const of = (userId: string) =>
      rows
        .filter((r) => r.user_id === userId)
        .map((r) => `${r.role_id === adminRole ? 'admin' : 'contributor'}:${r.platform}`)
        .sort();
    expect(of(a.user.id)).toEqual(['admin:plantrepro', 'admin:treerepro']);
    expect(of(c.user.id)).toEqual(['contributor:treerepro']);
    expect(of(both.user.id)).toEqual([
      'admin:plantrepro',
      'admin:treerepro',
      'contributor:treerepro',
    ]);

    const [token] =
      (await client`select platform from auth_tokens where user_id = ${c.user.id}`) as [
        { platform: string | null },
      ];
    expect(token.platform).toBeNull();

    // No default: an insert must name its platform; the check holds.
    await expect(
      client`insert into user_roles (user_id, role_id) values (${c.user.id}, ${adminRole})`,
    ).rejects.toThrow(/null value/);
    await expect(
      client`insert into user_roles (user_id, role_id, platform) values (${c.user.id}, ${adminRole}, 'other')`,
    ).rejects.toThrow(/user_roles_platform_check/);
  });
});
