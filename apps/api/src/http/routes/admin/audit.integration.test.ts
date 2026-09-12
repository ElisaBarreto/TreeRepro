import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';
import { recordAudit } from '../../../audit/audit.ts';

describe('RFC-51 GET /api/admin/audit', () => {
  const t = useTestApp();

  it('answers entries with meta.nextCursor for audit.read and validates the query', async () => {
    const reader = await createUser(t.db, {
      roles: [(await createRole(t.db, { permissions: ['audit.read'] })).id],
    });
    const cookie = (await loginAs(t, reader.user)).cookie;
    const { user } = await createUser(t.db);
    await recordAudit(t.db, { actorUserId: user.id, action: 'auth.logout', ip: '203.0.113.7' });
    const res = await call(
      t.app,
      'GET',
      `/api/admin/audit?actor=${user.id}&action=auth.logout&limit=1`,
      { cookie },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      actorUserId: user.id,
      action: 'auth.logout',
      ip: '203.0.113.7',
    });
    expect(body.meta).toEqual({ nextCursor: null });
    for (const q of [
      'action=users.fly',
      'action=Login',
      'actor=me',
      'from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z',
      'from=yesterday',
      'cursor=nope',
      'limit=500',
    ]) {
      const bad = await call(t.app, 'GET', `/api/admin/audit?${q}`, { cookie });
      expect(bad.status, q).toBe(400);
      expect((await bad.json()).error.code, q).toBe('VALIDATION_FAILED');
    }
    const unknownAction = await call(t.app, 'GET', '/api/admin/audit?action=users.fly', { cookie });
    expect((await unknownAction.json()).error.details).toEqual([
      { path: 'action', message: 'Unknown action' },
    ]);
  });

  it('is 403 without audit.read', async () => {
    const other = await createUser(t.db, {
      roles: [(await createRole(t.db, { permissions: ['users.read'] })).id],
    });
    expect(
      (
        await call(t.app, 'GET', '/api/admin/audit', {
          cookie: (await loginAs(t, other.user)).cookie,
        })
      ).status,
    ).toBe(403);
  });
});
