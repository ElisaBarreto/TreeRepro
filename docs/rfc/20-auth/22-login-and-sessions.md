# RFC-22 — Login and sessions

| Field | Value |
|---|---|
| Status | accepted |
| Category | auth |
| Supersedes | — |

## Context

Sessions are opaque identifiers stored in Redis and carried by a cookie. There is no JWT: revocation is immediate. This RFC also holds the route list that RFC-02 R12 refers to.

## Rules

- **R1** Routes of this RFC family and their guard. `public` routes form the allowlist of RFC-02 R12; every other route requires a session (R8) and, from RFC-32, a permission.

  | Route | Guard |
  |---|---|
  | `GET /api/health`, `GET /api/health/ready` | public (RFC-10 R10) |
  | `POST /api/auth/login` | public |
  | `POST /api/auth/login/totp` | public |
  | `POST /api/auth/invite/accept` | public |
  | `POST /api/auth/password/forgot` | public |
  | `POST /api/auth/password/reset` | public |
  | `POST /api/auth/logout`, `POST /api/auth/logout-all` | session |
  | `GET /api/auth/me` | session |
  | `POST /api/auth/password/change` | session |
  | `POST /api/auth/totp/setup`, `/confirm`, `/disable` | session |
  | `GET /api/me/sessions`, `DELETE /api/me/sessions/:id` | session |
  | `PATCH /api/me` | session (RFC-50 R11) |
  | `/api/admin/*` | permission (RFC-30 R5, RFC-50, RFC-51) |

- **R2** `POST /api/auth/login { email, password }`: look the user up by blind index; run the argon2 verification (RFC-21 R4); when it fails or the user is not `active`/`suspended`, answer 401 `AUTH_INVALID_CREDENTIALS` and audit `auth.login.failure` with `metadata.reason` in `unknown_email`, `wrong_password`, `not_active` (target `user` when the user exists). A `suspended` user whose password verified answers 403 `AUTH_ACCOUNT_SUSPENDED` (reason `suspended`): the status is disclosed only to someone holding the password.
- **R3** A verified user with TOTP enabled receives `{ data: { status: "totp_required" } }` and the MFA cookie (RFC-23 R6); no session exists yet. Otherwise a session is created, the cookie set, `auth.login.success` audited, and the response is `{ data: { status: "ok", user } }` with `user` as in R10.
- **R4** Session record: raw id of 32 random bytes (base64url) known only to the client; Redis key `session:<HMAC-SHA256(session_secret, rawId)>` (hex), a hash with `userId`, `createdAt`, `lastSeenAt` (epoch ms), `ip` and `userAgent` encrypted with RFC-40 (AAD `session.ip`, `session.userAgent`). The set `user_sessions:<userId>` indexes a user's session keys. Session ids exposed by the API (R11) are the HMAC values.
- **R5** Cookie `__Host-session=<rawId>; HttpOnly; Secure; SameSite=Strict; Path=/`. It is set on login, TOTP success and invitation acceptance, and cleared (`Max-Age=0`) on logout and whenever the server finds it invalid.
- **R6** Lifetime: idle 12 hours (the Redis TTL, refreshed by a request when `lastSeenAt` is older than 60 seconds) and absolute 7 days from `createdAt`. A session past either limit is deleted when next seen.
- **R7** Every request resolves the session before routing: cookie → record → user row. When the record is missing or expired, or the user is not `active`, the session is deleted, the cookie cleared and the request continues unauthenticated. Otherwise `user` and `session` are available to handlers.
- **R8** `requireSession` answers 401 `AUTH_UNAUTHENTICATED` when no session was resolved.
- **R9** `POST /api/auth/logout` deletes the current session and clears the cookie (audit `auth.logout`). `POST /api/auth/logout-all` deletes every session of the user including the current one (audit `auth.logout_all`). Both answer `{ data: { status: "ok" } }`.
- **R10** `GET /api/auth/me` answers `{ data: { user: { id, email, name, status, totpEnabled, createdAt }, permissions } }`; `permissions` is the user's effective permissions, sorted (RFC-32 R6).
- **R11** `GET /api/me/sessions` lists the user's sessions as `{ id, createdAt, lastSeenAt, ip, userAgent, current }` ordered by `lastSeenAt` descending. `DELETE /api/me/sessions/:id` revokes one of the user's own sessions (audit `auth.session.revoked`) and answers `{ data: { status: "ok" } }`; an id that is not one of the user's sessions answers 404 `NOT_FOUND`.
- **R12** The client IP is the last entry of `X-Forwarded-For` (Caddy discards untrusted incoming values and appends the remote address); without the header it is `unknown`. It is used for the audit log and rate limiting only and never logged (RFC-02 R7).

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
- 2026-09-12 — R1: admin route; R10: permissions filled (RFC-32).
- 2026-09-12 — R1: PATCH /api/me and the admin family (RFC-50, RFC-51).
