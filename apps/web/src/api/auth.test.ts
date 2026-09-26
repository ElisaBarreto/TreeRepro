import { describe, expect, it } from 'vitest';
import { installFetchMock, lastRequest, mockJson } from '../test/fetch.ts';
import { USER } from '../test/fixtures.ts';
import {
  acceptInvite,
  changePassword,
  fetchMe,
  forgotPassword,
  login,
  loginTotp,
  logout,
  logoutAll,
  resetPassword,
  totpConfirm,
  totpDisable,
  totpSetup,
} from './auth.ts';

installFetchMock();

describe('RFC-22 R2-R3 login', () => {
  it('posts email and password and unwraps the data envelope', async () => {
    mockJson(200, { data: { status: 'ok', user: USER } });
    const result = await login({ email: 'ada@example.org', password: 'hunter2hunter2' });
    expect(result).toEqual({ status: 'ok', user: USER });
    const { url, init } = lastRequest();
    expect(url).toBe('/api/auth/login');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'ada@example.org',
      password: 'hunter2hunter2',
    });
  });

  it('passes the totp_required answer through', async () => {
    mockJson(200, { data: { status: 'totp_required' } });
    expect(await login({ email: 'ada@example.org', password: 'x' })).toEqual({
      status: 'totp_required',
    });
  });
});

describe('RFC-23 R6 loginTotp', () => {
  it('sends a six-digit code as { code }', async () => {
    mockJson(200, { data: { status: 'ok', user: USER } });
    expect(await loginTotp('123456')).toEqual({ status: 'ok', user: USER });
    const { url, init } = lastRequest();
    expect(url).toBe('/api/auth/login/totp');
    expect(JSON.parse(String(init?.body))).toEqual({ code: '123456' });
  });

  it('sends anything else as { recoveryCode }, trimmed', async () => {
    mockJson(200, { data: { status: 'ok', user: USER } });
    await loginTotp(' abcde-fghij ');
    const { init } = lastRequest();
    expect(JSON.parse(String(init?.body))).toEqual({ recoveryCode: 'abcde-fghij' });
  });
});

describe('RFC-22 R9-R10 session helpers', () => {
  it('fetchMe reads GET /auth/me', async () => {
    const me = { user: USER, permissions: ['roles.read'], scope: { plots: [], restricted: false } };
    mockJson(200, { data: me });
    expect(await fetchMe()).toEqual(me);
    const { url, init } = lastRequest();
    expect(url).toBe('/api/auth/me');
    expect(init?.method).toBe('GET');
  });

  it('logout posts to /auth/logout', async () => {
    mockJson(200, { data: { status: 'ok' } });
    await logout();
    const { url, init } = lastRequest();
    expect(url).toBe('/api/auth/logout');
    expect(init?.method).toBe('POST');
  });
});

describe('RFC-20 R6, RFC-21 R5-R6 invitation and password recovery calls', () => {
  it('acceptInvite posts token and password and returns the user', async () => {
    mockJson(200, { data: { user: USER } });
    await expect(acceptInvite('t'.repeat(43), 'a long enough passphrase')).resolves.toEqual(USER);
    expect(lastRequest().url).toBe('/api/auth/invite/accept');
    expect(JSON.parse(String(lastRequest().init?.body))).toEqual({
      token: 't'.repeat(43),
      password: 'a long enough passphrase',
    });
  });

  it('forgotPassword and resetPassword post their bodies', async () => {
    mockJson(200, { data: { status: 'sent' } });
    await forgotPassword('ada@example.org');
    expect(JSON.parse(String(lastRequest().init?.body))).toEqual({ email: 'ada@example.org' });
    mockJson(200, { data: { status: 'ok' } });
    await resetPassword('t'.repeat(43), 'a long enough passphrase');
    expect(lastRequest().url).toBe('/api/auth/password/reset');
    expect(JSON.parse(String(lastRequest().init?.body))).toEqual({
      token: 't'.repeat(43),
      newPassword: 'a long enough passphrase',
    });
  });
});

describe('RFC-21 R7 changePassword', () => {
  it('posts both passwords', async () => {
    mockJson(200, { data: { status: 'ok' } });
    await changePassword('old passphrase here', 'new passphrase here!');
    expect(lastRequest().url).toBe('/api/auth/password/change');
    expect(JSON.parse(String(lastRequest().init?.body))).toEqual({
      currentPassword: 'old passphrase here',
      newPassword: 'new passphrase here!',
    });
  });
});

describe('RFC-23 R2, R3, R7 TOTP calls; RFC-22 R9 logoutAll', () => {
  it('setup returns secret and uri; confirm returns the recovery codes; disable and logoutAll post', async () => {
    mockJson(200, { data: { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x' } });
    await expect(totpSetup('pw')).resolves.toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/x',
    });
    expect(JSON.parse(String(lastRequest().init?.body))).toEqual({ password: 'pw' });
    mockJson(200, {
      data: { recoveryCodes: Array.from({ length: 10 }, (_, i) => `abcde-fghi${i}`) },
    });
    await expect(totpConfirm('123456')).resolves.toHaveLength(10);
    expect(JSON.parse(String(lastRequest().init?.body))).toEqual({ code: '123456' });
    mockJson(200, { data: { status: 'ok' } });
    await totpDisable({ password: 'pw', code: '123456' });
    expect(lastRequest().url).toBe('/api/auth/totp/disable');
    mockJson(200, { data: { status: 'ok' } });
    await logoutAll();
    expect(lastRequest().url).toBe('/api/auth/logout-all');
  });
});
