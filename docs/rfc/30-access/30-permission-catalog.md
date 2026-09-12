# RFC-30 — Permission catalog

| Field | Value |
|---|---|
| Status | accepted |
| Category | access control |
| Supersedes | — |

## Context

Permissions are the vocabulary of authorization. They are fixed by code and by this RFC, never created at runtime; administrators combine them into roles (RFC-31). Every privileged API route names exactly one permission (RFC-32).

## Rules

- **R1** A permission key has the form `<resource>.<action>`: lowercase ASCII letters, one dot, no other characters. Keys are unique and never renamed; a retired key keeps its row with "(retired)".
- **R2** The catalog below is mirrored exactly by `PERMISSIONS` in `packages/contracts/src/permissions.ts` (key → description); a test parses this table and fails on any difference.
- **R3** Table `permissions`: `key` text primary key, `description` text not null, `created_at` timestamptz not null default `now()`. Its rows equal the catalog; a test compares them. Adding a permission is one change set: this RFC, `PERMISSIONS`, and a migration inserting the row.
- **R4** `admin.access` gates the administration area of the SPA (plan 05). It grants nothing by itself; every API route names its own permission.
- **R5** `GET /api/admin/permissions` answers the catalog in table order as `{ data: [{ key, description }] }` and requires `roles.read`.

## Catalog

| Key | Description |
|---|---|
| `users.read` | List and view users |
| `users.invite` | Invite users |
| `users.update` | Edit user profiles and roles |
| `users.suspend` | Suspend and reactivate users |
| `users.delete` | Erase users (retired) |
| `roles.read` | List roles and the permission catalog |
| `roles.manage` | Create, edit and delete roles |
| `sessions.read` | List any user's sessions |
| `sessions.revoke` | Revoke any user's sessions |
| `audit.read` | Read the audit log |
| `admin.access` | Open the admin area |

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
- 2026-09-12 — users.delete retired: users are never erased (RFC-50 R12).
