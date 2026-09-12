import { roleSchema } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { adminRoleId, createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';

const uniq = () => `Role ${Math.random().toString(16).slice(2)}`;

describe('RFC-50 R10 role routes', () => {
  const t = useTestApp();

  it('creates, reads, lists, updates and deletes a role with roles.manage / roles.read', async () => {
    const { user: admin } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const cookie = (await loginAs(t, admin)).cookie;
    const name = uniq();
    const created = await call(t.app, 'POST', '/api/admin/roles', {
      cookie,
      body: { name, permissions: ['users.read', 'audit.read'] },
    });
    expect(created.status).toBe(201);
    const role = (await created.json()).data;
    expect(roleSchema.safeParse(role).success).toBe(true);
    expect(role).toMatchObject({
      name,
      description: '',
      permissions: ['audit.read', 'users.read'],
    });

    const got = await call(t.app, 'GET', `/api/admin/roles/${role.id}`, { cookie });
    expect(got.status).toBe(200);
    expect((await got.json()).data.id).toBe(role.id);

    const listed = await call(t.app, 'GET', '/api/admin/roles', { cookie });
    expect(listed.status).toBe(200);
    expect((await listed.json()).data.map((r: { id: string }) => r.id)).toContain(role.id);

    const updated = await call(t.app, 'PATCH', `/api/admin/roles/${role.id}`, {
      cookie,
      body: { description: 'Readers', permissions: ['users.read'] },
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()).data).toMatchObject({
      description: 'Readers',
      permissions: ['users.read'],
    });

    const deleted = await call(t.app, 'DELETE', `/api/admin/roles/${role.id}`, { cookie });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ data: { status: 'ok' } });
    const gone = await call(t.app, 'GET', `/api/admin/roles/${role.id}`, { cookie });
    expect(gone.status).toBe(404);
    expect((await gone.json()).error.code).toBe('ROLE_NOT_FOUND');
  });

  it('maps the RFC-31 errors: PERMISSION_UNKNOWN, ROLE_NAME_TAKEN, ROLE_IS_SYSTEM, and validates bodies', async () => {
    const { user: admin } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const cookie = (await loginAs(t, admin)).cookie;
    const unknown = await call(t.app, 'POST', '/api/admin/roles', {
      cookie,
      body: { name: uniq(), permissions: ['users.fly'] },
    });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toMatchObject({
      code: 'PERMISSION_UNKNOWN',
      details: [{ path: 'permissions', message: 'users.fly' }],
    });
    const existing = await createRole(t.db);
    const taken = await call(t.app, 'POST', '/api/admin/roles', {
      cookie,
      body: { name: existing.name.toUpperCase(), permissions: [] },
    });
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.code).toBe('ROLE_NAME_TAKEN');
    const system = await call(t.app, 'DELETE', `/api/admin/roles/${await adminRoleId(t.db)}`, {
      cookie,
    });
    expect(system.status).toBe(409);
    expect((await system.json()).error.code).toBe('ROLE_IS_SYSTEM');
    expect(
      (await call(t.app, 'PATCH', `/api/admin/roles/${existing.id}`, { cookie, body: {} })).status,
    ).toBe(400);
    expect(
      (await call(t.app, 'POST', '/api/admin/roles', { cookie, body: { name: uniq() } })).status,
    ).toBe(400);
  });

  it('roles.read reads but cannot manage', async () => {
    const reader = await createUser(t.db, {
      roles: [(await createRole(t.db, { permissions: ['roles.read'] })).id],
    });
    const cookie = (await loginAs(t, reader.user)).cookie;
    expect((await call(t.app, 'GET', '/api/admin/roles', { cookie })).status).toBe(200);
    expect(
      (
        await call(t.app, 'POST', '/api/admin/roles', {
          cookie,
          body: { name: uniq(), permissions: [] },
        })
      ).status,
    ).toBe(403);
  });
});
