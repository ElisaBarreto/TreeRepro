# RFC-31 — Roles

| Field | Value |
|---|---|
| Status | accepted |
| Category | access control |
| Supersedes | — |

## Context

Roles are named sets of permissions created by administrators. A user holds any number of roles; effective permissions are the union (RFC-32). One role is special: `admin`, created by the system, which always holds everything.

`users.update` and `roles.manage` are the permissions that hand out permissions. Without a ceiling each of them is `admin` in disguise: a holder assigns themselves the admin role, or writes the whole catalog into a role they hold. R12–R14 cap them, so that delegating either to a manager delegates exactly that and nothing more.

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
- **R10** Permission sets of the seeded roles. `contributor`: `dataset.read`, `records.create`, `records.annotate`, `taxa.propose`. `manager`: the contributor set plus `dataset.read_inactive`, `records.review`, `records.withdraw`, `imports.read`, `contributions.read`, `coverage.read`. Managers do not hold `traits.manage`: a missing level is escalated to the admin. No seeded role stores `records.withdraw_imported` (RFC-65 R4): only `admin` withdraws imported records (R15). No seeded role stores `help.edit` either: only `admin` edits the help pages (RFC-73 R7).
- **R11** `GET /api/admin/roles` items carry `isSystem` and, for a system role with stored permissions, its permission keys; the web role list renders system roles read-only.
- **R12** Delegation ceiling: an actor never hands out more than they hold. The actor's effective permissions are RFC-32 R1, resolved from the database at the time of the call. `setUserRoles`: the `admin` system role is added to or removed from a user only by an actor who holds `admin`; every other role added must have a stored permission set contained in the actor's effective permissions; removing a role is never limited by the ceiling. `createRole` and `updateRole`: every permission the call writes into the role that the role does not already store must be held by the actor. An actor who holds `admin` holds everything, so the ceiling never binds them. The CLI's `null` actor (R8) is unrestricted.
- **R13** Self-change: an actor never changes their own roles — `setUserRoles` with `userId` equal to the actor is refused, whatever the set — and never changes the permission set of a role they hold, unless they hold `admin`; `updateRole` on a held role may still change `name` and `description`. A holder of `admin` who wants a different set asks another administrator.
- **R14** A refusal under R12 or R13 answers 403 `PERMISSION_DENIED` with the RFC-32 R4 message and records `roles.delegation_refused` (RFC-41): target `user` with `metadata: { reason, added, removed }` for `setUserRoles`, target `role` with `metadata: { reason }` for `createRole` and `updateRole` (a `createRole` refusal has no role id yet and carries `targetId: null`); `reason` is one of `admin_role`, `ceiling`, `own_roles`, `held_role`. The check runs inside the service's transaction, after the resource errors of R3–R6 (an unknown user or role, a system role) and on the snapshot the write uses; a refusal rolls the transaction back and the entry is written afterwards on the caller's connection — a caller whose connection is itself a transaction (`updateUser`, RFC-50 R5) does the same on the root connection once its own transaction has rolled back, so exactly one entry commits and nothing else is written. The web app does not offer what the API refuses: the roles section of a user's own page is read-only (RFC-13 R3), and the invite dialog (RFC-50 R3) offers only the roles within the actor's ceiling — `admin` only to an actor who holds it, any other role only when its stored permissions are all among the actor's.
- **R15** Admin-only permissions. `dataset.export` and `records.withdraw_imported` are held only through the `admin` system role (R2): no custom role may hold them. `createRole` (R3) and `updateRole` (R4) with either key answer 400 `VALIDATION_FAILED` with a detail at path `permissions`, and the roles page does not offer them. Importing is not a permission at all: the `import:*` commands run only from the server (RFC-64, RFC-68). Plan 13g implements this rule, deletes any `role_permissions` row of a custom role that holds either key, and adds `records.withdraw_imported`.

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
- 2026-09-12 — R7: no erasure; wording (RFC-50).
- 2026-09-17 — R2 amended, R10–R11 added: manager and contributor system roles (plan 08a).
- 2026-09-18 — R10: manager gains `contributions.read` (RFC-71, plan 11a).
- 2026-09-18 — R10: manager gains `coverage.read` (RFC-69 R5-R7, plan 11c).
- 2026-09-19 — R10: contributor and manager gain `taxa.propose` (RFC-75, plan 12c).
- 2026-09-20 — R12–R14 added, Context amended: delegation ceiling, self-change, refusal audit (security audit 2026-09-19, issue #118 F-02, plan #120 step 1).
- 2026-09-25 — R10: `records.withdraw_imported` is admin-only; R15 added: `dataset.export` and `records.withdraw_imported` cannot be granted to a custom role (owner ruling) (record model revision R-12; plan 13a). `draft` until plan 13g.
- 2026-09-26 — R14: the invite dialog offers only the roles within the actor's ceiling (issue #171).
- 2026-09-26 — accepted: implemented by plan 13g.
- 2026-09-26 — R10: no seeded role stores `help.edit` (RFC-73, issue #172).
