import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';

const apiDir = resolve(import.meta.dirname, '..');
let child: ChildProcess | undefined;
let secretsDir: string | undefined;

function waitForListening(proc: ChildProcess): Promise<number> {
  return new Promise((resolvePort, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`api did not start:\n${buffer}`)), 25_000);
    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      for (const line of buffer.split('\n')) {
        if (!line.includes('api listening')) continue;
        clearTimeout(timer);
        resolvePort((JSON.parse(line) as { port: number }).port);
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
    });
    proc.on('exit', (code) => reject(new Error(`api exited with ${code}:\n${buffer}`)));
  });
}

afterAll(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((r) => child?.once('exit', r));
  }
  if (secretsDir) rmSync(secretsDir, { recursive: true, force: true });
});

describe('RFC-10 R5, R10, R11 server boot', () => {
  it('starts from TypeScript source, serves /api/health and /api/health/ready, and shuts down on SIGTERM', async () => {
    const pg = inject('postgres');
    const redis = inject('redis');
    secretsDir = mkdtempSync(join(tmpdir(), 'treerepro-boot-'));
    const secrets: Record<string, string> = {
      db_app_password: pg.password,
      redis_password: redis.password,
      pii_encryption_key_v1: 'a'.repeat(64),
      pii_hmac_key: 'b'.repeat(64),
      session_secret: 'c'.repeat(64),
    };
    for (const [name, value] of Object.entries(secrets))
      writeFileSync(join(secretsDir, name), value);

    child = spawn('node', ['--conditions=development', 'src/server.ts'], {
      cwd: apiDir,
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'test',
        PORT: '0',
        LOG_LEVEL: 'info',
        APP_ORIGIN: 'http://localhost',
        DB_HOST: pg.host,
        DB_PORT: String(pg.port),
        DB_NAME: pg.database,
        DB_USER: pg.user,
        REDIS_HOST: redis.host,
        REDIS_PORT: String(redis.port),
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        SMTP_FROM: 'TreeRepro <no-reply@localhost>',
        SECRETS_DIR: secretsDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const port = await waitForListening(child);

    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const ready = await fetch(`http://127.0.0.1:${port}/api/health/ready`);
    expect(ready.status).toBe(200);

    const exit = new Promise<number | null>((r) => child?.once('exit', (code) => r(code)));
    child.kill('SIGTERM');
    expect(await exit).toBe(0);
  });

  it('refuses to start when a secret is missing', async () => {
    const pg = inject('postgres');
    const dir = mkdtempSync(join(tmpdir(), 'treerepro-boot-missing-'));
    const proc = spawn('node', ['--conditions=development', 'src/server.ts'], {
      cwd: apiDir,
      env: {
        PATH: process.env.PATH ?? '',
        APP_ORIGIN: 'http://localhost',
        DB_HOST: pg.host,
        DB_NAME: pg.database,
        DB_USER: pg.user,
        REDIS_HOST: 'localhost',
        SMTP_HOST: '127.0.0.1',
        SMTP_FROM: 'TreeRepro <no-reply@localhost>',
        SECRETS_DIR: dir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    const code = await new Promise<number | null>((r) => proc.once('exit', (c) => r(c)));
    rmSync(dir, { recursive: true, force: true });
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/missing secret "db_app_password"/);
  });
});
