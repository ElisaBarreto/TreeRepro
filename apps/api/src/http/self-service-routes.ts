/**
 * Routes an authenticated user reaches with a session only, as
 * `"<METHOD> <path>"`; every other non-public route needs `requirePermission`.
 * @rfc RFC-32 R5
 */
export const SELF_SERVICE_ROUTES: readonly string[] = [
  'POST /api/auth/logout',
  'POST /api/auth/logout-all',
  'GET /api/auth/me',
  'POST /api/auth/password/change',
  'POST /api/auth/totp/setup',
  'POST /api/auth/totp/confirm',
  'POST /api/auth/totp/disable',
  'GET /api/me/sessions',
  'DELETE /api/me/sessions/:id',
];
