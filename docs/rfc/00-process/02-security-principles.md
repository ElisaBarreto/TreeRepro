# RFC-02 — Security principles

| Field | Value |
|---|---|
| Status | accepted |
| Category | process |
| Supersedes | — |

## Context

TreeRepro holds personal data of its users and scientific data whose integrity matters. These principles apply to every line of code. Specific mechanisms (sessions, permissions, encryption) have their own RFCs; this one sets the baseline.

## Rules

- **R1** The backend (`apps/api`) is the only authority. The frontend is a display layer: nothing it sends is trusted, nothing it computes is used for a decision.
- **R2** Every request body, query string and path parameter is validated by a strict Zod schema from `packages/contracts` before a handler runs. Unknown fields are rejected with 400 `VALIDATION_FAILED`. Malformed JSON is rejected with 400 `VALIDATION_INVALID_JSON`.
- **R3** Every mutating request (POST, PUT, PATCH, DELETE) must carry an `Origin` header exactly equal to the configured `APP_ORIGIN`; otherwise the API answers 403 `SECURITY_INVALID_ORIGIN` before any handler runs. Safe methods (GET, HEAD, OPTIONS) are exempt.
- **R4** Request bodies larger than 1 MiB are rejected with 413 `REQUEST_TOO_LARGE`.
- **R5** Every API response carries: `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`. The SPA served by Caddy in production carries a strict CSP (`default-src 'self'`, no inline scripts), HSTS, and the same three headers. In development Caddy sets no CSP because Vite injects inline scripts.
- **R6** Secrets are read only from files under `/run/secrets` (Docker secrets; `SECRETS_DIR` overrides the directory for tests). A missing or malformed secret aborts process start. Secrets are never logged, never placed in environment variables, never returned by any endpoint.
- **R7** Application logs redact these keys at the top level and one level deep: `password`, `passwordHash`, `token`, `secret`, `email`, `ip`, `userAgent`; plus `req.headers.cookie`, `req.headers.authorization`, `res.headers.set-cookie`, `user.name`, `body.name`, `input.name`. Client IP addresses appear only in the audit log (RFC-41), never in application logs.
- **R8** All identifiers exposed by the API are UUID v7 (`uuidv7()` in PostgreSQL 18). Sequential integers are never exposed.
- **R9** Error responses never include stack traces, internal messages, SQL, or file paths. Unexpected errors answer 500 `INTERNAL_ERROR` with a fixed message; the details go to the log with the request ID.
- **R10** Containers run as a non-root user with a read-only filesystem, all capabilities dropped and `no-new-privileges`. Only Caddy publishes a port in production.
- **R11** Dependencies are pinned to exact versions; the lockfile is committed; `pnpm audit --audit-level high` runs in CI; Docker base images are pinned by tag and digest.
- **R12** Every API route is protected by a permission guard (RFC-32, future) unless it appears on the explicit public allowlist: `GET /api/health`, `GET /api/health/ready`, and the authentication routes listed in RFC-22. A test enumerates registered routes and fails on any unguarded route.
- **R13** Cryptographic randomness comes only from `node:crypto` (`randomBytes`, `randomUUID`). `Math.random` is never used for anything security-relevant.

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
