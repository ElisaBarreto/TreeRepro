# TreeRepro — Administration Design (plan 04)

**Date:** 2026-09-12
**Status:** implemented (plan 04)
**Scope:** user administration over HTTP (list, invite, update, suspend, reactivate, re-invite, sessions), role administration over HTTP, audit-log query, self-service profile update (`PATCH /api/me`), audit-log retention (RFC-42, issue #4), RFCs 42, 50, 51 and the amendments they force. Refines sections 7–8 of the foundation design (`2026-09-12-foundation-design.md`) and closes issues #19 and #4. UI is plan 05 (#20).

## 1. Context

Plans 01–03 delivered the platform, authentication and authorization: encrypted PII (RFC-40), an append-only audit log (RFC-41), invitations, sessions, TOTP, a permission catalog, dynamic roles and `requirePermission`. Administrators still have no HTTP surface beyond `GET /api/admin/permissions`; the `seed:admin` command is the only way to create a user.

One decision changes the foundation design: **users are never erased or anonymized.** The people in this system are research collaborators whose contributions are cited in scientific publications. Their name and email persist for as long as the system exists so that authorship stays attributable. Offboarding is suspension. The GDPR still applies (collaborators are natural persons): the lawful basis for retaining identity is scientific research and the integrity of the scientific record (Art. 89; Art. 17(3)(d) exempts erasure where it would seriously impair research objectives). Encryption at rest (RFC-40), the audit log (RFC-41) and its retention (RFC-42) remain the protective measures.

Consequences: no erase endpoint, no `deleted` status, no data export (no demand; a collaborator sees their own profile through `GET /api/auth/me` and their sessions through `GET /api/me/sessions`).

Constraints inherited: backend is the only authority; every route belongs to exactly one guard class (RFC-02 R12, RFC-32 R5); business rules in RFCs; RFC → failing test → code (RFC-01).

## 2. Decisions summary

| Topic | Decision |
|---|---|
| Erasure and export | Dropped. Users are never deleted or anonymized; `deleted` status and `deleted_at` are removed; `users.delete` is retired in the catalog; `users.deleted` and `users.exported` leave the audit action catalog. |
| Offboarding | `POST /api/admin/users/:id/suspend`: status `suspended`, every session deleted, anti-lockout enforced. Reactivation restores `active`. |
| Self-service profile | Only `PATCH /api/me { name }`. `GET /api/me` does not exist: `GET /api/auth/me` already returns the profile and permissions. |
| Pagination | Keyset cursor on `id` descending for users and audit entries (UUID v7 is time-ordered, so this is insertion order and immune to the microsecond precision of `created_at`/`at`); the cursor is the base64url of the last id; malformed cursor answers 400 `VALIDATION_FAILED`. |
| Invitation mail failure | The user and token are committed (RFC-20 R4); the route answers 502 `MAIL_SEND_FAILED` so the administrator knows to re-send. |
| Audit retention | `audit_log_purge()` is a `SECURITY DEFINER` function with the 2-year retention hard-coded; `treerepro_app` loses `DELETE` on `audit_log`. The API process calls the function at boot and every 24 hours. |
| Audit entries | Returned with decrypted `ip` and `userAgent`; `audit.read` is the permission that grants seeing them. No join with the actor's name; the UI resolves names from the user list. |
| Module layout | New `apps/api/src/admin/` for user and session administration; audit query and retention live in `apps/api/src/audit/`; admin routes split by resource under `apps/api/src/http/routes/admin/`. |

## 3. Data model changes

### `users` (RFC-20 R1, amended)

- Column `deleted_at` dropped.
- Check constraint `users_status_check` rewritten to `('invited', 'active', 'suspended')`.
- `USER_STATUSES` in `packages/contracts` loses `deleted`.

### `permissions` (RFC-30 R1)

- Row `users.delete` stays; its description becomes `Erase users (retired)`. `PERMISSIONS` in `packages/contracts` carries the same text so the catalog test keeps passing. No route names it.

### `audit_log` (RFC-41, RFC-42)

- Function `audit_log_purge() RETURNS bigint`, `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public`, owned by `treerepro_migrator` (the migration runs as that role). Body: `PERFORM set_config('treerepro.allow_audit_purge', 'on', true); DELETE FROM audit_log WHERE at < now() - interval '2 years'; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;`.
- `REVOKE ALL ON FUNCTION audit_log_purge() FROM PUBLIC; GRANT EXECUTE ON FUNCTION audit_log_purge() TO treerepro_app;`
- `REVOKE DELETE ON audit_log FROM treerepro_app;` guarded by `IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'treerepro_app')`, as migration 0001 does for `UPDATE`.
- The trigger from migration 0001 stays as the second line of defense; the flag it checks is now set only inside the function.

### Migrations

| File | Content |
|---|---|
| `0005_users_no_delete.sql` | drop `deleted_at`; rewrite `users_status_check` |
| `0006_permissions_retire_delete.sql` | update the `users.delete` description |
| `0007_audit_retention.sql` | function, grants, `REVOKE DELETE` |

## 4. Modules (`apps/api/src`)

| Module | Responsibility |
|---|---|
| `admin/users.ts` | `listUsers(db, { status?, cursor?, limit })`, `getUser(db, id)` (with roles), `updateUserName(ctx, { actor, id, name })`, `suspendUser(ctx, { actor, id })`, `reactivateUser(ctx, { actor, id })`, `resendInvite(ctx, { actor, id })`. Throws `AppError` (`USER_NOT_FOUND`, `USER_INVALID_STATUS`, `ROLE_LAST_ADMIN`); re-throws `InvitationMailError`. |
| `admin/sessions.ts` | `listUserSessions(ctx, userId)`, `revokeUserSession(ctx, { actor, userId, sessionId })`, `revokeAllUserSessions(ctx, { actor, userId })`. Audit `sessions.revoked`. |
| `audit/query.ts` | `queryAudit(db, { actor?, action?, from?, to?, cursor?, limit })` → `{ data, nextCursor }`. |
| `audit/retention.ts` | `purgeAudit(db)` runs `SELECT audit_log_purge()`; `startRetentionTimer({ db, logger, intervalMs = 24h })` runs `purgeAudit` immediately and on an unref'd interval, logs the count, logs and swallows failures, returns `stop()`. Called only from `server.ts`. |
| `http/cursor.ts` | `encodeCursor(id)` / `decodeCursor(token)`; base64url of the uuid; `decodeCursor` throws `AppError('VALIDATION_FAILED')` with detail path `cursor`. |
| `http/routes/admin/index.ts` | Mounts `users.ts`, `roles.ts`, `audit.ts` and keeps `GET /permissions`. |
| `http/routes/admin/users.ts` | User and session routes (section 6). |
| `http/routes/admin/roles.ts` | Role routes over `access/roles.ts` (section 6). |
| `http/routes/admin/audit.ts` | `GET /audit`. |
| `http/routes/me.ts` | Adds `PATCH /` (name). |

`packages/contracts/src`: `users.ts` (`userSchema`, `userSummarySchema` for embedded roles, `listUsersQuerySchema`, `createUserBodySchema`, `updateUserBodySchema`, `updateMeBodySchema`), `audit.ts` (`auditEntrySchema`, `auditQuerySchema`), `roles.ts` gains `roleInputSchema` (`name`, `description`, `permissions`) and `updateRoleBodySchema` (all optional, at least one), `pagination.ts` (`cursorQuerySchema`: `cursor?: string`, `limit: 1..200 default 50`).

## 5. Representations

### `user` (RFC-50)

```json
{
  "id": "uuid", "email": "…", "name": "…",
  "status": "invited | active | suspended",
  "totpEnabled": false,
  "roles": [{ "id": "uuid", "name": "admin" }],
  "createdAt": "ISO", "updatedAt": "ISO", "suspendedAt": "ISO | null"
}
```

Never contains the password hash, TOTP secret or recovery codes.

### `auditEntry` (RFC-51)

```json
{
  "id": "uuid", "at": "ISO", "actorUserId": "uuid | null",
  "action": "auth.login.success", "targetType": "user | null", "targetId": "… | null",
  "ip": "… | null", "userAgent": "… | null", "metadata": {}
}
```

### Lists

`{ data: [...], meta: { nextCursor: string | null } }` (RFC-11 R2, R6).

## 6. Routes

Every `/api/admin/*` route carries exactly one `requirePermission`. Errors use RFC-12 codes; new codes in section 8.

### Users (RFC-50)

| Route | Permission | Behaviour |
|---|---|---|
| `GET /api/admin/users?status=&cursor=&limit=` | `users.read` | Keyset by `id` descending; optional `status` filter. |
| `POST /api/admin/users { email, name }` | `users.invite` | `inviteUser` (RFC-20 R4) with the actor; 201 with the user. Existing non-invited email: 409 `USER_EMAIL_TAKEN`. Mail failure: 502 `MAIL_SEND_FAILED`; user and token are kept. |
| `GET /api/admin/users/:id` | `users.read` | 404 `USER_NOT_FOUND`. |
| `PATCH /api/admin/users/:id { name?, roles? }` | `users.update` | One transaction. `name` → `users.updated` with `metadata.fields: ['name']`. `roles` (role ids) → `setUserRoles` (RFC-31: audit `users.roles_changed`, `ROLE_LAST_ADMIN`, `ROLE_NOT_FOUND`). Empty body: 400. |
| `POST /api/admin/users/:id/suspend` | `users.suspend` | Only `active` → 409 `USER_INVALID_STATUS` otherwise. `assertNotLastAdmin` (409 `ROLE_LAST_ADMIN`). Sets `status`, `suspended_at`, `updated_at`; deletes every session of the user from Redis after commit; audit `users.suspended`. |
| `POST /api/admin/users/:id/reactivate` | `users.suspend` | Only `suspended`. Clears `suspended_at`; audit `users.reactivated`. |
| `POST /api/admin/users/:id/resend-invite` | `users.invite` | Only `invited` (RFC-20 R7); otherwise 409 `USER_INVALID_STATUS`. Re-issues the token, audit `auth.invite.created`, sends mail; failure 502 as above. |
| `GET /api/admin/users/:id/sessions` | `sessions.read` | RFC-22 R11 shape, `current` always `false`. |
| `DELETE /api/admin/users/:id/sessions/:sessionId` | `sessions.revoke` | Audit `sessions.revoked` (target `session`). Unknown session: 404 `NOT_FOUND`. |
| `DELETE /api/admin/users/:id/sessions` | `sessions.revoke` | Deletes all; audit `sessions.revoked` (target `user`, `metadata.count`). |

Mutations answer `{ data: user }` (user routes) or `{ data: { status: 'ok' } }` (session revocation), matching existing routes.

### Roles (RFC-50; semantics in RFC-31)

| Route | Permission |
|---|---|
| `GET /api/admin/roles` | `roles.read` |
| `POST /api/admin/roles { name, description, permissions }` | `roles.manage` (201) |
| `GET /api/admin/roles/:id` | `roles.read` |
| `PATCH /api/admin/roles/:id { name?, description?, permissions? }` | `roles.manage` |
| `DELETE /api/admin/roles/:id` | `roles.manage` (`{ data: { status: 'ok' } }`) |

### Audit (RFC-51)

`GET /api/admin/audit?actor=&action=&from=&to=&cursor=&limit=` — `audit.read`. `action` must be a catalog key; `from > to` is a validation error. Keyset by `id` descending.

### Self-service (RFC-50)

`PATCH /api/me { name }` — `requireSession`; audit `users.updated` with actor = target = the user; answers `{ data: user }`. Added to the self-service list in RFC-32 R5.

## 7. Retention timer (RFC-42)

`server.ts` calls `startRetentionTimer` after the HTTP server is listening. The first run happens immediately, later runs every 24 hours. Each run logs `audit retention: purged <n> entries`; a failure logs at `error` level with the request-less logger and the process keeps running. The interval is `unref()`'d so it never keeps the process alive. `app.ts` does not start it, so integration tests never purge.

## 8. Contracts and error codes

New RFC-12 codes:

| Code | Status | Meaning |
|---|---|---|
| `USER_NOT_FOUND` | 404 | User id does not exist. |
| `USER_INVALID_STATUS` | 409 | The action is not allowed in the user's current status. |
| `MAIL_SEND_FAILED` | 502 | The invitation email could not be sent; the invitation can be re-sent. |

Removed from `USER_STATUSES`: `deleted`. Removed from `AUDIT_ACTIONS`: `users.deleted`, `users.exported`.

## 9. RFCs

| RFC | Title | Content |
|---|---|---|
| RFC-42 | Audit retention | 2-year retention, `audit_log_purge()`, privilege model, API timer. |
| RFC-50 | User administration | Representation, list, invite, update, suspend/reactivate, re-invite, session administration, role routes, `PATCH /api/me`, the no-erasure rule and its lawful basis. |
| RFC-51 | Audit query | Query parameters, ordering, entry shape, validation. |

Amendments:

- RFC-20 R1 (no `deleted_at`, status check), R2 (no `deleted` transition; offboarding is suspension; identity persists for scientific authorship), R9 (rationale unchanged).
- RFC-30 catalog: `users.delete` → `Erase users (retired)`.
- RFC-31 R7: "Suspended and invited holders do not count."
- RFC-32 R5: `PATCH /api/me` in the self-service list.
- RFC-41 R2 and R9 (app role holds neither `UPDATE`, `DELETE` nor `TRUNCATE`; only `audit_log_purge()` deletes), R6 (points to RFC-42), action catalog (remove `users.deleted`, `users.exported`).
- RFC-12: three new codes.
- Foundation design §7 "Data-subject rights" and §8 admin/self-service tables: superseded note pointing here.

## 10. Testing

- Unit: `http/cursor.ts` round trip and malformed input; contract schemas (strictness, `limit` bounds, `roles` array of uuids, empty PATCH bodies rejected); `actions.test.ts` and `permissions.test.ts` still match the RFC tables; `retention.ts` with fake timers (first run immediate, interval, failure swallowed, `stop()`).
- Integration, per route: 401 without session, 403 without permission, success, and each state error. Users: list order, cursor continuation, `status` filter, `limit` bounds; invite happy path and mail failure (502, user stays, re-invite works); PATCH name and roles (audit entries, `ROLE_LAST_ADMIN`); suspend (sessions gone, suspended user cannot log in, last admin refused); reactivate; resend-invite on non-invited. Sessions: list, revoke one, revoke all. Roles: CRUD over HTTP. Audit query: each filter, cursor, invalid `action`, `from > to`. `PATCH /api/me`.
- `routes-guarded.integration.test.ts` classifies every new route without changes to its logic.
- `db/privileges.integration.test.ts`: `DELETE FROM audit_log` as `treerepro_app` fails by privilege; `SELECT audit_log_purge()` as `treerepro_app` succeeds; a row with `at` three years old is purged, one a year old stays.
- `db/schema/users.integration.test.ts`: `deleted` rejected by the check constraint; `deleted_at` absent.

## 11. Out of scope

- Admin UI and `/settings` page (plan 05, #20).
- Data export, erasure, anonymization (decision in section 1).
- Changing a user's email.
- Actor names in audit entries.
