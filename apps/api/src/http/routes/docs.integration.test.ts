import { describe, expect, it } from 'vitest';
import { createAdminKey } from '../../../test/helpers/api-keys.ts';
import { call, useTestApp } from '../../../test/helpers/app.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser } from '../../../test/helpers/users.ts';

describe('RFC-82 R20 GET /api/docs and GET /api/docs/openapi.json', () => {
  const t = useTestApp();

  it('GET /api/docs answers the guide as Markdown with a key', async () => {
    const { headers } = await createAdminKey(t);
    const res = await call(t.app, 'GET', '/api/docs', { headers, origin: null });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/markdown/);
    const text = await res.text();
    expect(text.split('\n')[0]).toMatch(/^openapi-sha256: [0-9a-f]{64}$/);
  });

  it('GET /api/docs/openapi.json answers the generated reference with a key', async () => {
    const { headers } = await createAdminKey(t);
    const res = await call(t.app, 'GET', '/api/docs/openapi.json', { headers, origin: null });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openapi).toBe('3.1.0');
    expect(body.paths['/api/docs']).toBeDefined();
  });

  it('both routes answer 401 AUTH_UNAUTHENTICATED without credentials', async () => {
    for (const path of ['/api/docs', '/api/docs/openapi.json']) {
      const res = await call(t.app, 'GET', path, { origin: null });
      expect(res.status, path).toBe(401);
      expect((await res.json()).error.code, path).toBe('AUTH_UNAUTHENTICATED');
    }
  });

  it('both routes answer 401 AUTH_UNAUTHENTICATED to a cookie session with no key', async () => {
    const { user } = await createUser(t.db);
    const { cookie } = await loginAs(t, user);
    for (const path of ['/api/docs', '/api/docs/openapi.json']) {
      const res = await call(t.app, 'GET', path, { cookie, origin: null });
      expect(res.status, path).toBe(401);
      expect((await res.json()).error.code, path).toBe('AUTH_UNAUTHENTICATED');
    }
  });
});
