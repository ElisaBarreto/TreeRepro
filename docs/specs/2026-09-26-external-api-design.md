# TreeRepro — External API (plans 14a–14c)

**Date:** 2026-09-26
**Status:** approved design; nothing implemented yet
**Amendments:** 2026-09-26 (plan 14a): R-6 covers every self-service route (RFC-32 R5), not only account routes, because `requireSession` now demands a cookie session; the audit actions are `auth.api_key.created` and `auth.api_key.revoked`, following the RFC-41 naming; creating a key needs TOTP enabled (409 `AUTH_TOTP_NOT_ENABLED`) and is limited to 5 per 15 minutes per user. 2026-09-26 (owner ruling, final review of plan 14a): password reset, password change, TOTP disable, sign out everywhere, suspension, an administrator's revoke-all-sessions and removal of the admin role revoke every active key of the user in the same transaction (audited `auth.api_key.revoked` with a `reason`), so reactivation or a new admin grant never brings a key back (RFC-82 R3); a key-authenticated request is refused with 403 `PERMISSION_DENIED` on `users.invite`, `users.update`, `users.suspend`, `users.delete`, `roles.manage` and `sessions.revoke` (RFC-82 R6). 2026-09-26 (plan 14b): the batch answers inside the RFC-11 R2 envelope, `{ data: { summary, results } }`; the batch request counts as its first operation, so a batch of n costs n units; `POST /api/batch` is a fourth guard class (API-key, RFC-32 R5); a non-JSON answer gives `body: null`; a `GET` with a body is refused per item; the E2E sends catalog writes, because the E2E stack has no pending group. 2026-09-26 (plan 14c): the catalog holds a summary and an optional response schema only; guard, permission and request schemas are read from the mounted handlers; response schemas are referenced only where `packages/contracts` already has them; the docs routes are API-key routes; the handbook rule is `CLAUDE.md` rule 10.
**Scope:** script access (R, Python) to the whole platform with a personal API key, a batch endpoint, and self-updating documentation. Every decision below was confirmed with the owner on 2026-09-26.

## 0. Why

The imported dataset carries a large number of errors; the harmonisation queue on a small test sample already shows it. Admins need to pull the pending items, fix them on their own machine with their own tools, and send the fixes back in bulk. A fix sent through the API must be indistinguishable from the same fix made in the workspace: same validation, same permission checks, same authorship, same audit.

## 1. Decisions

- **D-1 JSON in, JSON out.** The API never speaks CSV. How the admin edits locally is their concern.
- **D-2 Full scope.** Every `/api/*` route the workspace uses is reachable by script, reads and writes, for every dataset area.
- **D-3 Same routes, second credential.** There is no separate API surface. A personal key is a second way to authenticate on the existing routes, so every rule the platform enforces applies unchanged and cannot drift. No write bypasses an existing route; nothing changes data at its origin outside the rules the workspace already applies.
- **D-4 Admins only, for now.** A key works only while its owner holds the `admin` system role. Per-permission and per-data-type scopes are future work and need their own design.
- **D-5 Personal key, 90 days.** A key belongs to one user. Everything done with it is attributed to that user exactly as in the workspace. It expires 90 days after creation; renewal means creating a new key.
- **D-6 Batch is partial.** A batch runs each operation independently, like clicks in the workspace: valid operations are applied, invalid ones come back with their error.
- **D-7 Two documentation layers.** A generated OpenAPI reference and a hand-written guide with a changelog, both served only to a valid key. CI fails when the API surface changes without the guide being updated.

## 2. Authentication (plan 14a)

- **R-1 Key format.** `tr_live_` followed by 32 random bytes in base64url. The raw key is shown once, at creation. Only its SHA-256 is stored.
- **R-2 Storage.** New table `api_keys`: `id`, `user_id`, `name`, `key_hash` (unique), `key_prefix` (first 8 characters after `tr_live_`, for display), `created_at`, `expires_at` (`created_at + 90 days`), `last_used_at`, `revoked_at`.
- **R-3 Resolution.** `resolveSession` also reads `Authorization: Bearer tr_live_…`. The key authenticates when it exists, is not revoked, is not expired, its user is `active` and its user holds the `admin` role. It then sets the same `user` on the context as a cookie session does, and `requirePermission` resolves permissions exactly as today. `last_used_at` is updated at most once per minute per key.
- **R-4 One credential per request.** A request carrying both a session cookie and a Bearer key is refused with `AUTH_UNAUTHENTICATED`. An invalid, expired or revoked key is refused the same way; the response never says which.
- **R-5 Origin check.** A request authenticated by a Bearer key and carrying no session cookie is exempt from the origin check (RFC-02 R3). Browsers never attach a Bearer header on their own, so CSRF does not apply.
- **R-6 Account routes need a session.** A key cannot change the password, TOTP, sessions or profile (`PATCH /api/me`), and cannot create or revoke keys. Those routes require a cookie session; a key-authenticated call answers `AUTH_UNAUTHENTICATED`. A key is also refused (403 `PERMISSION_DENIED`) on the permissions that create or change identities, roles or sessions (`users.invite`, `users.update`, `users.suspend`, `users.delete`, `roles.manage`, `sessions.revoke`), so a leaked key cannot mint another key, an admin account or a role grant that outlives its revocation.
- **R-7 Management.** **Settings › API keys** lists the user's keys (name, prefix, created, expires, last used, state) and lets them revoke one. Creating a key asks for the password and a current TOTP code. Suspending a user (RFC-50 R12) or removing their `admin` role makes every key of theirs stop working at once, through R-3; no cleanup job is needed.
- **R-8 Audit.** `api_key.create` and `api_key.revoke` are audit actions. Writes made with a key follow each route's existing audit rules; where a route writes an audit entry, its metadata gains `via: 'api_key'` and `apiKeyId`. Record and annotation writes stay provenance-only (RFC-65 R12): `created_by` is the key's owner.
- **R-9 Rate limit.** Key-authenticated calls are limited per key with the existing `rate-limit.ts`: 3000 operations per 10 minutes. A batch consumes one unit per operation (R-14).

