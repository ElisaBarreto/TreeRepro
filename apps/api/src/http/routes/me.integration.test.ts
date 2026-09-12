import { sessionSummarySchema, userSchema } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../test/helpers/app.ts';
import { lastAudit } from '../../../test/helpers/audit.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser } from '../../../test/helpers/users.ts';

describe('RFC-22 R11 own sessions', () => {
  const t = useTestApp();

  it('lists sessions newest first with the current one flagged, and revokes one', async () => {
    const { user } = await createUser(t.db);
    const a = await loginAs(t, user, { ip: '203.0.113.1', userAgent: 'A' });
    t.clock.now += 1000;
    const b = await loginAs(t, user, { ip: '203.0.113.2', userAgent: 'B' });
    const res = await call(t.app, 'GET', '/api/me/sessions', { cookie: a.cookie });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveLength(2);
    for (const s of data) expect(sessionSummarySchema.safeParse(s).success).toBe(true);
    expect(data.map((s: { id: string }) => s.id)).toEqual([b.id, a.id]);
    expect(data[1]).toMatchObject({ ip: '203.0.113.1', userAgent: 'A', current: true });
    expect(data[0].current).toBe(false);
    expect(JSON.stringify(data)).not.toContain(b.rawId);

    const del = await call(t.app, 'DELETE', `/api/me/sessions/${b.id}`, { cookie: a.cookie });
    expect(del.status).toBe(200);
    expect((await call(t.app, 'GET', '/api/auth/me', { cookie: b.cookie })).status).toBe(401);
    const audit = await lastAudit(t.db, 'auth.session.revoked', { targetId: b.id });
    expect(audit).toMatchObject({ actorUserId: user.id, targetType: 'session', targetId: b.id });
  });

  it("cannot revoke another user's session or an unknown id (404)", async () => {
    const { user } = await createUser(t.db);
    const other = await createUser(t.db);
    const mine = await loginAs(t, user);
    const theirs = await loginAs(t, other.user);
    const res = await call(t.app, 'DELETE', `/api/me/sessions/${theirs.id}`, {
      cookie: mine.cookie,
    });
    expect(res.status).toBe(404);
    expect((await call(t.app, 'GET', '/api/auth/me', { cookie: theirs.cookie })).status).toBe(200);
    expect(
      (await call(t.app, 'DELETE', `/api/me/sessions/${'0'.repeat(64)}`, { cookie: mine.cookie }))
        .status,
    ).toBe(404);
  });

  it('is 401 without a session and 403 without Origin on DELETE', async () => {
    expect((await call(t.app, 'GET', '/api/me/sessions')).status).toBe(401);
    const { user } = await createUser(t.db);
    const { cookie, id } = await loginAs(t, user);
    expect(
      (await call(t.app, 'DELETE', `/api/me/sessions/${id}`, { cookie, origin: null })).status,
    ).toBe(403);
  });
});

describe('RFC-50 R11 PATCH /api/me', () => {
  const t = useTestApp();

  it('changes the caller name, audits with the caller as actor and target, and validates', async () => {
    const { user } = await createUser(t.db, { name: 'Ada' });
    const { cookie } = await loginAs(t, user);
    const res = await call(t.app, 'PATCH', '/api/me', {
      cookie,
      body: { name: '  Ada Lovelace ' },
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ id: user.id, name: 'Ada Lovelace', roles: [] });
    expect(userSchema.safeParse(data).success).toBe(true);
    const audit = await lastAudit(t.db, 'users.updated', { targetId: user.id });
    expect(audit).toMatchObject({
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      metadata: { fields: ['name'] },
    });
    const me = await call(t.app, 'GET', '/api/auth/me', { cookie });
    expect((await me.json()).data.user.name).toBe('Ada Lovelace');
    expect((await call(t.app, 'PATCH', '/api/me', { cookie, body: {} })).status).toBe(400);
    expect((await call(t.app, 'PATCH', '/api/me', { cookie, body: { name: ' ' } })).status).toBe(
      400,
    );
    expect(
      (await call(t.app, 'PATCH', '/api/me', { cookie, body: { name: 'x', email: 'a@b.c' } }))
        .status,
    ).toBe(400);
    expect((await call(t.app, 'PATCH', '/api/me', { body: { name: 'x' } })).status).toBe(401);
  });
});
