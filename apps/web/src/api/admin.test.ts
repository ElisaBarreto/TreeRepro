import { describe, expect, it } from 'vitest';
import {
  ADMIN_SESSION,
  ADMIN_USER,
  AUDIT_ENTRY,
  INVITED_USER,
  PERMISSION_ENTRIES,
  ROLE_READERS,
} from '../test/admin-fixtures.ts';
import { installFetchMock, lastRequest, mockJson } from '../test/fetch.ts';
import { PLATFORM_HEALTH } from '../test/health-fixtures.ts';
import {
  adminKeys,
  createRole,
  deleteRole,
  fetchPlatformHealth,
  fetchUser,
  inviteUser,
  listPermissions,
  listRoles,
  listUserSessions,
  listUsers,
  queryAudit,
  reactivateUser,
  resendInvite,
  revokeAllUserSessions,
  revokeUserSession,
  suspendUser,
  updateRole,
  updateUser,
} from './admin.ts';

installFetchMock();

describe('RFC-50 R2-R4 users', () => {
  it('listUsers sends status, cursor and limit and returns the page', async () => {
    mockJson(200, { data: [ADMIN_USER], meta: { nextCursor: 'c1' } });
    const result = await listUsers({ status: 'active', cursor: 'c0', limit: 25 });
    expect(result).toEqual({ data: [ADMIN_USER], meta: { nextCursor: 'c1' } });
    expect(lastRequest().url).toBe('/api/admin/users?status=active&cursor=c0&limit=25');
    expect(lastRequest().init?.method).toBe('GET');
  });

  it('listUsers without filters asks for the bare path', async () => {
    mockJson(200, { data: [], meta: { nextCursor: null } });
    await listUsers({});
    expect(lastRequest().url).toBe('/api/admin/users');
  });

  it('fetchUser gets /admin/users/<id>; inviteUser posts the body', async () => {
    mockJson(200, { data: INVITED_USER });
    await expect(fetchUser(INVITED_USER.id)).resolves.toEqual(INVITED_USER);
    expect(lastRequest().url).toBe(`/api/admin/users/${INVITED_USER.id}`);

    mockJson(201, { data: INVITED_USER });
    const body = { email: 'bea@example.org', name: 'Bea', roles: [INVITED_USER.id] };
    await expect(inviteUser(body)).resolves.toEqual(INVITED_USER);
    expect(lastRequest().init?.method).toBe('POST');
    expect(JSON.parse(String(lastRequest().init?.body))).toEqual(body);
  });
});

describe('RFC-50 R5-R8 user writes', () => {
  it('updateUser patches name and roles', async () => {
    mockJson(200, { data: ADMIN_USER });
    await updateUser(ADMIN_USER.id, { name: 'Ada L.', roles: [ROLE_READERS.id] });
    expect(lastRequest().init?.method).toBe('PATCH');
    expect(lastRequest().url).toBe(`/api/admin/users/${ADMIN_USER.id}`);
    expect(JSON.parse(String(lastRequest().init?.body))).toEqual({
      name: 'Ada L.',
      roles: [ROLE_READERS.id],
    });
  });

  it.each([
    ['suspend', suspendUser],
    ['reactivate', reactivateUser],
    ['resend-invite', resendInvite],
  ])('%s posts to the action path and returns the user', async (action, fn) => {
    mockJson(200, { data: ADMIN_USER });
    await expect(fn(ADMIN_USER.id)).resolves.toEqual(ADMIN_USER);
    expect(lastRequest().init?.method).toBe('POST');
    expect(lastRequest().url).toBe(`/api/admin/users/${ADMIN_USER.id}/${action}`);
  });
});

