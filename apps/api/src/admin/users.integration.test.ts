import { userSchema } from '@treerepro/contracts';
import { desc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useTestApp } from '../../test/helpers/app.ts';
import { adminRoleId, createRole } from '../../test/helpers/roles.ts';
import { loginAs } from '../../test/helpers/session.ts';
import { createUser } from '../../test/helpers/users.ts';
import { findUserByEmail } from '../auth/users.ts';
import { auditLog } from '../db/schema/audit-log.ts';
import { AppError } from '../http/errors.ts';
import {
  getUser,
  listUsers,
  reactivateUser,
  resendInvite,
  suspendUser,
  updateUser,
} from './users.ts';

function ctxOf(t: ReturnType<typeof useTestApp>) {
  return {
    db: t.db,
    sessions: t.sessions,
    mfa: t.mfa,
    limiter: t.limiter,
    mailer: t.mail.mailer,
    breachChecker: t.deps.breachChecker,
    permissionCache: t.permissionCache,
    logger: t.deps.logger,
    appOrigin: 'http://localhost',
    now: () => t.clock.now,
  };
}

async function lastAudit(t: ReturnType<typeof useTestApp>, action: string) {
  const [row] = await t.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, action))
    .orderBy(desc(auditLog.id))
    .limit(1);
  return row;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof AppError ? e.code : String(e);
  }
}

const meta = (actorUserId: string) => ({ actorUserId, ip: '203.0.113.9', userAgent: 'admin-ua' });

describe('RFC-50 R1, R4 getUser', () => {
  const t = useTestApp();

  it('serializes the documented shape with roles by name and no secrets', async () => {
    const b = await createRole(t.db, { name: `b-${Date.now()}` });
    const a = await createRole(t.db, { name: `A-${Date.now()}` });
    const { user } = await createUser(t.db, {
      roles: [b.id, a.id],
      totpSecret: 'JBSWY3DPEHPK3PXP',
    });
    const got = await getUser(t.db, user.id);
    expect(got).not.toBeNull();
    expect(userSchema.safeParse(got).success).toBe(true);
    expect(got?.roles.map((r) => r.id)).toEqual([a.id, b.id]);
    expect(got).toMatchObject({ status: 'active', totpEnabled: true, suspendedAt: null });
    expect(JSON.stringify(got)).not.toMatch(/passwordHash|totpSecret|\$argon2/);
    expect(await getUser(t.db, '019a0000-0000-7000-8000-000000000000')).toBeNull();
  });
});

