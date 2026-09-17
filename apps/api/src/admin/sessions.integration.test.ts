import { sessionSummarySchema } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { ctxOf, useTestApp } from '../../test/helpers/app.ts';
import { lastAudit } from '../../test/helpers/audit.ts';
import { loginAs } from '../../test/helpers/session.ts';
import { createUser } from '../../test/helpers/users.ts';
import { AppError } from '../http/errors.ts';
import { listUserSessions, revokeAllUserSessions, revokeUserSession } from './sessions.ts';

const meta = (actorUserId: string) => ({ actorUserId, ip: '203.0.113.9', userAgent: 'admin-ua' });

describe('RFC-50 R9 session administration', () => {
  const t = useTestApp();

  it('lists newest first with current false, revokes one, then all, auditing sessions.revoked', async () => {
    const { user: admin } = await createUser(t.db);
    const { user } = await createUser(t.db);
    const a = await loginAs(t, user, { ip: '203.0.113.1', userAgent: 'A' });
    t.clock.now += 1000;
    const b = await loginAs(t, user, { ip: '203.0.113.2', userAgent: 'B' });
    const listed = await listUserSessions(ctxOf(t), user.id);
    expect(listed.map((s) => s.id)).toEqual([b.id, a.id]);
    for (const s of listed) {
      expect(sessionSummarySchema.safeParse(s).success).toBe(true);
      expect(s.current).toBe(false);
    }
    expect(
      await revokeUserSession(ctxOf(t), { ...meta(admin.id), userId: user.id, sessionId: b.id }),
    ).toBe(true);
    expect(await t.sessions.get(b.rawId)).toBeNull();
    expect(await lastAudit(t.db, 'sessions.revoked', { targetId: b.id })).toMatchObject({
      actorUserId: admin.id,
      targetType: 'session',
      targetId: b.id,
      ip: '203.0.113.9',
    });
    expect(
      await revokeUserSession(ctxOf(t), {
        ...meta(admin.id),
        userId: user.id,
        sessionId: '0'.repeat(64),
      }),
    ).toBe(false);
    const other = await createUser(t.db);
    const theirs = await loginAs(t, other.user);
    expect(
      await revokeUserSession(ctxOf(t), {
        ...meta(admin.id),
        userId: user.id,
        sessionId: theirs.id,
      }),
    ).toBe(false);
    expect(await t.sessions.get(theirs.rawId)).not.toBeNull();
    expect(await revokeAllUserSessions(ctxOf(t), { ...meta(admin.id), userId: user.id })).toBe(1);
    expect(await t.sessions.get(a.rawId)).toBeNull();
    expect(await lastAudit(t.db, 'sessions.revoked', { targetId: user.id })).toMatchObject({
      targetType: 'user',
      targetId: user.id,
      metadata: { count: 1 },
    });
  });

  it('answers USER_NOT_FOUND for an unknown user', async () => {
    const { user: admin } = await createUser(t.db);
    const unknown = '019a0000-0000-7000-8000-000000000000';
    await expect(listUserSessions(ctxOf(t), unknown)).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
    await expect(
      revokeAllUserSessions(ctxOf(t), { ...meta(admin.id), userId: unknown }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
