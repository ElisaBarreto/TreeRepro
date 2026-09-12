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
- **R2** The system role `admin` (`is_system = true`) is inserted by the migration that creates the tables. It has no `role_permissions` rows: a user holding it has every permission of the catalog, including permissions added later. It cannot be renamed, edited or deleted (409 `ROLE_IS_SYSTEM`).
- **R3** `createRole({ name, description, permissions })`: `name` is trimmed, 1–64 characters, and must not collide case-insensitively with an existing role (409 `ROLE_NAME_TAKEN`); every permission must be a catalog key (400 `PERMISSION_UNKNOWN`, `details` listing each unknown key at path `permissions`). Audit `roles.created` (target `role`, `metadata.permissions`).
- **R4** `updateRole(id, { name?, description?, permissions? })`: 404 `ROLE_NOT_FOUND`; R2 and R3 apply; `permissions` replaces the whole set; `updated_at` is set. Audit `roles.updated` with `metadata.changes` listing the changed fields. Every user holding the role is invalidated in the permission cache (RFC-32 R3).
- **R5** `deleteRole(id)`: 404 or 409 as above; deletes `role_permissions` and `user_roles` by cascade. Audit `roles.deleted`. Users that held the role are invalidated.
- **R6** `setUserRoles(userId, roleIds)` replaces the user's roles with the given set (unknown role → 404 `ROLE_NOT_FOUND`; unknown user → 404 `NOT_FOUND`). Audit `users.roles_changed` (target `user`, `metadata.added` and `metadata.removed` as role id arrays). The user is invalidated in the cache.
- **R7** Anti-lockout: the last `active` user holding `admin` cannot lose it — `setUserRoles` answers 409 `ROLE_LAST_ADMIN` when the change would remove `admin` from that user. `assertNotLastAdmin(userId)` exposes the same check for suspension and erasure (RFC-5x). Suspended, invited and deleted holders do not count.
- **R8** Every service takes the actor's user id (null for the seed command) and runs in one transaction with its audit entry; a failed audit rolls the change back (RFC-41 R5).
- **R9** `pnpm seed:admin` assigns `admin` to the invited user (RFC-20 R8); running it again for the same invited user keeps the role.

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
