import { describe, expect, it } from 'vitest';
import { installFetchMock, lastRequest, mockJson } from '../test/fetch.ts';
import { USER } from '../test/fixtures.ts';
import { updateName } from './me.ts';

installFetchMock();

describe('RFC-50 R11 updateName', () => {
  it('patches /me and returns the user', async () => {
    mockJson(200, {
      data: { ...USER, name: 'Ada L.', roles: [], updatedAt: USER.createdAt, suspendedAt: null },
    });
    const user = await updateName('Ada L.');
    expect(user.name).toBe('Ada L.');
    expect(lastRequest().init?.method).toBe('PATCH');
    expect(lastRequest().url).toBe('/api/me');
  });
});
