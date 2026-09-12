/**
 * The permission catalog: key → description. Mirrors the table in RFC-30.
 * @rfc RFC-30 R1, R2
 */
export const PERMISSIONS = {
  'users.read': 'List and view users',
  'users.invite': 'Invite users',
  'users.update': 'Edit user profiles and roles',
  'users.suspend': 'Suspend and reactivate users',
  'users.delete': 'Erase users (retired)',
  'roles.read': 'List roles and the permission catalog',
  'roles.manage': 'Create, edit and delete roles',
  'sessions.read': "List any user's sessions",
  'sessions.revoke': "Revoke any user's sessions",
  'audit.read': 'Read the audit log',
  'admin.access': 'Open the admin area',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

/** Catalog order. @rfc RFC-30 R2 */
export const PERMISSION_KEYS: readonly PermissionKey[] = Object.keys(
  PERMISSIONS,
) as PermissionKey[];

const keySet: ReadonlySet<string> = new Set(PERMISSION_KEYS);

/** @rfc RFC-30 R1 */
export function isPermissionKey(value: string): value is PermissionKey {
  return keySet.has(value);
}
