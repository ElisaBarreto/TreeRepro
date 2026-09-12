import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, inject } from 'vitest';
import { type App, type AppDeps, createApp } from '../../src/app.ts';
import { createMfaStore, type MfaStore } from '../../src/auth/mfa.ts';
import { createRateLimiter, type RateLimiter } from '../../src/auth/rate-limit.ts';
import { createSessionStore, type SessionStore } from '../../src/auth/sessions.ts';
import { createDb, type Db } from '../../src/db/client.ts';
import { createRedis, type Redis } from '../../src/redis/client.ts';
import { captureLogger } from './logger.ts';
import { createFakeMailer, type FakeMailer } from './mail.ts';

export const TEST_ORIGIN = 'http://localhost';
export const TEST_SESSION_SECRET = Buffer.alloc(32, 3);

export interface TestApp {
  readonly app: App;
  readonly deps: AppDeps;
  readonly db: Db;
  readonly redis: Redis;
  readonly sessions: SessionStore;
  readonly mfa: MfaStore;
  readonly limiter: RateLimiter;
  readonly mail: FakeMailer;
  /** Passwords the fake breach checker reports as breached. */
  readonly breached: Set<string>;
  /** Captured log lines of the default app. */
  readonly lines: unknown[];
  /** Controls `now` for every store and flow of the default app. */
  readonly clock: { now: number };
  /** Builds another app over the same pool (e.g. with a failing health check). */
  build(overrides?: Partial<AppDeps>): { app: App; lines: unknown[] };
}

/** One pool + one Redis connection per test file; an app with fakes for mail and HIBP. */
export function useTestApp(): TestApp {
  let handle: ReturnType<typeof createDb> | undefined;
  let redis: Redis | undefined;
  let state: Omit<TestApp, 'build'> | undefined;

  const breached = new Set<string>();
  const clock = { now: Date.now() };
  const mail = createFakeMailer();

  function build(db: Db, r: Redis, overrides: Partial<AppDeps> = {}) {
    const { logger, lines } = captureLogger();
    const sessions = createSessionStore(r, TEST_SESSION_SECRET, () => clock.now);
    const mfa = createMfaStore(r, TEST_SESSION_SECRET);
    const limiter = createRateLimiter(r, () => clock.now);
    const deps: AppDeps = {
      config: { appOrigin: TEST_ORIGIN },
      logger,
      health: { database: async () => true, redis: async () => true },
      db,
      sessions,
      mfa,
      limiter,
      mailer: mail.mailer,
      breachChecker: { isBreached: async (p) => breached.has(p) },
      now: () => clock.now,
      ...overrides,
    };
    return { app: createApp(deps), deps, lines, sessions, mfa, limiter };
  }

  beforeAll(async () => {
    handle = createDb(inject('databaseUrl'), { max: 4 });
    redis = createRedis(inject('redisUrl'));
    await redis.connect();
    const built = build(handle.db, redis);
    state = {
      app: built.app,
      deps: built.deps,
      db: handle.db,
      redis,
      sessions: built.sessions,
      mfa: built.mfa,
      limiter: built.limiter,
      mail,
      breached,
      lines: built.lines,
      clock,
    };
  });
  afterAll(async () => {
    await Promise.all([handle?.close(), redis?.quit()]);
  });

  const get = <K extends keyof Omit<TestApp, 'build'>>(key: K) => {
    if (!state) throw new Error('useTestApp: not initialised (call inside a test)');
    return state[key];
  };
  return {
    get app() {
      return get('app');
    },
    get deps() {
      return get('deps');
    },
    get db() {
      return get('db');
    },
    get redis() {
      return get('redis');
    },
    get sessions() {
      return get('sessions');
    },
    get mfa() {
      return get('mfa');
    },
    get limiter() {
      return get('limiter');
    },
    get mail() {
      return get('mail');
    },
    get breached() {
      return get('breached');
    },
    get lines() {
      return get('lines');
    },
    get clock() {
      return get('clock');
    },
    build(overrides) {
      if (!handle || !redis) throw new Error('useTestApp: not initialised');
      const built = build(handle.db, redis, overrides);
      return { app: built.app, lines: built.lines };
    },
  };
}

export interface CallOptions {
  body?: unknown;
  cookie?: string | string[];
  /** Default: a fresh random IP, so per-IP limits never bleed between tests. */
  ip?: string;
  /** `null` sends no Origin header. Default TEST_ORIGIN. */
  origin?: string | null;
  headers?: Record<string, string>;
}

export function randomIp(): string {
  const b = randomBytes(3);
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

/** Sends a request the way the browser would through Caddy. */
export async function call(
  app: Pick<App, 'request'>,
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.origin !== null) headers.set('origin', options.origin ?? TEST_ORIGIN);
  headers.set('x-forwarded-for', options.ip ?? randomIp());
  if (options.cookie) {
    headers.set(
      'cookie',
      Array.isArray(options.cookie) ? options.cookie.join('; ') : options.cookie,
    );
  }
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(options.body);
  }
  return app.request(path, { method, headers, body });
}

/** The raw Set-Cookie line for `name`, or '' when absent. */
export function setCookieLine(res: Response, name: string): string {
  return res.headers.getSetCookie().find((line) => line.startsWith(`${name}=`)) ?? '';
}

/** `name=value` from Set-Cookie, or null when absent or cleared (Max-Age=0). */
export function cookieFrom(res: Response, name: string): string | null {
  const line = setCookieLine(res, name);
  if (!line || /Max-Age=0/i.test(line)) return null;
  return line.split(';')[0] ?? null;
}
