import { PERMISSION_KEYS } from '@treerepro/contracts';
import { desc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, setCookieLine, useTestApp } from '../../../test/helpers/app.ts';
import { adminRoleId, createRole } from '../../../test/helpers/roles.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { auditLog } from '../../db/schema/audit-log.ts';

describe('RFC-22 R9, R10 logout, logout-all, me', () => {
  const t = useTestApp();

  it('me returns the user and an empty permissions list; 401 without a session', async () => {
    const { user, email } = await createUser(t.db, { name: 'Ada' });
    const { cookie } = await loginAs(t, user);
    const res = await call(t.app, 'GET', '/api/auth/me', { cookie });
    expect(await res.json()).toEqual({
      data: {
        user: {
          id: user.id,
          email,
          name: 'Ada',
          status: 'active',
          totpEnabled: false,
          createdAt: user.createdAt.toISOString(),
        },
        permissions: [],
      },
    });
    const anon = await call(t.app, 'GET', '/api/auth/me');
    expect(anon.status).toBe(401);
    expect((await anon.json()).error.code).toBe('AUTH_UNAUTHENTICATED');

    const roleA = await createRole(t.db, { permissions: ['users.read'] });
    const roleB = await createRole(t.db, { permissions: ['audit.read', 'users.read'] });
    const withRoles = await createUser(t.db, { roles: [roleA.id, roleB.id] });
    const rolesCookie = (await loginAs(t, withRoles.user)).cookie;
    const rolesRes = await call(t.app, 'GET', '/api/auth/me', { cookie: rolesCookie });
    expect((await rolesRes.json()).data.permissions).toEqual(['audit.read', 'users.read']);

    const admin = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const adminCookie = (await loginAs(t, admin.user)).cookie;
    const adminRes = await call(t.app, 'GET', '/api/auth/me', { cookie: adminCookie });
    expect((await adminRes.json()).data.permissions).toEqual([...PERMISSION_KEYS].sort());
  });

  it('logout deletes the current session only and clears the cookie', async () => {
    const { user } = await createUser(t.db);
    const a = await loginAs(t, user);
    const b = await loginAs(t, user);
    const res = await call(t.app, 'POST', '/api/auth/logout', { cookie: a.cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: 'ok' } });
    expect(setCookieLine(res, '__Host-session')).toContain('Max-Age=0');
    expect((await call(t.app, 'GET', '/api/auth/me', { cookie: a.cookie })).status).toBe(401);
    expect((await call(t.app, 'GET', '/api/auth/me', { cookie: b.cookie })).status).toBe(200);
    const [audit] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'auth.logout'))
      .orderBy(desc(auditLog.id))
      .limit(1);
    expect(audit?.actorUserId).toBe(user.id);
  });

  it('logout-all deletes every session of the user', async () => {
    const { user } = await createUser(t.db);
    const a = await loginAs(t, user);
    const b = await loginAs(t, user);
    const res = await call(t.app, 'POST', '/api/auth/logout-all', { cookie: a.cookie });
    expect(res.status).toBe(200);
    expect((await call(t.app, 'GET', '/api/auth/me', { cookie: a.cookie })).status).toBe(401);
    expect((await call(t.app, 'GET', '/api/auth/me', { cookie: b.cookie })).status).toBe(401);
    const [audit] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'auth.logout_all'))
      .orderBy(desc(auditLog.id))
      .limit(1);
    expect(audit?.actorUserId).toBe(user.id);
  });

  it('logout without a session is 401 and without Origin is 403', async () => {
    expect((await call(t.app, 'POST', '/api/auth/logout')).status).toBe(401);
    const { user } = await createUser(t.db);
    const { cookie } = await loginAs(t, user);
    expect((await call(t.app, 'POST', '/api/auth/logout', { cookie, origin: null })).status).toBe(
      403,
    );
  });
});
