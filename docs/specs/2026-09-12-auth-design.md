# TreeRepro — Authentication Design (plan 02)

**Date:** 2026-09-12
**Status:** implemented (plan 02); implementation plan `docs/plans/2026-09-12-auth-02.md`
**Scope:** users and invitations, passwords, login with optional TOTP, opaque sessions, password recovery and change, rate limiting, transactional email. Refines section 5 of the foundation design (`2026-09-12-foundation-design.md`) and closes issue #17. Authorization (roles, permissions, `requirePermission`) is plan 03; admin and self-service HTTP routes beyond sessions are plan 04; UI is plan 05.

## 1. Context

Plan 01 delivered the platform: Hono API, Drizzle + PostgreSQL 18, Redis, PII encryption with AAD-bound columns (RFC-40), the audit log (RFC-41), request-scoped logging and the `Secret` wrapper (PR #21). Nothing can log in yet. This plan adds the whole authentication subsystem as API routes, services and RFCs 20–24, with no UI.

Constraints inherited from the foundation: backend is the only authority; every route guarded or explicitly public; PII encrypted at rest; no enumeration of accounts; secrets only through `Secret`; RFC → failing test → code.

## 2. Decisions summary

| Topic | Decision |
|---|---|
| First user and invitations | CLI `pnpm seed:admin --email <email> --name <name>` calls the internal service `inviteUser()`. No admin HTTP routes in this plan (they arrive in plan 03/04 behind `requirePermission`). |
| Invitation acceptance | Sets the password and creates a session (possession of the token authenticates). |
| Rate limiting | Fixed sliding windows in Redis, 429 + `Retry-After`. No progressive lockout. Counts every attempt, successful or not. |
| TOTP second step | HttpOnly cookie `__Host-mfa` bound to a Redis record, 5 minutes, 3 attempts. |
| Session PII in Redis | `ip` and `userAgent` are encrypted with the PII module (AAD `session.ip`, `session.userAgent`). |
| Session key | Redis key is `HMAC-SHA256(session_secret, id)`; the cookie carries the raw id. A Redis dump yields no usable cookie. |
| Session status check | The session middleware loads the user row on every request; a non-`active` user is logged out. |
| Password reset | Revokes every session; no auto-login. |
| Password change | Requires the current password; revokes every other session. |
| `GET /api/auth/me` | Returns `{ user, permissions: [] }` now; plan 03 fills `permissions`. |
| External calls | `Mailer` and `PasswordBreachChecker` are interfaces injected through `AppDeps`; tests use in-memory fakes. |

## 3. Versions (verified 2026-09-12)

| Package | Version | Role |
|---|---|---|
| `@node-rs/argon2` | 2.2.0 | argon2id hashing (native, prebuilt for linux-x64/arm64 musl and glibc); 2.2.1 was younger than the 7-day `minimumReleaseAge` guard on 2026-09-12 |
| `otpauth` | 9.5.2 | TOTP (RFC 6238) and `otpauth://` URIs |
| `nodemailer` | 10.0.0 | SMTP transport; ships its own types (no `@types/nodemailer`). 10.0.1–10.0.9 were younger than the 7-day `minimumReleaseAge` guard on 2026-09-12 |

Everything else is already pinned (Hono 4.13.7, Drizzle 0.45.2, ioredis 6.0.0, Zod 4.6.2). Exact versions are re-verified when the plan is executed.

## 4. Data model

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | `uuidv7()` default, PK |
| `email` | text | `encryptedText('users', 'email')` |
| `email_hash` | text | blind index (RFC-40 R5), `UNIQUE`, the only lookup key |
| `name` | text | `encryptedText('users', 'name')` |
| `password_hash` | text | null while `invited` |
| `status` | text | `invited` / `active` / `suspended` / `deleted`, `CHECK` constraint |
| `totp_secret` | text | `encryptedText('users', 'totp_secret')`, null until confirmed |
| `totp_enabled_at` | timestamptz | null when TOTP is off |
| `created_at`, `updated_at` | timestamptz | `updated_at` maintained by the service |
| `suspended_at`, `deleted_at` | timestamptz | set by plan 04 actions; read here |

State machine: `invited → active` (invite accepted), `active ↔ suspended` (plan 04), `active|suspended → deleted` (plan 04, soft). Only `active` users can log in or hold sessions.

### `auth_tokens`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK `users.id` |
| `kind` | text | `invite` / `password_reset`, `CHECK` |
| `token_hash` | text | `SHA-256(token)` hex, `UNIQUE` |
| `expires_at` | timestamptz | invite 72 h, reset 1 h |
| `consumed_at` | timestamptz | null until used or superseded |
| `created_at` | timestamptz | |

A token is 32 random bytes, base64url in the link, never stored. Issuing a token consumes every unconsumed token of the same `kind` for the user (re-sending invalidates the previous one). A token is valid when it exists, `consumed_at` is null and `expires_at` is in the future; validation is one query on `token_hash`.

### `totp_recovery_codes`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK |
| `code_hash` | text | `SHA-256(code)` hex |
| `used_at` | timestamptz | null while unused |

Ten codes per enablement, format `xxxxx-xxxxx` (base32 alphabet, 50 bits), shown once in the confirm response. Confirming TOTP again (after disable) deletes the old set. Codes are high-entropy random values, so SHA-256 (not argon2) is enough.

### Redis keys

| Key | Value | TTL |
|---|---|---|
| `session:<hmac>` | hash `{ userId, createdAt, lastSeenAt, ip, userAgent }` — `ip`/`userAgent` encrypted | idle 12 h, refreshed at most once per minute; absolute 7 d enforced from `createdAt` |
| `user_sessions:<userId>` | set of `<hmac>` | none; pruned on read of missing members |
| `mfa:<hmac>` | hash `{ userId, attempts }` | 5 min |
| `totp_setup:<userId>` | provisional secret (encrypted, AAD `totp_setup.secret`) | 10 min |
| `rl:<scope>:<key>` | sorted set of attempt timestamps | window length |

`<hmac>` = `HMAC-SHA256(session_secret, rawId)` hex; the same derivation serves session and MFA ids. Raw ids are 32 random bytes, base64url.

## 5. Modules (`apps/api/src`)

| Path | Responsibility |
|---|---|
| `db/schema/users.ts`, `auth-tokens.ts`, `totp-recovery-codes.ts` | Drizzle tables; one migration |
| `auth/password.ts` | argon2id hash/verify (m = 19 MiB, t = 2, p = 1), policy (12–128 chars), `DUMMY_HASH` for constant-time login |
| `auth/breach-check.ts` | `PasswordBreachChecker` interface; HIBP k-anonymity client (`GET https://api.pwnedpasswords.com/range/<5 hex>`, `Add-Padding: true`, 2 s timeout, any failure → not breached) |
| `auth/tokens.ts` | issue / validate / consume `auth_tokens` |
| `auth/sessions.ts` | session store on Redis: create, touch, get, revoke, revoke-all, list |
| `auth/totp.ts` | secret generation, URI, verify with ±1 step, recovery codes |
| `auth/rate-limit.ts` | sliding-window counter over sorted sets; returns `{ allowed, retryAfterSeconds }` |
| `auth/users.ts` | `inviteUser`, `findByEmail` (blind index), `activate`, `setPassword`, status helpers |
| `auth/flows/{invitation,login,session,password,totp}.ts` | orchestration: login, totp step, logout(-all), invite accept, forgot/reset/change, totp setup/confirm/disable; every path writes its audit entry |
| `http/client-ip.ts` | last `X-Forwarded-For` entry, else `unknown` |
| `http/middleware/session.ts` | `resolveSession` (global, attaches `session`/`user` when the cookie is valid) and `requireSession` (401 `AUTH_UNAUTHENTICATED`) |
| `http/middleware/rate-limit.ts` | global limiter (per session, else per IP) and per-route limiters |
| `http/routes/auth.ts`, `http/routes/me.ts` | routes; validation through `packages/contracts` |
| `mail/mailer.ts` | `Mailer` interface, Nodemailer SMTP implementation, plain-text templates (invite, password reset) |
| `cli/seed-admin.ts` | `pnpm seed:admin` |
| `test/helpers/users.ts`, `test/helpers/session.ts` | factories `createUser({ status, totp })`, `loginAs(user)` → cookie header |

`AppDeps` grows: `db`, `redis`, `mailer`, `breachChecker`, `config` (adds `sessionSecret`, `appOrigin` for links, SMTP settings, `nodeEnv`).

Client IP: Caddy runs without `trusted_proxies`, so it discards any incoming `X-Forwarded-For` and writes the real remote address; the API reads the last entry. Tests inject the header through `app.request()`.

## 6. Flows

### Invitation (RFC-20)

1. `inviteUser({ email, name })` (CLI or, later, admin route): trims the email (stored as given, case preserved), computes the blind index over the RFC-40 R5 normalized form, rejects a duplicate with `USER_EMAIL_TAKEN` (409), inserts `users` with `status = 'invited'`, issues an `invite` token (72 h), sends the email with `<APP_ORIGIN>/invite/<token>`, audits `auth.invite.created`. Everything inside one transaction; the email is sent after commit and a send failure is reported to the caller.
2. `POST /api/auth/invite/accept { token, password }` (public, rate-limited per IP): validates the token, checks the password policy and breach status (`AUTH_PASSWORD_WEAK`, details `too_short` | `too_long` | `breached`), hashes, sets `status = 'active'`, consumes the token, creates a session, sets `__Host-session`, audits `auth.invite.accepted`. Response `{ data: { user } }`. Invalid or expired token → 400 `AUTH_TOKEN_INVALID` (same code for both, no distinction).
3. Re-sending (`inviteUser` on an `invited` user, later exposed by plan 04) issues a new token and consumes the old one.

### Login (RFC-22, RFC-23)

`POST /api/auth/login { email, password }` (public, rate-limited):

1. Look the user up by blind index.
2. Run argon2 verify against the stored hash, or against `DUMMY_HASH` when the user is missing, `invited` or `deleted`. The verify always runs.
3. Failure (no user, wrong password, `invited`, `deleted`) → 401 `AUTH_INVALID_CREDENTIALS`, audit `auth.login.failure` with `metadata.reason` (`unknown_email` | `wrong_password` | `not_active`) and the target user id when known.
4. Correct password and `suspended` → 403 `AUTH_ACCOUNT_SUSPENDED` (disclosed only after the password was verified), audit `auth.login.failure` reason `suspended`.
5. Correct password and TOTP enabled → create `mfa:<hmac>`, set `__Host-mfa`, respond `{ data: { status: 'totp_required' } }`. No session yet, no audit success yet.
6. Correct password and no TOTP → create session, set `__Host-session`, respond `{ data: { status: 'ok', user } }`, audit `auth.login.success`.

`POST /api/auth/login/totp { code }` or `{ recoveryCode }` (public, rate-limited per MFA id): requires a valid `__Host-mfa`; a missing or expired record answers 401 `AUTH_MFA_EXPIRED`. A wrong code increments `attempts`; the third failure deletes the record and answers `AUTH_MFA_EXPIRED`; earlier failures answer 401 `AUTH_TOTP_INVALID` and audit `auth.login.totp_failure`. Success deletes the MFA record, clears `__Host-mfa`, creates the session, audits `auth.login.success` (and `auth.totp.recovery_used` when a recovery code was consumed).

### Sessions (RFC-22)

- Cookie `__Host-session=<rawId>; HttpOnly; Secure; SameSite=Strict; Path=/`. `Secure` is set in every environment; the dev stack is reached through Caddy on `http://localhost`, which browsers treat as a secure context.
- `resolveSession` runs on every request: reads the cookie, derives the key, loads the record, checks the absolute limit (`createdAt` + 7 d), loads the user; when the record is missing, expired, or the user is not `active`, the session is deleted and the cookie cleared. Otherwise it touches `lastSeenAt` and the TTL (at most once a minute) and sets `session` and `user` on the context.
- `requireSession` answers 401 `AUTH_UNAUTHENTICATED` when no session was resolved.
- `POST /api/auth/logout` deletes the current session, clears the cookie, audits `auth.logout`. `POST /api/auth/logout-all` deletes every session of the user, audits `auth.logout_all`.
- `GET /api/me/sessions` lists `{ id, createdAt, lastSeenAt, ip, userAgent, current }` (ids are the hmac values, never raw ids). `DELETE /api/me/sessions/:id` revokes one, audits `auth.session.revoked`.
- `GET /api/auth/me` returns `{ data: { user: { id, email, name, status, totpEnabled, createdAt }, permissions: [] } }`.

### Password recovery and change (RFC-21)

- `POST /api/auth/password/forgot { email }` (public, rate-limited): always 200 `{ data: { status: 'sent' } }` after a constant amount of work. When the user exists and is `active`, a `password_reset` token (1 h) is issued and emailed with `<APP_ORIGIN>/reset-password/<token>`; audit `auth.password.reset_requested`. A mail failure is logged and the response is unchanged.
- `POST /api/auth/password/reset { token, newPassword }` (public, rate-limited per IP): validates the token, policy and breach status, sets the hash, consumes the token, revokes every session of the user, audits `auth.password.reset`. Response `{ data: { status: 'ok' } }`; the client logs in again.
- `POST /api/auth/password/change { currentPassword, newPassword }` (session): verifies the current password (`AUTH_INVALID_CREDENTIALS` on mismatch), applies policy and breach check, sets the hash, revokes every other session, audits `auth.password.changed`.
- Password reset does not disable TOTP.

### TOTP setup (RFC-23)

- `POST /api/auth/totp/setup` (session): `AUTH_TOTP_ALREADY_ENABLED` (409) when enabled. Generates a 20-byte secret, stores it encrypted at `totp_setup:<userId>` (10 min), returns `{ data: { secret, otpauthUri } }` (`otpauth://totp/TreeRepro:<email>?secret=…&issuer=TreeRepro&digits=6&period=30&algorithm=SHA1`). The client renders the QR code.
- `POST /api/auth/totp/confirm { code }` (session): verifies the code against the provisional secret (`AUTH_TOTP_INVALID` on mismatch or missing setup), stores `totp_secret`, sets `totp_enabled_at`, replaces the recovery codes, returns `{ data: { recoveryCodes: string[] } }`, audits `auth.totp.enabled`.
- `POST /api/auth/totp/disable { password, code }` (session): requires the current password and a valid TOTP or recovery code; clears the secret, `totp_enabled_at` and the recovery codes; `AUTH_TOTP_NOT_ENABLED` (409) when off; audits `auth.totp.disabled`.
- Verification window ±1 step (30 s). A code accepted once is not replayable within its window: the last accepted counter is kept at `totp_last:<userId>` (TTL 90 s).

## 7. Rate limiting (RFC-24)

Sliding window over a Redis sorted set per key (`ZADD` now, `ZREMRANGEBYSCORE` older than window, `ZCARD`, `PEXPIRE`), executed atomically by one Lua script. Every attempt counts, successful or not. Exceeding answers 429 `RATE_LIMITED` with `Retry-After` = seconds until the oldest entry in the window expires (minimum 1).

| Scope | Key | Limit |
|---|---|---|
| global | session hmac, else client IP | 300 / min per session, 100 / min per IP |
| `login` | `email_hash + ip` and `ip` | 5 / 15 min and 20 / 15 min |
| `login/totp` | mfa hmac | 5 / 15 min |
| `password/forgot` | `email_hash + ip` and `ip` | 3 / 15 min and 10 / 15 min |
| `invite/accept`, `password/reset` | ip | 10 / 15 min |

The global limiter runs after `resolveSession` on every request; health endpoints are exempt. Per-route limiters run before validation so that a flood of malformed bodies is also counted. Rate-limited login attempts are audited as `auth.login.failure` with reason `rate_limited`.

## 8. Email and breach check

`Mailer` interface: `send({ to, subject, text }): Promise<void>`. Implementation on Nodemailer SMTP with env `SMTP_HOST`, `SMTP_PORT` (default 587; 1025 for Mailpit), `SMTP_FROM`, optional `SMTP_USER` plus secret `smtp_password`, `SMTP_SECURE` (`true` for implicit TLS; STARTTLS otherwise). 5 s timeout. Templates are plain text, English, containing the link and the expiry. `NODE_ENV=test` never constructs the SMTP mailer.

`PasswordBreachChecker` interface: `isBreached(password): Promise<boolean>`. HIBP implementation as in section 5; the API never sends more than the first five hex characters of the SHA-1. Tests use a fake with a configurable set of "breached" passwords; one unit test drives the real client against a stubbed `fetch`.

## 9. Contracts and error codes

`packages/contracts/src/auth.ts` exports strict Zod schemas: `loginBodySchema`, `loginTotpBodySchema` (exactly one of `code` (6 digits) or `recoveryCode`), `inviteAcceptBodySchema`, `forgotPasswordBodySchema`, `resetPasswordBodySchema`, `changePasswordBodySchema`, `totpConfirmBodySchema`, `totpDisableBodySchema`, plus `passwordSchema` (string, 12–128 chars, no composition rules), `emailSchema` (`z.email()`, max 254) and the response types (`AuthUser`, `SessionSummary`).

Password policy outcomes: `too_long` is a `VALIDATION_FAILED` (schema) outcome — `passwordSchema` caps the length at 128 — and the `AUTH_PASSWORD_WEAK` details carry the two human-readable messages of RFC-21 R2 (`too_short`, `breached`) as `{ path: "password", message }`.

New codes in RFC-12 (mirrored in `ERROR_CODES`):

| Code | Status |
|---|---|
| `AUTH_INVALID_CREDENTIALS` | 401 |
| `AUTH_UNAUTHENTICATED` | 401 |
| `AUTH_TOTP_INVALID` | 401 |
| `AUTH_MFA_EXPIRED` | 401 |
| `AUTH_ACCOUNT_SUSPENDED` | 403 |
| `AUTH_TOKEN_INVALID` | 400 |
| `AUTH_PASSWORD_WEAK` | 400 |
| `AUTH_TOTP_ALREADY_ENABLED` | 409 |
| `AUTH_TOTP_NOT_ENABLED` | 409 |
| `USER_EMAIL_TAKEN` | 409 |

## 10. RFCs

New, all under `docs/rfc/20-auth/`:

- **RFC-20 Users and invitations** — user states and transitions, invitation token, acceptance, email normalization and uniqueness by blind index, `seed:admin`.
- **RFC-21 Passwords** — argon2id parameters, policy, breach check and its failure mode, dummy-hash rule, forgot/reset/change semantics and session revocation.
- **RFC-22 Login and sessions** — route list and the public allowlist (referenced by RFC-02 R12), identical-error rule, suspended disclosure rule, session cookie, TTLs, key derivation, status check per request, `me`, session listing and revocation.
- **RFC-23 TOTP** — secret, URI, window, replay guard, recovery codes, MFA cookie and attempt limit, enable/disable.
- **RFC-24 Rate limiting** — algorithm, scopes and limits, `Retry-After`, exemptions, audit of limited logins.

Amendments:

- **RFC-02 R12** — the public allowlist now points at RFC-22.
- **RFC-10 R5** — SMTP environment variables and the optional `smtp_password` secret.
- **RFC-12** — catalog rows above; `AUTH_` and `USER_` prefixes now in use.
- **RFC-40 R1** — adds `users.totp_secret` and the session record fields `ip`, `userAgent` in Redis; AAD names `session.ip`, `session.userAgent`, `totp_setup.secret`.
- **RFC-41 R3** — new actions `auth.login.totp_failure`, `auth.totp.recovery_used`, `auth.session.revoked`; R4 gains the `reason` metadata convention for login failures.

## 11. Testing

- **Unit:** password policy, argon2 parameters and dummy-hash timing shape, token hashing and expiry math, session TTL math (idle refresh, absolute cap), rate-limit window math, TOTP window and replay guard, recovery code format, HIBP client against a stubbed `fetch` (prefix only, padding, timeout → not breached), client IP extraction, contracts schemas (strict, extra field rejected).
- **Integration (testcontainers):** users repository (blind-index uniqueness, encrypted columns, `eq` on the encrypted column never matching), auth tokens (issue supersedes, consume once, expiry), session store on Redis (create/touch/list/revoke/revoke-all, encrypted `ip`/`userAgent`, HMAC keys), rate limiter against Redis, mailer over Nodemailer's stream transport.
- **API (`app.request()` against real Postgres + Redis):** every route, positive and negative (RFC-01 R6): no session → 401, extra body field → 400, invalid `Origin` → 403, rate limit → 429 with `Retry-After`; identical body and status for unknown email and wrong password; argon2 verify invoked for unknown emails (spy on the hashing module, not a timing assertion); suspended disclosed only with the correct password; TOTP flow end to end with a generated code; recovery code single use; password change revokes other sessions; reset revokes all; `me` after logout is 401; every audit entry written.
- **Meta:** `routes-guarded.test.ts` enumerates the Hono routes and fails when a route is neither behind `requireSession` nor on the RFC-22 public allowlist (plan 03 extends it to `requirePermission`); `error-codes` catalog test already parses RFC-12.
- **Fixtures:** `createUser({ status, password, totp })` inserts directly through Drizzle (the invitation flow is tested separately); `loginAs(user)` creates a session through `auth/sessions.ts` and returns the `Cookie` header. No shared seed.
- **Dev stack:** Mailpit receives invitation and reset emails; `seed:admin` prints the invitation link as well as sending it, so the flow works without opening Mailpit.

## 12. Out of scope (later plans)

- Roles, permissions, `requirePermission`, `permissions` in `me` (plan 03).
- Admin HTTP routes (`/api/admin/users…`, resend invite, suspend, session listing per user), self-service profile, export, erase, retention (plan 04).
- Any UI, E2E flows (plan 05).
- Passkeys, SSO, "remember this device", email change.
