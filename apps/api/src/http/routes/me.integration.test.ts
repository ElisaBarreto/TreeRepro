import { sessionSummarySchema } from '@treerepro/contracts';
import { desc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../test/helpers/app.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { auditLog } from '../../db/schema/audit-log.ts';

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
    const [audit] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'auth.session.revoked'))
      .orderBy(desc(auditLog.id))
      .limit(1);
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
