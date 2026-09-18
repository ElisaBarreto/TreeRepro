import {
  contributionAnnotationSchema,
  contributionRecordSchema,
  contributionSummarySchema,
  type PermissionKey,
  userSchema,
} from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { lastAudit } from '../../../../test/helpers/audit.ts';
import {
  createAnnotation,
  createPlot,
  createVisibilityFixture,
} from '../../../../test/helpers/dataset.ts';
import { adminRoleId, createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser, randomEmail } from '../../../../test/helpers/users.ts';
import { findUserByEmail } from '../../../auth/users.ts';
import { forgetCached } from '../../../redis/cache.ts';

async function adminCookie(t: ReturnType<typeof useTestApp>) {
  const { user } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
  return { admin: user, cookie: (await loginAs(t, user)).cookie };
}

const UNKNOWN = '019a0000-0000-7000-8000-000000000000';

describe('RFC-50 R2 GET /api/admin/users', () => {
  const t = useTestApp();

  it('lists with meta.nextCursor, filters by status, validates the query', async () => {
    const { cookie } = await adminCookie(t);
    await createUser(t.db, { status: 'suspended' });
    await createUser(t.db, { status: 'suspended' });
    const res = await call(t.app, 'GET', '/api/admin/users?status=suspended&limit=1', { cookie });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].status).toBe('suspended');
    expect(userSchema.safeParse(body.data[0]).success).toBe(true);
    expect(body.meta).toEqual({ nextCursor: expect.any(String) });
    const next = await call(
      t.app,
      'GET',
      `/api/admin/users?status=suspended&limit=1&cursor=${body.meta.nextCursor}`,
      { cookie },
    );
    expect(next.status).toBe(200);
    expect((await next.json()).data[0]?.id ?? '').not.toBe(body.data[0].id);
    for (const q of ['status=deleted', 'limit=0', 'limit=201', 'cursor=nope', 'page=2']) {
      const bad = await call(t.app, 'GET', `/api/admin/users?${q}`, { cookie });
      expect(bad.status, q).toBe(400);
      expect((await bad.json()).error.code, q).toBe('VALIDATION_FAILED');
    }
  });

  it('is 403 with a permission other than users.read', async () => {
    const { user } = await createUser(t.db, {
      roles: [(await createRole(t.db, { permissions: ['users.invite'] })).id],
    });
    const res = await call(t.app, 'GET', '/api/admin/users', {
      cookie: (await loginAs(t, user)).cookie,
    });
    expect(res.status).toBe(403);
  });
});

