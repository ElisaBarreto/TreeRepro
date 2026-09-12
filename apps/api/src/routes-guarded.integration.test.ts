import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../test/helpers/app.ts';
import { loginAs } from '../test/helpers/session.ts';
import { createUser } from '../test/helpers/users.ts';
import { isGuard } from './http/guards.ts';
import { PUBLIC_ROUTES } from './http/public-routes.ts';

interface RouteEntry {
  method: string;
  path: string;
  handler: unknown;
}

function endpoints(routes: RouteEntry[]): Map<string, RouteEntry[]> {
  const map = new Map<string, RouteEntry[]>();
  for (const r of routes) {
    if (r.method === 'ALL') continue;
    const key = `${r.method} ${r.path}`;
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  return map;
}

describe('RFC-02 R12 every route is guarded or public', () => {
  const t = useTestApp();

  it('fails on any endpoint that is neither behind a guard nor on the RFC-22 R1 allowlist', () => {
    const unguarded: string[] = [];
    for (const [key, entries] of endpoints(t.app.routes as RouteEntry[])) {
      if (PUBLIC_ROUTES.includes(key)) continue;
      if (!entries.some((e) => isGuard(e.handler))) unguarded.push(key);
    }
    expect(unguarded).toEqual([]);
  });

  it('the allowlist names only routes that exist', () => {
    const keys = [...endpoints(t.app.routes as RouteEntry[]).keys()];
    for (const route of PUBLIC_ROUTES) expect(keys).toContain(route);
  });

  it('exposes exactly the routes RFC-22 R1 lists', () => {
    const keys = [...endpoints(t.app.routes as RouteEntry[]).keys()].sort();
    expect(keys).toEqual(
      [
        'GET /api/health',
        'GET /api/health/ready',
        'POST /api/auth/login',
        'POST /api/auth/login/totp',
        'POST /api/auth/invite/accept',
        'POST /api/auth/password/forgot',
        'POST /api/auth/password/reset',
        'POST /api/auth/logout',
        'POST /api/auth/logout-all',
        'GET /api/auth/me',
        'POST /api/auth/password/change',
        'POST /api/auth/totp/setup',
        'POST /api/auth/totp/confirm',
        'POST /api/auth/totp/disable',
        'GET /api/me/sessions',
        'DELETE /api/me/sessions/:id',
        'GET /api/admin/permissions',
      ].sort(),
    );
  });
});

describe('RFC-01 R6 negative sweep over every route', () => {
  const t = useTestApp();
  const concrete = (path: string) => path.replace(':id', '0'.repeat(64));

  it('every non-public route answers 401 AUTH_UNAUTHENTICATED without a session', async () => {
    for (const key of endpoints(t.app.routes as RouteEntry[]).keys()) {
      if (PUBLIC_ROUTES.includes(key)) continue;
      const [method, path] = key.split(' ') as [string, string];
      const res = await call(t.app, method, concrete(path), {
        body: method === 'GET' ? undefined : {},
      });
      expect(res.status, key).toBe(401);
      expect((await res.json()).error.code, key).toBe('AUTH_UNAUTHENTICATED');
    }
  });

  it('every mutating route answers 403 SECURITY_INVALID_ORIGIN without Origin, even with a session', async () => {
    const { user } = await createUser(t.db);
    const { cookie } = await loginAs(t, user);
    for (const key of endpoints(t.app.routes as RouteEntry[]).keys()) {
      const [method, path] = key.split(' ') as [string, string];
      if (method === 'GET') continue;
      const res = await call(t.app, method, concrete(path), { body: {}, cookie, origin: null });
      expect(res.status, key).toBe(403);
      expect((await res.json()).error.code, key).toBe('SECURITY_INVALID_ORIGIN');
    }
  });

  it('every route with a body schema rejects an unknown field with 400 VALIDATION_FAILED', async () => {
    const { user } = await createUser(t.db);
    const { cookie } = await loginAs(t, user);
    const withBody = [
      'POST /api/auth/login',
      'POST /api/auth/login/totp',
      'POST /api/auth/invite/accept',
      'POST /api/auth/password/forgot',
      'POST /api/auth/password/reset',
      'POST /api/auth/password/change',
      'POST /api/auth/totp/confirm',
      'POST /api/auth/totp/disable',
    ];
    for (const key of withBody) {
      const [method, path] = key.split(' ') as [string, string];
      const res = await call(t.app, method, path, { body: { unexpected: true }, cookie });
      expect(res.status, key).toBe(400);
      expect((await res.json()).error.code, key).toBe('VALIDATION_FAILED');
    }
  });

  it('a non-JSON body answers 400 on a public route', async () => {
    const res = await t.app.request('/api/auth/login', {
      method: 'POST',
      body: 'email=a',
      headers: {
        origin: 'http://localhost',
        'content-type': 'text/plain',
        'x-forwarded-for': '10.9.9.9',
      },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED');
  });
});
