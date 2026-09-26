# RFC-32 — Authorization enforcement

| Field | Value |
|---|---|
| Status | accepted |
| Category | access control |
| Supersedes | — |

## Context

The backend is the only authority (RFC-02 R1). Every route that is not public and not self-service names one permission and is guarded by one middleware. Effective permissions are derived from roles (RFC-31) and cached briefly.

## Rules

- **R1** Effective permissions of a user: the whole catalog (RFC-30) when the user holds the `admin` system role; otherwise the union of `role_permissions` over the user's roles. Only `active` users have sessions (RFC-22 R7), so a suspended user has no effective permissions in practice.
- **R2** Cache: Redis key `perms:<userId>` holds a JSON object `{ gen, keys }` — the sorted permission keys and the generation they were computed under — for 5 minutes. Resolution reads the cache first and fills it on a miss; the fill is written only while the user's generation (`perms:gen:<userId>`, a counter that reads as 0 when absent) still equals the one read before the database query.
- **R3** Invalidation deletes `perms:<userId>` for every affected user after the change commits: the one user in `setUserRoles`; every user holding the role in `updateRole` and `deleteRole`. It also bumps the user's generation (kept for 10 minutes), so a fill that raced an invalidation is discarded instead of caching stale permissions.
- **R4** `requirePermission(key, options?)`: without a session user, 401 `AUTH_UNAUTHENTICATED`; without the permission, 403 `PERMISSION_DENIED` with the fixed message "You do not have permission to do this" (the required key is not disclosed); when `options.resource` is given it is awaited after the permission check and `false` answers 403 `PERMISSION_DENIED`. On success the resolved set is available to the handler as `permissions`. A request authenticated by an API key answers 403 `PERMISSION_DENIED` on the identity, role and session management permissions RFC-82 R6 lists.
- **R5** Guard classes. Every registered route is exactly one of: public (RFC-22 R1), self-service — behind `requireSession` only —, API-key — behind `requireApiKey` only, reached with an API key and never a session: `POST /api/batch` (RFC-82 R10) —, or permission-guarded — behind `requirePermission`. The self-service list: `POST /api/auth/logout`, `POST /api/auth/logout-all`, `GET /api/auth/me`, `POST /api/auth/password/change`, `POST /api/auth/totp/setup`, `POST /api/auth/totp/confirm`, `POST /api/auth/totp/disable`, `GET /api/me/sessions`, `DELETE /api/me/sessions/:id`, `GET /api/me/api-keys`, `POST /api/me/api-keys`, `DELETE /api/me/api-keys/:id` (RFC-82 R6), `PATCH /api/me` (RFC-50 R11), `GET /api/help`, `GET /api/help/:slug` (RFC-73 R6). Every route that is neither public, self-service nor API-key is permission-guarded, wherever its path lives (`/api/admin/*`, `/api/species`, …). A test enumerates the registered routes and fails on any route outside its class. Self-service routes need a cookie session; an API key never reaches them (RFC-82 R6).
- **R6** `GET /api/auth/me` returns the user's effective permissions, sorted, in `permissions` (RFC-22 R10).
- **R7** Resource-level rules are the visibility rules of RFC-33, applied inside the services with the `Visibility` value the route derives; `options.resource` stays available for future per-row checks.
- **R8** SPA gates mirror the API. Every permission key the web app tests — `hasPermission(…, '<key>')`, a navigation entry's `permission: '<key>'`, `permissions.includes('<key>')` under `apps/web/src` — is a catalog key (RFC-30 R2) that the API enforces: named by a route guard, `requirePermission(ctx, '<key>')`, or tested on the resolved set inside a handler or a service — exactly `permissions.has('<key>')` on that identifier or `currentPermissions(c).has('<key>')`, never another receiver (R7; `records.withdraw`, `plots.manage`, `dataset.read_inactive` are checked this way) — anywhere under `apps/api/src`. The lint reads tokens, not text: a key quoted in a comment or a string is neither a gate nor a check. One key shapes the SPA without any check of its own and is the only exception: `admin.access` (RFC-30 R4). `tools/rfc-lint` (`pnpm rfc:check`) enforces the rule and fails on a key outside the catalog, a key the API never checks, or an exception the SPA no longer tests.

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
- 2026-09-12 — R1, R5: PATCH /api/me; no deleted status (RFC-50).
- 2026-09-13 — R5 wording: guard class is decided by the guard, not by the path prefix (plan 06).
- 2026-09-17 — R7: visibility rules live in RFC-33 (plan 08a).
- 2026-09-20 — R8: SPA gates cross-checked against the API's permission checks by `tools/rfc-lint` (security audit 2026-09-19, plan #120 step 3).
- 2026-09-26 — R5: the help reads are self-service (RFC-73 R6, issue #172).
- 2026-09-26 — R5: API key management is self-service and never reachable by a key (RFC-82 R6, plan 14a).
- 2026-09-26 — R4: a key-authenticated request is refused on identity, role and session management permissions (RFC-82 R6).
- 2026-09-26 — R5: the API-key class, for POST /api/batch (RFC-82 R10, plan 14b).
