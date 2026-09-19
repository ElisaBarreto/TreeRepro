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
 * shell filters by permission (RFC-13 R3). Three of the Curation entries
 * require `records.review`: the queues are manager work (RFC-65 R8–R10,
 * RFC-31 R10). Coverage requires `coverage.read` instead (RFC-69 R5,
 * plan 11c) — a manager permission of its own, not the queues'. Proposals
 * requires `taxa.manage` (RFC-75 R3, plan 12c): deciding one creates a
 * species, which is the catalog permission, not a review permission.
 * @rfc RFC-13 R3
 * @rfc RFC-60 R9
 * @rfc RFC-65 R8, R10
 * @rfc RFC-69 R5
 * @rfc RFC-71 R1
 * @rfc RFC-75 R3
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
  { to: '/app/taxa', label: 'Taxa', icon: 'branch', permission: 'taxa.manage', section: 'data' },
  {
    to: '/app/imports',
    label: 'Imports',
    icon: 'upload',
    permission: 'imports.read',
    section: 'data',
  },
  {
    to: '/app/contributions',
    label: 'My contributions',
    icon: 'user',
    permission: 'dataset.read',
    section: 'data',
  },
  {
    to: '/app/curation/pending',
    label: 'Pending',
    icon: 'clipboard',
    permission: 'records.review',
    section: 'curation',
  },
  {
    to: '/app/curation/disputed',
    label: 'Disputed',
    icon: 'alert',
    permission: 'records.review',
    section: 'curation',
  },
  {
    to: '/app/curation/coverage',
    label: 'Coverage',
    icon: 'check',
    permission: 'coverage.read',
    section: 'curation',
  },
  {
    to: '/app/curation/proposals',
    label: 'Proposals',
    icon: 'clipboard',
    permission: 'taxa.manage',
    section: 'curation',
  },
  {
    to: '/app/species',
    label: 'Unresolved taxa',
    icon: 'leaf',
    permission: 'records.review',
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
    to: '/app/admin/plots',
    label: 'Plots',
    icon: 'map',
    permission: 'plots.manage',
    section: 'admin',
  },
  {
    to: '/app/admin/audit',
    label: 'Audit',
    icon: 'clipboard',
    permission: 'audit.read',
    section: 'admin',
  },
  {
    to: '/app/admin/health',
    label: 'Health',
    icon: 'pulse',
    permission: 'health.read',
    section: 'admin',
  },
  { to: '/app/settings', label: 'Settings', icon: 'sliders', section: 'account' },
  // No permission: the help section is open to every signed-in user (RFC-73 R1).
  { to: '/app/help', label: 'Help', icon: 'help', section: 'account' },
];

// Every search entry of `entry` is present in `search` with the same value.
function searchMatches(entry: NavEntry, search: Record<string, unknown>): boolean {
  return Object.entries(entry.search ?? {}).every(([key, value]) => search[key] === value);
}

/**
 * The entry a location belongs to: the longest `to` that is the pathname or
 * a prefix of it at a segment boundary, so `/app/species/<id>` is Species
 * and `/app` alone is Workspace. Two entries may share a `to` and differ
 * only in `search` (Species and Unresolved taxa): among those, the one whose
 * search entries all match the location's search wins, else the one without
 * a `search`.
 * @rfc RFC-13 R3
 */
export function currentEntry(
  pathname: string,
  search: Record<string, unknown> = {},
): NavEntry | undefined {
  let best: NavEntry | undefined;
  for (const entry of NAV_ENTRIES) {
    const match = pathname === entry.to || pathname.startsWith(`${entry.to}/`);
    if (!match) continue;
    if (!best || entry.to.length > best.to.length) {
      best = entry;
      continue;
    }
    if (entry.to.length !== best.to.length) continue;
    // Same path: a search-specific entry beats a plain one only when the
    // location carries its search; a plain one beats a search entry that
    // does not match.
    const entryFits = entry.search ? searchMatches(entry, search) : true;
    const bestFits = best.search ? searchMatches(best, search) : true;
    if (entryFits && (!bestFits || (entry.search && !best.search))) best = entry;
  }
  return best;
}