describe('RFC-50 R3, R8 invitations over HTTP', () => {
  const t = useTestApp();

  it('invites with 201, audits with the admin as actor, and refuses a taken email', async () => {
    const { admin, cookie } = await adminCookie(t);
    const email = randomEmail();
    const res = await call(t.app, 'POST', '/api/admin/users', {
      cookie,
      body: { email, name: 'Grace' },
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({ email, name: 'Grace', status: 'invited', roles: [] });
    expect(t.mail.sent.at(-1)?.to).toBe(email);
    expect(await lastAudit(t.db, 'auth.invite.created', { targetId: data.id })).toMatchObject({
      actorUserId: admin.id,
      targetId: data.id,
    });
    const taken = await createUser(t.db);
    const dup = await call(t.app, 'POST', '/api/admin/users', {
      cookie,
      body: { email: taken.email, name: 'X' },
    });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe('USER_EMAIL_TAKEN');
  });

  it('answers 502 MAIL_SEND_FAILED when the email fails, keeps the user, and can re-send', async () => {
    const { cookie } = await adminCookie(t);
    const email = randomEmail();
    t.mail.failNext(new Error('smtp down'));
    const res = await call(t.app, 'POST', '/api/admin/users', {
      cookie,
      body: { email, name: 'Grace' },
    });
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('MAIL_SEND_FAILED');
    const user = await findUserByEmail(t.db, email);
    expect(user?.status).toBe('invited');
    const sent = t.mail.sent.length;
    const resend = await call(t.app, 'POST', `/api/admin/users/${user?.id}/resend-invite`, {
      cookie,
    });
    expect(resend.status).toBe(200);
    expect((await resend.json()).data.id).toBe(user?.id);
    expect(t.mail.sent).toHaveLength(sent + 1);
    const active = await createUser(t.db);
    const wrong = await call(t.app, 'POST', `/api/admin/users/${active.user.id}/resend-invite`, {
      cookie,
    });
    expect(wrong.status).toBe(409);
    expect((await wrong.json()).error.code).toBe('USER_INVALID_STATUS');
  });
});

describe('RFC-50 R4, R5 GET and PATCH /api/admin/users/:id', () => {
  const t = useTestApp();

  it('reads a user, updates name and roles, and validates', async () => {
    const { cookie } = await adminCookie(t);
    const { user } = await createUser(t.db, { name: 'Ada' });
    const role = await createRole(t.db, { permissions: ['users.read'] });
    const got = await call(t.app, 'GET', `/api/admin/users/${user.id}`, { cookie });
    expect(got.status).toBe(200);
    expect((await got.json()).data).toMatchObject({ id: user.id, name: 'Ada', roles: [] });
    const patched = await call(t.app, 'PATCH', `/api/admin/users/${user.id}`, {
      cookie,
      body: { name: 'Ada L.', roles: [role.id] },
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).data).toMatchObject({
      name: 'Ada L.',
      roles: [{ id: role.id, name: role.name }],
    });
    expect(
      (await call(t.app, 'PATCH', `/api/admin/users/${user.id}`, { cookie, body: {} })).status,
    ).toBe(400);
    expect(
      (
        await call(t.app, 'PATCH', `/api/admin/users/${user.id}`, {
          cookie,
          body: { name: 'x', email: 'a@b.c' },
        })
      ).status,
    ).toBe(400);
    const missing = await call(t.app, 'GET', `/api/admin/users/${UNKNOWN}`, { cookie });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('USER_NOT_FOUND');
    expect((await call(t.app, 'GET', '/api/admin/users/not-a-uuid', { cookie })).status).toBe(400);
    const badRole = await call(t.app, 'PATCH', `/api/admin/users/${user.id}`, {
      cookie,
      body: { roles: [UNKNOWN] },
    });
    expect(badRole.status).toBe(404);
    expect((await badRole.json()).error.code).toBe('ROLE_NOT_FOUND');
  });
});

describe('RFC-50 R6, R7 suspend and reactivate over HTTP', () => {
  const t = useTestApp();

  it('suspends (sessions die), refuses a repeat, reactivates', async () => {
    const { cookie } = await adminCookie(t);
    const { user } = await createUser(t.db);
    const victim = await loginAs(t, user);
    const res = await call(t.app, 'POST', `/api/admin/users/${user.id}/suspend`, { cookie });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      status: 'suspended',
      suspendedAt: expect.any(String),
    });
    expect((await call(t.app, 'GET', '/api/auth/me', { cookie: victim.cookie })).status).toBe(401);
    const again = await call(t.app, 'POST', `/api/admin/users/${user.id}/suspend`, { cookie });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('USER_INVALID_STATUS');
    const back = await call(t.app, 'POST', `/api/admin/users/${user.id}/reactivate`, { cookie });
    expect(back.status).toBe(200);
    expect((await back.json()).data).toMatchObject({ status: 'active', suspendedAt: null });
    expect(
      (await call(t.app, 'POST', `/api/admin/users/${UNKNOWN}/suspend`, { cookie })).status,
    ).toBe(404);
  });
});

