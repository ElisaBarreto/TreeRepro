# RFC-32 — Authorization enforcement

| Field | Value |
|---|---|
| Status | accepted |
| Category | access control |
| Supersedes | — |

## Context

The backend is the only authority (RFC-02 R1). Every route that is not public and not self-service names one permission and is guarded by one middleware. Effective permissions are derived from roles (RFC-31) and cached briefly.

## Rules

- **R1** Effective permissions of a user: the whole catalog (RFC-30) when the user holds the `admin` system role; otherwise the union of `role_permissions` over the user's roles. Only `active` users have sessions (RFC-22 R7), so a suspended or deleted user has no effective permissions in practice.
- **R2** Cache: Redis key `perms:<userId>` holds a JSON object `{ gen, keys }` — the sorted permission keys and the generation they were computed under — for 5 minutes. Resolution reads the cache first and fills it on a miss; the fill is written only while the user's generation (`perms:gen:<userId>`, a counter that reads as 0 when absent) still equals the one read before the database query.
- **R3** Invalidation deletes `perms:<userId>` for every affected user after the change commits: the one user in `setUserRoles`; every user holding the role in `updateRole` and `deleteRole`. It also bumps the user's generation (kept for 10 minutes), so a fill that raced an invalidation is discarded instead of caching stale permissions.
- **R4** `requirePermission(key, options?)`: without a session user, 401 `AUTH_UNAUTHENTICATED`; without the permission, 403 `PERMISSION_DENIED` with the fixed message "You do not have permission to do this" (the required key is not disclosed); when `options.resource` is given it is awaited after the permission check and `false` answers 403 `PERMISSION_DENIED`. On success the resolved set is available to the handler as `permissions`.
- **R5** Guard classes. Every registered route is exactly one of: public (RFC-22 R1), self-service — behind `requireSession` only —, or permission-guarded — behind `requirePermission`. The self-service list: `POST /api/auth/logout`, `POST /api/auth/logout-all`, `GET /api/auth/me`, `POST /api/auth/password/change`, `POST /api/auth/totp/setup`, `POST /api/auth/totp/confirm`, `POST /api/auth/totp/disable`, `GET /api/me/sessions`, `DELETE /api/me/sessions/:id`, plus the self-service routes RFC-5x adds under `/api/me`. Every route whose path starts with `/api/admin/` is permission-guarded. A test enumerates the registered routes and fails on any route outside its class.
- **R6** `GET /api/auth/me` returns the user's effective permissions, sorted, in `permissions` (RFC-22 R10).
- **R7** Resource-level rules (row-level scoping) are not implemented; `options.resource` is the hook they will use.

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
