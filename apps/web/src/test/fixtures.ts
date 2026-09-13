import { type AuthUser, type MeResponse, PERMISSION_KEYS } from '@treerepro/contracts';

/** @rfc RFC-01 R2 */
export const USER = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e',
  email: 'ada@example.org',
  name: 'Ada',
  status: 'active',
  totpEnabled: false,
  createdAt: '2026-09-12T00:00:00.000Z',
} as const satisfies AuthUser;

/** A signed-in user without any permission. @rfc RFC-01 R2 */
export const ME: MeResponse = { user: USER, permissions: [] };

/** A signed-in administrator (every catalog key). @rfc RFC-01 R2 */
export const ADMIN_ME: MeResponse = { user: USER, permissions: [...PERMISSION_KEYS] };
