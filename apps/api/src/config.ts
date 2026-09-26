import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { z } from 'zod';
import { defaultMapsDir } from './maps/manifest.ts';
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
  // RFC-74 R6: `false` turns the daily digest off; anything unset is on.
  DIGEST_ENABLED: z.stringbool().default(true),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_FROM: z.string().min(3),
  SMTP_USER: z
    .string()
    .optional()
    .transform((v) => {
      const user = v?.trim();
      return user || undefined;
    }),
  DOI_CONTACT_EMAIL: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined)
    .pipe(z.string().email().optional()),
  // RFC-20 R4: named in the invitation as who to ask for a new one; unset
  // names an administrator. Configuration, not code: the repository is public.
  INVITE_CONTACT_EMAIL: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined)
    .pipe(z.string().email().optional()),
  // RFC-81 R1: unset skips the WCVP call and the verdict comes from the
  // GBIF backbone alone; the start-up check disables it too on any failure.
  WCVP_GBIF_DATASET_KEY: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
  // RFC-76 R1: the trait maps directory, private and mounted read-only
  // (`/maps` in the container); default is the repository directory used in
  // development and tests, which never carries the image files themselves.
  MAPS_DIR: z.string().min(1).default(defaultMapsDir()),
});

const migratorEnvSchema = z.object({
  ...dbHostSchema,
  DB_MIGRATOR_USER: z.string().min(1),
});

/**
 * Holds a secret value so that it cannot reach a log or a response by
 * accident: JSON, string and inspect forms are the literal `[secret]`, the
 * value lives in a private field, and only `expose()` returns it.
 * @rfc RFC-02 R6
 */
export class Secret<T> {
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  expose(): T {
    return this.#value;
  }

  toJSON(): string {
    return '[secret]';
  }

  toString(): string {
    return '[secret]';
  }

  [inspect.custom](): string {
    return '[secret]';
  }
}

/** @rfc RFC-10 R5 */
export interface SmtpSettings {
  host: string;
  port: number;
  /** Implicit TLS (port 465). Otherwise STARTTLS is attempted. */
  secure: boolean;
  from: string;
  user?: string;
  password?: Secret<string>;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: LogLevel;
  appOrigin: string;
  db: { url: Secret<string> };
  redis: { url: Secret<string> };
  pii: { keyring: Secret<PiiKeyring>; hmacKey: Secret<Buffer> };
  sessionSecret: Secret<Buffer>;
  smtp: SmtpSettings;
  /** `DIGEST_ENABLED`; the E2E stack turns it off. @rfc RFC-74 R6 */
  digestEnabled: boolean;
  doiContactEmail?: string;
  /** `INVITE_CONTACT_EMAIL`. @rfc RFC-20 R4 */
  inviteContactEmail?: string;
  /** `WCVP_GBIF_DATASET_KEY`; unset disables the WCVP source. @rfc RFC-81 R1 */
  wcvpGbifDatasetKey?: string;
  /** `MAPS_DIR`; private, mounted read-only in production. @rfc RFC-76 R1 */
  mapsDir: string;
}

export interface MigratorConfig {
  db: { url: Secret<string> };
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
  const smtp: SmtpSettings = {
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    from: e.SMTP_FROM,
  };
  if (e.SMTP_USER) {
    smtp.user = e.SMTP_USER;
    smtp.password = new Secret(readSecret(e.SECRETS_DIR, 'smtp_password'));
  }
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    appOrigin: e.APP_ORIGIN,
    db: {
      url: new Secret(
        buildDbUrl({
          host: e.DB_HOST,
          port: e.DB_PORT,
          name: e.DB_NAME,
          user: e.DB_USER,
          password: dbPassword,
        }),
      ),
    },
    redis: {
      url: new Secret(
        buildRedisUrl({ host: e.REDIS_HOST, port: e.REDIS_PORT, password: redisPassword }),
      ),
    },
    pii: { keyring: new Secret(keyring), hmacKey: new Secret(hmacKey) },
    sessionSecret: new Secret(sessionSecret),
    smtp,
    digestEnabled: e.DIGEST_ENABLED,
    doiContactEmail: e.DOI_CONTACT_EMAIL,
    inviteContactEmail: e.INVITE_CONTACT_EMAIL,
    wcvpGbifDatasetKey: e.WCVP_GBIF_DATASET_KEY,
    mapsDir: e.MAPS_DIR,
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
      url: new Secret(
        buildDbUrl({
          host: e.DB_HOST,
          port: e.DB_PORT,
          name: e.DB_NAME,
          user: e.DB_MIGRATOR_USER,
          password: readSecret(e.SECRETS_DIR, 'db_migrator_password'),
        }),
      ),
    },
  };
}
