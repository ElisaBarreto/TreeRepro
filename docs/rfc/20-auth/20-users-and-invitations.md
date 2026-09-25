# RFC-20 — Users and invitations

| Field | Value |
|---|---|
| Status | accepted |
| Category | auth |
| Supersedes | — |

## Context

There is no public sign-up. An administrator (in this plan: the `seed:admin` command; from RFC-50: the admin API) creates a user and the system emails an invitation. The invited person sets a password and becomes active. Personal fields are encrypted (RFC-40); the email is looked up only through its blind index.

## Rules

- **R1** Table `users`: `id` uuid primary key default `uuidv7()`; `email` text not null (encrypted, AAD `users.email`); `email_hash` text not null unique (RFC-40 R5 blind index of the email); `name` text not null (encrypted, AAD `users.name`); `password_hash` text nullable (argon2id PHC string, RFC-21 R1); `status` text not null default `'invited'`, checked against `invited`, `active`, `suspended`; `totp_secret` text nullable (encrypted, AAD `users.totp_secret`, RFC-23); `totp_enabled_at`, `suspended_at` timestamptz nullable; `restrict_to_assigned_plots` boolean not null default `false` (RFC-67 R1); `created_at`, `updated_at` timestamptz not null default `now()`. Every write sets `updated_at`.
- **R2** States and transitions: `invited → active` when the invitation is accepted (R6); `active → suspended` and `suspended → active` by an administrator (RFC-50 R6, R7). There is no other transition: users are never deleted or anonymized (RFC-50 R12); offboarding is suspension. Only `active` users can log in or hold a session (RFC-22 R7).
- **R3** The email is trimmed and stored as given (case preserved). Uniqueness and every lookup use `email_hash`, computed over the RFC-40 R5 normalized form, so `Ada@Example.com` and `ada@example.com ` are the same account. A second account for the same email is refused with 409 `USER_EMAIL_TAKEN`.
- **R4** `inviteUser({ email, name, roleIds? })` runs in one transaction: it creates the user with `status = 'invited'` (or reuses an existing `invited` user), issues an `invite` token (R5), writes the audit entry `auth.invite.created` (target `user`) and, when `roleIds` is given, sets the user's roles with `setUserRoles` (RFC-31 R6, R12–R14; RFC-50 R3), so a refused role leaves nothing behind. After the transaction commits it sends the invitation email with the link `<APP_ORIGIN>/invite/<token>` and the expiry; for an expired link it says whom to ask for a new invitation: `INVITE_CONTACT_EMAIL` when set, otherwise an administrator (configuration, since the repository is public). A send failure is reported to the caller; the user and token stay, so the invitation can be re-sent.
- **R5** Table `auth_tokens`: `id` uuid primary key; `user_id` uuid not null references `users`; `kind` text not null in (`invite`, `password_reset`); `token_hash` text not null unique; `expires_at` timestamptz not null; `consumed_at` timestamptz nullable; `created_at` timestamptz not null. A token is 32 random bytes (RFC-02 R13) sent base64url (43 characters) and stored only as its SHA-256 hex. Lifetimes: `invite` 72 hours, `password_reset` 1 hour. Issuing a token marks every unconsumed token of the same kind for the same user as consumed. A token is valid while `consumed_at` is null and `expires_at` is in the future; consumption is one `UPDATE … RETURNING` on `token_hash`, so a token can be redeemed once.
- **R6** `POST /api/auth/invite/accept { token, password }`: the password policy (RFC-21 R2, R3) is checked before the token is consumed, so a rejected password does not spend the invitation. On success the token is consumed, the user becomes `active` with the new hash, a session is created (RFC-22 R4), the audit entry `auth.invite.accepted` is written by the user as actor, and the answer is `{ data: { user: <RFC-22 R3 user> } }` — the user alone, without the `status` of the login steps (`inviteAcceptResponseSchema`). A token that is unknown, expired, consumed, or whose user is no longer `invited` answers 400 `AUTH_TOKEN_INVALID`; the four cases are indistinguishable.
- **R7** Re-inviting is allowed only while the user is `invited`; it issues a new token (invalidating the old one, R5) and re-sends the email. Any other status answers 409 `USER_EMAIL_TAKEN`.
- **R8** `pnpm seed:admin --email <email> --name <name>` runs `inviteUser` with a null actor, assigns the `admin` role (RFC-31 R9) and prints the invitation link to stdout in addition to sending the email.
- **R9** `audit_log.actor_user_id` references `users.id` (completes RFC-41 R1). Users are never hard-deleted, so the reference never blocks.

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
- 2026-09-12 — R8: seed assigns `admin` (RFC-31 R9).
- 2026-09-12 — R1, R2: no deleted status; users are permanent (RFC-50 R12).
- 2026-09-17 — R1: restrict_to_assigned_plots (RFC-67, plan 08b).
- 2026-09-20 — R6 states the answer, `{ data: { user } }`, which the web had claimed carried a `status` (issue #116).
- 2026-09-25 — R4: the invitation names `INVITE_CONTACT_EMAIL` as whom to ask when the link has expired (issue #173).
- 2026-09-26 — R4: `roleIds`, assigned inside the invitation's transaction (issue #171).
