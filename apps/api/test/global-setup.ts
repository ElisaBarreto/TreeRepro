import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';
import { buildDbUrl } from '../src/config.ts';
import { seedDictionary } from '../src/dataset/seed.ts';
import { createDb } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrator.ts';

export interface PostgresInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface RedisInfo {
  host: string;
  port: number;
  password: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    /** `treerepro_app` credentials: what the API runs with (RFC-10 R7). */
    databaseUrl: string;
    /** The container's superuser, for tests that must change privileges. */
    superuserDatabaseUrl: string;
    redisUrl: string;
    postgres: PostgresInfo;
    redis: RedisInfo;
  }
}

const REDIS_PASSWORD = 'test-redis-password';
const APP_PASSWORD = 'test-app-password';
const MIGRATOR_PASSWORD = 'test-migrator-password';
const BACKUP_PASSWORD = 'test-backup-password';

// The production init script (infra/postgres/init/01-roles.sh) runs inside the
// test container, so the roles and grants under test are exactly the ones a
// deployment gets; the migrations then run as `treerepro_migrator` and every
// test connects as `treerepro_app` unless it asks for the superuser.
const ROLES_SCRIPT = new URL('../../../infra/postgres/init/01-roles.sh', import.meta.url).pathname;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:18.6-alpine')
      .withCopyFilesToContainer([
        { source: ROLES_SCRIPT, target: '/docker-entrypoint-initdb.d/01-roles.sh', mode: 0o755 },
      ])
      .withCopyContentToContainer([
        { content: APP_PASSWORD, target: '/run/secrets/db_app_password', mode: 0o444 },
        { content: MIGRATOR_PASSWORD, target: '/run/secrets/db_migrator_password', mode: 0o444 },
        { content: BACKUP_PASSWORD, target: '/run/secrets/db_backup_password', mode: 0o444 },
      ])
      .start(),
    new RedisContainer('redis:8.8-alpine').withPassword(REDIS_PASSWORD).start(),
  ]);

  const base = { host: postgres.getHost(), port: postgres.getPort(), name: postgres.getDatabase() };
  const migratorUrl = buildDbUrl({
    ...base,
    user: 'treerepro_migrator',
    password: MIGRATOR_PASSWORD,
  });
  const appUrl = buildDbUrl({ ...base, user: 'treerepro_app', password: APP_PASSWORD });
  await runMigrations(migratorUrl);

  // RFC-62 R2: the dictionary is part of every environment; tests use its traits.
  const seedHandle = createDb(appUrl, { max: 1 });
  try {
    await seedDictionary(seedHandle.db);
  } finally {
    await seedHandle.close();
  }

  project.provide('databaseUrl', appUrl);
  project.provide('superuserDatabaseUrl', postgres.getConnectionUri());
  project.provide('redisUrl', redis.getConnectionUrl());
  project.provide('postgres', {
    host: base.host,
    port: base.port,
    database: base.name,
    user: 'treerepro_app',
    password: APP_PASSWORD,
  });
  project.provide('redis', {
    host: redis.getHost(),
    port: redis.getPort(),
    password: REDIS_PASSWORD,
  });

  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
