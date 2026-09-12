import { desc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, randomIp, useTestApp } from '../../../test/helpers/app.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser, DEFAULT_PASSWORD, randomEmail } from '../../../test/helpers/users.ts';
import { auditLog } from '../../db/schema/audit-log.ts';
import { authTokens } from '../../db/schema/auth-tokens.ts';

const NEW_PASSWORD = 'another perfectly fine passphrase';

// uuidv7 ids are time-ordered with sub-millisecond precision; `at` can tie.
async function lastAudit(t: ReturnType<typeof useTestApp>, action: string) {
  const [row] = await t.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, action))
    .orderBy(desc(auditLog.id))
    .limit(1);
  return row;
}

describe('RFC-21 R5 POST /api/auth/password/forgot', () => {
  const t = useTestApp();
  const forgot = (email: string, options = {}) =>
    call(t.app, 'POST', '/api/auth/password/forgot', { body: { email }, ...options });

  it('answers the same 200 for known and unknown emails; emails a 1 h link only to active users', async () => {
    const { user, email } = await createUser(t.db, { name: 'Ada' });
    const before = t.mail.sent.length;
    const known = await forgot(email);
    const unknown = await forgot(randomEmail());
    expect(known.status).toBe(200);
    const knownBody = await known.json();
    expect(knownBody).toEqual(await unknown.json());
    expect(knownBody).toEqual({ data: { status: 'sent' } });
    expect(t.mail.sent.length).toBe(before + 1);
    const mail = t.mail.sent[before];
    expect(mail?.to).toBe(email);
    expect(mail?.text).toMatch(/http:\/\/localhost\/reset-password\/[A-Za-z0-9_-]{43}/);
    const [token] = await t.db.select().from(authTokens).where(eq(authTokens.userId, user.id));
    expect(token?.kind).toBe('password_reset');
    expect(token?.expiresAt.getTime()).toBe(t.clock.now + 3600 * 1000);
    expect(await lastAudit(t, 'auth.password.reset_requested')).toMatchObject({
      actorUserId: null,
      targetId: user.id,
    });
  });

  it('sends nothing for invited or suspended users', async () => {
    const before = t.mail.sent.length;
    const invited = await createUser(t.db, { status: 'invited', password: null });
    const suspended = await createUser(t.db, { status: 'suspended' });
    expect((await forgot(invited.email)).status).toBe(200);
    expect((await forgot(suspended.email)).status).toBe(200);
    expect(t.mail.sent.length).toBe(before);
  });

  it('logs a mail failure without the address and still answers 200', async () => {
    const { email } = await createUser(t.db);
    t.mail.failNext(new Error('ECONNREFUSED'));
    expect((await forgot(email)).status).toBe(200);
    const line = t.lines.find((l) => (l as { msg: string }).msg === 'password reset email failed');
    expect(line).toBeDefined();
    expect(JSON.stringify(line)).not.toContain(email);
  });

  it('RFC-24 R3 limits 3 per email+IP and 10 per IP', async () => {
    const email = randomEmail();
    const ip = randomIp();
    for (let i = 0; i < 3; i++) expect((await forgot(email, { ip })).status).toBe(200);
    expect((await forgot(email, { ip })).status).toBe(429);
    const ip2 = randomIp();
    for (let i = 0; i < 10; i++) await forgot(randomEmail(), { ip: ip2 });
    expect((await forgot(randomEmail(), { ip: ip2 })).status).toBe(429);
  });
});

