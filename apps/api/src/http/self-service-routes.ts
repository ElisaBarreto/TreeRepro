/**
 * Routes an authenticated user reaches with a session only, as
 * `"<METHOD> <path>"`; every other non-public route needs `requirePermission`.
 * @rfc RFC-32 R5
 * @rfc RFC-50 R11
 * @rfc RFC-73 R6
 * @rfc RFC-82 R6
 */
export const SELF_SERVICE_ROUTES: readonly string[] = [
  'POST /api/auth/logout',
  'POST /api/auth/logout-all',
  'GET /api/auth/me',
  'PATCH /api/me',
  'POST /api/auth/password/change',
  'POST /api/auth/totp/setup',
  'POST /api/auth/totp/confirm',
  'POST /api/auth/totp/disable',
  'GET /api/me/sessions',
  'DELETE /api/me/sessions/:id',
  'GET /api/me/api-keys',
  'GET /api/me/api-keys/endpoints',
  'POST /api/me/api-keys',
  'DELETE /api/me/api-keys/:id',
  'GET /api/help',
  'GET /api/help/:slug',
];
