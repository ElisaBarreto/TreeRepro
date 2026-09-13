import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../test/helpers/app.ts';
import { adminRoleId } from '../test/helpers/roles.ts';
import { loginAs } from '../test/helpers/session.ts';
import { createUser } from '../test/helpers/users.ts';
import { guardKind } from './http/guards.ts';
import { PUBLIC_ROUTES } from './http/public-routes.ts';
import { SELF_SERVICE_ROUTES } from './http/self-service-routes.ts';

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

describe('RFC-02 R12, RFC-32 R5 every route is in exactly one guard class', () => {
  const t = useTestApp();

  it('public routes carry no guard, self-service routes requireSession, everything else requirePermission', () => {
    const wrong: string[] = [];
    for (const [key, entries] of endpoints(t.app.routes as RouteEntry[])) {
      const kinds = new Set(entries.map((e) => guardKind(e.handler)).filter(Boolean));
      const [, path] = key.split(' ') as [string, string];
      if (PUBLIC_ROUTES.includes(key)) {
        if (kinds.size > 0) wrong.push(`${key}: public but guarded`);
      } else if (SELF_SERVICE_ROUTES.includes(key)) {
        if (!kinds.has('session') || kinds.has('permission'))
          wrong.push(`${key}: self-service must carry requireSession only`);
        if (path.startsWith('/api/admin/'))
          wrong.push(`${key}: admin routes cannot be self-service`);
      } else {
        if (!kinds.has('permission')) wrong.push(`${key}: needs requirePermission`);
        if (kinds.has('session')) wrong.push(`${key}: carries both guards`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('the allowlists name only routes that exist and do not overlap', () => {
    const keys = [...endpoints(t.app.routes as RouteEntry[]).keys()];
    for (const route of [...PUBLIC_ROUTES, ...SELF_SERVICE_ROUTES]) expect(keys).toContain(route);
    expect(PUBLIC_ROUTES.filter((r) => SELF_SERVICE_ROUTES.includes(r))).toEqual([]);
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
        'PATCH /api/me',
        'GET /api/admin/permissions',
        'GET /api/admin/users',
        'POST /api/admin/users',
        'GET /api/admin/users/:id',
        'PATCH /api/admin/users/:id',
        'POST /api/admin/users/:id/suspend',
        'POST /api/admin/users/:id/reactivate',
        'POST /api/admin/users/:id/resend-invite',
        'GET /api/admin/users/:id/sessions',
        'DELETE /api/admin/users/:id/sessions',
        'DELETE /api/admin/users/:id/sessions/:sessionId',
        'GET /api/admin/roles',
        'POST /api/admin/roles',
        'GET /api/admin/roles/:id',
        'PATCH /api/admin/roles/:id',
        'DELETE /api/admin/roles/:id',
        'GET /api/admin/audit',
        'GET /api/species',
        'POST /api/species',
        'GET /api/species/:id',
        'PATCH /api/species/:id',
        'GET /api/species/:id/traits',
        'POST /api/species/:id/names',
        'GET /api/families',
        'POST /api/families',
        'PATCH /api/families/:id',
        'GET /api/genera',
        'POST /api/genera',
        'PATCH /api/genera/:id',
        'GET /api/references',
        'POST /api/references',
        'GET /api/references/:id',
        'PATCH /api/references/:id',
        'GET /api/records',
        'GET /api/records/:id',
        'POST /api/records',
        'GET /api/records/pending/traits',
        'GET /api/records/pending',
        'POST /api/records/pending/map',
        'GET /api/traits',
        'POST /api/traits',
        'PATCH /api/traits/:id',
        'POST /api/traits/:id/levels',
        'PATCH /api/traits/:id/levels/:levelId',
        'GET /api/imports',
        'GET /api/imports/:id',
        'GET /api/imports/:id/rejects',
        'GET /api/export/accepted.csv',
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
    const admin = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const { cookie } = await loginAs(t, admin.user);
    const withBody = [
      'POST /api/auth/login',
      'POST /api/auth/login/totp',
      'POST /api/auth/invite/accept',
      'POST /api/auth/password/forgot',
      'POST /api/auth/password/reset',
      'POST /api/auth/password/change',
      'POST /api/auth/totp/confirm',
      'POST /api/auth/totp/disable',
      'PATCH /api/me',
      'POST /api/admin/users',
      'PATCH /api/admin/users/:id',
      'POST /api/admin/roles',
      'PATCH /api/admin/roles/:id',
      'POST /api/records',
      'POST /api/records/pending/map',
      'POST /api/families',
      'PATCH /api/families/:id',
      'POST /api/genera',
      'PATCH /api/genera/:id',
      'POST /api/species',
      'PATCH /api/species/:id',
      'POST /api/species/:id/names',
      'POST /api/references',
      'PATCH /api/references/:id',
      'POST /api/traits',
      'PATCH /api/traits/:id',
      'POST /api/traits/:id/levels',
      'PATCH /api/traits/:id/levels/:levelId',
    ];
    for (const key of withBody) {
      const [method, path] = key.split(' ') as [string, string];
      const res = await call(t.app, method, concrete(path), { body: { unexpected: true }, cookie });
      expect(res.status, key).toBe(400);
      expect((await res.json()).error.code, key).toBe('VALIDATION_FAILED');
    }
  });

  it('every permission-guarded route answers 403 PERMISSION_DENIED for a session without roles and not 403 for an admin', async () => {
    const nobody = await createUser(t.db);
    const admin = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const plain = (await loginAs(t, nobody.user)).cookie;
    const adminCookie = (await loginAs(t, admin.user)).cookie;
    for (const key of endpoints(t.app.routes as RouteEntry[]).keys()) {
      if (PUBLIC_ROUTES.includes(key) || SELF_SERVICE_ROUTES.includes(key)) continue;
      const [method, path] = key.split(' ') as [string, string];
      const denied = await call(t.app, method, concrete(path), {
        body: method === 'GET' ? undefined : {},
        cookie: plain,
      });
      expect(denied.status, key).toBe(403);
      expect((await denied.json()).error.code, key).toBe('PERMISSION_DENIED');
      const allowed = await call(t.app, method, concrete(path), {
        body: method === 'GET' ? undefined : {},
        cookie: adminCookie,
      });
      expect(allowed.status, key).not.toBe(403);
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
