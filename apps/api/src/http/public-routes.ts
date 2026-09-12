/**
 * Routes reachable without a session, as `"<METHOD> <path>"`. Everything else
 * must sit behind a guard (`requireSession` now, `requirePermission` from
 * RFC-32); the meta-test in `routes-guarded.integration.test.ts` enforces it.
 * @rfc RFC-02 R12
 * @rfc RFC-22 R1
 */
export const PUBLIC_ROUTES: readonly string[] = [
  'GET /api/health',
  'GET /api/health/ready',
  'POST /api/auth/login',
  'POST /api/auth/login/totp',
  'POST /api/auth/invite/accept',
  'POST /api/auth/password/forgot',
  'POST /api/auth/password/reset',
];
