import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, cookieFrom, randomIp, useTestApp } from '../../../test/helpers/app.ts';
import { lastAudit } from '../../../test/helpers/audit.ts';
import { createUser, randomEmail } from '../../../test/helpers/users.ts';
import { authTokens } from '../../db/schema/auth-tokens.ts';
import { findUserByEmail, findUserById, UserEmailTakenError } from '../users.ts';
import { InvitationMailError, inviteUser } from './invitation.ts';

const GOOD_PASSWORD = 'a perfectly fine passphrase';

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

describe('RFC-20 R4 inviteUser', () => {
  const t = useTestApp();

  it('creates an invited user, a 72 h token, sends the email with the link and audits', async () => {
    const ctx = ctxOf(t);
    const email = randomEmail();
    const before = t.mail.sent.length;
    const { user, link, expiresAt } = await inviteUser(ctx, {
      email,
      name: 'Ada',
      actorUserId: null,
    });
    expect(user.status).toBe('invited');
    expect(link).toMatch(/^http:\/\/localhost\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(expiresAt.getTime() - t.clock.now).toBe(72 * 3600 * 1000);
    const mail = t.mail.sent[before];
    expect(mail?.to).toBe(email);
    expect(mail?.text).toContain(link);
    const audit = await lastAudit(t.db, 'auth.invite.created', { targetId: user.id });
    expect(audit).toMatchObject({ actorUserId: null, targetType: 'user', targetId: user.id });
  });

  it('R7 re-inviting an invited user supersedes the token; any other status is refused', async () => {
    const ctx = ctxOf(t);
    const email = randomEmail();
    const first = await inviteUser(ctx, { email, name: 'Ada', actorUserId: null });
    const second = await inviteUser(ctx, {
      email: email.toUpperCase(),
      name: 'Ada',
      actorUserId: null,
    });
    expect(second.user.id).toBe(first.user.id);
    const tokens = await t.db
      .select()
      .from(authTokens)
      .where(and(eq(authTokens.userId, first.user.id), eq(authTokens.kind, 'invite')));
    expect(tokens.filter((x) => x.consumedAt === null)).toHaveLength(1);
    const { email: activeEmail } = await createUser(t.db);
    await expect(
      inviteUser(ctx, { email: activeEmail, name: 'X', actorUserId: null }),
    ).rejects.toBeInstanceOf(UserEmailTakenError);
  });

  it('keeps the user and token when the email fails, and reports the failure with the link', async () => {
    const ctx = ctxOf(t);
    const email = randomEmail();
    t.mail.failNext(new Error('ECONNREFUSED'));
    const err = await inviteUser(ctx, { email, name: 'Ada', actorUserId: null }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InvitationMailError);
    expect((err as InvitationMailError).link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(((err as InvitationMailError).cause as Error).message).toBe('ECONNREFUSED');
    expect((await findUserByEmail(t.db, email))?.status).toBe('invited');
  });
});

describe('RFC-20 R6 POST /api/auth/invite/accept', () => {
  const t = useTestApp();

  async function invite() {
    const email = randomEmail();
    const { user, link } = await inviteUser(ctxOf(t), { email, name: 'Ada', actorUserId: null });
    return { user, email, token: link.split('/').at(-1) ?? '' };
  }

  it('activates the user, consumes the token, opens a session and audits', async () => {
    const { user, token } = await invite();
    const ip = randomIp();
    const res = await call(t.app, 'POST', '/api/auth/invite/accept', {
      body: { token, password: GOOD_PASSWORD },
      ip,
      headers: { 'user-agent': 'UA/9' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.user).toMatchObject({ id: user.id, status: 'active', totpEnabled: false });
    expect(body.data.user.passwordHash).toBeUndefined();
    const cookie = cookieFrom(res, '__Host-session');
    expect(cookie).toMatch(/^__Host-session=[A-Za-z0-9_-]{43}$/);
    expect((await findUserById(t.db, user.id))?.passwordHash?.startsWith('$argon2id$')).toBe(true);
    const me = await call(t.app, 'GET', '/api/auth/me', { cookie: cookie ?? '' });
    expect(me.status).toBe(200);
    const audit = await lastAudit(t.db, 'auth.invite.accepted', { targetId: user.id });
    expect(audit).toMatchObject({ actorUserId: user.id, targetId: user.id, ip, userAgent: 'UA/9' });
    const again = await call(t.app, 'POST', '/api/auth/invite/accept', {
      body: { token, password: GOOD_PASSWORD },
    });
    expect(again.status).toBe(400);
    expect((await again.json()).error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('RFC-21 R2 rejects a short or breached password without spending the token', async () => {
    const { token } = await invite();
    const short = await call(t.app, 'POST', '/api/auth/invite/accept', {
      body: { token, password: 'elevenchars' },
    });
    expect(short.status).toBe(400);
    expect((await short.json()).error).toMatchObject({
      code: 'AUTH_PASSWORD_WEAK',
      details: [{ path: 'password', message: 'Password must be at least 12 characters long.' }],
    });
    t.breached.add('breached passphrase 123');
    const breached = await call(t.app, 'POST', '/api/auth/invite/accept', {
      body: { token, password: 'breached passphrase 123' },
    });
    expect((await breached.json()).error.details[0].message).toMatch(/data breaches/);
    const ok = await call(t.app, 'POST', '/api/auth/invite/accept', {
      body: { token, password: GOOD_PASSWORD },
    });
    expect(ok.status).toBe(200);
  });

  it('rejects unknown and expired tokens alike', async () => {
    const unknown = await call(t.app, 'POST', '/api/auth/invite/accept', {
      body: { token: 'A'.repeat(43), password: GOOD_PASSWORD },
    });
    expect(unknown.status).toBe(400);
    const { token } = await invite();
    t.clock.now += 72 * 3600 * 1000 + 1;
    const expired = await call(t.app, 'POST', '/api/auth/invite/accept', {
      body: { token, password: GOOD_PASSWORD },
    });
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual(await unknown.json());
  });

  it('RFC-01 R6 negatives: extra field, no origin, rate limit per IP', async () => {
    const extra = await call(t.app, 'POST', '/api/auth/invite/accept', {
      body: { token: 'A'.repeat(43), password: GOOD_PASSWORD, x: 1 },
    });
    expect(extra.status).toBe(400);
    expect((await extra.json()).error.code).toBe('VALIDATION_FAILED');
    const noOrigin = await call(t.app, 'POST', '/api/auth/invite/accept', {
      body: { token: 'A'.repeat(43), password: GOOD_PASSWORD },
      origin: null,
    });
    expect(noOrigin.status).toBe(403);
    const ip = randomIp();
    for (let i = 0; i < 10; i++)
      await call(t.app, 'POST', '/api/auth/invite/accept', {
        body: { token: 'A'.repeat(43), password: GOOD_PASSWORD },
        ip,
      });
    const limited = await call(t.app, 'POST', '/api/auth/invite/accept', {
      body: { token: 'A'.repeat(43), password: GOOD_PASSWORD },
      ip,
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
  });
});
