# TreeRepro — Authorization Design (plan 03)

**Date:** 2026-09-12
**Status:** approved (design); implementation plan `docs/plans/2026-09-12-rbac-03.md`
**Scope:** permission catalog, dynamic roles, role assignment with the anti-lockout rule, effective-permission resolution with a Redis cache, `requirePermission`, `permissions` in `GET /api/auth/me`, one admin route (`GET /api/admin/permissions`), the three-class route-guard meta-test, RFCs 30–32. Refines section 6 of the foundation design (`2026-09-12-foundation-design.md`) and closes issue #18. Role and user management over HTTP is plan 04; UI is plan 05.

## 1. Context

Plan 02 delivered authentication: every non-public route is behind `requireSession`. Nothing distinguishes an administrator from a regular user yet. This plan adds the authority model the foundation design fixes: a permission catalog owned by code and RFC, roles created by administrators, users holding N roles, and one middleware that every privileged route uses.

Constraints inherited: backend is the only authority; every route guarded or explicitly public (RFC-02 R12); business rules in RFCs; RFC → failing test → code.

## 2. Decisions summary

| Topic | Decision |
|---|---|
| Role management surface | Domain services only (`createRole`, `updateRole`, `deleteRole`, `setUserRoles`, `listRoles`); HTTP routes arrive in plan 04. `seed:admin` assigns `admin` to the first user. |
| `admin` role | Created by the migration with `is_system = true`; its permissions are not stored — a user holding `admin` has the whole catalog, computed at resolution time, so new permissions apply automatically. |
| Guard classes | Public (RFC-22 R1), self-service (session only; listed in RFC-32), permission-guarded (everything else). Any route under `/api/admin/` must carry `requirePermission`. |
| Cache | `perms:<userId>` in Redis, JSON array, TTL 5 minutes. Invalidated by deleting the keys of the affected users after the change commits: the one user in `setUserRoles`; every user of the role in `updateRole`/`deleteRole`. |
| The one route | `GET /api/admin/permissions` behind `requirePermission('roles.read')`, so the guard is exercised end to end (401 / 403 / 200) and plan 04 inherits the pattern. |
| Resource hook | `requirePermission(key, { resource })` accepts an optional async predicate on the context; it is called after the permission check and a `false` answers 403. Nothing uses it yet. |

## 3. Data model

### `permissions`

| Column | Type | Notes |
|---|---|---|
| `key` | text | PK, `<resource>.<action>` |
| `description` | text | not null |
| `created_at` | timestamptz | default `now()` |

Rows are inserted by the migration that creates the table, from the catalog. A test compares the catalog keys with the table (RFC-30).

### `roles`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | `uuidv7()` PK |
| `name` | text | not null; unique index on `lower(name)` |
| `description` | text | not null, default `''` |
| `is_system` | boolean | not null, default false |
| `created_at`, `updated_at` | timestamptz | |

The migration inserts `admin` (`is_system = true`, description `Full access to every permission, including future ones.`).

### `role_permissions`

| Column | Type | Notes |
|---|---|---|
| `role_id` | uuid | FK `roles.id` on delete cascade |
| `permission_key` | text | FK `permissions.key` |
| PK | (`role_id`, `permission_key`) | |

### `user_roles`

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | FK `users.id` |
| `role_id` | uuid | FK `roles.id` on delete cascade |
| `created_at` | timestamptz | default `now()` |
| PK | (`user_id`, `role_id`) | |

### Redis

| Key | Value | TTL |
|---|---|---|
| `perms:<userId>` | JSON array of permission keys, sorted | 5 min |

## 4. Catalog

`packages/contracts/src/permissions.ts`:

```ts
export const PERMISSIONS = {
  'users.read': 'List and view users',
  'users.invite': 'Invite users',
  'users.update': 'Edit user profiles and roles',
  'users.suspend': 'Suspend and reactivate users',
  'users.delete': 'Erase users',
  'roles.read': 'List roles and the permission catalog',
  'roles.manage': 'Create, edit and delete roles',
  'sessions.read': 'List any user\'s sessions',
  'sessions.revoke': 'Revoke any user\'s sessions',
  'audit.read': 'Read the audit log',
  'admin.access': 'Open the admin area',
} as const;
export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS: readonly PermissionKey[];
```

