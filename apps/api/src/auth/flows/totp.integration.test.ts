import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, cookieFrom, useTestApp } from '../../../test/helpers/app.ts';
import { lastAudit } from '../../../test/helpers/audit.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser, DEFAULT_PASSWORD } from '../../../test/helpers/users.ts';
import { totpRecoveryCodes } from '../../db/schema/totp-recovery-codes.ts';
import { generateTotpCode } from '../totp.ts';
import { findUserById } from '../users.ts';

describe('RFC-23 R2, R3 TOTP enrolment', () => {
  const t = useTestApp();

  async function enrolled() {
    const { user, email } = await createUser(t.db);
    const { cookie } = await loginAs(t, user);
    const setup = await call(t.app, 'POST', '/api/auth/totp/setup', {
      cookie,
      body: { password: DEFAULT_PASSWORD },
    });
    const { secret } = (await setup.json()).data;
    const confirm = await call(t.app, 'POST', '/api/auth/totp/confirm', {
      cookie,
      body: { code: generateTotpCode(secret, t.clock.now) },
    });
    const { recoveryCodes } = (await confirm.json()).data as { recoveryCodes: string[] };
    return { user, email, cookie, secret, recoveryCodes };
  }

  it('setup returns a secret and URI, stores the provisional secret encrypted, and refuses when enabled', async () => {
    const { user, email } = await createUser(t.db);
    const { cookie } = await loginAs(t, user);
    const res = await call(t.app, 'POST', '/api/auth/totp/setup', {
      cookie,
      body: { password: DEFAULT_PASSWORD },
    });
    expect(res.status).toBe(200);
    const { secret, otpauthUri } = (await res.json()).data;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri).toContain(`otpauth://totp/TreeRepro:${encodeURIComponent(email)}?`);
    expect(await t.redis.get(`totp_setup:${user.id}`)).not.toBe(secret);
    expect(await t.mfa.getSetupSecret(user.id)).toBe(secret);
    expect((await findUserById(t.db, user.id))?.totpEnabledAt).toBeNull();
  });

  it('setup needs the current password: a wrong one is 401 and stores nothing', async () => {
    const { user } = await createUser(t.db);
    const { cookie } = await loginAs(t, user);
    const wrong = await call(t.app, 'POST', '/api/auth/totp/setup', {
      cookie,
      body: { password: 'wrong wrong wrong' },
    });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(await t.mfa.getSetupSecret(user.id)).toBeNull();
    const missing = await call(t.app, 'POST', '/api/auth/totp/setup', { cookie, body: {} });
    expect(missing.status).toBe(400);
  });

  it('confirm enables TOTP, returns ten recovery codes once and audits; wrong code or no setup is 401', async () => {
    const { user } = await createUser(t.db);
    const session = await loginAs(t, user);
    const noSetup = await call(t.app, 'POST', '/api/auth/totp/confirm', {
      cookie: session.cookie,
      body: { code: '123456' },
    });
    expect((await noSetup.json()).error.code).toBe('AUTH_TOTP_INVALID');
    const { secret } = (
      await (
        await call(t.app, 'POST', '/api/auth/totp/setup', {
          cookie: session.cookie,
          body: { password: DEFAULT_PASSWORD },
        })
      ).json()
    ).data;
    const wrong = await call(t.app, 'POST', '/api/auth/totp/confirm', {
      cookie: session.cookie,
      body: { code: '000000' },
    });
    expect(wrong.status).toBe(401);
    expect((await findUserById(t.db, user.id))?.totpEnabledAt).toBeNull();
    const ok = await call(t.app, 'POST', '/api/auth/totp/confirm', {
      cookie: session.cookie,
      body: { code: generateTotpCode(secret, t.clock.now) },
    });
    expect(ok.status).toBe(200);
    const { recoveryCodes } = (await ok.json()).data as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(10);
    for (const code of recoveryCodes) expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    const fresh = await findUserById(t.db, user.id);
    expect(fresh?.totpSecret).toBe(secret);
    expect(fresh?.totpEnabledAt).not.toBeNull();
    expect(await t.mfa.getSetupSecret(user.id)).toBeNull();
    const raw = await t.db.execute(sql`select totp_secret from users where id = ${user.id}`);
    expect((raw[0] as { totp_secret: string }).totp_secret).not.toBe(secret);
    expect(await lastAudit(t.db, 'auth.totp.enabled', { actorUserId: user.id })).toMatchObject({
      actorUserId: user.id,
    });
    const [count] = await t.db
      .select({ n: sql<number>`count(*)::int` })
      .from(totpRecoveryCodes)
      .where(eq(totpRecoveryCodes.userId, user.id));
    expect(count?.n).toBe(10);
    const again = await call(t.app, 'POST', '/api/auth/totp/setup', {
      cookie: session.cookie,
      body: { password: DEFAULT_PASSWORD },
    });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('AUTH_TOTP_ALREADY_ENABLED');
  });

  it('after enrolment, login needs the second step and a recovery code works once', async () => {
    const { user, email, recoveryCodes } = await enrolled();
    const login = await call(t.app, 'POST', '/api/auth/login', {
      body: { email, password: DEFAULT_PASSWORD },
    });
    expect((await login.json()).data).toEqual({ status: 'totp_required' });
    const mfa = cookieFrom(login, '__Host-mfa') ?? '';
    const ok = await call(t.app, 'POST', '/api/auth/login/totp', {
      cookie: mfa,
      body: { recoveryCode: recoveryCodes[0]?.toUpperCase() },
    });
    expect(ok.status).toBe(200);
    expect(
      await lastAudit(t.db, 'auth.totp.recovery_used', { actorUserId: user.id }),
    ).toMatchObject({ actorUserId: user.id });
    const login2 = await call(t.app, 'POST', '/api/auth/login', {
      body: { email, password: DEFAULT_PASSWORD },
    });
    const mfa2 = cookieFrom(login2, '__Host-mfa') ?? '';
    const reused = await call(t.app, 'POST', '/api/auth/login/totp', {
      cookie: mfa2,
      body: { recoveryCode: recoveryCodes[0] },
    });
    expect((await reused.json()).error.code).toBe('AUTH_TOTP_INVALID');
  });

  it('R7 disable needs the password and a code, clears everything and audits', async () => {
    const { user, email, cookie, secret, recoveryCodes } = await enrolled();
    const disable = (body: unknown) =>
      call(t.app, 'POST', '/api/auth/totp/disable', { cookie, body });
    expect(
      (
        await (
          await disable({
            password: 'wrong wrong wrong',
            code: generateTotpCode(secret, t.clock.now),
          })
        ).json()
      ).error.code,
    ).toBe('AUTH_INVALID_CREDENTIALS');
    expect(
      (await (await disable({ password: DEFAULT_PASSWORD, code: '000000' })).json()).error.code,
    ).toBe('AUTH_TOTP_INVALID');
    expect(
      (await disable({ password: DEFAULT_PASSWORD, recoveryCode: recoveryCodes[1] })).status,
    ).toBe(200);
    const fresh = await findUserById(t.db, user.id);
    expect(fresh?.totpSecret).toBeNull();
    expect(fresh?.totpEnabledAt).toBeNull();
    const [count] = await t.db
      .select({ n: sql<number>`count(*)::int` })
      .from(totpRecoveryCodes)
      .where(eq(totpRecoveryCodes.userId, user.id));
    expect(count?.n).toBe(0);
    expect(await lastAudit(t.db, 'auth.totp.disabled', { actorUserId: user.id })).toMatchObject({
      actorUserId: user.id,
    });
    const off = await disable({ password: DEFAULT_PASSWORD, code: '000000' });
    expect(off.status).toBe(409);
    expect((await off.json()).error.code).toBe('AUTH_TOTP_NOT_ENABLED');
    const login = await call(t.app, 'POST', '/api/auth/login', {
      body: { email, password: DEFAULT_PASSWORD },
    });
    expect((await login.json()).data.status).toBe('ok');
  });

  it('every TOTP route is 401 without a session', async () => {
    for (const path of [
      '/api/auth/totp/setup',
      '/api/auth/totp/confirm',
      '/api/auth/totp/disable',
    ]) {
      expect((await call(t.app, 'POST', path, { body: {} })).status).toBe(401);
    }
  });
});