describe('RFC-21 R6 POST /api/auth/password/reset', () => {
  const t = useTestApp();

  async function requestReset() {
    const created = await createUser(t.db);
    const before = t.mail.sent.length;
    await call(t.app, 'POST', '/api/auth/password/forgot', { body: { email: created.email } });
    const token =
      /reset-password\/([A-Za-z0-9_-]{43})/.exec(t.mail.sent[before]?.text ?? '')?.[1] ?? '';
    return { ...created, token };
  }
  const reset = (body: unknown, options = {}) =>
    call(t.app, 'POST', '/api/auth/password/reset', { body, ...options });

  it('replaces the password, revokes every session and does not log in', async () => {
    const { user, email, token } = await requestReset();
    const session = await loginAs(t, user);
    const res = await reset({ token, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: 'ok' } });
    expect(
      res.headers
        .getSetCookie()
        .some((l) => l.startsWith('__Host-session=') && !/Max-Age=0/.test(l)),
    ).toBe(false);
    expect((await call(t.app, 'GET', '/api/auth/me', { cookie: session.cookie })).status).toBe(401);
    expect(
      (
        await call(t.app, 'POST', '/api/auth/login', {
          body: { email, password: DEFAULT_PASSWORD },
        })
      ).status,
    ).toBe(401);
    expect(
      (await call(t.app, 'POST', '/api/auth/login', { body: { email, password: NEW_PASSWORD } }))
        .status,
    ).toBe(200);
    expect(await lastAudit(t, 'auth.password.reset')).toMatchObject({
      actorUserId: user.id,
      targetId: user.id,
    });
    expect((await reset({ token, newPassword: NEW_PASSWORD })).status).toBe(400);
  });

  it('a weak password is refused without consuming the token; invalid tokens answer 400', async () => {
    const { token } = await requestReset();
    const weak = await reset({ token, newPassword: 'short' });
    expect((await weak.json()).error.code).toBe('AUTH_PASSWORD_WEAK');
    expect((await reset({ token, newPassword: NEW_PASSWORD })).status).toBe(200);
    const bad = await reset({ token: 'B'.repeat(43), newPassword: NEW_PASSWORD });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('R8 keeps TOTP enabled', async () => {
    const { email } = await createUser(t.db, { totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' });
    const before = t.mail.sent.length;
    await call(t.app, 'POST', '/api/auth/password/forgot', { body: { email } });
    const token =
      /reset-password\/([A-Za-z0-9_-]{43})/.exec(t.mail.sent[before]?.text ?? '')?.[1] ?? '';
    expect((await reset({ token, newPassword: NEW_PASSWORD })).status).toBe(200);
    const login = await call(t.app, 'POST', '/api/auth/login', {
      body: { email, password: NEW_PASSWORD },
    });
    expect((await login.json()).data).toEqual({ status: 'totp_required' });
  });
});

describe('RFC-21 R7 POST /api/auth/password/change', () => {
  const t = useTestApp();
  const change = (cookie: string, body: unknown) =>
    call(t.app, 'POST', '/api/auth/password/change', { body, cookie });

  it('requires the current password, keeps the current session and revokes the others', async () => {
    const { user, email } = await createUser(t.db);
    const current = await loginAs(t, user);
    const other = await loginAs(t, user);
    const wrong = await change(current.cookie, {
      currentPassword: 'nope nope nope',
      newPassword: NEW_PASSWORD,
    });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error.code).toBe('AUTH_INVALID_CREDENTIALS');
    const weak = await change(current.cookie, {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: 'short',
    });
    expect((await weak.json()).error.code).toBe('AUTH_PASSWORD_WEAK');
    const ok = await change(current.cookie, {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(ok.status).toBe(200);
    expect((await call(t.app, 'GET', '/api/auth/me', { cookie: current.cookie })).status).toBe(200);
    expect((await call(t.app, 'GET', '/api/auth/me', { cookie: other.cookie })).status).toBe(401);
    expect(
      (await call(t.app, 'POST', '/api/auth/login', { body: { email, password: NEW_PASSWORD } }))
        .status,
    ).toBe(200);
    expect(await lastAudit(t, 'auth.password.changed')).toMatchObject({ actorUserId: user.id });
  });

  it('is 401 without a session', async () => {
    expect(
      (
        await call(t.app, 'POST', '/api/auth/password/change', {
          body: { currentPassword: 'a', newPassword: NEW_PASSWORD },
        })
      ).status,
    ).toBe(401);
  });
});
