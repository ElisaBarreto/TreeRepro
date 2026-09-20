import type { PermissionKey } from '@treerepro/contracts';

/**
 * The permissions that read the dataset: every route guarded by one of them
 * hands the viewer's `Visibility` to its services (RFC-33 R1, R3), and the
 * meta-test `routes-visibility.integration.test.ts` checks that it does.
 * @rfc RFC-33 R10
 */
export const VISIBILITY_GUARDED_PERMISSIONS: readonly PermissionKey[] = [
  'dataset.read',
  'dataset.export',
  'coverage.read',
  'records.review',
  'contributions.read',
];

/**
 * Routes behind one of those permissions that return no dataset rows, as
 * `"<METHOD> <path>"`, each with the rule that says so. The meta-test fails
 * on an entry that does not exist or that resolves visibility after all.
 * @rfc RFC-33 R10
 */
export const VISIBILITY_EXEMPT_ROUTES: readonly string[] = [
  // Visibility-blind counts of the viewer's own activity (RFC-71 R4) and of
  // another user's (RFC-71 R5).
  'GET /api/me/contributions/summary',
  'GET /api/admin/users/:id/contributions/summary',
  // Plots are the recruitment structure, not scientific data (RFC-67 R3).
  'GET /api/plots',
  'GET /api/plots/:id',
];
