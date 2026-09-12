import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PERMISSION_KEYS } from '@treerepro/contracts';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { useTestDb } from '../../test/helpers/db.ts';
import { randomEmail } from '../../test/helpers/users.ts';
import { effectivePermissions } from '../access/permissions.ts';
import { findUserByEmail } from '../auth/users.ts';
import { userRoles } from '../db/schema/user-roles.ts';

const apiDir = resolve(import.meta.dirname, '../..');
let secretsDir: string | undefined;

afterAll(() => {
  if (secretsDir) rmSync(secretsDir, { recursive: true, force: true });
});

describe('RFC-20 R8 seed:admin', () => {
  const t = useTestDb();

  it('creates the invited user, prints the link, and exits 1 when the email cannot be sent', async () => {
    const pg = inject('postgres');
    const redis = inject('redis');
    secretsDir = mkdtempSync(join(tmpdir(), 'treerepro-seed-'));
    for (const [name, value] of Object.entries({
      db_app_password: pg.password,
      redis_password: redis.password,
      pii_encryption_key_v1: 'a'.repeat(64),
      pii_hmac_key: Buffer.alloc(32, 7).toString('hex'),
      session_secret: 'c'.repeat(64),
    }))
      writeFileSync(join(secretsDir, name), value);
    const email = randomEmail();
    const result = spawnSync(
      'node',
      [
        '--conditions=development',
        'src/cli/seed-admin.ts',
        '--email',
        email,
        '--name',
        'First Admin',
      ],
      {
        cwd: apiDir,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          NODE_ENV: 'test',
          APP_ORIGIN: 'http://localhost',
          DB_HOST: pg.host,
          DB_PORT: String(pg.port),
          DB_NAME: pg.database,
          DB_USER: pg.user,
          REDIS_HOST: redis.host,
          REDIS_PORT: String(redis.port),
          SECRETS_DIR: secretsDir,
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: '1',
          SMTP_FROM: 'TreeRepro <no-reply@localhost>',
        },
        timeout: 30_000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/http:\/\/localhost\/invite\/[A-Za-z0-9_-]{43}/);
    expect(result.stderr).toMatch(/could not be sent/i);
    expect((await findUserByEmail(t.db, email))?.status).toBe('invited');
    const user = await findUserByEmail(t.db, email);
    expect(await effectivePermissions(t.db, user?.id ?? '')).toEqual([...PERMISSION_KEYS].sort());

    const result2 = spawnSync(
      'node',
      [
        '--conditions=development',
        'src/cli/seed-admin.ts',
        '--email',
        email,
        '--name',
        'First Admin',
      ],
      {
        cwd: apiDir,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          NODE_ENV: 'test',
          APP_ORIGIN: 'http://localhost',
          DB_HOST: pg.host,
          DB_PORT: String(pg.port),
          DB_NAME: pg.database,
          DB_USER: pg.user,
          REDIS_HOST: redis.host,
          REDIS_PORT: String(redis.port),
          SECRETS_DIR: secretsDir,
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: '1',
          SMTP_FROM: 'TreeRepro <no-reply@localhost>',
        },
        timeout: 30_000,
      },
    );
    expect(result2.status).toBe(1);
    expect(result2.stderr).toMatch(/could not be sent/i);
    const [row] = await t.db
      .select({ n: sql<number>`count(*)::int` })
      .from(userRoles)
      .where(eq(userRoles.userId, user?.id ?? ''));
    expect(row?.n).toBe(1);
  });

  it('refuses to run without --email and --name', () => {
    const result = spawnSync('node', ['--conditions=development', 'src/cli/seed-admin.ts'], {
      cwd: apiDir,
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage');
  });
});
