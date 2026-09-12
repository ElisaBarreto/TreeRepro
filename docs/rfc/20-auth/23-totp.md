# RFC-23 — TOTP second factor

| Field | Value |
|---|---|
| Status | accepted |
| Category | auth |
| Supersedes | — |

## Context

Users may add a time-based one-time password (RFC 6238) as a second factor. Enrolment happens inside a session; the login challenge happens between the password step and the session.

## Rules

- **R1** Secret: 20 random bytes, base32. Algorithm SHA-1, 6 digits, 30-second period. Provisioning URI `otpauth://totp/TreeRepro:<email>?secret=<base32>&issuer=TreeRepro&algorithm=SHA1&digits=6&period=30`.
- **R2** `POST /api/auth/totp/setup` (session): 409 `AUTH_TOTP_ALREADY_ENABLED` when `totp_enabled_at` is set. Otherwise a new secret is stored encrypted (AAD `totp_setup.secret`) at Redis `totp_setup:<userId>` for 10 minutes and the response is `{ data: { secret, otpauthUri } }`. Calling setup again replaces the provisional secret.
- **R3** `POST /api/auth/totp/confirm { code }` (session): the code must verify (R4) against the provisional secret; on success the secret is stored in `users.totp_secret`, `totp_enabled_at` is set, the provisional secret deleted, the recovery codes replaced (R5) and returned once as `{ data: { recoveryCodes } }`; audit `auth.totp.enabled`. A wrong code or no setup in progress answers 401 `AUTH_TOTP_INVALID`.
- **R4** Verification accepts the current step and one step on each side (±30 s). Replay guard: the counter of the last accepted code is kept at Redis `totp_last:<userId>` for 90 seconds; a code whose counter is not greater than the stored one is rejected.
- **R5** Recovery codes: ten per enablement, each 10 characters from the base32 alphabet (`a–z`, `2–7`) written `xxxxx-xxxxx`, generated with RFC-02 R13 randomness. Only the RFC-40 R5 blind index of the normalized code (lowercase, separators removed) — HMAC-SHA256 with `pii_hmac_key`, hex — is stored in `totp_recovery_codes` (`id`, `user_id`, `code_hash` unique, `used_at`, `created_at`), so a database dump cannot be brute-forced without the key; rotating `pii_hmac_key` invalidates every recovery code. A code is single-use: redemption is one `UPDATE … SET used_at … WHERE used_at IS NULL … RETURNING`.
- **R6** MFA challenge: after a verified password for a user with TOTP enabled (RFC-22 R3), a challenge with a raw id of 32 random bytes is stored at Redis `mfa:<HMAC-SHA256(session_secret, rawId)>` as `{ userId, attempts }` for 5 minutes, and the cookie `__Host-mfa=<rawId>; HttpOnly; Secure; SameSite=Strict; Path=/` is set. `POST /api/auth/login/totp` with `{ code }` or `{ recoveryCode }` requires that cookie; a missing or expired challenge answers 401 `AUTH_MFA_EXPIRED`. A wrong code increments `attempts` and audits `auth.login.totp_failure` (actor: the user); the third failure deletes the challenge and answers `AUTH_MFA_EXPIRED`, earlier ones answer 401 `AUTH_TOTP_INVALID`. Success deletes the challenge, clears the cookie, creates the session (RFC-22 R4, R5) and audits `auth.login.success`, plus `auth.totp.recovery_used` when a recovery code was consumed.
- **R7** `POST /api/auth/totp/disable { password, code | recoveryCode }` (session): the password must verify (401 `AUTH_INVALID_CREDENTIALS`) and the code must be a valid TOTP or unused recovery code (401 `AUTH_TOTP_INVALID`); then `totp_secret`, `totp_enabled_at` and all recovery codes are cleared; audit `auth.totp.disabled`. 409 `AUTH_TOTP_NOT_ENABLED` when TOTP is off.
- **R8** Password reset and change never change the TOTP state (RFC-21 R8).

## Open questions

None.

## Changelog

- 2026-09-12 — R5: recovery codes hashed with the keyed blind index (security review).
- 2026-09-12 — created.
- 2026-09-12 — accepted.
