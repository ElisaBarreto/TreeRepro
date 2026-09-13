import type { PermissionKey } from '@treerepro/contracts';
import type { IconName } from '../ui/Icon.tsx';

export type NavSection = 'data' | 'curation' | 'admin' | 'account';

export interface NavEntry {
  to: string;
  label: string;
  icon: IconName;
  /** Rendered only when the session holds this permission. */
  permission?: PermissionKey;
  /**
   * Group in the sidebar, in the order of `NAV_SECTIONS`; entries without
   * one come first. `admin` is also gated by admin.access.
   */
  section?: NavSection;
  /** Search params the link carries (typed loosely; the target route validates them). */
  search?: Record<string, unknown>;
}

/**
 * Sidebar groups in display order; a `null` label is a gap without a heading.
 * @rfc RFC-13 R3
 */
export const NAV_SECTIONS: readonly { key: NavSection; label: string | null }[] = [
  { key: 'data', label: 'Data' },
  { key: 'curation', label: 'Curation' },
  { key: 'admin', label: 'Admin' },
  { key: 'account', label: null },
];

/**
 * Every navigation entry of the workspace. Other plans append here; the
 * shell filters by permission (RFC-13 R3).
 * @rfc RFC-13 R3
 * @rfc RFC-65 R8, R10
 */
export const NAV_ENTRIES: readonly NavEntry[] = [
  { to: '/app', label: 'Workspace', icon: 'home' },
  {
    to: '/app/species',
    label: 'Species',
    icon: 'leaf',
    permission: 'dataset.read',
    section: 'data',
  },
  { to: '/app/traits', label: 'Traits', icon: 'list', permission: 'dataset.read', section: 'data' },
  {
    to: '/app/references',
    label: 'References',
    icon: 'book',
    permission: 'dataset.read',
    section: 'data',
  },
  {
    to: '/app/imports',
    label: 'Imports',
    icon: 'upload',
    permission: 'imports.read',
    section: 'data',
  },
  {
    to: '/app/curation/pending',
    label: 'Pending',
    icon: 'clipboard',
    permission: 'dataset.read',
    section: 'curation',
  },
  {
    to: '/app/curation/disputed',
    label: 'Disputed',
    icon: 'alert',
    permission: 'dataset.read',
    section: 'curation',
  },
  {
    to: '/app/species',
    label: 'Unresolved taxa',
    icon: 'leaf',
    permission: 'dataset.read',
    section: 'curation',
    search: { unresolved: true },
  },
  {
    to: '/app/admin/users',
    label: 'Users',
    icon: 'users',
    permission: 'users.read',
    section: 'admin',
  },
  {
    to: '/app/admin/roles',
    label: 'Roles',
    icon: 'shield',
    permission: 'roles.read',
    section: 'admin',
  },
  {
    to: '/app/admin/audit',
    label: 'Audit',
    icon: 'clipboard',
    permission: 'audit.read',
    section: 'admin',
  },
  { to: '/app/settings', label: 'Settings', icon: 'sliders', section: 'account' },
];

/**
 * The entry a pathname belongs to: the longest `to` that is the path or a
 * prefix of it at a segment boundary, so `/app/species/<id>` is Species and
 * `/app` alone is Workspace. Two entries may share a `to` (Species and
 * Unresolved taxa, which differ only in search params); the first wins.
 * @rfc RFC-13 R3
 */
export function currentEntry(pathname: string): NavEntry | undefined {
  let best: NavEntry | undefined;
  for (const entry of NAV_ENTRIES) {
    const match = pathname === entry.to || pathname.startsWith(`${entry.to}/`);
    if (match && (!best || entry.to.length > best.to.length)) best = entry;
  }
  return best;
}
