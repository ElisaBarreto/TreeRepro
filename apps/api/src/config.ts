import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { keyringFromHex, type PiiKeyring } from './security/pii.ts';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

// Browsers send `Origin` as scheme://host[:port] with no path, trailing slash
// or default port, and the check is an exact comparison (RFC-02 R3), so the
// configured value is normalized to that form.
const originSchema = z
  .url()
  .transform((u) => new URL(u))
  .refine((u) => u.protocol === 'http:' || u.protocol === 'https:', 'APP_ORIGIN must be http(s)')
  .transform((u) => u.origin);

const dbHostSchema = {
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DB_NAME: z.string().min(1),
  SECRETS_DIR: z.string().min(1).default('/run/secrets'),
};

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // 0 is valid here (not for DB_PORT/REDIS_PORT): it asks the OS for an
  // ephemeral port, used by the boot smoke test (Task 13).
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  APP_ORIGIN: originSchema,
  ...dbHostSchema,
  DB_USER: z.string().min(1),
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
  PII_CURRENT_KEY_VERSION: z
    .string()
    .regex(/^v\d+$/)
    .default('v1'),
});

const migratorEnvSchema = z.object({
  ...dbHostSchema,
  DB_MIGRATOR_USER: z.string().min(1),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: LogLevel;
  appOrigin: string;
  db: { url: string };
  redis: { url: string };
  pii: { keyring: PiiKeyring; hmacKey: Buffer };
  sessionSecret: Buffer;
}

export interface MigratorConfig {
  db: { url: string };
}

/** @rfc RFC-10 R5 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const HEX_32_BYTES = /^[0-9a-f]{64}$/;
const KEY_FILE_RE = /^pii_encryption_key_(v\d+)$/;

/** @rfc RFC-02 R6 */
export function readSecret(secretsDir: string, name: string): string {
  const path = join(secretsDir, name);
  if (!existsSync(path)) throw new ConfigError(`missing secret "${name}" in ${secretsDir}`);
  const value = readFileSync(path, 'utf8').trim();
  if (value.length === 0) throw new ConfigError(`secret "${name}" is empty`);
  return value;
}

function readHexSecret(secretsDir: string, name: string): Buffer {
  const value = readSecret(secretsDir, name);
  if (!HEX_32_BYTES.test(value))
    throw new ConfigError(`secret "${name}" must be 64 hex characters`);
  return Buffer.from(value, 'hex');
}

/** @rfc RFC-10 R5 */
export function buildDbUrl(p: {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
}): string {
  return `postgres://${encodeURIComponent(p.user)}:${encodeURIComponent(p.password)}@${p.host}:${p.port}/${p.name}`;
}

/** @rfc RFC-10 R5 */
export function buildRedisUrl(p: { host: string; port: number; password: string }): string {
  return `redis://:${encodeURIComponent(p.password)}@${p.host}:${p.port}`;
}

/** @rfc RFC-40 R3 */
function loadKeyring(secretsDir: string, current: string): PiiKeyring {
  const keysHex: Record<string, string> = {};
  const files = existsSync(secretsDir) ? readdirSync(secretsDir) : [];
  for (const file of files) {
    const match = KEY_FILE_RE.exec(file);
    if (match?.[1]) keysHex[match[1]] = readHexSecret(secretsDir, file).toString('hex');
  }
  if (!(current in keysHex)) {
    throw new ConfigError(`missing secret "pii_encryption_key_${current}" in ${secretsDir}`);
  }
  return keyringFromHex(current, keysHex);
}

function parseEnv<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv): z.output<T> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new ConfigError(`invalid environment: ${fields}`);
  }
  return parsed.data;
}

/**
 * @rfc RFC-10 R5
 * @rfc RFC-02 R6
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const e = parseEnv(envSchema, env);
  const dbPassword = readSecret(e.SECRETS_DIR, 'db_app_password');
  const redisPassword = readSecret(e.SECRETS_DIR, 'redis_password');
  const hmacKey = readHexSecret(e.SECRETS_DIR, 'pii_hmac_key');
  const sessionSecret = readHexSecret(e.SECRETS_DIR, 'session_secret');
  const keyring = loadKeyring(e.SECRETS_DIR, e.PII_CURRENT_KEY_VERSION);
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    appOrigin: e.APP_ORIGIN,
    db: {
      url: buildDbUrl({
        host: e.DB_HOST,
        port: e.DB_PORT,
        name: e.DB_NAME,
        user: e.DB_USER,
        password: dbPassword,
      }),
    },
    redis: {
      url: buildRedisUrl({ host: e.REDIS_HOST, port: e.REDIS_PORT, password: redisPassword }),
    },
    pii: { keyring, hmacKey },
    sessionSecret,
  };
}

/**
 * Configuration of the one-shot `migrate` process (RFC-10 R7): the migrator
 * role's URL, nothing else.
 * @rfc RFC-10 R5
 * @rfc RFC-02 R6
 */
export function loadMigratorConfig(env: NodeJS.ProcessEnv = process.env): MigratorConfig {
  const e = parseEnv(migratorEnvSchema, env);
  return {
    db: {
      url: buildDbUrl({
        host: e.DB_HOST,
        port: e.DB_PORT,
        name: e.DB_NAME,
        user: e.DB_MIGRATOR_USER,
        password: readSecret(e.SECRETS_DIR, 'db_migrator_password'),
      }),
    },
  };
}
