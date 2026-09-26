# RFC-82 — External API

| Field | Value |
|---|---|
| Status | accepted |
| Category | integrations |
| Supersedes | — |

## Context

Admins fix the imported dataset from their own machines with R or Python scripts: they pull what is pending, correct it locally, and send the corrections back. The external API is not a second surface. It is the same `/api/*` routes the workspace calls, reached with a personal key instead of a session cookie, so every validation, permission check and authorship rule applies unchanged (design: `docs/specs/2026-09-26-external-api-design.md`).

## Rules

- **R1** An API key is `tr_live_` followed by 32 random bytes in base64url. It is shown once, when created; only its SHA-256 (hex) is stored, in `api_keys`, with the owner, a name (1–60 characters), the first 8 characters after `tr_live_` for display, the creation time, `expires_at` = creation + 90 days, `last_used_at` and `revoked_at`. Rows are never deleted.
- **R2** Only a user holding the `admin` system role can create or use a key. Creating one needs a session (R6), the current password and a current TOTP code, which is consumed like any other TOTP code (RFC-23 R3). A user without TOTP enabled gets 409 `AUTH_TOTP_NOT_ENABLED`; a user without the admin role gets 403 `PERMISSION_DENIED`. `POST /api/me/api-keys` is limited per user by the `apiKeyCreate` bucket (RFC-24 R3).
- **R3** Every request resolves `Authorization: Bearer <key>` before routing. The key authenticates when its hash exists, it is not revoked, it has not expired, its user is `active` and holds the `admin` system role (read on every request, not cached). The request then carries that `user`, and no session. A Bearer header that does not authenticate answers 401 `AUTH_UNAUTHENTICATED` on every route, public ones included, and the response does not say why; it is counted against the `global:ip` bucket first (RFC-24 R4), so a caller that keeps sending one may answer 429 `RATE_LIMITED` instead. `last_used_at` is written at most once a minute per key. Password reset, password change (RFC-21 R6, R7), TOTP disable (RFC-23 R7), sign out everywhere (RFC-22 R9) and suspension (RFC-50 R6) set `revoked_at` on every active key of the user, in the same transaction as the action, each key audited as `auth.api_key.revoked` with `metadata.reason` one of `password_reset`, `password_change`, `totp_disabled`, `logout_all`, `user_suspended` (actor: the user, or the suspending administrator). A revoked key stays revoked: reactivating the user (RFC-50 R7) or granting the admin role again brings no key back.
- **R4** A request carrying both a session cookie and a Bearer header answers 401 `AUTH_UNAUTHENTICATED`.
- **R5** A request with a Bearer header carrying a token (`Bearer <token>`, one token) and no `Cookie` header is exempt from the origin check (RFC-02 R3): a browser never attaches a Bearer header by itself, so there is no cross-site request to forge.
- **R6** A key reaches permission-guarded routes only. Every self-service route (RFC-32 R5), including key management, the profile, the password, TOTP, sessions, `GET /api/auth/me` and the help pages, needs a cookie session, so a key answers 401 there and cannot create another key. A key cannot manage identities, roles or sessions either: `requirePermission` answers 403 `PERMISSION_DENIED` to a key-authenticated request when the route needs `users.invite`, `users.update`, `users.suspend`, `users.delete`, `roles.manage` or `sessions.revoke` (RFC-32 R4), so a leaked key cannot mint an admin account, grant a role or sign the real administrators out. Every other permission-guarded route is reachable with the key owner's full permissions.
- **R7** `GET /api/me/api-keys` answers `{ eligible, keys }`: `eligible` is whether the user holds the admin system role; `keys` lists their keys, newest first, as `{ id, name, prefix, createdAt, expiresAt, lastUsedAt, revokedAt, state }` with `state` one of `active`, `expired`, `revoked`. `POST /api/me/api-keys` answers `{ key, secret }`. `DELETE /api/me/api-keys/:id` revokes one of the user's own active keys; any other id answers 404 `NOT_FOUND`.
- **R8** Creating and revoking a key write `auth.api_key.created` and `auth.api_key.revoked` (RFC-41), target `api_key`. Every audit entry written during a key-authenticated request carries `via: "api_key"` and `apiKeyId` in its metadata. Record and annotation writes stay provenance-only (RFC-65 R12): their `created_by` is the key's owner.
- **R9** Key-authenticated requests use the `global:api_key` bucket of RFC-24 R4, 3000 per 10 minutes per key, instead of the per-session bucket.

## Open questions

None.

## Changelog

- 2026-09-26 — Created with R1–R9 (plan 14a). R10–R21 (batch, documentation) arrive with plans 14b and 14c.
- 2026-09-26 — R3: account-recovery actions and suspension revoke every active key; a failing Bearer counts against `global:ip`. R5: the exemption needs a parseable token. R6: keys are refused on identity, role and session management (owner rulings, final review of plan 14a). R1–R9 accepted with plan 14a; R10–R21 arrive as `draft` with plans 14b and 14c.
