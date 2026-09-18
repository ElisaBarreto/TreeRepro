# RFC-31 — Roles

| Field | Value |
|---|---|
| Status | accepted |
| Category | access control |
| Supersedes | — |

## Context

Roles are named sets of permissions created by administrators. A user holds any number of roles; effective permissions are the union (RFC-32). One role is special: `admin`, created by the system, which always holds everything.

## Rules

- **R1** Table `roles`: `id` uuid primary key default `uuidv7()`; `name` text not null, unique case-insensitively (unique index on `lower(name)`); `description` text not null default `''`; `is_system` boolean not null default `false`; `created_at`, `updated_at` timestamptz not null default `now()`. Table `role_permissions`: `role_id` uuid references `roles` on delete cascade, `permission_key` text references `permissions`, primary key (`role_id`, `permission_key`). Table `user_roles`: `user_id` uuid references `users`, `role_id` uuid references `roles` on delete cascade, `created_at` timestamptz not null default `now()`, primary key (`user_id`, `role_id`).
- **R2** System roles (`is_system = true`): `admin`, inserted by migration 0004 with no `role_permissions` rows — a user holding it has every permission of the catalog, including permissions added later; `manager` and `contributor`, inserted by the migration the changelog names with the stored permissions of R10. A system role cannot be renamed, edited or deleted (409 `ROLE_IS_SYSTEM`). A later migration that grants a system role a new permission inserts the `role_permissions` row, and R10 lists the change.
- **R3** `createRole({ name, description, permissions })`: `name` is trimmed, 1–64 characters, and must not collide case-insensitively with an existing role (409 `ROLE_NAME_TAKEN`); every permission must be a catalog key (400 `PERMISSION_UNKNOWN`, `details` listing each unknown key at path `permissions`). Audit `roles.created` (target `role`, `metadata.permissions`).
- **R4** `updateRole(id, { name?, description?, permissions? })`: 404 `ROLE_NOT_FOUND`; R2 and R3 apply; `permissions` replaces the whole set; `updated_at` is set. Audit `roles.updated` with `metadata.changes` listing the changed fields. Every user holding the role is invalidated in the permission cache (RFC-32 R3).
- **R5** `deleteRole(id)`: 404 or 409 as above; deletes `role_permissions` and `user_roles` by cascade. Audit `roles.deleted`. Users that held the role are invalidated.
- **R6** `setUserRoles(userId, roleIds)` replaces the user's roles with the given set (unknown role → 404 `ROLE_NOT_FOUND`; unknown user → 404 `NOT_FOUND`). Audit `users.roles_changed` (target `user`, `metadata.added` and `metadata.removed` as role id arrays). The user is invalidated in the cache.
- **R7** Anti-lockout: the last `active` user holding `admin` cannot lose it — `setUserRoles` answers 409 `ROLE_LAST_ADMIN` when the change would remove `admin` from that user. `assertNotLastAdmin(userId)` exposes the same check for suspension (RFC-50 R6); the check holds a transaction-scoped advisory lock so concurrent removals serialize. Suspended and invited holders do not count.
- **R8** Every service takes the actor's user id (null for the seed command) and runs in one transaction with its audit entry; a failed audit rolls the change back (RFC-41 R5).
- **R9** `pnpm seed:admin` assigns `admin` to the invited user (RFC-20 R8); running it again for the same invited user keeps the role.
- **R10** Permission sets of the seeded roles. `contributor`: `dataset.read`, `records.create`, `records.annotate`. `manager`: the contributor set plus `dataset.read_inactive`, `records.review`, `records.withdraw`, `imports.read`, `contributions.read`. Managers do not hold `traits.manage`: a missing level is escalated to the admin. Later plans append: `taxa.propose` (contributor and manager, RFC-75), `coverage.read` (manager, RFC-69).
- **R11** `GET /api/admin/roles` items carry `isSystem` and, for a system role with stored permissions, its permission keys; the web role list renders system roles read-only.

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
- 2026-09-12 — R7: no erasure; wording (RFC-50).
- 2026-09-17 — R2 amended, R10–R11 added: manager and contributor system roles (plan 08a).
- 2026-09-18 — R10: manager gains `contributions.read` (RFC-71, plan 11a).
