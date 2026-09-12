import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { captureLogger } from '../test/helpers/logger.ts';
import {
  buildDbUrl,
  buildRedisUrl,
  ConfigError,
  loadConfig,
  loadMigratorConfig,
  readSecret,
  Secret,
} from './config.ts';

const hex = () => randomBytes(32).toString('hex');

const ALL_SECRETS = {
  db_app_password: 'dbpw',
  db_migrator_password: 'migpw',
  redis_password: 'redispw',
  pii_encryption_key_v1: hex(),
  pii_hmac_key: hex(),
  session_secret: hex(),
};

const dirs: string[] = [];
function secretsDir(secrets: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'treerepro-secrets-'));
  dirs.push(dir);
  for (const [name, value] of Object.entries(secrets)) writeFileSync(join(dir, name), `${value}\n`);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    APP_ORIGIN: 'http://localhost',
    DB_HOST: 'postgres',
    DB_NAME: 'treerepro',
    DB_USER: 'treerepro_app',
    REDIS_HOST: 'redis',
    SECRETS_DIR: secretsDir(ALL_SECRETS),
    ...overrides,
  };
}

describe('RFC-10 R5 loadConfig', () => {
  it('builds a config from env and secret files', () => {
    const config = loadConfig(env());
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
    expect(config.appOrigin).toBe('http://localhost');
    expect(config.db.url.expose()).toBe('postgres://treerepro_app:dbpw@postgres:5432/treerepro');
    expect(config.redis.url.expose()).toBe('redis://:redispw@redis:6379');
    expect(config.pii.keyring.expose().current).toBe('v1');
    expect(config.pii.hmacKey.expose()).toHaveLength(32);
    expect(config.sessionSecret.expose()).toHaveLength(32);
  });

  it('rejects an invalid environment naming the field, not the value', () => {
    expect(() => loadConfig(env({ APP_ORIGIN: 'not a url' }))).toThrow(
      new ConfigError('invalid environment: APP_ORIGIN'),
    );
  });

  it('coerces numeric ports', () => {
    expect(loadConfig(env({ PORT: '4000', DB_PORT: '6543' })).port).toBe(4000);
  });
});

describe('RFC-02 R3 APP_ORIGIN normalization', () => {
  it('normalizes a trailing slash and an explicit default port to the bare origin', () => {
    expect(loadConfig(env({ APP_ORIGIN: 'http://localhost/' })).appOrigin).toBe('http://localhost');
    expect(loadConfig(env({ APP_ORIGIN: 'https://x.example:443/' })).appOrigin).toBe(
      'https://x.example',
    );
    expect(loadConfig(env({ APP_ORIGIN: 'https://x.example:8443/app' })).appOrigin).toBe(
      'https://x.example:8443',
    );
  });

  it('rejects non-http(s) URLs naming only the field', () => {
    expect(() => loadConfig(env({ APP_ORIGIN: 'mailto:a@b.example' }))).toThrow(
      new ConfigError('invalid environment: APP_ORIGIN'),
    );
  });
});

describe('RFC-10 R5 loadMigratorConfig', () => {
  it('builds the migrator URL from env and the migrator secret', () => {
    const config = loadMigratorConfig({
      DB_HOST: 'postgres',
      DB_NAME: 'treerepro',
      DB_MIGRATOR_USER: 'treerepro_migrator',
      SECRETS_DIR: secretsDir(ALL_SECRETS),
    });
    expect(config.db.url.expose()).toBe(
      'postgres://treerepro_migrator:migpw@postgres:5432/treerepro',
    );
  });

  it('rejects an invalid environment naming the field', () => {
    expect(() =>
      loadMigratorConfig({ DB_HOST: 'postgres', DB_NAME: 'treerepro', SECRETS_DIR: '/nowhere' }),
    ).toThrow(new ConfigError('invalid environment: DB_MIGRATOR_USER'));
  });

  it('names a missing migrator secret', () => {
    const { db_migrator_password: _omit, ...rest } = ALL_SECRETS;
    expect(() =>
      loadMigratorConfig({
        DB_HOST: 'postgres',
        DB_NAME: 'treerepro',
        DB_MIGRATOR_USER: 'treerepro_migrator',
        SECRETS_DIR: secretsDir(rest),
      }),
    ).toThrow(/missing secret "db_migrator_password"/);
  });
});

