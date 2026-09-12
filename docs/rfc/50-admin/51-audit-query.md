# RFC-51 — Audit query

| Field | Value |
|---|---|
| Status | accepted |
| Category | admin |
| Supersedes | — |

## Context

Administrators holding `audit.read` inspect the audit log (RFC-41) through one paginated, filterable route. The entries carry the decrypted `ip` and `user_agent`: seeing them is what the permission grants.

## Rules

- **R1** `GET /api/admin/audit?actor=&action=&from=&to=&cursor=&limit=` (`audit.read`). `actor` is a user id (`actor_user_id` equality); `action` is one key of the RFC-41 catalog; `from` and `to` are millisecond-precision instants (ISO 8601) bounding `at`: `from` inclusive (`at >= from`); `to` inclusive of its whole millisecond (`at < to + 1 ms`), because `audit_log.at` keeps microsecond precision and `from`/`to` cannot carry it. Pagination is RFC-11 R6.
- **R2** Entry: `{ id, at, actorUserId, action, targetType, targetId, ip, userAgent, metadata }`; `ip` and `userAgent` are decrypted (RFC-40 R8); nullable fields are `null`, never omitted. Answer `{ data: entry[], meta: { nextCursor } }`.
- **R3** Order is `id` descending (UUID v7, insertion order); the cursor is a keyset on `id`, as in RFC-50 R2.
- **R4** Validation: an `action` outside the catalog, a malformed `actor`, `from` or `to`, or `from` later than `to` answers 400 `VALIDATION_FAILED` with the failing path in `details`. Reading the audit log is not itself audited.

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — R1: `from`/`to` are millisecond-precision instants; `to` is inclusive of its whole millisecond (`at < to + 1 ms`), matching `audit_log.at`'s microsecond precision.
- 2026-09-12 — accepted.
