import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';
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
    databaseUrl: string;
    redisUrl: string;
    postgres: PostgresInfo;
    redis: RedisInfo;
  }
}

const REDIS_PASSWORD = 'test-redis-password';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:18.6-alpine').start(),
    new RedisContainer('redis:8.8-alpine').withPassword(REDIS_PASSWORD).start(),
  ]);
  await runMigrations(postgres.getConnectionUri());

  project.provide('databaseUrl', postgres.getConnectionUri());
  project.provide('redisUrl', redis.getConnectionUrl());
  project.provide('postgres', {
    host: postgres.getHost(),
    port: postgres.getPort(),
    database: postgres.getDatabase(),
    user: postgres.getUsername(),
    password: postgres.getPassword(),
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
