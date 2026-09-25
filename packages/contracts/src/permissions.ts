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
  'dataset.read': 'Browse species, traits, references and records',
  'imports.read': 'View import batches and their rejections',
  'records.create': 'Add trait records and map pending values',
  'records.annotate': 'Validate and contest records',
  'records.withdraw': 'Withdraw any manual record',
  'records.withdraw_imported': 'Withdraw any imported record',
  'accepted.manage': 'Set and clear the accepted value per species and trait (retired)',
  'taxa.manage': 'Create and edit families, genera, species and names',
  'taxa.propose': 'Propose a species for the catalog',
  'references.manage': 'Create and edit bibliographic references',
  'traits.manage': 'Create and edit traits and levels',
  'dataset.export': 'Download the dataset',
  'dataset.read_inactive': 'See inactive species, traits and levels',
  'records.review':
    'Work the harmonisation and contested queues; resolve contests and withdraw levels',
  'plots.manage': 'Create and edit field plots and their species',
  'contributions.read': "View any user's contributions",
  'coverage.read': 'View coverage metrics',
  'health.read': 'View platform health',
  'help.edit': 'Create, edit and delete help pages',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

/** Catalog order. @rfc RFC-30 R2 */
export const PERMISSION_KEYS: readonly PermissionKey[] = Object.keys(
  PERMISSIONS,
) as PermissionKey[];

const keySet: ReadonlySet<string> = new Set(PERMISSION_KEYS);

/**
 * Held only through the `admin` system role: no custom role may hold them, so
 * the role services refuse them and the roles page does not offer them.
 * @rfc RFC-31 R15
 */
export const ADMIN_ONLY_PERMISSIONS: readonly PermissionKey[] = [
  'dataset.export',
  'records.withdraw_imported',
];

/** @rfc RFC-30 R1 */
export function isPermissionKey(value: string): value is PermissionKey {
  return keySet.has(value);
}
