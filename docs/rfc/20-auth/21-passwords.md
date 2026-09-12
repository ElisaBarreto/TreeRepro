# RFC-21 — Passwords

| Field | Value |
|---|---|
| Status | accepted |
| Category | auth |
| Supersedes | — |

## Context

Passwords are the primary factor. Hashing, policy, breach checking, recovery and change follow current OWASP guidance and never reveal whether an account exists.

## Rules

- **R1** Hash: argon2id with memory 19456 KiB, 2 iterations, parallelism 1 (`@node-rs/argon2`), stored as the PHC string in `users.password_hash`. Verification uses the parameters encoded in the stored string.
- **R2** Policy: at least 12 characters and at most 128; no composition rules. The upper bound is enforced by the request schema (400 `VALIDATION_FAILED`). A shorter or breached (R3) password answers 400 `AUTH_PASSWORD_WEAK` with one detail `{ path: "password", message }` whose message is either `Password must be at least 12 characters long.` or `This password appears in known data breaches; choose another one.`. The same check applies to invitation acceptance, reset and change.
- **R3** Breach check: Have I Been Pwned range API with k-anonymity. The API sends only the first five uppercase hex characters of the password's SHA-1 (`GET https://api.pwnedpasswords.com/range/<prefix>`, header `Add-Padding: true`) and compares suffixes locally; padded entries (count 0) do not count. Timeout 2 seconds. Any failure (network, non-2xx, timeout) is logged without the password and treated as "not breached": the check never blocks a user.
- **R4** Login always runs an argon2 verification: against the stored hash when the user is `active` or `suspended`, otherwise against a process-wide dummy hash generated at first use. Unknown email, wrong password, `invited` and `deleted` all answer 401 `AUTH_INVALID_CREDENTIALS` with the same body.
- **R5** `POST /api/auth/password/forgot { email }` answers 200 `{ data: { status: "sent" } }` whether or not the account exists. When the user is `active`, a `password_reset` token (RFC-20 R5) is issued and emailed with the link `<APP_ORIGIN>/reset-password/<token>`, and `auth.password.reset_requested` is audited. A mail failure is logged (without the address) and the response is unchanged.
- **R6** `POST /api/auth/password/reset { token, newPassword }`: policy (R2, R3) first, then the token is consumed, the hash replaced and every session of the user revoked; no session is created. Audit `auth.password.reset`. An invalid token answers 400 `AUTH_TOKEN_INVALID`.
- **R7** `POST /api/auth/password/change { currentPassword, newPassword }` (session required): the current password must verify (401 `AUTH_INVALID_CREDENTIALS` otherwise), the policy applies to the new one, the hash is replaced and every session except the current one is revoked. Audit `auth.password.changed`.
- **R8** Reset and change never alter the TOTP configuration.

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