`admin.access` gates the SPA's admin area (plan 05); API routes each name their own permission.

## 5. Modules (`apps/api/src`)

| Path | Responsibility |
|---|---|
| `db/schema/permissions.ts`, `roles.ts`, `role-permissions.ts`, `user-roles.ts` | Drizzle tables; one migration with the catalog rows and the `admin` role |
| `access/permissions.ts` | `effectivePermissions(db, userId)`, `createPermissionCache(redis, now?)` (`get`, `set`, `invalidate(userIds)`), `resolvePermissions(ctx, userId)` (cache → database) |
| `access/roles.ts` | `createRole`, `updateRole`, `deleteRole`, `listRoles`, `getRole`, `setUserRoles`, `userIdsWithRole`, `assertNotLastAdmin`; audits; cache invalidation after commit |
| `access/context.ts` | `AccessContext = { db; permissionCache; logger; now }` (`AuthContext` gains `permissionCache` and satisfies it) |
| `http/middleware/require-permission.ts` | `requirePermission(key, options?)`, `currentPermissions(c)` |
| `http/routes/admin.ts` | `GET /api/admin/permissions` |
| `http/self-service-routes.ts` | `SELF_SERVICE_ROUTES` (RFC-32) |
| `cli/seed-admin.ts` | assigns `admin` after the invitation |
| `test/helpers/roles.ts` | `createRole(db, { name?, permissions })`, `grantRoles(db, userId, roleIds)`; `createUser` gains `roles?: string[]` |

`AppEnv.Variables` gains `permissions?: ReadonlySet<PermissionKey>`.

## 6. Flows

### Resolution (RFC-32)

`resolvePermissions(ctx, userId)`: read `perms:<userId>`; on a miss compute `effectivePermissions` — if the user holds a role named `admin` with `is_system`, the whole catalog; otherwise the union of `role_permissions` over the user's roles — sort, write the cache with the 5-minute TTL, return a `ReadonlySet`. A user without a session never reaches resolution; a revoked session has no permissions because `resolveSession` (RFC-22 R7) attaches no user.

### `requirePermission(key, options?)` (RFC-32)

1. No `user` on the context → 401 `AUTH_UNAUTHENTICATED` (same as `requireSession`).
2. Resolve permissions; missing `key` → 403 `PERMISSION_DENIED` with a fixed message ("You do not have permission to do this") — the required key is not disclosed in the body.
3. `options.resource` present → await it; `false` → 403 `PERMISSION_DENIED`.
4. Set `permissions` on the context and continue.

Marked with `markGuard`.

### Roles (RFC-31)

- `createRole({ name, description?, permissions })`: name trimmed, 1–64 chars, unique case-insensitively (`ROLE_NAME_TAKEN` 409); every permission must exist in the catalog (`PERMISSION_UNKNOWN` 400, details list the offending keys); audit `roles.created` with `metadata.permissions`.
- `updateRole(id, { name?, description?, permissions? })`: `ROLE_NOT_FOUND` 404; system role → `ROLE_IS_SYSTEM` 409; permissions replaced as a set; audit `roles.updated`; invalidate every user holding the role.
- `deleteRole(id)`: system role → `ROLE_IS_SYSTEM`; cascades `role_permissions` and `user_roles`; audit `roles.deleted`; invalidate the users that held it.
- `setUserRoles(userId, roleIds)`: replaces the user's set; unknown role → `ROLE_NOT_FOUND`; if the change removes `admin` from the last active user holding it → `ROLE_LAST_ADMIN` 409 (anti-lockout); audit `users.roles_changed` with `metadata.added`/`removed` role ids; invalidate the user.
- `assertNotLastAdmin(db, userId)`: throws `ROLE_LAST_ADMIN` when `userId` is the only `active` user holding `admin`; exported for plan 04's suspend and erase.
- All of the above take the actor id for the audit entry and run in one transaction; cache invalidation happens after commit.

### `seed:admin` (RFC-20 R8)

