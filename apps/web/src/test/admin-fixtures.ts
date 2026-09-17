import {
  type AuditLogEntry,
  PERMISSION_KEYS,
  PERMISSIONS,
  type PermissionEntry,
  type Role,
  type SessionSummary,
  type User,
} from '@treerepro/contracts';
import type { Page } from '../api/dataset.ts';
import { USER } from './fixtures.ts';

const AT = '2026-09-12T00:00:00.000Z';

/** @rfc RFC-01 R2 */
export const ROLE_ADMIN: Role = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8a01',
  name: 'admin',
  description: 'Every permission of the catalog',
  isSystem: true,
  permissions: [],
  createdAt: AT,
  updatedAt: AT,
};

/** The system `manager` role with its stored permissions. @rfc RFC-31 R2, R11 */
export const ROLE_MANAGER: Role = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8a04',
  name: 'manager',
  description: 'Runs imports and curation',
  isSystem: true,
  permissions: [
    'dataset.read',
    'dataset.read_inactive',
    'imports.read',
    'records.annotate',
    'records.create',
    'records.review',
    'records.withdraw',
  ],
  createdAt: AT,
  updatedAt: AT,
};

/** @rfc RFC-01 R2 */
export const ROLE_READERS: Role = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8a02',
  name: 'Readers',
  description: 'May list users',
  isSystem: false,
  permissions: ['users.read'],
  createdAt: AT,
  updatedAt: AT,
};

/** The signed-in administrator as the admin API represents them. @rfc RFC-01 R2 */
export const ADMIN_USER: User = {
  id: USER.id,
  email: USER.email,
  name: USER.name,
  status: 'active',
  totpEnabled: false,
  roles: [{ id: ROLE_ADMIN.id, name: ROLE_ADMIN.name }],
  plots: [],
  restrictToAssignedPlots: false,
  createdAt: AT,
  updatedAt: AT,
  suspendedAt: null,
};

/** @rfc RFC-01 R2 */
export const INVITED_USER: User = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e01',
  email: 'bea@example.org',
  name: 'Bea',
  status: 'invited',
  totpEnabled: false,
  roles: [],
  plots: [],
  restrictToAssignedPlots: false,
  createdAt: '2026-09-13T08:00:00.000Z',
  updatedAt: '2026-09-13T08:00:00.000Z',
  suspendedAt: null,
};

/** @rfc RFC-01 R2 */
export const SUSPENDED_USER: User = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e02',
  email: 'cid@example.org',
  name: 'Cid',
  status: 'suspended',
  totpEnabled: true,
  roles: [{ id: ROLE_READERS.id, name: ROLE_READERS.name }],
  plots: [],
  restrictToAssignedPlots: false,
  createdAt: '2026-09-11T08:00:00.000Z',
  updatedAt: '2026-09-13T09:00:00.000Z',
  suspendedAt: '2026-09-13T09:00:00.000Z',
};

/** The catalog as `GET /api/admin/permissions` answers it. @rfc RFC-01 R2 */
export const PERMISSION_ENTRIES: PermissionEntry[] = PERMISSION_KEYS.map((key) => ({
  key,
  description: PERMISSIONS[key],
}));

/** A session of another user (`current` is always false for an administrator). @rfc RFC-01 R2 */
export const ADMIN_SESSION: SessionSummary = {
  id: 'a'.repeat(64),
  createdAt: '2026-09-13T07:00:00.000Z',
  lastSeenAt: '2026-09-13T09:30:00.000Z',
  ip: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0',
  current: false,
};

/** @rfc RFC-01 R2 */
export const AUDIT_ENTRY: AuditLogEntry = {
  id: '019a0000-0000-7000-8000-000000000001',
  at: '2026-09-13T10:20:00.000Z',
  actorUserId: USER.id,
  action: 'users.created',
  targetType: 'user',
  targetId: INVITED_USER.id,
  ip: '203.0.113.1',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Safari/605.1.15',
  metadata: { fields: ['name'] },
};

/** One page of a cursor list. @rfc RFC-01 R2 */
export const page = <T>(data: T[], nextCursor: string | null = null): Page<T> => ({
  data,
  meta: { nextCursor },
});
