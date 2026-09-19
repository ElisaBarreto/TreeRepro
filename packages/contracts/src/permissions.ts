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
  'records.annotate': 'Confirm, dispute and comment on records',
  'records.withdraw': 'Withdraw any manual record',
  'accepted.manage': 'Set and clear the accepted value per species and trait',
  'taxa.manage': 'Create and edit families, genera, species and names',
  'taxa.propose': 'Propose a species for the catalog',
  'references.manage': 'Create and edit bibliographic references',
  'traits.manage': 'Create and edit traits and levels',
  'dataset.export': 'Download the accepted values',
  'dataset.read_inactive': 'See inactive species, traits and levels',
  'records.review':
    'Work the harmonisation and disputed queues; neutralise or dispute any record with a note',
  'plots.manage': 'Create and edit field plots and their species',
  'contributions.read': "View any user's contributions",
  'coverage.read': 'View coverage metrics',
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
