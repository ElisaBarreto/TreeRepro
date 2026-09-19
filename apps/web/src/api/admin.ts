import type {
  AuditLogEntry,
  CreateRoleBody,
  CreateUserBody,
  DataEnvelope,
  PermissionEntry,
  PlatformHealth,
  Role,
  SessionSummary,
  SetUserPlotsBody,
  UpdateRoleBody,
  UpdateUserBody,
  User,
  UserStatus,
} from '@treerepro/contracts';
import { apiFetch } from './client.ts';
import type { Page } from './dataset.ts';
import { type QueryParams, withQuery } from './query.ts';

/** Query keys of the admin pages; every fetcher below owns one. @rfc RFC-50 R2 */
export const adminKeys = {
  users: (params: QueryParams) => ['admin', 'users', params] as const,
  user: (id: string) => ['admin', 'users', id] as const,
  userSessions: (id: string) => ['admin', 'users', id, 'sessions'] as const,
  roles: ['admin', 'roles'] as const,
  permissions: ['admin', 'permissions'] as const,
  audit: (params: QueryParams) => ['admin', 'audit', params] as const,
  health: ['admin', 'health'] as const,
};

/** @rfc RFC-50 R2 */
export function listUsers(params: {
  status?: UserStatus;
  cursor?: string;
  limit?: number;
}): Promise<Page<User>> {
  return apiFetch<Page<User>>(withQuery('/admin/users', params));
}
/** @rfc RFC-50 R4 */
export async function fetchUser(id: string): Promise<User> {
  const { data } = await apiFetch<DataEnvelope<User>>(`/admin/users/${id}`);
  return data;
}
/** @rfc RFC-50 R3 */
export async function inviteUser(body: CreateUserBody): Promise<User> {
  const { data } = await apiFetch<DataEnvelope<User>>('/admin/users', {
    method: 'POST',
    json: body,
  });
  return data;
}
/** @rfc RFC-50 R5 */
export async function updateUser(id: string, body: UpdateUserBody): Promise<User> {
  const { data } = await apiFetch<DataEnvelope<User>>(`/admin/users/${id}`, {
    method: 'PATCH',
    json: body,
  });
  return data;
}
/** @rfc RFC-50 R6 */
export async function suspendUser(id: string): Promise<User> {
  const { data } = await apiFetch<DataEnvelope<User>>(`/admin/users/${id}/suspend`, {
    method: 'POST',
  });
  return data;
}
/** @rfc RFC-50 R7 */
export async function reactivateUser(id: string): Promise<User> {
  const { data } = await apiFetch<DataEnvelope<User>>(`/admin/users/${id}/reactivate`, {
    method: 'POST',
  });
  return data;
}
/** @rfc RFC-50 R8 */
export async function resendInvite(id: string): Promise<User> {
  const { data } = await apiFetch<DataEnvelope<User>>(`/admin/users/${id}/resend-invite`, {
    method: 'POST',
  });
  return data;
}
/** @rfc RFC-50 R9 */
export async function listUserSessions(id: string): Promise<SessionSummary[]> {
  const { data } = await apiFetch<DataEnvelope<SessionSummary[]>>(`/admin/users/${id}/sessions`);
  return data;
}
/** @rfc RFC-50 R9 */
export async function revokeUserSession(id: string, sessionId: string): Promise<void> {
  await apiFetch(`/admin/users/${id}/sessions/${sessionId}`, { method: 'DELETE' });
}
/** @rfc RFC-50 R9 */
export async function revokeAllUserSessions(id: string): Promise<void> {
  await apiFetch(`/admin/users/${id}/sessions`, { method: 'DELETE' });
}
/** @rfc RFC-50 R10 */
export async function listRoles(): Promise<Role[]> {
  const { data } = await apiFetch<DataEnvelope<Role[]>>('/admin/roles');
  return data;
}
/** @rfc RFC-50 R10 */
export async function createRole(body: CreateRoleBody): Promise<Role> {
  const { data } = await apiFetch<DataEnvelope<Role>>('/admin/roles', {
    method: 'POST',
    json: body,
  });
  return data;
}
/** @rfc RFC-50 R10 */
export async function updateRole(id: string, body: UpdateRoleBody): Promise<Role> {
  const { data } = await apiFetch<DataEnvelope<Role>>(`/admin/roles/${id}`, {
    method: 'PATCH',
    json: body,
  });
  return data;
}
/** @rfc RFC-50 R10 */
export async function deleteRole(id: string): Promise<void> {
  await apiFetch(`/admin/roles/${id}`, { method: 'DELETE' });
}
/** @rfc RFC-30 R5 */
export async function listPermissions(): Promise<PermissionEntry[]> {
  const { data } = await apiFetch<DataEnvelope<PermissionEntry[]>>('/admin/permissions');
  return data;
}
/** @rfc RFC-51 R1 */
export function queryAudit(params: {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}): Promise<Page<AuditLogEntry>> {
  return apiFetch<Page<AuditLogEntry>>(withQuery('/admin/audit', params));
}

/** @rfc RFC-67 R6 */
export async function setUserPlots(id: string, body: SetUserPlotsBody): Promise<User> {
  const { data } = await apiFetch<DataEnvelope<User>>(`/admin/users/${id}/plots`, {
    method: 'PUT',
    json: body,
  });
  return data;
}

/** @rfc RFC-52 R1 */
export async function fetchPlatformHealth(): Promise<PlatformHealth> {
  const { data } = await apiFetch<DataEnvelope<PlatformHealth>>('/admin/health');
  return data;
}
