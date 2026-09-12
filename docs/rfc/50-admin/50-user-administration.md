# RFC-50 — User administration

| Field | Value |
|---|---|
| Status | accepted |
| Category | admin |
| Supersedes | — |

## Context

Administrators manage the people who collaborate in the project: invite them, edit their name and roles, suspend and reactivate them, and look after their sessions. Users are research collaborators whose contributions are cited in scientific publications; their identity is therefore permanent (R12). Every route here is permission-guarded (RFC-32 R5); the permissions are the catalog of RFC-30. Role semantics are RFC-31; this RFC only maps them to HTTP.

## Rules

- **R1** Representation `user`: `{ id, email, name, status, totpEnabled, roles: [{ id, name }], createdAt, updatedAt, suspendedAt }`. `roles` is ordered by name case-insensitively; `suspendedAt` is null unless the user is suspended. The password hash, TOTP secret and recovery codes never appear. A `name` is trimmed and 1–120 characters (`nameSchema`); the email rules are RFC-20 R3.
- **R2** `GET /api/admin/users?status=&cursor=&limit=` (`users.read`) lists users newest first, ordered by `id` descending (UUID v7 is time-ordered, RFC-02 R8), optionally filtered by `status`; pagination is RFC-11 R6 with a keyset cursor on `id`. Answer `{ data: user[], meta: { nextCursor } }`.
- **R3** `POST /api/admin/users { email, name }` (`users.invite`) runs `inviteUser` (RFC-20 R4) with the caller as actor and answers 201 `{ data: user }`. An email held by a non-invited user answers 409 `USER_EMAIL_TAKEN` (RFC-20 R3, R7). When the invitation email cannot be sent the user and token stay committed and the route answers 502 `MAIL_SEND_FAILED`; the invitation can be re-sent (R8).
- **R4** `GET /api/admin/users/:id` (`users.read`) answers `{ data: user }`; an unknown id answers 404 `USER_NOT_FOUND`. Every `:id` route of this RFC answers 404 `USER_NOT_FOUND` the same way; a malformed id is 400 `VALIDATION_FAILED`.
- **R5** `PATCH /api/admin/users/:id { name?, roles? }` (`users.update`): at least one field (else 400 `VALIDATION_FAILED`). Both changes run in one transaction: `name` sets `users.name` and `updated_at` and audits `users.updated` (target `user`, `metadata.fields: ['name']`) only when the value differs; `roles` (role ids) calls `setUserRoles` (RFC-31 R6, R7: audit `users.roles_changed`, 404 `ROLE_NOT_FOUND`, 409 `ROLE_LAST_ADMIN`). The permission cache is invalidated again after commit. Answer `{ data: user }`.
- **R6** `POST /api/admin/users/:id/suspend` (`users.suspend`): only an `active` user (else 409 `USER_INVALID_STATUS`); `assertNotLastAdmin` applies (409 `ROLE_LAST_ADMIN`). Sets `status = 'suspended'`, `suspended_at`, `updated_at` and audits `users.suspended` in one transaction; after commit every session of the user is deleted and the permission cache invalidated. Answer `{ data: user }`.
- **R7** `POST /api/admin/users/:id/reactivate` (`users.suspend`): only a `suspended` user (else 409 `USER_INVALID_STATUS`). Sets `status = 'active'`, clears `suspended_at`, sets `updated_at`, audits `users.reactivated`. Answer `{ data: user }`.
- **R8** `POST /api/admin/users/:id/resend-invite` (`users.invite`): only an `invited` user (else 409 `USER_INVALID_STATUS`). Runs `inviteUser` for the user's email (RFC-20 R7: new token, old ones consumed, audit `auth.invite.created`, email sent). Mail failure answers 502 `MAIL_SEND_FAILED` as in R3. Answer `{ data: user }`.
- **R9** Session administration. `GET /api/admin/users/:id/sessions` (`sessions.read`) lists the user's sessions in the RFC-22 R11 shape with `current` always `false`. `DELETE /api/admin/users/:id/sessions/:sessionId` (`sessions.revoke`) revokes one session of that user (a session that is not theirs answers 404 `NOT_FOUND`) and audits `sessions.revoked` (target `session`). `DELETE /api/admin/users/:id/sessions` (`sessions.revoke`) revokes all and audits `sessions.revoked` (target `user`, `metadata.count`). Both answer `{ data: { status: "ok" } }`. Audit entries of R5–R9 carry the administrator's `ip` and `user_agent`.
- **R10** Role routes, all under `/api/admin/roles`, with the semantics of RFC-31: `GET /` (`roles.read`) lists roles by name; `POST / { name, description?, permissions }` (`roles.manage`) answers 201 `{ data: role }`; `GET /:id` (`roles.read`), `PATCH /:id { name?, description?, permissions? }` (`roles.manage`, at least one field) answer `{ data: role }`; `DELETE /:id` (`roles.manage`) answers `{ data: { status: "ok" } }`. Unknown permission keys answer 400 `PERMISSION_UNKNOWN` from the service (RFC-31 R3), not from schema validation.
- **R11** `PATCH /api/me { name }` (self-service, RFC-32 R5) sets the caller's own name under the rules of R5 (audit `users.updated` with the caller as actor and target) and answers `{ data: user }`. There is no `GET /api/me`: `GET /api/auth/me` (RFC-22 R10) is the profile.
- **R12** Users are never deleted or anonymized by the system, by administrators or by themselves; there is no erase or export endpoint. Offboarding is suspension (R6). Lawful basis for retaining identity: GDPR Art. 6(1)(f) — the legitimate interest of the project and of the scientific community in the integrity and attributability of the scientific record. Necessity: a collaborator's name and email are needed for as long as their contributions can be published, cited or audited; erasure would make attribution impossible or seriously impair it, so the Art. 17(3)(d) exemption applies to that extent. Safeguards required by Art. 89(1): encryption at rest (RFC-40), access limited to permission-guarded routes (RFC-32), the append-only audit log (RFC-41) and its retention (RFC-42), suspension instead of deletion. Scope and review: an erasure request from a person with no attributable contributions is assessed by the project owner (the data controller) outside the API; retained identities are reviewed whenever a collaborator is suspended.

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
- 2026-09-13 — R12: lawful basis restated (Art. 6(1)(f)); scope of the erasure exemption; review.