describe('RFC-50 R9 session administration over HTTP', () => {
  const t = useTestApp();

  it('lists, revokes one, revokes all, with sessions.read / sessions.revoke', async () => {
    const reader = await createUser(t.db, {
      roles: [(await createRole(t.db, { permissions: ['sessions.read'] })).id],
    });
    const readerCookie = (await loginAs(t, reader.user)).cookie;
    const { cookie } = await adminCookie(t);
    const { user } = await createUser(t.db);
    const a = await loginAs(t, user);
    const b = await loginAs(t, user);
    const listed = await call(t.app, 'GET', `/api/admin/users/${user.id}/sessions`, {
      cookie: readerCookie,
    });
    expect(listed.status).toBe(200);
    const { data } = await listed.json();
    expect(data).toHaveLength(2);
    expect(data.every((s: { current: boolean }) => s.current === false)).toBe(true);
    expect(
      (
        await call(t.app, 'DELETE', `/api/admin/users/${user.id}/sessions/${a.id}`, {
          cookie: readerCookie,
        })
      ).status,
    ).toBe(403);
    const one = await call(t.app, 'DELETE', `/api/admin/users/${user.id}/sessions/${a.id}`, {
      cookie,
    });
    expect(one.status).toBe(200);
    expect(await one.json()).toEqual({ data: { status: 'ok' } });
    expect((await call(t.app, 'GET', '/api/auth/me', { cookie: a.cookie })).status).toBe(401);
    expect(
      (
        await call(t.app, 'DELETE', `/api/admin/users/${user.id}/sessions/${'0'.repeat(64)}`, {
          cookie,
        })
      ).status,
    ).toBe(404);
    const all = await call(t.app, 'DELETE', `/api/admin/users/${user.id}/sessions`, { cookie });
    expect(all.status).toBe(200);
    expect((await call(t.app, 'GET', '/api/auth/me', { cookie: b.cookie })).status).toBe(401);
    expect(await lastAudit(t.db, 'sessions.revoked', { targetId: user.id })).toMatchObject({
      targetType: 'user',
      targetId: user.id,
      metadata: { count: 1 },
    });
    expect(
      (await call(t.app, 'GET', `/api/admin/users/${UNKNOWN}/sessions`, { cookie })).status,
    ).toBe(404);
  });
});