describe('RFC-50 R2 listUsers', () => {
  const t = useTestApp();

  it('pages newest first by id with a keyset cursor, filters by status, and never repeats or skips', async () => {
    const mine = [];
    for (let i = 0; i < 3; i++)
      mine.push((await createUser(t.db, { status: 'invited', password: null })).user.id);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listUsers(t.db, { status: 'invited', cursor, limit: 2 });
      expect(page.data.length).toBeLessThanOrEqual(2);
      for (const u of page.data) expect(u.status).toBe('invited');
      seen.push(...page.data.map((u) => u.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of mine) expect(seen).toContain(id);
    expect([...seen].sort().reverse()).toEqual(seen);
    const first = await listUsers(t.db, { limit: 1 });
    expect(first.data).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
  });

  it('rejects a malformed cursor with VALIDATION_FAILED', async () => {
    expect(await code(listUsers(t.db, { cursor: 'nope', limit: 10 }))).toBe('VALIDATION_FAILED');
  });
});

describe('RFC-50 R5 updateUser', () => {
  const t = useTestApp();

  it('changes the name and roles in one call, auditing each; a same name writes nothing', async () => {
    const { user: admin } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const { user } = await createUser(t.db, { name: 'Ada' });
    const role = await createRole(t.db, { permissions: ['users.read'] });
    const updated = await updateUser(ctxOf(t), {
      ...meta(admin.id),
      id: user.id,
      name: '  Ada L. ',
      roleIds: [role.id],
    });
    expect(updated.name).toBe('Ada L.');
    expect(updated.roles.map((r) => r.id)).toEqual([role.id]);
    const nameAudit = await lastAudit(t, 'users.updated');
    expect(nameAudit).toMatchObject({
      actorUserId: admin.id,
      targetId: user.id,
      ip: '203.0.113.9',
      userAgent: 'admin-ua',
      metadata: { fields: ['name'] },
    });
    expect(await lastAudit(t, 'users.roles_changed')).toMatchObject({
      targetId: user.id,
      metadata: { added: [role.id] },
    });
    // Same name again: no write, no new users.updated entry.
    const again = await updateUser(ctxOf(t), { ...meta(admin.id), id: user.id, name: 'Ada L.' });
    expect(again.name).toBe('Ada L.');
    expect((await lastAudit(t, 'users.updated'))?.id).toBe(nameAudit?.id);
  });

  it('answers USER_NOT_FOUND for an unknown id and ROLE_NOT_FOUND for an unknown role', async () => {
    const { user: admin } = await createUser(t.db);
    const { user } = await createUser(t.db);
    expect(
      await code(
        updateUser(ctxOf(t), {
          ...meta(admin.id),
          id: '019a0000-0000-7000-8000-000000000000',
          name: 'x',
        }),
      ),
    ).toBe('USER_NOT_FOUND');
    expect(
      await code(
        updateUser(ctxOf(t), {
          ...meta(admin.id),
          id: user.id,
          roleIds: ['019a0000-0000-7000-8000-000000000000'],
        }),
      ),
    ).toBe('ROLE_NOT_FOUND');
  });
});

describe('RFC-50 R6, R7 suspendUser and reactivateUser', () => {
  const t = useTestApp();

  it('suspends an active user, drops their sessions, audits; reactivation restores active', async () => {
    const { user: admin } = await createUser(t.db);
    const { user } = await createUser(t.db);
    const session = await loginAs(t, user);
    const suspended = await suspendUser(ctxOf(t), { ...meta(admin.id), id: user.id });
    expect(suspended.status).toBe('suspended');
    expect(suspended.suspendedAt).toEqual(expect.any(String));
    expect(await t.sessions.get(session.rawId)).toBeNull();
    expect(await lastAudit(t, 'users.suspended')).toMatchObject({
      actorUserId: admin.id,
      targetId: user.id,
      ip: '203.0.113.9',
    });
    expect(await code(suspendUser(ctxOf(t), { ...meta(admin.id), id: user.id }))).toBe(
      'USER_INVALID_STATUS',
    );
    const active = await reactivateUser(ctxOf(t), { ...meta(admin.id), id: user.id });
    expect(active).toMatchObject({ status: 'active', suspendedAt: null });
    expect(await lastAudit(t, 'users.reactivated')).toMatchObject({
      actorUserId: admin.id,
      targetId: user.id,
    });
    expect(await code(reactivateUser(ctxOf(t), { ...meta(admin.id), id: user.id }))).toBe(
      'USER_INVALID_STATUS',
    );
  });

  it('refuses to suspend an invited user and an unknown id', async () => {
    const { user: admin } = await createUser(t.db);
    const { user } = await createUser(t.db, { status: 'invited', password: null });
    expect(await code(suspendUser(ctxOf(t), { ...meta(admin.id), id: user.id }))).toBe(
      'USER_INVALID_STATUS',
    );
    expect(
      await code(
        suspendUser(ctxOf(t), { ...meta(admin.id), id: '019a0000-0000-7000-8000-000000000000' }),
      ),
    ).toBe('USER_NOT_FOUND');
  });
});

describe('RFC-50 R8 resendInvite', () => {
  const t = useTestApp();

  it('re-issues the invitation for an invited user and refuses other statuses', async () => {
    const { user: admin } = await createUser(t.db);
    const { user, email } = await createUser(t.db, { status: 'invited', password: null });
    const sentBefore = t.mail.sent.length;
    const result = await resendInvite(ctxOf(t), { ...meta(admin.id), id: user.id });
    expect(result.status).toBe('invited');
    expect(t.mail.sent).toHaveLength(sentBefore + 1);
    expect(t.mail.sent.at(-1)?.to).toBe(email);
    expect(await lastAudit(t, 'auth.invite.created')).toMatchObject({
      actorUserId: admin.id,
      targetId: user.id,
    });
    expect((await findUserByEmail(t.db, email))?.id).toBe(user.id);
    const { user: active } = await createUser(t.db);
    expect(await code(resendInvite(ctxOf(t), { ...meta(admin.id), id: active.id }))).toBe(
      'USER_INVALID_STATUS',
    );
  });
});
