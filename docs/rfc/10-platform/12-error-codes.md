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
| `AUTH_INVALID_CREDENTIALS` | 401 | Unknown email, wrong password, or account that cannot log in (RFC-21 R4, RFC-22 R2). |
| `AUTH_UNAUTHENTICATED` | 401 | No valid session on a route that requires one (RFC-22 R8). |
| `AUTH_TOTP_INVALID` | 401 | TOTP or recovery code rejected (RFC-23 R3, R6, R7). |
| `AUTH_MFA_EXPIRED` | 401 | MFA challenge missing, expired or exhausted (RFC-23 R6). |
| `AUTH_ACCOUNT_SUSPENDED` | 403 | Password verified but the account is suspended (RFC-22 R2). |
| `AUTH_TOKEN_INVALID` | 400 | Invitation or reset token unknown, expired or consumed (RFC-20 R6, RFC-21 R6). |
| `AUTH_PASSWORD_WEAK` | 400 | Password too short or breached; `details` names the reason (RFC-21 R2). |
| `AUTH_TOTP_ALREADY_ENABLED` | 409 | TOTP setup requested while enabled (RFC-23 R2). |
| `AUTH_TOTP_NOT_ENABLED` | 409 | TOTP disable requested while off (RFC-23 R7). |
| `USER_EMAIL_TAKEN` | 409 | Another account already uses this email (RFC-20 R3). |
| `PERMISSION_DENIED` | 403 | Session user lacks the route's permission or the resource rule refused (RFC-32 R4). |
| `PERMISSION_UNKNOWN` | 400 | A permission key is not in the catalog; `details` lists them (RFC-31 R3). |
| `ROLE_NOT_FOUND` | 404 | Role id does not exist (RFC-31 R4, R6). |
| `ROLE_NAME_TAKEN` | 409 | Another role has this name, case-insensitively (RFC-31 R3). |
| `ROLE_IS_SYSTEM` | 409 | The `admin` system role cannot be changed or deleted (RFC-31 R2). |
| `ROLE_LAST_ADMIN` | 409 | The change would leave no active administrator (RFC-31 R7). |

Reserved prefixes for later RFCs: `USER_` beyond `USER_EMAIL_TAKEN` (RFC-5x).

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
- 2026-09-12 — AUTH_* and USER_EMAIL_TAKEN added (RFC-20–23).
- 2026-09-12 — PERMISSION_* and ROLE_* codes (RFC-31, RFC-32).
