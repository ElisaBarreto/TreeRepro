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
| `records.annotate` | Validate and contest records |
| `records.withdraw` | Withdraw any manual record |
| `records.withdraw_imported` | Withdraw any imported record |
| `accepted.manage` | Set and clear the accepted value per species and trait (retired) |
| `taxa.manage` | Create and edit families, genera, species and names |
| `taxa.propose` | Propose a species for the catalog |
| `references.manage` | Create and edit bibliographic references |
| `traits.manage` | Create and edit traits and levels |
| `dataset.export` | Download the dataset |
| `dataset.read_inactive` | See inactive species, traits and levels |
| `records.review` | Work the harmonisation and contested queues; resolve contests and withdraw levels |
| `plots.manage` | Create and edit field plots and their species |
| `contributions.read` | View any user's contributions |
| `coverage.read` | View coverage metrics |
| `health.read` | View platform health |
| `help.edit` | Create, edit and delete help pages |

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
- 2026-09-19 — health.read (RFC-52, plan 12d).
- 2026-09-25 — R1: accepted.manage retired (the accepted value per species and trait goes; row kept per R1) and dataset.export reworded off the accepted value (spec R-1, plan 13e).
- 2026-09-25 — records.withdraw_imported (admin only, RFC-31 R15, RFC-65 R4); records.annotate and records.review descriptions (spec R-10, R-11; plan 13g).
- 2026-09-26 — help.edit (RFC-73 R6, R7; issue #172). No seeded role stores it: only `admin` edits the help (RFC-31 R2).
