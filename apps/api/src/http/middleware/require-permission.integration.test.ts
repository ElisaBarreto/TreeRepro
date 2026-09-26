import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../test/helpers/app.ts';
import { adminRoleId, createRole } from '../../../test/helpers/roles.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser } from '../../../test/helpers/users.ts';
import type { AppEnv } from '../env.ts';
import { createErrorHandler } from '../errors.ts';
import { guardKind } from '../guards.ts';
import { currentPermissions, requirePermission } from './require-permission.ts';
import { resolveSession } from './session.ts';

describe('RFC-32 R4 requirePermission', () => {
  const t = useTestApp();
  const ctx = () => ({
    db: t.db,
    permissionCache: t.permissionCache,
    logger: t.deps.logger,
    now: () => t.clock.now,
  });

  function app() {
    const a = new Hono<AppEnv>();
    a.use(resolveSession({ sessions: t.sessions, db: t.db, limiter: t.limiter }));
    a.get('/read', requirePermission(ctx(), 'users.read'), (c) =>
      c.json({ permissions: [...currentPermissions(c)] }),
    );
    a.get(
      '/own',
      requirePermission(ctx(), 'users.read', {
        resource: async (c) => c.req.query('mine') === '1',
      }),
      (c) => c.json({ ok: true }),
    );
    a.onError(createErrorHandler(t.deps.logger));
    return a;
  }

  it('answers 401 without a session and 403 PERMISSION_DENIED without the permission', async () => {
    const anon = await call(app(), 'GET', '/read');
    expect(anon.status).toBe(401);
    expect((await anon.json()).error.code).toBe('AUTH_UNAUTHENTICATED');
    const { user } = await createUser(t.db);
    const { cookie } = await loginAs(t, user);
    const denied = await call(app(), 'GET', '/read', { cookie });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: { code: 'PERMISSION_DENIED', message: 'You do not have permission to do this' },
    });
  });

  it('passes with the permission (role or admin) and exposes the resolved set', async () => {
    const role = await createRole(t.db, { permissions: ['users.read'] });
    const holder = await createUser(t.db, { roles: [role.id] });
    const res = await call(app(), 'GET', '/read', {
      cookie: (await loginAs(t, holder.user)).cookie,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ permissions: ['users.read'] });
    const admin = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const adminRes = await call(app(), 'GET', '/read', {
      cookie: (await loginAs(t, admin.user)).cookie,
    });
    expect(adminRes.status).toBe(200);
    expect((await adminRes.json()).permissions).toContain('admin.access');
  });

  it('R7 the resource hook runs after the permission check and false answers 403', async () => {
    const role = await createRole(t.db, { permissions: ['users.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    const { cookie } = await loginAs(t, user);
    expect((await call(app(), 'GET', '/own?mine=1', { cookie })).status).toBe(200);
    const refused = await call(app(), 'GET', '/own?mine=0', { cookie });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe('PERMISSION_DENIED');
    const nobody = await createUser(t.db);
    expect(
      (await call(app(), 'GET', '/own?mine=1', { cookie: (await loginAs(t, nobody.user)).cookie }))
        .status,
    ).toBe(403);
  });

  it('is registered as a permission guard', () => {
    expect(guardKind(requirePermission(ctx(), 'users.read'))).toBe('permission');
  });
});
