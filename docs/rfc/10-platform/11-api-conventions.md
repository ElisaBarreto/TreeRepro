# RFC-11 — API conventions

| Field | Value |
|---|---|
| Status | accepted |
| Category | platform |
| Supersedes | — |

## Context

One shape for every request and response so that the web client, tests and future scripts (R, Python) can rely on it.

## Rules

- **R1** Every API route is mounted under `/api`. Caddy proxies `/api/*` to the API process and nothing else.
- **R2** Successful responses have the shape `{ "data": <payload> }`. List responses add `"meta": { "nextCursor": <string | null> }`. The only exceptions are the health endpoints (RFC-10 R10) and file downloads (RFC-66 R7), whose errors still use the R3 envelope.
- **R3** Error responses have the shape `{ "error": { "code": <code>, "message": <text>, "details"?: [{ "path": <string>, "message": <string> }] } }`. `code` is from RFC-12. `message` is one English sentence for humans and never contains internals (RFC-02 R9). `details` appears only for validation errors, lists the failing field paths, and never echoes received values.
- **R4** The HTTP status of an error response is the one assigned to its code in RFC-12; a code has exactly one status.
- **R5** Every response carries `X-Request-Id` (RFC-10 R12).
- **R6** Lists paginate by cursor: query `cursor` (opaque string, optional) and `limit` (integer, default 50, maximum 200). Offset pagination is not offered.
- **R7** Request bodies are JSON sent with `Content-Type: application/json`. A body with any other content type is rejected with 400 `VALIDATION_FAILED` and a single detail `{ "path": "", "message": "Expected application/json" }`; malformed JSON answers 400 `VALIDATION_INVALID_JSON`.
- **R8** An unknown route answers 404 `NOT_FOUND` using the error envelope.
- **R9** JSON fields are camelCase. Timestamps are ISO 8601 strings in UTC. Identifiers are UUID strings.

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
- 2026-09-13 — R2: file downloads (RFC-66).
