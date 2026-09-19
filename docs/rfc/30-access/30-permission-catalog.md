# RFC-30 — Permission catalog

| Field | Value |
|---|---|
| Status | accepted |
| Category | access control |
| Supersedes | — |

## Context

Permissions are the vocabulary of authorization. They are fixed by code and by this RFC, never created at runtime; administrators combine them into roles (RFC-31). Every privileged API route names exactly one permission (RFC-32).

## Rules

- **R1** A permission key has the form `<resource>.<action>`: lowercase ASCII letters, one dot, and `_` allowed inside the action segment only (`dataset.read_inactive`); no other characters. Keys are unique and never renamed; a retired key keeps its row with "(retired)".
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
| `dataset.read` | Browse species, traits, references and records |
| `imports.read` | View import batches and their rejections |
| `records.create` | Add trait records and map pending values |
| `records.annotate` | Confirm, dispute and comment on records |
| `records.withdraw` | Withdraw any manual record |
| `accepted.manage` | Set and clear the accepted value per species and trait |
| `taxa.manage` | Create and edit families, genera, species and names |
| `taxa.propose` | Propose a species for the catalog |
| `references.manage` | Create and edit bibliographic references |
| `traits.manage` | Create and edit traits and levels |
| `dataset.export` | Download the accepted values |
| `dataset.read_inactive` | See inactive species, traits and levels |
| `records.review` | Work the harmonisation and disputed queues; neutralise or dispute any record with a note |
| `plots.manage` | Create and edit field plots and their species |
| `contributions.read` | View any user's contributions |
| `coverage.read` | View coverage metrics |

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
- 2026-09-12 — users.delete retired: users are never erased (RFC-50 R12).
- 2026-09-13 — dataset.read, imports.read (RFC-60–64, plan 06).
- 2026-09-13 — curation permissions (RFC-65, RFC-66, plan 07).
- 2026-09-17 — dataset.read_inactive, records.review (RFC-33, RFC-65 R8–R10, plan 08a).
- 2026-09-17 — plots.manage (RFC-67, plan 08b).
- 2026-09-17 — R1: an underscore inside the action segment (plan 08a).
- 2026-09-17 — records.review: meaning widened by RFC-70 R4 (plan 09a).
- 2026-09-18 — contributions.read (RFC-71, plan 11a).
- 2026-09-18 — coverage.read (RFC-69 R5-R7, plan 11c).
- 2026-09-19 — taxa.propose (RFC-75, plan 12c).
