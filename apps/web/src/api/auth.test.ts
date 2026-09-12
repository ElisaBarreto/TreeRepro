import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMe, login, loginTotp, logout } from './auth.ts';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const user = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e',
  email: 'ada@example.org',
  name: 'Ada',
  status: 'active',
  totpEnabled: false,
  createdAt: '2026-09-12T00:00:00.000Z',
};

const fetchMock = vi.fn<typeof fetch>();
const lastCall = () => fetchMock.mock.calls[0] as [string, RequestInit];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('RFC-22 R2-R3 login', () => {
  it('posts email and password and unwraps the data envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { status: 'ok', user } }));
    const result = await login({ email: 'ada@example.org', password: 'hunter2hunter2' });
    expect(result).toEqual({ status: 'ok', user });
    const [url, init] = lastCall();
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'ada@example.org',
      password: 'hunter2hunter2',
    });
  });

  it('passes the totp_required answer through', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { status: 'totp_required' } }));
    expect(await login({ email: 'ada@example.org', password: 'x' })).toEqual({
      status: 'totp_required',
    });
  });
});

describe('RFC-23 R6 loginTotp', () => {
  it('sends a six-digit code as { code }', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { status: 'ok', user } }));
    expect(await loginTotp('123456')).toEqual({ status: 'ok', user });
    const [url, init] = lastCall();
    expect(url).toBe('/api/auth/login/totp');
    expect(JSON.parse(init.body as string)).toEqual({ code: '123456' });
  });

  it('sends anything else as { recoveryCode }, trimmed', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { status: 'ok', user } }));
    await loginTotp(' abcde-fghij ');
    const [, init] = lastCall();
    expect(JSON.parse(init.body as string)).toEqual({ recoveryCode: 'abcde-fghij' });
  });
});

describe('RFC-22 R9-R10 session helpers', () => {
  it('fetchMe reads GET /auth/me', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { user, permissions: ['roles.read'] } }));
    expect(await fetchMe()).toEqual({ user, permissions: ['roles.read'] });
    const [url, init] = lastCall();
    expect(url).toBe('/api/auth/me');
    expect(init.method).toBe('GET');
  });

  it('logout posts to /auth/logout', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { status: 'ok' } }));
    await logout();
    const [url, init] = lastCall();
    expect(url).toBe('/api/auth/logout');
    expect(init.method).toBe('POST');
  });
});
