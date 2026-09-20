import {
  type AuditLogEntry,
  auditLogEntrySchema,
  type CreateRoleBody,
  type CreateUserBody,
  dataEnvelopeSchema,
  listEnvelopeSchema,
  okStatusSchema,
  type PermissionEntry,
  type PlatformHealth,
  permissionEntrySchema,
  platformHealthSchema,
  type Role,
  roleSchema,
  type SessionSummary,
  type SetUserPlotsBody,
  sessionSummarySchema,
  type UpdateRoleBody,
  type UpdateUserBody,
  type User,
  type UserStatus,
  userSchema,
} from '@treerepro/contracts';
import { z } from 'zod';
import { apiFetch } from './client.ts';
import type { Page } from './dataset.ts';
import { type QueryParams, withQuery } from './query.ts';

const userEnvelope = dataEnvelopeSchema(userSchema);
const roleEnvelope = dataEnvelopeSchema(roleSchema);
const okEnvelope = dataEnvelopeSchema(okStatusSchema);

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
  return apiFetch(withQuery('/admin/users', params), listEnvelopeSchema(userSchema));
}
/** @rfc RFC-50 R4 */
export async function fetchUser(id: string): Promise<User> {
  const { data } = await apiFetch(`/admin/users/${id}`, userEnvelope);
  return data;
}
/** @rfc RFC-50 R3 */
export async function inviteUser(body: CreateUserBody): Promise<User> {
  const { data } = await apiFetch('/admin/users', userEnvelope, { method: 'POST', json: body });
  return data;
}
/** @rfc RFC-50 R5 */
export async function updateUser(id: string, body: UpdateUserBody): Promise<User> {
  const { data } = await apiFetch(`/admin/users/${id}`, userEnvelope, {
    method: 'PATCH',
    json: body,
  });
  return data;
}
/** @rfc RFC-50 R6 */
export async function suspendUser(id: string): Promise<User> {
  const { data } = await apiFetch(`/admin/users/${id}/suspend`, userEnvelope, {
    method: 'POST',
  });
  return data;
}
/** @rfc RFC-50 R7 */
export async function reactivateUser(id: string): Promise<User> {
  const { data } = await apiFetch(`/admin/users/${id}/reactivate`, userEnvelope, {
    method: 'POST',
  });
  return data;
}
/** @rfc RFC-50 R8 */
export async function resendInvite(id: string): Promise<User> {
  const { data } = await apiFetch(`/admin/users/${id}/resend-invite`, userEnvelope, {
    method: 'POST',
  });
  return data;
}
/** @rfc RFC-50 R9 */
export async function listUserSessions(id: string): Promise<SessionSummary[]> {
  const { data } = await apiFetch(
    `/admin/users/${id}/sessions`,
    dataEnvelopeSchema(z.array(sessionSummarySchema)),
  );
  return data;
}
/** @rfc RFC-50 R9 */
export async function revokeUserSession(id: string, sessionId: string): Promise<void> {
  await apiFetch(`/admin/users/${id}/sessions/${sessionId}`, okEnvelope, { method: 'DELETE' });
}
/** @rfc RFC-50 R9 */
export async function revokeAllUserSessions(id: string): Promise<void> {
  await apiFetch(`/admin/users/${id}/sessions`, okEnvelope, { method: 'DELETE' });
}
/** @rfc RFC-50 R10 */
export async function listRoles(): Promise<Role[]> {
  const { data } = await apiFetch('/admin/roles', dataEnvelopeSchema(z.array(roleSchema)));
  return data;
}
/** @rfc RFC-50 R10 */
export async function createRole(body: CreateRoleBody): Promise<Role> {
  const { data } = await apiFetch('/admin/roles', roleEnvelope, { method: 'POST', json: body });
  return data;
}
/** @rfc RFC-50 R10 */
export async function updateRole(id: string, body: UpdateRoleBody): Promise<Role> {
  const { data } = await apiFetch(`/admin/roles/${id}`, roleEnvelope, {
    method: 'PATCH',
    json: body,
  });
  return data;
}
/** @rfc RFC-50 R10 */
export async function deleteRole(id: string): Promise<void> {
  await apiFetch(`/admin/roles/${id}`, okEnvelope, { method: 'DELETE' });
}
/** @rfc RFC-30 R5 */
export async function listPermissions(): Promise<PermissionEntry[]> {
  const { data } = await apiFetch(
    '/admin/permissions',
    dataEnvelopeSchema(z.array(permissionEntrySchema)),
  );
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
  return apiFetch(withQuery('/admin/audit', params), listEnvelopeSchema(auditLogEntrySchema));
}

/** @rfc RFC-67 R6 */
export async function setUserPlots(id: string, body: SetUserPlotsBody): Promise<User> {
  const { data } = await apiFetch(`/admin/users/${id}/plots`, userEnvelope, {
    method: 'PUT',
    json: body,
  });
  return data;
}

/**
 * `HealthPage` reads deep into this shape (`health.data.users.active` and
 * further) on first render; `apiFetch`'s parse rejects a malformed or
 * partial response before it gets there, which TanStack Query turns into
 * `health.error`, the page's existing `Alert tone="error"` path.
 * @rfc RFC-52 R1
 */
export async function fetchPlatformHealth(): Promise<PlatformHealth> {
  const { data } = await apiFetch('/admin/health', dataEnvelopeSchema(platformHealthSchema));
  return data;
}
