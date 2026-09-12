# RFC-12 — Error codes

| Field | Value |
|---|---|
| Status | accepted |
| Category | platform |
| Supersedes | — |

## Context

Clients branch on stable codes, never on messages. This catalog is the single list.

## Rules

- **R1** Codes are `SCREAMING_SNAKE_CASE` and start with a domain prefix (`VALIDATION_`, `SECURITY_`, `AUTH_`, `PERMISSION_`, `USER_`, `ROLE_`, or a generic word for cross-cutting codes).
- **R2** A code is never renamed, reused with a different meaning, or given a different status once published. Retiring a code keeps its row with "(retired)".
- **R3** The catalog below is mirrored exactly by `ERROR_CODES` in `packages/contracts/src/error-codes.ts`; a test parses this table and fails on any difference.
- **R4** Each code maps to exactly one HTTP status (RFC-11 R4).

## Catalog

| Code | Status | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Request failed schema validation; `details` lists failing fields (RFC-02 R2). |
| `VALIDATION_INVALID_JSON` | 400 | Request body is not valid JSON (RFC-11 R7). |
| `SECURITY_INVALID_ORIGIN` | 403 | Mutating request without a valid `Origin` header (RFC-02 R3). |
| `NOT_FOUND` | 404 | Route or resource does not exist (RFC-11 R8). |
| `REQUEST_TOO_LARGE` | 413 | Body exceeds 1 MiB (RFC-02 R4). |
| `RATE_LIMITED` | 429 | Too many requests; `Retry-After` header is set. |
| `INTERNAL_ERROR` | 500 | Unexpected failure; see logs by request id (RFC-02 R9). |
| `SERVICE_UNAVAILABLE` | 503 | A dependency is down (RFC-10 R10). |

Reserved prefixes for later RFCs: `AUTH_` (RFC-2x), `PERMISSION_` (RFC-3x), `USER_` and `ROLE_` (RFC-5x).

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
