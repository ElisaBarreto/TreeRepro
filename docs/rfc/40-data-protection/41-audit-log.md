# RFC-41 — Audit log

| Field | Value |
|---|---|
| Status | accepted |
| Category | data-protection |
| Supersedes | — |

## Context

Security-relevant events must be recorded immutably: accountability under the GDPR (Art. 5(2), Art. 32) and scientific integrity both require knowing who did what and when.

## Rules

- **R1** Table `audit_log` columns: `id` uuid primary key default `uuidv7()`; `at` timestamptz not null default `now()`; `actor_user_id` uuid nullable (foreign key to `users` added by RFC-2x); `action` text not null; `target_type` text nullable; `target_id` text nullable; `ip` text nullable (encrypted); `user_agent` text nullable (encrypted); `metadata` jsonb not null default `{}`. Indexes: `(at desc)` and `(actor_user_id, at desc)`.
- **R2** Append-only. A trigger rejects every `UPDATE` and `TRUNCATE`. It rejects `DELETE` unless the current transaction has set `treerepro.allow_audit_purge = 'on'` (the retention job, RFC-42, uses `SET LOCAL`); PostgreSQL does not distinguish a session-level `SET`, so the flag is a convention enforced by code review until RFC-42 moves purging into a `SECURITY DEFINER` function and revokes `DELETE` from `treerepro_app`.
- **R3** Actions are dot-separated identifiers `<domain>.<event>` from the catalog below, mirrored exactly by `AUDIT_ACTIONS` in `apps/api/src/audit/actions.ts` (a test compares the two). New actions are added to this RFC first.
- **R4** `ip` and `user_agent` are encrypted with RFC-40 before storage.
- **R5** `recordAudit` runs inside the same database transaction as the action it records. If the audit write fails, the action is rolled back (fail closed).
- **R6** Retention: entries older than 2 years are purged by the retention job (RFC-42, future). Until it exists nothing is purged.
- **R7** `metadata` never contains personal data or secrets. `recordAudit` rejects the keys `password`, `passwordHash`, `token`, `secret`, `email`, `name`, `ip`, `userAgent` at any depth before writing.
- **R8** `actor_user_id` is null for events without an authenticated actor (for example a failed login for an unknown email).
- **R9** The runtime role `treerepro_app` never holds `UPDATE` or `TRUNCATE` on `audit_log`: the migration that creates the trigger also revokes `UPDATE` from `treerepro_app` when that role exists. The trigger is the second line of defense.

## Actions

| Action | Meaning |
|---|---|
| `auth.login.success` | Password (and TOTP, if enabled) accepted; session created. |
| `auth.login.failure` | Login attempt rejected (unknown email, wrong password or wrong TOTP). |
| `auth.logout` | Current session revoked by the user. |
| `auth.logout_all` | All sessions of a user revoked. |
| `auth.invite.created` | Invitation issued (or re-issued) for a user. |
| `auth.invite.accepted` | Invitation accepted; password set. |
| `auth.password.reset_requested` | Password reset token issued. |
| `auth.password.reset` | Password replaced through a reset token. |
| `auth.password.changed` | Password replaced by the authenticated user. |
| `auth.totp.enabled` | TOTP second factor enabled. |
| `auth.totp.disabled` | TOTP second factor disabled. |
| `users.created` | User record created by an admin. |
| `users.updated` | User profile fields changed. |
| `users.roles_changed` | Roles assigned to or removed from a user. |
| `users.suspended` | User suspended. |
| `users.reactivated` | User reactivated. |
| `users.deleted` | User erased and anonymized. |
| `users.exported` | Personal data export produced. |
| `roles.created` | Role created. |
| `roles.updated` | Role name, description or permissions changed. |
| `roles.deleted` | Role deleted. |
| `sessions.revoked` | A session revoked by an admin. |
| `admin.accessed` | Admin area opened. |

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
- 2026-09-12 — R2: purge flag scope clarified.
