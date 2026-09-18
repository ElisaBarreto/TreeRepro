# RFC-41 — Audit log

| Field | Value |
|---|---|
| Status | accepted |
| Category | data-protection |
| Supersedes | — |

## Context

Security-relevant events must be recorded immutably: accountability under the GDPR (Art. 5(2), Art. 32) and scientific integrity both require knowing who did what and when.

## Rules

- **R1** Table `audit_log` columns: `id` uuid primary key default `uuidv7()`; `at` timestamptz not null default `now()`; `actor_user_id` uuid nullable (foreign key to `users`, RFC-20 R9); `action` text not null; `target_type` text nullable; `target_id` text nullable; `ip` text nullable (encrypted); `user_agent` text nullable (encrypted); `metadata` jsonb not null default `{}`. Indexes: `(at desc)` and `(actor_user_id, at desc)`.
- **R2** Append-only. A trigger rejects every `UPDATE` and `TRUNCATE`, and rejects `DELETE` unless the current transaction has set `treerepro.allow_audit_purge = 'on'`. Only `audit_log_purge()` (RFC-42 R2) sets that flag; the runtime role cannot delete directly (R9).
- **R3** Actions are dot-separated identifiers `<domain>.<event>` from the catalog below, mirrored exactly by `AUDIT_ACTIONS` in `packages/contracts/src/audit.ts` — shared with the web app, which offers it as the audit filter (RFC-51 R1) — and re-exported by `apps/api/src/audit/actions.ts` (a test compares the catalog with this table). New actions are added to this RFC first.
- **R4** `ip` and `user_agent` are encrypted with RFC-40 before storage. `auth.login.failure` entries carry `metadata.reason` with one of `unknown_email`, `wrong_password`, `not_active`, `suspended`, `rate_limited` (RFC-22 R2, RFC-24 R6).
- **R5** `recordAudit` runs inside the same database transaction as the action it records. If the audit write fails, the action is rolled back (fail closed).
- **R6** Retention: entries older than 2 years are purged by `audit_log_purge()` on the schedule of RFC-42.
- **R7** `metadata` never contains personal data or secrets. `recordAudit` inspects every key at any depth before writing, normalized to lowercase with `_` and `-` removed, and rejects it when it contains `password`, `token`, `secret`, `email` or `useragent`; when it is `ip` or starts or ends with `ip` (`ipAddress`, `clientIp`); or when it is one of `name`, `username`, `firstname`, `lastname`, `fullname`, `displayname`. Values are not inspected: a key naming PII is rejected whatever it holds.
- **R8** `actor_user_id` is null for events without an authenticated actor (for example a failed login for an unknown email).
- **R9** The runtime role `treerepro_app` holds `SELECT` and `INSERT` on `audit_log` and neither `UPDATE`, `DELETE` nor `TRUNCATE`: migration 0001 revokes `UPDATE`, migration 0007 revokes `DELETE` (RFC-42 R3). The trigger is the second line of defense.

## Actions

| Action | Meaning |
|---|---|
| `auth.login.success` | Password (and TOTP, if enabled) accepted; session created. |
| `auth.login.failure` | Login attempt rejected (unknown email, wrong password or wrong TOTP). |
| `auth.login.totp_failure` | Wrong TOTP or recovery code during the MFA step. |
| `auth.logout` | Current session revoked by the user. |
| `auth.logout_all` | All sessions of a user revoked. |
| `auth.session.revoked` | One of the user's own sessions revoked by the user. |
| `auth.invite.created` | Invitation issued (or re-issued) for a user. |
| `auth.invite.accepted` | Invitation accepted; password set. |
| `auth.password.reset_requested` | Password reset token issued. |
| `auth.password.reset` | Password replaced through a reset token. |
| `auth.password.changed` | Password replaced by the authenticated user. |
| `auth.totp.enabled` | TOTP second factor enabled. |
| `auth.totp.disabled` | TOTP second factor disabled. |
| `auth.totp.recovery_used` | A recovery code was consumed to complete login. |
| `users.created` | User record created by an admin. |
| `users.updated` | User profile fields changed. |
| `users.roles_changed` | Roles assigned to or removed from a user. |
| `users.suspended` | User suspended. |
| `users.reactivated` | User reactivated. |
| `roles.created` | Role created. |
| `roles.updated` | Role name, description or permissions changed. |
| `roles.deleted` | Role deleted. |
| `sessions.revoked` | A session revoked by an admin. |
| `admin.accessed` | Admin area opened. |
| `taxa.created` | Family, genus, species or alternative name created (RFC-60 R10). |
| `taxa.updated` | Family, genus or species changed (RFC-60 R10). |
| `references.created` | Bibliographic reference created (RFC-61 R6). |
| `references.updated` | Bibliographic reference changed (RFC-61 R6). |
| `traits.created` | Trait created (RFC-62 R6). |
| `traits.updated` | Trait or one of its levels changed, or a level added (RFC-62 R6). |
| `dataset.exported` | Accepted values downloaded as a file (RFC-66 R6). |
| `imports.completed` | A supplementary import batch completed (RFC-68 R5). |
| `plots.created` | Field plot created (RFC-67 R5). |
| `plots.updated` | Field plot metadata changed (RFC-67 R5). |
| `plots.species_added` | Species added to a field plot (RFC-67 R5). |
| `plots.species_removed` | Species removed from a field plot (RFC-67 R5). |
| `users.plots_changed` | Field plots assigned to or removed from a user, or restriction flag changed (RFC-67 R6). |
| `digest.sent` | Daily digest e-mail run completed (RFC-74 R5). |

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
- 2026-09-12 — R2: purge flag scope clarified.
- 2026-09-12 — R7: key normalization and contains-matching (issue #8).
- 2026-09-12 — R1 FK, R4 reason metadata, three auth actions (RFC-20, RFC-22, RFC-23).
- 2026-09-12 — R2, R6, R9: purge through audit_log_purge() (RFC-42); users.deleted and users.exported removed (RFC-50 R12).
- 2026-09-13 — catalog and export actions (RFC-60–62, RFC-66, plan 07).
- 2026-09-13 — R3: the catalog lives in packages/contracts (plan 05b).
- 2026-09-17 — imports.completed (RFC-68, plan 08a).
- 2026-09-17 — plots.*, users.plots_changed (RFC-67, plan 08b).
- 2026-09-19 — digest.sent (RFC-74, plan 12b).
