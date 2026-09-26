import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../test/helpers/logger.ts';
import type { AppEnv } from './env.ts';
import { createErrorHandler } from './errors.ts';
import { originCheck } from './origin-check.ts';

const ORIGIN = 'https://treerepro.example.org';

function app() {
  const a = new Hono<AppEnv>();
  a.onError(createErrorHandler(captureLogger().logger));
  a.use(originCheck(ORIGIN));
  for (const method of ['post', 'put', 'patch', 'delete'] as const)
    a[method]('/m', (c) => c.text('ok'));
  a.get('/g', (c) => c.text('ok'));
  return a;
}

describe('RFC-02 R3 origin check', () => {
  it('rejects mutations without an Origin header', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await app().request('/m', { method });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('SECURITY_INVALID_ORIGIN');
    }
  });

  it('rejects mutations from another origin, including a different port or scheme', async () => {
    for (const origin of [
      'https://evil.example',
      'http://treerepro.example.org',
      `${ORIGIN}:8443`,
    ]) {
      const res = await app().request('/m', { method: 'POST', headers: { origin } });
      expect(res.status).toBe(403);
    }
  });

  it('accepts mutations from the configured origin', async () => {
    const res = await app().request('/m', { method: 'POST', headers: { origin: ORIGIN } });
    expect(res.status).toBe(200);
  });

  it('does not require Origin on safe methods', async () => {
    expect((await app().request('/g')).status).toBe(200);
    expect((await app().request('/g', { method: 'HEAD' })).status).toBe(200);
    // OPTIONS is exempt too: no route answers it here, so 404 (not 403) proves
    // the check let it through.
    expect((await app().request('/m', { method: 'OPTIONS' })).status).toBe(404);
  });

  it('RFC-82 R5 exempts a Bearer request without cookies, but not one carrying a cookie too', async () => {
    const res = await app().request('/m', {
      method: 'POST',
      headers: { authorization: 'Bearer tr_live_x' },
    });
    expect(res.status).toBe(200);
    const withCookie = await app().request('/m', {
      method: 'POST',
      headers: { authorization: 'Bearer tr_live_x', cookie: 'a=b' },
    });
    expect(withCookie.status).toBe(403);
  });
});