describe('RFC-02 R6 secrets', () => {
  it('fails when a secret file is missing and names it', () => {
    const { pii_hmac_key: _omit, ...rest } = ALL_SECRETS;
    expect(() => loadConfig(env({ SECRETS_DIR: secretsDir(rest) }))).toThrow(
      /missing secret "pii_hmac_key"/,
    );
  });

  it('fails on an empty secret file', () => {
    const dir = secretsDir({ ...ALL_SECRETS, session_secret: '' });
    expect(() => loadConfig(env({ SECRETS_DIR: dir }))).toThrow(/secret "session_secret" is empty/);
  });

  it('never includes secret values in error messages', () => {
    const dir = secretsDir({ ...ALL_SECRETS, pii_hmac_key: 'nothex' });
    try {
      loadConfig(env({ SECRETS_DIR: dir }));
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain('nothex');
      expect((e as Error).message).toMatch(/pii_hmac_key/);
    }
  });

  it('readSecret trims trailing newlines', () => {
    expect(readSecret(secretsDir({ x: 'value' }), 'x')).toBe('value');
  });

  it('Secret hides its value from JSON, String and inspect and only expose() reads it', () => {
    const s = new Secret('hunter2');
    expect(s.expose()).toBe('hunter2');
    expect(JSON.stringify({ s })).toBe('{"s":"[secret]"}');
    expect(String(s)).toBe('[secret]');
    expect(`${s}`).toBe('[secret]');
    expect(inspect(s)).toBe('[secret]');
    expect(Object.keys(s)).toEqual([]);
  });

  it('serializing the whole config leaks no secret material', () => {
    const config = loadConfig(env());
    const { logger, lines } = captureLogger();
    logger.info({ config }, 'boot');
    const serialized = [
      JSON.stringify(config),
      inspect(config, { depth: 10 }),
      JSON.stringify(lines),
    ];
    const material = [
      'dbpw',
      'redispw',
      ALL_SECRETS.pii_hmac_key,
      ALL_SECRETS.session_secret,
      ALL_SECRETS.pii_encryption_key_v1,
      Buffer.from(ALL_SECRETS.pii_hmac_key, 'hex').toString('base64'),
    ];
    for (const text of serialized) {
      for (const m of material) expect(text).not.toContain(m);
      expect(text).not.toMatch(/"data":\[/);
    }
    expect(JSON.parse(JSON.stringify(config))).toMatchObject({
      db: { url: '[secret]' },
      redis: { url: '[secret]' },
      pii: { keyring: '[secret]', hmacKey: '[secret]' },
      sessionSecret: '[secret]',
    });
  });
});

describe('RFC-40 R3 keyring loading', () => {
  it('loads every pii_encryption_key_v* file and honours PII_CURRENT_KEY_VERSION', () => {
    const dir = secretsDir({ ...ALL_SECRETS, pii_encryption_key_v2: hex() });
    const config = loadConfig(env({ SECRETS_DIR: dir, PII_CURRENT_KEY_VERSION: 'v2' }));
    const keyring = config.pii.keyring.expose();
    expect(keyring.current).toBe('v2');
    expect([...keyring.keys.keys()].sort()).toEqual(['v1', 'v2']);
  });

  it('fails when the current version file is missing', () => {
    expect(() => loadConfig(env({ PII_CURRENT_KEY_VERSION: 'v3' }))).toThrow(
      /missing secret "pii_encryption_key_v3"/,
    );
  });
});

describe('RFC-10 R5 url builders', () => {
  it('percent-encodes credentials', () => {
    expect(buildDbUrl({ host: 'h', port: 1, name: 'd', user: 'u@x', password: 'p:w' })).toBe(
      'postgres://u%40x:p%3Aw@h:1/d',
    );
    expect(buildRedisUrl({ host: 'h', port: 2, password: 'p/w' })).toBe('redis://:p%2Fw@h:2');
  });
});
