import { PERMISSION_KEYS, PERMISSIONS, permissionEntrySchema } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../test/helpers/app.ts';
import { adminRoleId, createRole } from '../../../test/helpers/roles.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser } from '../../../test/helpers/users.ts';

describe('RFC-30 R5 GET /api/admin/permissions', () => {
  const t = useTestApp();

  it('is 401 without a session, 403 without roles.read, and lists the catalog in order with it', async () => {
    expect((await call(t.app, 'GET', '/api/admin/permissions')).status).toBe(401);
    const nobody = await createUser(t.db);
    const denied = await call(t.app, 'GET', '/api/admin/permissions', {
      cookie: (await loginAs(t, nobody.user)).cookie,
    });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('PERMISSION_DENIED');
    const reader = await createUser(t.db, {
      roles: [(await createRole(t.db, { permissions: ['roles.read'] })).id],
    });
    const res = await call(t.app, 'GET', '/api/admin/permissions', {
      cookie: (await loginAs(t, reader.user)).cookie,
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.map((e: { key: string }) => e.key)).toEqual([...PERMISSION_KEYS]);
    for (const entry of data) expect(permissionEntrySchema.safeParse(entry).success).toBe(true);
    expect(data[0]).toEqual({ key: 'users.read', description: PERMISSIONS['users.read'] });
    const admin = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    expect(
      (
        await call(t.app, 'GET', '/api/admin/permissions', {
          cookie: (await loginAs(t, admin.user)).cookie,
        })
      ).status,
    ).toBe(200);
  });
});