describe('RFC-50 R13, RFC-67 R6 PUT /api/admin/users/:id/plots', () => {
  const t = useTestApp();

  it('updates plot assignments and restriction flag, enforces users.update permission', async () => {
    const { cookie } = await adminCookie(t);
    const { user } = await createUser(t.db);
    const p1 = await createPlot(t.db);

    const res = await call(t.app, 'PUT', `/api/admin/users/${user.id}/plots`, {
      cookie,
      body: { plotIds: [p1.id], restrictToAssignedPlots: true },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.plots.map((p: { id: string }) => p.id)).toEqual([p1.id]);
    expect(body.data.restrictToAssignedPlots).toBe(true);

    // 400 when restricted with empty plotIds
    const bad = await call(t.app, 'PUT', `/api/admin/users/${user.id}/plots`, {
      cookie,
      body: { plotIds: [], restrictToAssignedPlots: true },
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('VALIDATION_FAILED');

    // 403 without users.update
    const reader = await createUser(t.db, {
      roles: [(await createRole(t.db, { permissions: ['users.read'] })).id],
    });
    const forbidden = await call(t.app, 'PUT', `/api/admin/users/${user.id}/plots`, {
      cookie: (await loginAs(t, reader.user)).cookie,
      body: { plotIds: [p1.id], restrictToAssignedPlots: false },
    });
    expect(forbidden.status).toBe(403);
  });

  it("forgets the target user's dashboard cache entry, so their next dashboard read reflects the new plots rather than the no-plots answer cached before them", async () => {
    const { cookie } = await adminCookie(t);
    const { user } = await createUser(t.db, {
      roles: [(await createRole(t.db, { permissions: ['dataset.read'] })).id],
    });
    const targetCookie = (await loginAs(t, user)).cookie;
    const p1 = await createPlot(t.db);
    const key = `dashboard:${user.id}`;

    try {
      // Warm the target's own cache entry while they still have no plots.
      const before = await call(t.app, 'GET', '/api/me/dashboard', { cookie: targetCookie });
      expect(before.status).toBe(200);
      expect((await before.json()).data.scope).toBeNull();
      expect(await t.redis.get(key)).not.toBeNull();

      const assigned = await call(t.app, 'PUT', `/api/admin/users/${user.id}/plots`, {
        cookie,
        body: { plotIds: [p1.id], restrictToAssignedPlots: true },
      });
      expect(assigned.status).toBe(200);
      expect(await t.redis.get(key)).toBeNull();

      // Without the fix this answers `scope` (uncached) with the new plot
      // while `contributor` still comes back as the no-plots shape cached
      // above — two sections of one page disagreeing about whether the
      // viewer has plots.
      const after = await call(t.app, 'GET', '/api/me/dashboard', { cookie: targetCookie });
      expect(after.status).toBe(200);
      const body = (await after.json()).data;
      expect(body.scope).not.toBeNull();
      expect(body.contributor.missingCells).not.toBeNull();
      expect(body.contributor.awaitingValidation).not.toBeNull();
    } finally {
      await forgetCached(t.redis, key);
    }
  });
});

describe('RFC-71 R5 GET /api/admin/users/:id/contributions', () => {
  const t = useTestApp();

  const viewer = async (permissions: PermissionKey[]) => {
    const role = await createRole(t.db, { permissions });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  };

  it("answers another user's contributions and summary with contributions.read", async () => {
    const { cookie } = await viewer(['contributions.read']);
    const { user: target } = await createUser(t.db);
    const fixture = await createVisibilityFixture(t.db, target.id);
    await createAnnotation(t.db, {
      recordId: fixture.visible.id,
      actorId: target.id,
      kind: 'confirm',
    });

    const list = await call(
      t.app,
      'GET',
      `/api/admin/users/${target.id}/contributions?kind=records`,
      { cookie },
    );
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(contributionRecordSchema.safeParse(body.data[0]).success).toBe(true);
    // RFC-71 R5: the viewer's own visibility applies; the route widens nothing.
    expect(body.data.map((r: { id: string }) => r.id)).toEqual([fixture.visible.id]);

    const annotations = await call(
      t.app,
      'GET',
      `/api/admin/users/${target.id}/contributions?kind=annotations`,
      { cookie },
    );
    expect(annotations.status).toBe(200);
    expect(contributionAnnotationSchema.safeParse((await annotations.json()).data[0]).success).toBe(
      true,
    );

    // RFC-71 R4: the summary counts every row, including the two the list hides.
    const summary = await call(
      t.app,
      'GET',
      `/api/admin/users/${target.id}/contributions/summary`,
      { cookie },
    );
    expect(summary.status).toBe(200);
    const counts = await summary.json();
    expect(contributionSummarySchema.safeParse(counts.data).success).toBe(true);
    expect(counts.data.records).toBe(3);
    expect(counts.data.validations).toBe(1);
  });

  it('is 404 for an unknown user and 403 without contributions.read', async () => {
    const { cookie } = await viewer(['contributions.read']);
    for (const path of [
      `/api/admin/users/${UNKNOWN}/contributions?kind=records`,
      `/api/admin/users/${UNKNOWN}/contributions/summary`,
    ]) {
      const res = await call(t.app, 'GET', path, { cookie });
      expect(res.status, path).toBe(404);
      expect((await res.json()).error.code, path).toBe('USER_NOT_FOUND');
    }

    const { user: target } = await createUser(t.db);
    const denied = await viewer(['dataset.read', 'users.read']);
    for (const path of [
      `/api/admin/users/${target.id}/contributions?kind=records`,
      `/api/admin/users/${target.id}/contributions/summary`,
    ]) {
      const res = await call(t.app, 'GET', path, { cookie: denied.cookie });
      expect(res.status, path).toBe(403);
      expect((await res.json()).error.code, path).toBe('PERMISSION_DENIED');
    }
  });
});
