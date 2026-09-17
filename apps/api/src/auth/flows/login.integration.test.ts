import { verify } from '@node-rs/argon2';
import { describe, expect, it, vi } from 'vitest';
import {
  call,
  cookieFrom,
  randomIp,
  setCookieLine,
  useTestApp,
} from '../../../test/helpers/app.ts';
import { lastAudit } from '../../../test/helpers/audit.ts';
import { createUser, DEFAULT_PASSWORD, randomEmail } from '../../../test/helpers/users.ts';
import { generateTotpCode, generateTotpSecret } from '../totp.ts';

vi.mock('@node-rs/argon2', { spy: true });

describe('RFC-22 R2, R3 POST /api/auth/login', () => {
  const t = useTestApp();
  const login = (body: unknown, options = {}) =>
    call(t.app, 'POST', '/api/auth/login', { body, ...options });

  it('opens a session for a correct password and audits success', async () => {
    const { user, email } = await createUser(t.db);
    const ip = randomIp();
    const res = await login(
      { email, password: DEFAULT_PASSWORD },
      { ip, headers: { 'user-agent': 'UA/1' } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      status: 'ok',
      user: expect.objectContaining({ id: user.id, email, totpEnabled: false }),
    });
    const line = setCookieLine(res, '__Host-session');
    expect(line).toContain('HttpOnly');
    expect(line).toContain('Secure');
    expect(line).toContain('SameSite=Strict');
    expect(line).toContain('Path=/');
    expect(setCookieLine(res, '__Host-mfa')).toBe('');
    const audit = await lastAudit(t.db, 'auth.login.success', { actorUserId: user.id });
    expect(audit).toMatchObject({ actorUserId: user.id, ip, userAgent: 'UA/1' });
    const me = await call(t.app, 'GET', '/api/auth/me', {
      cookie: cookieFrom(res, '__Host-session') ?? '',
    });
    expect((await me.json()).data).toEqual({
      user: expect.objectContaining({ id: user.id }),
      permissions: [],
      scope: { plots: [], restricted: false },
    });
  });

  it('answers the same 401 for an unknown email and a wrong password, and still runs argon2', async () => {
    const { email } = await createUser(t.db);
    const wrong = await login({ email, password: 'not the password' });
    const unknown = await login({ email: randomEmail(), password: 'not the password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const wrongBody = await wrong.json();
    expect(wrongBody).toEqual(await unknown.json());
    expect(wrongBody.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(cookieFrom(wrong, '__Host-session')).toBeNull();
    const calls = vi.mocked(verify).mock.calls.length;
    const ip = randomIp();
    await login({ email: randomEmail(), password: 'x' }, { ip });
    expect(vi.mocked(verify).mock.calls.length).toBe(calls + 1);
    const failure = await lastAudit(t.db, 'auth.login.failure', { ip });
    expect(failure).toMatchObject({ actorUserId: null, metadata: { reason: 'unknown_email' } });
  });

  it('treats invited users as invalid credentials with reason not_active', async () => {
    const invited = await createUser(t.db, { status: 'invited', password: null });
    expect((await login({ email: invited.email, password: DEFAULT_PASSWORD })).status).toBe(401);
    expect(
      await lastAudit(t.db, 'auth.login.failure', { targetId: invited.user.id }),
    ).toMatchObject({
      targetId: invited.user.id,
      metadata: { reason: 'not_active' },
    });
  });

  it('discloses suspension only with the correct password', async () => {
    const { email, user } = await createUser(t.db, { status: 'suspended' });
    const right = await login({ email, password: DEFAULT_PASSWORD });
    expect(right.status).toBe(403);
    expect((await right.json()).error.code).toBe('AUTH_ACCOUNT_SUSPENDED');
    expect(await lastAudit(t.db, 'auth.login.failure', { targetId: user.id })).toMatchObject({
      targetId: user.id,
      metadata: { reason: 'suspended' },
    });
    const wrong = await login({ email, password: 'nope nope nope' });
    expect(wrong.status).toBe(401);
  });

  it('R3 answers totp_required with the MFA cookie and no session for a TOTP user', async () => {
    const { user, email } = await createUser(t.db, { totpSecret: generateTotpSecret() });
    const res = await login({ email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ status: 'totp_required' });
    expect(cookieFrom(res, '__Host-mfa')).toMatch(/^__Host-mfa=[A-Za-z0-9_-]{43}$/);
    expect(setCookieLine(res, '__Host-mfa')).toContain('HttpOnly');
    expect(cookieFrom(res, '__Host-session')).toBeNull();
    expect(await lastAudit(t.db, 'auth.login.success', { actorUserId: user.id })).toBeUndefined();
  });

  it('RFC-24 R3, R6 limits 5 attempts per email+IP and 20 per IP, auditing rate_limited', async () => {
    const { email } = await createUser(t.db);
    const ip = randomIp();
    for (let i = 0; i < 5; i++)
      expect((await login({ email, password: 'wrong' }, { ip })).status).toBe(401);
    const limited = await login({ email, password: DEFAULT_PASSWORD }, { ip });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await lastAudit(t.db, 'auth.login.failure', { ip })).toMatchObject({
      actorUserId: null,
      metadata: { reason: 'rate_limited' },
    });
    const ip2 = randomIp();
    for (let i = 0; i < 20; i++)
      await login({ email: randomEmail(), password: 'wrong' }, { ip: ip2 });
    expect((await login({ email: randomEmail(), password: 'wrong' }, { ip: ip2 })).status).toBe(
      429,
    );
  });

  it('RFC-01 R6 negatives', async () => {
    expect((await login({ email: 'a@b.example', password: 'x', extra: true })).status).toBe(400);
    expect((await login({ email: 'a@b.example', password: 'x' }, { origin: null })).status).toBe(
      403,
    );
    expect((await login({ email: 'a@b.example' })).status).toBe(400);
  });
});

describe('RFC-23 R6 POST /api/auth/login/totp', () => {
  const t = useTestApp();

  async function challenge() {
    const secret = generateTotpSecret();
    const { user, email } = await createUser(t.db, { totpSecret: secret });
    const res = await call(t.app, 'POST', '/api/auth/login', {
      body: { email, password: DEFAULT_PASSWORD },
    });
    return { user, secret, mfaCookie: cookieFrom(res, '__Host-mfa') ?? '' };
  }
  const totp = (cookie: string, body: unknown) =>
    call(t.app, 'POST', '/api/auth/login/totp', { body, cookie });

  it('completes login with a valid code, clears the MFA cookie and rejects a replay', async () => {
    const { user, secret, mfaCookie } = await challenge();
    const code = generateTotpCode(secret, t.clock.now);
    const res = await totp(mfaCookie, { code });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      status: 'ok',
      user: expect.objectContaining({ id: user.id, totpEnabled: true }),
    });
    expect(cookieFrom(res, '__Host-session')).not.toBeNull();
    expect(setCookieLine(res, '__Host-mfa')).toContain('Max-Age=0');
    expect(await lastAudit(t.db, 'auth.login.success', { actorUserId: user.id })).toMatchObject({
      actorUserId: user.id,
    });
    const again = await totp(mfaCookie, { code });
    expect(again.status).toBe(401);
    expect((await again.json()).error.code).toBe('AUTH_MFA_EXPIRED');
  });

  it('R4 rejects a replayed code on a fresh challenge', async () => {
    const secret = generateTotpSecret();
    const { email } = await createUser(t.db, { totpSecret: secret });
    const first =
      cookieFrom(
        await call(t.app, 'POST', '/api/auth/login', {
          body: { email, password: DEFAULT_PASSWORD },
        }),
        '__Host-mfa',
      ) ?? '';
    const code = generateTotpCode(secret, t.clock.now);
    expect((await totp(first, { code })).status).toBe(200);
    const second =
      cookieFrom(
        await call(t.app, 'POST', '/api/auth/login', {
          body: { email, password: DEFAULT_PASSWORD },
        }),
        '__Host-mfa',
      ) ?? '';
    const replay = await totp(second, { code });
    expect(replay.status).toBe(401);
    expect((await replay.json()).error.code).toBe('AUTH_TOTP_INVALID');
  });

  it('counts failures, expires the challenge on the third and audits each', async () => {
    const { user, mfaCookie } = await challenge();
    const first = await totp(mfaCookie, { code: '000000' });
    expect((await first.json()).error.code).toBe('AUTH_TOTP_INVALID');
    expect(
      await lastAudit(t.db, 'auth.login.totp_failure', { actorUserId: user.id }),
    ).toMatchObject({ actorUserId: user.id });
    expect((await (await totp(mfaCookie, { code: '000000' })).json()).error.code).toBe(
      'AUTH_TOTP_INVALID',
    );
    const third = await totp(mfaCookie, { code: '000000' });
    expect((await third.json()).error.code).toBe('AUTH_MFA_EXPIRED');
    expect(setCookieLine(third, '__Host-mfa')).toContain('Max-Age=0');
  });

  it('answers AUTH_MFA_EXPIRED without a cookie or after 5 minutes', async () => {
    expect((await (await totp('', { code: '123456' })).json()).error.code).toBe('AUTH_MFA_EXPIRED');
    const { mfaCookie } = await challenge();
    await t.redis.del(
      `mfa:${(await t.mfa.getChallenge(mfaCookie.replace('__Host-mfa=', '')))?.id ?? ''}`,
    );
    expect((await (await totp(mfaCookie, { code: '123456' })).json()).error.code).toBe(
      'AUTH_MFA_EXPIRED',
    );
  });

  it('RFC-24 R3 limits 5 attempts per challenge', async () => {
    const { mfaCookie } = await challenge();
    // three failures expire the challenge; the limiter is keyed by the challenge id and still counts
    for (let i = 0; i < 5; i++) await totp(mfaCookie, { code: '000000' });
    expect((await totp(mfaCookie, { code: '000000' })).status).toBe(429);
  });
});
