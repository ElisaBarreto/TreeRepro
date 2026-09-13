import type { PermissionKey } from '@treerepro/contracts';

export interface NavEntry {
  to: string;
  label: string;
  /** Rendered only when the session holds this permission. */
  permission?: PermissionKey;
  /** `admin` entries sit under the Admin heading, itself gated by admin.access. */
  section?: 'admin';
}

/**
 * Every navigation entry of the workspace. Other plans append here; the
 * shell filters by permission (RFC-13 R3).
 * @rfc RFC-13 R3
 */
export const NAV_ENTRIES: readonly NavEntry[] = [
  { to: '/app', label: 'Workspace' },
  { to: '/app/settings', label: 'Settings' },
  { to: '/app/admin/users', label: 'Users', permission: 'users.read', section: 'admin' },
  { to: '/app/admin/roles', label: 'Roles', permission: 'roles.read', section: 'admin' },
  { to: '/app/admin/audit', label: 'Audit', permission: 'audit.read', section: 'admin' },
  { to: '/app/species', label: 'Species', permission: 'dataset.read' },
  { to: '/app/traits', label: 'Traits', permission: 'dataset.read' },
  { to: '/app/references', label: 'References', permission: 'dataset.read' },
  { to: '/app/imports', label: 'Imports', permission: 'imports.read' },
];