## 3. Batch (plan 14b)

- **R-10 Endpoint.** `POST /api/batch`, key-authenticated only (a cookie session gets `AUTH_UNAUTHENTICATED`). Body: `{ ops: [{ ref?: string, method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE', path: string, body?: unknown }] }`, 1 to 500 operations.
- **R-11 Execution.** Operations run in order, one at a time. Each is dispatched as an internal request to the same application with the caller's Bearer key, so it goes through the same route, Zod schema, permission guard, rules and authorship. Each operation commits on its own.
- **R-12 Refused without running.** An operation whose `path` does not start with `/api/`, targets `/api/batch`, or targets an account route (R-6) is refused with `VALIDATION_FAILED` for that item; the rest of the batch still runs.
- **R-13 Response.** Always `200`: `{ summary: { ok, failed }, results: [{ ref, status, body }] }`, one result per operation in input order. `status` and `body` are exactly what the route answers on its own, including RFC-12 error codes. `ok` counts 2xx results.
- **R-14 Limits.** The rate limit counts operations, not calls; a batch that would exceed the remaining budget is refused whole with `RATE_LIMITED` before any operation runs.
- **R-15 Re-sending.** Re-sending a batch creates no duplicate records: record writes already use `ON CONFLICT … DO NOTHING`. Catalog creates that collide return the same duplicate error the workspace shows.
- **Deferred:** an operation using an ID created by an earlier operation of the same batch. The script sends two batches. Add when it is actually needed.

## 4. Documentation and the no-drift rule (plan 14c)

- **R-16 Route catalog.** One file lists every mounted `/api/*` route: method, path, guard (public, session, permission key), request schema and response schema (from `packages/contracts`). A meta-test, like RFC-32's, fails when a mounted route is missing from the catalog or the catalog names a route that is not mounted.
- **R-17 OpenAPI.** `openapi.json` is generated from the catalog with Zod 4's `z.toJSONSchema`. No new dependency.
- **R-18 Guide.** `docs/api/guide.md`: authentication, key lifecycle, the pending workflow (list pending traits, fetch groups by type and trait, map them in a batch), batch semantics, error codes, limits, R and Python examples, and a changelog, newest first.
- **R-19 CI lock.** The guide's first lines carry `openapi-sha256: <hash>`. A test generates the OpenAPI and compares its hash. Any change to the API surface fails CI until the hash is updated, which is done together with a changelog entry describing the change.
- **R-20 Serving.** `GET /api/docs` returns the guide (Markdown) and `GET /api/docs/openapi.json` the reference, both to a valid key only; without one they answer `AUTH_UNAUTHENTICATED`.
- **R-21 Handbook rule.** `CLAUDE.md` gains non-negotiable rule 8: a change that alters how data enters or leaves the platform, or any route's behaviour or shape, checks its effect on the API and updates the catalog, the guide and its changelog in the same PR.

## 5. RFC

RFC-82 `docs/rfc/80-integrations/82-external-api.md` holds R-1–R-21 as numbered rules. Plan 14a creates it with R-1–R-9; 14b and 14c add theirs. RFC-11 (API conventions) links to it.

## 6. Testing

TDD, integration tests with testcontainers, no database mocks.

- **Keys (14a):** a valid key authenticates; expired, revoked, suspended-user and non-admin keys are refused; cookie plus Bearer is refused; account routes refuse a key; the origin check exempts Bearer-only requests and still checks cookie requests; creation needs password and TOTP; create and revoke are audited; a record written with a key has `created_by` = the key's owner.
- **Batch (14b):** order is kept; a failing item does not affect the others; forbidden paths are refused per item; more than 500 operations is refused; the rate limit counts operations; a `POST /api/records/pending/map` inside a batch resolves the group with the key owner as author.
- **Docs (14c):** the route-catalog meta-test; the OpenAPI hash test; `/api/docs` refuses a missing key.
- **E2E:** create a key in Settings, resolve a pending group through `POST /api/batch` with it, see it resolved in `/app/curation/pending`.

## 7. Delivery

Three PRs, each usable on its own:

| Plan | Content | Estimate |
|---|---|---|
| 14a | Migration (next free number on `origin/main`), `api_keys`, Bearer in `resolveSession`, origin exemption, Settings › API keys, RFC-82 R1–R9 | 1–1.5 days |
| 14b | `POST /api/batch`, RFC-82 R10–R15 | half a day |
| 14c | Route catalog, OpenAPI, guide, `/api/docs`, CI locks, RFC-82 R16–R21, `CLAUDE.md` rule 8 | 1–2 days (≈60 routes to catalog) |