After `inviteUser`, `setUserRoles(user.id, [adminRoleId])` with a null actor. Re-running for an existing invited user keeps the role.

### `GET /api/auth/me` (RFC-22 R10)

`permissions` is the resolved, sorted array.

### `GET /api/admin/permissions` (RFC-30)

`requirePermission('roles.read')`; answers `{ data: [{ key, description }] }` in catalog order.

## 7. Route-guard meta-test (RFC-02 R12, RFC-32)

For every registered endpoint (`METHOD /path`):

- in `PUBLIC_ROUTES` → no guard required;
- in `SELF_SERVICE_ROUTES` → must carry `requireSession`;
- otherwise → must carry `requirePermission`;
- any path starting with `/api/admin/` → must carry `requirePermission` regardless of the lists.

`SELF_SERVICE_ROUTES` = `POST /api/auth/logout`, `POST /api/auth/logout-all`, `GET /api/auth/me`, `POST /api/auth/password/change`, `POST /api/auth/totp/setup`, `POST /api/auth/totp/confirm`, `POST /api/auth/totp/disable`, `GET /api/me/sessions`, `DELETE /api/me/sessions/:id`. Guards are told apart by identity: `requireSession` is one function; `requirePermission(...)` instances are tagged at creation (`markGuard` with a kind).

Negative sweep addition: every permission-guarded route answers 401 without a session, 403 with a session lacking the permission, and not-403 with it.

## 8. Contracts and error codes

`packages/contracts/src/permissions.ts` (section 4) and `packages/contracts/src/roles.ts`: `roleNameSchema` (1–64, trimmed), `roleSchema` (`id`, `name`, `description`, `isSystem`, `permissions: PermissionKey[]`, `createdAt`, `updatedAt`), `permissionEntrySchema` (`key`, `description`). Request schemas for role management come with plan 04.

RFC-12 additions:

| Code | Status |
|---|---|
| `PERMISSION_DENIED` | 403 |
| `PERMISSION_UNKNOWN` | 400 |
| `ROLE_NOT_FOUND` | 404 |
| `ROLE_NAME_TAKEN` | 409 |
| `ROLE_IS_SYSTEM` | 409 |
| `ROLE_LAST_ADMIN` | 409 |

## 9. RFCs

New, under `docs/rfc/30-access/`:

- **RFC-30 Permission catalog** — key format, the catalog, the table and the sync test, how a permission is added, `admin.access`.
- **RFC-31 Roles** — tables, the `admin` system role and its computed permissions, uniqueness, service semantics, anti-lockout, audit entries.
- **RFC-32 Authorization enforcement** — effective permissions, cache and invalidation, `requirePermission` (401/403, resource hook), guard classes and the self-service list, the meta-test, `me.permissions`, `GET /api/admin/permissions`.

Amendments: RFC-02 R12 (three classes, `/api/admin/` rule), RFC-12 (codes; `PERMISSION_`/`ROLE_` prefixes in use), RFC-20 R8 (`seed:admin` assigns `admin`), RFC-22 R1 (the admin route) and R10 (`permissions` filled).

## 10. Testing

- **Unit:** catalog shape (keys `<resource>.<action>`, unique, descriptions), contracts schemas, `requirePermission` against stubbed context/permissions (401, 403, resource hook true/false, guard marking).
- **Integration:** catalog ↔ table sync; `admin` resolves to the whole catalog; union over several roles; cache hit (no DB query on the second call — spy on the executor or count via a wrapped `db`), TTL with the injected clock, invalidation by `setUserRoles`/`updateRole`/`deleteRole`; role name uniqueness; system role immutability; unknown permission rejected; anti-lockout (last active admin cannot lose the role; a suspended admin does not count as a holder; two admins → allowed); audit entries.
- **API:** `GET /api/admin/permissions` 401 / 403 / 200; `me.permissions` for a user with two roles and for an admin; meta-test with the three classes; negative sweep extension.
- **CLI:** `seed:admin` leaves the user holding `admin` (extend the existing test).

## 11. Out of scope (later plans)

- Role and user management routes, audit listing (plan 04).
- Row-level rules; the resource hook stays unused.
- UI (plan 05).
