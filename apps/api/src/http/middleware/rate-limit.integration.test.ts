import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { call, randomIp, useTestApp } from '../../../test/helpers/app.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { RATE_LIMITS } from '../../auth/rate-limit.ts';
import type { AppEnv } from '../env.ts';
import { createErrorHandler } from '../errors.ts';
import { emailIpKey, globalRateLimit, ipKey, rateLimit } from './rate-limit.ts';
import { resolveSession } from './session.ts';

describe('RFC-24 R4, R5 rate-limit middleware', () => {
  const t = useTestApp();

  it('rateLimit rejects the request over the limit with 429 and Retry-After and runs onLimited', async () => {
    let limited = 0;
    const a = new Hono<AppEnv>()
      .post(
        '/x',
        rateLimit(
          t.limiter,
          [{ scope: 'test-ip', rule: { limit: 2, windowMs: 60_000 }, key: ipKey }],
          async () => {
            limited += 1;
          },
        ),
        (c) => c.json({ ok: true }),
      )
      .onError(createErrorHandler(t.deps.logger));
    const ip = randomIp();
    expect((await call(a, 'POST', '/x', { ip, body: {} })).status).toBe(200);
    expect((await call(a, 'POST', '/x', { ip, body: {} })).status).toBe(200);
    const res = await call(a, 'POST', '/x', { ip, body: {} });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(limited).toBe(1);
    expect((await call(a, 'POST', '/x', { ip: randomIp(), body: {} })).status).toBe(200);
  });

  it('R5, R7 emailIpKey reads the raw body and yields a blind-index key; null without a usable email', async () => {
    const keys: (string | null)[] = [];
    const a = new Hono<AppEnv>().post('/x', async (c) => {
      keys.push(await emailIpKey(c));
      return c.json({});
    });
    const ip = randomIp();
    await call(a, 'POST', '/x', { ip, body: { email: 'Ada@Example.test' } });
    await call(a, 'POST', '/x', { ip, body: { email: ' ada@example.test ' } });
    await call(a, 'POST', '/x', { ip, body: { nope: 1 } });
    await a.request('/x', {
      method: 'POST',
      body: '{not json',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    });
    expect(keys[0]).toMatch(/^[0-9a-f]{64}:[0-9a-f]{64}$/);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).toBeNull();
    expect(keys[3]).toBeNull();
    expect(JSON.stringify(keys)).not.toContain('example.test');
    expect(JSON.stringify(keys)).not.toContain(ip);
  });

  it('R4 globalRateLimit keys by session when present, by IP otherwise, and exempts health', async () => {
    const a = new Hono<AppEnv>()
      .basePath('/api')
      .use(resolveSession({ sessions: t.sessions, db: t.db }))
      .use(globalRateLimit(t.limiter))
      .get('/health', (c) => c.json({ ok: true }))
      .get('/thing', (c) => c.json({ ok: true }))
      .onError(createErrorHandler(t.deps.logger));
    const ip = randomIp();
    for (let i = 0; i < RATE_LIMITS.globalIp.limit; i++) {
      expect((await call(a, 'GET', '/api/thing', { ip })).status).toBe(200);
    }
    expect((await call(a, 'GET', '/api/thing', { ip })).status).toBe(429);
    expect((await call(a, 'GET', '/api/health', { ip })).status).toBe(200);
    const { user } = await createUser(t.db);
    const { cookie } = await loginAs(t, user);
    expect((await call(a, 'GET', '/api/thing', { ip, cookie })).status).toBe(200);
  });
});