describe('RFC-50 R9 sessions of a user', () => {
  it('lists, revokes one, revokes all', async () => {
    mockJson(200, { data: [ADMIN_SESSION] });
    await expect(listUserSessions(ADMIN_USER.id)).resolves.toEqual([ADMIN_SESSION]);
    expect(lastRequest().url).toBe(`/api/admin/users/${ADMIN_USER.id}/sessions`);

    mockJson(200, { data: { status: 'ok' } });
    await expect(revokeUserSession(ADMIN_USER.id, ADMIN_SESSION.id)).resolves.toBeUndefined();
    expect(lastRequest().init?.method).toBe('DELETE');
    expect(lastRequest().url).toBe(
      `/api/admin/users/${ADMIN_USER.id}/sessions/${ADMIN_SESSION.id}`,
    );

    mockJson(200, { data: { status: 'ok' } });
    await expect(revokeAllUserSessions(ADMIN_USER.id)).resolves.toBeUndefined();
    expect(lastRequest().init?.method).toBe('DELETE');
    expect(lastRequest().url).toBe(`/api/admin/users/${ADMIN_USER.id}/sessions`);
  });
});

describe('RFC-50 R10, RFC-30 R5 roles and permissions', () => {
  it('lists, creates, updates, deletes roles; lists the catalog', async () => {
    mockJson(200, { data: [ROLE_READERS] });
    await expect(listRoles()).resolves.toEqual([ROLE_READERS]);
    expect(lastRequest().url).toBe('/api/admin/roles');

    mockJson(201, { data: ROLE_READERS });
    await expect(
      createRole({ name: 'Readers', description: '', permissions: ['users.read'] }),
    ).resolves.toEqual(ROLE_READERS);
    expect(lastRequest().init?.method).toBe('POST');

    mockJson(200, { data: ROLE_READERS });
    await updateRole(ROLE_READERS.id, { description: 'x' });
    expect(lastRequest().init?.method).toBe('PATCH');
    expect(lastRequest().url).toBe(`/api/admin/roles/${ROLE_READERS.id}`);

    mockJson(200, { data: { status: 'ok' } });
    await expect(deleteRole(ROLE_READERS.id)).resolves.toBeUndefined();
    expect(lastRequest().init?.method).toBe('DELETE');

    mockJson(200, { data: PERMISSION_ENTRIES });
    await expect(listPermissions()).resolves.toEqual(PERMISSION_ENTRIES);
    expect(lastRequest().url).toBe('/api/admin/permissions');
  });
});

describe('RFC-51 R1 audit', () => {
  it('queryAudit sends only the defined filters', async () => {
    mockJson(200, { data: [AUDIT_ENTRY], meta: { nextCursor: null } });
    const result = await queryAudit({
      action: 'users.created',
      from: '2026-09-01T00:00:00.000Z',
      limit: 50,
    });
    expect(result.data).toEqual([AUDIT_ENTRY]);
    expect(lastRequest().url).toBe(
      '/api/admin/audit?action=users.created&from=2026-09-01T00%3A00%3A00.000Z&limit=50',
    );
  });

  it('adminKeys share the ["admin"] prefix', () => {
    expect(adminKeys.users({ status: 'active' })).toEqual(['admin', 'users', { status: 'active' }]);
    expect(adminKeys.user('u1')).toEqual(['admin', 'users', 'u1']);
    expect(adminKeys.userSessions('u1')).toEqual(['admin', 'users', 'u1', 'sessions']);
    expect(adminKeys.roles).toEqual(['admin', 'roles']);
    expect(adminKeys.permissions).toEqual(['admin', 'permissions']);
    expect(adminKeys.audit({ action: 'x' })).toEqual(['admin', 'audit', { action: 'x' }]);
    expect(adminKeys.health).toEqual(['admin', 'health']);
  });
});

describe('RFC-52 R1 platform health', () => {
  it('fetchPlatformHealth gets /admin/health and returns the payload', async () => {
    mockJson(200, { data: PLATFORM_HEALTH });
    await expect(fetchPlatformHealth()).resolves.toEqual(PLATFORM_HEALTH);
    expect(lastRequest().url).toBe('/api/admin/health');
    expect(lastRequest().init?.method ?? 'GET').toBe('GET');
  });

  it('fetchPlatformHealth rejects a malformed payload instead of returning it', async () => {
    mockJson(200, {
      data: { ...PLATFORM_HEALTH, users: { ...PLATFORM_HEALTH.users, active: 'twelve' } },
    });
    await expect(fetchPlatformHealth()).rejects.toThrow();
  });
});
