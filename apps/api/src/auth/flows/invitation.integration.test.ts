import type { Platform } from '@treerepro/contracts';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  call,
  cookieFrom,
  ctxOf,
  randomIp,
  setCookieLine,
  TEST_PLANT_ORIGIN,
  useTestApp,
} from '../../../test/helpers/app.ts';
import { lastAudit } from '../../../test/helpers/audit.ts';
import { createRole } from '../../../test/helpers/roles.ts';
import { createUser, randomEmail } from '../../../test/helpers/users.ts';
import { ConfigError } from '../../config.ts';
import { authTokens } from '../../db/schema/auth-tokens.ts';
import { findUserByEmail, findUserById, UserEmailTakenError } from '../users.ts';
import { InvitationMailError, inviteUser } from './invitation.ts';

const GOOD_PASSWORD = 'a perfectly fine passphrase';

describe('RFC-20 R4 inviteUser', () => {
  const t = useTestApp();

  it('creates an invited user, a 14-day token, sends the email with the link and audits', async () => {
    const ctx = ctxOf(t);
    const email = randomEmail();
    const before = t.mail.sent.length;
    const { user, link, expiresAt } = await inviteUser(ctx, {
      email,
      name: 'Ada',
      actorUserId: null,
      platform: 'treerepro',
    });
    expect(user.status).toBe('invited');
    expect(link).toMatch(/^http:\/\/localhost\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(expiresAt.getTime() - t.clock.now).toBe(14 * 24 * 3600 * 1000);
    const mail = t.mail.sent[before];
    expect(mail?.to).toBe(email);
    expect(mail?.text).toContain(link);
    const audit = await lastAudit(t.db, 'auth.invite.created', { targetId: user.id });
    expect(audit).toMatchObject({ actorUserId: null, targetType: 'user', targetId: user.id });
  });

  it('RFC-20 R4, R5 names its platform: the token carries it and the link goes to its origin', async () => {
    const before = t.mail.sent.length;
    const { user, link } = await inviteUser(ctxOf(t), {
      email: randomEmail(),
      name: 'Ada',
      actorUserId: null,
      platform: 'plantrepro',
    });
    expect(link).toMatch(/^http:\/\/plantrepro\.localhost\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(t.mail.sent[before]?.text).toContain('http://plantrepro.localhost/');
    const [token] = await t.db
      .select({ platform: authTokens.platform })
      .from(authTokens)
      .where(eq(authTokens.userId, user.id));
    expect(token?.platform).toBe('plantrepro');
  });

  it('RFC-20 R7 a re-invite keeps the platform of the latest invitation, where its roles are', async () => {
    const email = randomEmail();
    const role = await createRole(t.db);
    await inviteUser(ctxOf(t), {
      email,
      name: 'Ada',
      actorUserId: null,
      platform: 'plantrepro',
      roleIds: [role.id],
    });
    const again = await inviteUser(ctxOf(t), {
      email,
      name: 'Ada',
      actorUserId: null,
      platform: 'treerepro',
    });
    expect(again.link).toMatch(/^http:\/\/plantrepro\.localhost\/invite\//);
    expect(t.mail.sent.at(-1)?.subject).toBe('You have been invited to PlantRepro');
  });

  it('RFC-20 R4 refuses a platform with no host before writing anything', async () => {
    const ctx = {
      ...ctxOf(t),
      originOf: (platform: Platform) => {
        if (platform === 'plantrepro') throw new ConfigError('PLANT_DOMAIN is unset');
        return 'http://localhost';
      },
    };
    const email = randomEmail();
    const err = await inviteUser(ctx, {
      email,
      name: 'Ada',
      actorUserId: null,
      platform: 'plantrepro',
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'platform' }] });
    expect(await findUserByEmail(t.db, email)).toBeNull();
  });

  it('names the configured contact for an expired link in both parts of the email', async () => {
    const ctx = { ...ctxOf(t), inviteContactEmail: 'help@treerepro.test' };
    const before = t.mail.sent.length;
    await inviteUser(ctx, {
      email: randomEmail(),
      name: 'Ada',
      actorUserId: null,
      platform: 'treerepro',
    });
    const mail = t.mail.sent[before];
    expect(mail?.text).toContain('ask help@treerepro.test for a new invitation');
    expect(mail?.html).toContain('ask help@treerepro.test for a new invitation');
  });

  it('R7 re-inviting an invited user supersedes the token; any other status is refused', async () => {
    const ctx = ctxOf(t);
    const email = randomEmail();
    const first = await inviteUser(ctx, {
      email,
      name: 'Ada',
      actorUserId: null,
      platform: 'treerepro',
    });
    const second = await inviteUser(ctx, {
      email: email.toUpperCase(),
      name: 'Ada',
      actorUserId: null,
      platform: 'treerepro',
    });
    expect(second.user.id).toBe(first.user.id);
    const tokens = await t.db
      .select()
      .from(authTokens)
      .where(and(eq(authTokens.userId, first.user.id), eq(authTokens.kind, 'invite')));
    expect(tokens.filter((x) => x.consumedAt === null)).toHaveLength(1);
    const { email: activeEmail } = await createUser(t.db);
    await expect(
      inviteUser(ctx, { email: activeEmail, name: 'X', actorUserId: null, platform: 'treerepro' }),
    ).rejects.toBeInstanceOf(UserEmailTakenError);
  });

  it('keeps the user and token when the email fails, and reports the failure with the link', async () => {
    const ctx = ctxOf(t);
    const email = randomEmail();
    t.mail.failNext(new Error('ECONNREFUSED'));
    const err = await inviteUser(ctx, {
      email,
      name: 'Ada',
      actorUserId: null,
      platform: 'treerepro',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvitationMailError);
    expect((err as InvitationMailError).link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(((err as InvitationMailError).cause as Error).message).toBe('ECONNREFUSED');
    expect((await findUserByEmail(t.db, email))?.status).toBe('invited');
  });
});

describe('RFC-20 R6 POST /api/auth/invite/accept', () => {
  const t = useTestApp();

  /** Invited on `platform` with one role there (none when `roles` is false). */
  async function invite(platform: Platform = 'treerepro', roles = true) {
    const email = randomEmail();
    const { user, link } = await inviteUser(ctxOf(t), {
      email,
      name: 'Ada',
      actorUserId: null,
      platform,
      ...(roles ? { roleIds: [(await createRole(t.db)).id] } : {}),
    });
    return { user, email, token: link.split('/').at(-1) ?? '' };
  }

  it('RFC-22 R13 an invitation accepted on the other platform is refused and not spent', async () => {
    const { user, token } = await invite('treerepro');
    const res = await call(t.app, 'POST', 'http://plantrepro.localhost/api/auth/invite/accept', {
      body: { token, password: GOOD_PASSWORD },
      origin: TEST_PLANT_ORIGIN,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatchObject({
      code: 'PLATFORM_ACCESS_DENIED',
      details: [{ path: 'platforms', message: 'treerepro' }],
    });
    expect(setCookieLine(res, '__Host-session')).toBe('');
    expect(await lastAudit(t.db, 'auth.platform_denied', { targetId: user.id })).toMatchObject({
      metadata: { platform: 'plantrepro', reason: 'other_platform' },
    });
    const ok = await call(t.app, 'POST', '/api/auth/invite/accept', {
      body: { token, password: GOOD_PASSWORD },
    });
    expect(ok.status).toBe(200);
  });

  it('RFC-22 R13 an invitation with no role on its platform is refused; the user stays invited', async () => {
    const { user, token } = await invite('treerepro', false);
    const res = await call(t.app, 'POST', '/api/auth/invite/accept', {
      body: { token, password: GOOD_PASSWORD },
    });
    expect((await res.json()).error).toMatchObject({ code: 'PLATFORM_ACCESS_DENIED', details: [] });
    expect((await findUserById(t.db, user.id))?.status).toBe('invited');
    expect(await lastAudit(t.db, 'auth.platform_denied', { targetId: user.id })).toMatchObject({
      metadata: { platform: 'treerepro', reason: 'no_role' },
    });
  });

  it('RFC-14 R5 accepting on PlantRepro opens a PlantRepro session', async () => {
    const { user, token } = await invite('plantrepro');
    const res = await call(t.app, 'POST', 'http://plantrepro.localhost/api/auth/invite/accept', {
      body: { token, password: GOOD_PASSWORD },
      origin: TEST_PLANT_ORIGIN,
    });
    expect(res.status).toBe(200);
    const cookie = cookieFrom(res, '__Host-session') ?? '';
    const plant = await call(t.app, 'GET', 'http://plantrepro.localhost/api/auth/me', { cookie });
    expect((await plant.json()).data.user.id).toBe(user.id);
    expect((await call(t.app, 'GET', '/api/auth/me', { cookie })).status).toBe(401);
  });

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
    const audit = await lastAudit(t.db, 'auth.invite.accepted', { actorUserId: user.id });
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
    t.clock.now += 14 * 24 * 3600 * 1000 + 1;
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
