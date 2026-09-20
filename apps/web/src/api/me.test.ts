import { describe, expect, it } from 'vitest';
import { ADMIN_USER } from '../test/admin-fixtures.ts';
import { installFetchMock, lastRequest, mockJson } from '../test/fetch.ts';
import { USER } from '../test/fixtures.ts';
import { listSessions, revokeSession, updateName } from './me.ts';

installFetchMock();

describe('RFC-50 R11 updateName', () => {
  it('patches /me and returns the user', async () => {
    mockJson(200, { data: { ...ADMIN_USER, name: 'Ada L.' } });
    const user = await updateName('Ada L.');
    expect(user.name).toBe('Ada L.');
    expect(lastRequest().init?.method).toBe('PATCH');
    expect(lastRequest().url).toBe('/api/me');
  });
});

describe('RFC-22 R11 sessions', () => {
  it('listSessions gets /me/sessions and returns the array', async () => {
    const sessions = [
      {
        id: 'a'.repeat(64),
        createdAt: USER.createdAt,
        lastSeenAt: USER.createdAt,
        ip: '203.0.113.1',
        userAgent: 'Firefox on macOS',
        current: true,
      },
    ];
    mockJson(200, { data: sessions });
    await expect(listSessions()).resolves.toEqual(sessions);
    expect(lastRequest().init?.method).toBe('GET');
    expect(lastRequest().url).toBe('/api/me/sessions');
  });

  it('revokeSession deletes /me/sessions/<id>', async () => {
    mockJson(200, { data: { status: 'ok' } });
    await expect(revokeSession('b'.repeat(64))).resolves.toBeUndefined();
    expect(lastRequest().init?.method).toBe('DELETE');
    expect(lastRequest().url).toBe(`/api/me/sessions/${'b'.repeat(64)}`);
  });
});
