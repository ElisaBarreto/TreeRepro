# TreeRepro — Foundation Design

**Date:** 2026-09-12
**Status:** approved (design), pending implementation plan
**Scope:** infrastructure, authentication, authorization, data protection, admin area, security baseline, development process, testing strategy. Business features (scientific data collection) are out of scope and will be designed separately on top of this foundation.

## 1. Context

TreeRepro is a scientific data-collection and organization system. Several scientists collaborate to organize data that will eventually back a research article. Everything sits behind a login; nothing is public. Access is controlled per page and per feature within a page. Administrators manage users, roles and permissions. The system must comply with the GDPR (EU). Personal data in the system is limited to the system's own users (name, email, IP, user agent); research data is not personal data.

Non-negotiable project policies:

- **RFCs are the source of truth** for every business rule. Every exported function links to its RFC.
- **TDD is mandatory.** No production code without a failing test first.
- **Never trust the frontend.** The frontend only renders. All validation, computation and authorization happen in the backend.
- **Security from day one.**
- **Latest stable versions only.** No legacy versions.
- **All artifacts in English** (code, comments, docs, RFCs, UI, commits). Conversation with the user is in Portuguese.

## 2. Decisions summary

| Topic | Decision |
|---|---|
| Architecture | Monorepo: `apps/api` (Hono) + `apps/web` (Vite React SPA), shared `packages/contracts`. Physical front/back boundary. |
| Sign-in | Admin invitation only. Email + password. TOTP 2FA optional per user. |
| Permissions | Fixed permission catalog in code (mirrored by RFC); dynamic roles created by admins; users have N roles. |
| Personal data | Only system users' data is PII. Research data is not personal. |
| Hosting | Own VPS, Docker Compose, Caddy with automatic TLS. |
| Language | Everything in English. |
| Source hosting | GitHub (repository not created yet; work locally until then). |
| Project name | TreeRepro (identifiers: `treerepro`, package scope `@treerepro/`). |

## 3. Versions (verified 2026-09-12)

| Component | Version |
|---|---|
| Node | 24.21 LTS (26 becomes LTS in Oct 2026; revisit then) |
| PostgreSQL | 18.6 (`postgres:18.6-alpine`) |
| Redis | 8.8 (`redis:8.8-alpine`) |
| Caddy | 2.9 (`caddy:2.9-alpine`) |
| TypeScript | 7.0 (native). Fallback 6.0.3 if tooling breaks; record in `docs/gotchas/typescript.md`. |
| Hono | 4.13 |
| React | 19.3 |
| Vite | 8.3 |
| Tailwind CSS | 4.3 |
| Drizzle ORM / Kit | 0.45 / 0.31 |
| Zod | 4.6 |
| Vitest | 5.0 |
| Playwright | 1.63 |
| Biome | 2.5 |
| pnpm | 12 |
| testcontainers | 12 |
| Compose | v5.5 |

Exact versions are pinned in `package.json` (no `^`). Docker base images pin a digest.

## 4. Repository layout, tooling, Docker

```
treerepro/
├── apps/
│   ├── api/                # Hono 4 on Node 24. The only process that touches DB/Redis/secrets.
│   └── web/                # Vite 8 + React 19 SPA. UI only.
├── packages/
│   ├── contracts/          # Zod schemas + shared types (request/response), permission catalog
│   └── config/             # base tsconfig, base biome config
├── infra/
│   ├── docker/             # Dockerfiles (api, web), Caddyfile
│   ├── postgres/           # init SQL (roles, extensions)
│   └── secrets/            # gitignored; Compose secrets files
├── docs/
│   ├── rfc/                # source of truth (section 10)
│   ├── gotchas/            # <area>.md
│   ├── specs/              # design documents
│   └── plans/              # implementation plans
├── .github/workflows/ci.yml
├── compose.yml             # base: postgres, redis, api, web, caddy, mailpit(dev)
├── compose.dev.yml         # override: hot reload, published ports, mailpit
├── compose.prod.yml        # override: TLS, secrets, no published DB/Redis ports
├── README.md
└── package.json            # pnpm workspaces
```

**Tooling:** pnpm workspaces; TypeScript 7 (`tsgo` for type-check); Biome (lint + format, replaces ESLint + Prettier); Vitest; Playwright. No Turborepo yet (two apps; `pnpm -r` is enough).

**Docker Compose services:**

- `postgres` — `postgres:18.6-alpine`, named volume, `scram-sha-256`, application user without superuser/`CREATEDB`, separate `treerepro_migrator` user for migrations. No `pgcrypto`: encryption happens in the app; the key never reaches the database. `gen_random_uuid()` is built in.
- `redis` — `redis:8.8-alpine`, `requirepass`, `maxmemory-policy noeviction` (sessions must not be evicted), AOF persistence.
- `api` — multi-stage image, non-root user, `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`, `tmpfs /tmp`, healthcheck on `/health`.
- `web` — static build served by Caddy; no Node in production.
- `caddy` — `/api/*` proxied to `api:3000`, everything else serves the SPA. Dev: plain HTTP on `localhost`. Prod: automatic Let's Encrypt TLS. Only container with a published port in prod.
- `mailpit` — dev only; captures outgoing email.
- `backup` — daily `pg_dump`, encrypted with `age` (public key inside the container, private key kept off-server), written to a `backups` volume.

Network: `postgres` and `redis` publish no ports in prod. Dev publishes 5432/6379 for inspection only.

Secrets: Compose `secrets:` backed by files in `infra/secrets/` (gitignored). `DB_PASSWORD`, `DB_MIGRATOR_PASSWORD`, `REDIS_PASSWORD`, `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY`, `SESSION_SECRET`, `SMTP_*`. Never in `environment:`. The API reads `/run/secrets/*` at boot and refuses to start if any is missing.

Dev loop: `docker compose up` starts everything; `api` and `web` hot-reload through bind mounts. Tests run outside Compose; Vitest starts ephemeral Postgres/Redis through testcontainers.

## 5. Authentication

### Invitation (no public sign-up)

1. Admin creates a user: email, name, roles. The system generates an invitation token (32 random bytes), stores only its SHA-256 hash, expiry 72 h.
2. Email with link `/invite/<token>` via SMTP (Nodemailer). Dev uses Mailpit.
3. User opens the link, sets a password, optionally enables TOTP. Token is consumed; status becomes `active`.
4. User states: `invited` → `active` → `suspended` (by admin) → `deleted` (soft; see section 7). Re-sending an invitation invalidates the previous token.

### Password

- argon2id (`@node-rs/argon2`) with OWASP parameters (m = 19 MiB, t = 2, p = 1).
- Policy: minimum 12 characters; checked against Have I Been Pwned (k-anonymity, partial hash). If the HIBP call fails, the check is skipped (never blocks). No composition rules.

### Login

- Email + password. If the user has TOTP enabled, a second step requires a 6-digit code (window ±1 step). Ten single-use recovery codes are issued at TOTP setup, stored hashed.
- Identical error for unknown email and wrong password (no enumeration). Constant-time behavior: argon2 always runs, against a dummy hash when the email does not exist.
- Rate limiting (Redis): 5 attempts / 15 min per email+IP; 20 / 15 min per IP. Progressive lockout, never permanent. Every attempt is audited.

### Session

- Opaque session ID: 32 random bytes. Stored in Redis at `session:<id>` with `{ userId, createdAt, lastSeenAt, ip, userAgent }`.
- TTL: 12 h idle, 7 days absolute.
- Cookie `__Host-session`: `HttpOnly; Secure; SameSite=Strict; Path=/`.
- No JWT. Revocation is immediate. Logout deletes the key. Admins can list and revoke any user's sessions ("logout everywhere").

### Password recovery and change

- "Forgot password" issues a token like the invitation token (hash stored, 1 h expiry). The response is always "if the account exists, an email was sent".
- Changing the password revokes all sessions except the current one.

### CSRF

`SameSite=Strict` plus `Origin` header verification on every mutating request (POST/PUT/PATCH/DELETE). Mutations without a valid `Origin` are rejected with 403. No additional CSRF token.

### Endpoints

`POST /api/auth/login`, `/login/totp`, `/logout`, `/logout-all`, `/invite/accept`, `/password/forgot`, `/password/reset`, `/password/change`, `/totp/setup`, `/totp/confirm`, `/totp/disable`; `GET /api/auth/me`.

## 6. Authorization (RBAC)

### Permission catalog — fixed in code, defined by RFC

Single file `packages/contracts/src/permissions.ts` exports `const PERMISSIONS = { ... } as const`. Key format `<resource>.<action>`. Initial catalog:

```
users.read  users.invite  users.update  users.suspend  users.delete
roles.read  roles.manage
sessions.read  sessions.revoke
audit.read
admin.access        # gate for the /admin area
```

Business permissions (e.g. `samples.*`) arrive with their features, each through a new RFC. Adding a permission = code change + RFC + migration inserting it into the `permissions` table. A test asserts catalog and table match.

### Dynamic roles

- `roles` (id, name, description, is_system)
- `role_permissions` (role_id, permission_key)
- `user_roles` (user_id, role_id)

A user may hold N roles; effective permissions are the union.

System role `admin`: `is_system = true`, always holds every permission, cannot be edited or deleted. Seed creates `admin` and the first admin user via `pnpm seed:admin --email <email>` (issues an invitation). Anti-lockout rule: the system refuses to remove, suspend or delete the last active user holding `admin`.

### Enforcement — backend only

Hono middleware `requirePermission('<key>')` on every route. A route without a permission guard does not exist: a test enumerates all registered routes and fails if any lacks a guard, except an explicit public allowlist (login, invite/accept, password/forgot, password/reset, health). `requirePermission` accepts an optional resource-level callback as a hook for future row-level rules (not implemented now).

Effective permissions cached in Redis at `perms:<userId>` (TTL 5 min), invalidated on any role/permission change affecting the user. A revoked session has no permissions.

### Frontend

`GET /api/auth/me` returns `{ user, permissions: string[] }`. The SPA uses it only to show/hide navigation, routes and buttons. Route guards redirect when a page permission is missing. The API always re-checks.

Row-level scoping (e.g. "only sees samples from own project") is deferred to feature RFCs.

## 7. Data protection and GDPR

### PII inventory

Name, email, IP and user agent of the system's users, held in `users` and `audit_log`. Research data is not personal.

### Field-level encryption (application level)

- AES-256-GCM via `node:crypto`. Stored format: `v1:<iv>:<tag>:<ciphertext>` (base64). The `v1` prefix is the key version; rotation re-encrypts in batches while both versions are accepted.
- Key from Docker secret `PII_ENCRYPTION_KEY` (32 bytes). Never in the database, never logged. Separate from `SESSION_SECRET`.
- Encrypted columns: `users.name`, `users.email`, `audit_log.ip`, `audit_log.user_agent`.
- Searchable email: `users.email_hash = HMAC-SHA256(normalized email, PII_HMAC_KEY)`. Login and uniqueness use the hash; the email is decrypted only for display or sending.
- Single helper module `apps/api/src/security/pii.ts` (`encrypt`, `decrypt`, `blindIndex`). Exposed to Drizzle as a custom column type so business code never sees ciphertext.

### Database and backups

`pg_dump` output encrypted with `age` before being written to the backup volume. VPS disk encryption (LUKS) is an infrastructure responsibility, documented in `docs/gotchas/infra.md`.

### Audit log

Append-only table `audit_log`: `id, at, actor_user_id, action, target_type, target_id, ip, user_agent, metadata jsonb`. Events: login success/failure, logout, invitation, password/TOTP changes, role/permission changes, suspension, deletion, data export, admin area access. A Postgres trigger blocks `UPDATE` and `DELETE`. Retention: 2 years; a job deletes older rows (data minimization).

### Data-subject rights (GDPR Art. 15–17)

> Superseded by `2026-09-12-admin-design.md` section 1: users are never erased and there is no export.

Available in `/admin` and, for the user's own data, in `/settings`.

- **Export** (`GET /api/admin/users/:id/export` for admins; `GET /api/me/export` for the user's own data): JSON with profile, roles, sessions and audit entries where the user is the actor. Audited.
- **Erase** (`DELETE /api/admin/users/:id`, admin-executed; a user requests erasure from an admin): soft delete plus immediate anonymization — name/email become `deleted-<uuid>`, email hash removed, sessions revoked, TOTP secret and recovery codes deleted. The row remains for referential integrity (authorship of scientific data keeps `user_id` without identity). Audit entries keep `actor_user_id` (legal basis: legitimate interest, scientific integrity), documented in the RFC.
- The anti-lockout rule from section 6 applies.

### Application logs

pino with automatic redaction of `password`, `token`, `email`, `name`, cookies, `authorization`. IP appears only in the audit log, never in application logs.

`docs/rfc/40-data-protection/` doubles as the base for the record of processing activities (Art. 30): what data, why, for how long.

## 8. Admin area and frontend

### SPA routes (TanStack Router, file-based)

```
/login             /login/totp          /invite/$token
/forgot-password   /reset-password/$token
/                  dashboard placeholder
/settings          profile: name, password, TOTP, active sessions, export my data
/admin             gate: admin.access
/admin/users       list, filter by status; create/invite; open detail
/admin/users/$id   edit name, roles; suspend/reactivate; revoke sessions; export; erase
/admin/roles       list; create/edit role = name + permission checkboxes grouped by resource
/admin/audit       paginated table; filters: actor, action, period
```

Root layout: if `GET /api/auth/me` fails, redirect to `/login`. Admin routes check `permissions` from `me`; buttons hidden by permission. UX only — the API re-checks.

### Frontend stack

Vite 8, React 19, TanStack Router + Query, Tailwind 4, `react-hook-form` with Zod resolver using the same schemas from `packages/contracts` (frontend validation is fast feedback only). Minimal in-house component set (button, input, table, dialog); no component library yet. No global state beyond the Query cache.

HTTP client `apps/web/src/api/client.ts`: `fetch` with `credentials: 'include'`; 401 → redirect to login; 403 → "no permission" toast. Typed by `contracts` schemas.

### Admin API (every route behind `requirePermission`)

> Superseded by `2026-09-12-admin-design.md` section 6.

```
GET/POST           /api/admin/users
GET/PATCH/DELETE   /api/admin/users/:id
POST               /api/admin/users/:id/suspend | /reactivate | /resend-invite
GET/DELETE         /api/admin/users/:id/sessions[/:sessionId]
GET                /api/admin/users/:id/export
GET/POST           /api/admin/roles
GET/PATCH/DELETE   /api/admin/roles/:id
GET                /api/admin/permissions       # catalog, for the checkbox UI
GET                /api/admin/audit?actor=&action=&from=&to=&cursor=
```

### Self-service API (authenticated user, no extra permission)

> Superseded by `2026-09-12-admin-design.md` section 6.

```
GET/PATCH   /api/me                    # profile (name)
GET/DELETE  /api/me/sessions[/:id]     # own sessions
GET         /api/me/export             # own data export
```

Cursor-based pagination on every list. Response envelope: `{ data, meta }` or `{ error: { code, message, details? } }`. Error codes are stable identifiers (e.g. `AUTH_INVALID_CREDENTIALS`), never internal messages.

### Validation

Every route uses `zValidator` on body/query/params with schemas from `contracts`; the handler receives only typed data. Unknown fields are rejected (`strict`). Nothing bypasses a schema.

## 9. Security baseline

- **Headers** (Caddy + Hono `secureHeaders`): strict CSP (`default-src 'self'`, no inline scripts; Vite emits hashed assets), HSTS in prod, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive `Permissions-Policy`. No CORS (same origin).
- **Input:** 1 MB JSON body limit (413 above). `strict` schemas. All IDs are UUID v7; no numeric IDs exposed.
- **Global rate limit** (Redis sliding window): 300 req/min per session, 100 req/min per anonymous IP. Sensitive endpoints have their own limits. 429 with `Retry-After`.
- **Errors:** global handler. Client receives `{ error: { code, message } }`; stack traces only in logs. 500 never leaks internals. Zod errors → 400 with per-field `details` (never echoing the received value).
- **Secrets:** read from `/run/secrets/*` at boot; missing secret aborts startup. Environment validated with Zod in `apps/api/src/config.ts`, the only module reading `process.env`.
- **Dependencies:** `pnpm audit` in CI; committed lockfile; exact versions; monthly manual update; Docker base images pinned by digest.
- **Postgres:** app user without `CREATEDB`/`SUPERUSER`; migrations run as `treerepro_migrator`. Queries only through Drizzle (parameterized); raw `sql` only via template tag.
- **Health:** `GET /health` public → `{ ok: true }` only. `GET /health/ready` (internal network only) checks DB and Redis.
- **Containers:** non-root, read-only filesystem, all capabilities dropped, `no-new-privileges`, `tmpfs /tmp`.
- **CI (GitHub Actions):** lint, typecheck, unit, integration (Postgres + Redis services), e2e, audit. Failing checks block merge.

## 10. Process: RFCs, TDD, documentation

### RFC layout — `docs/rfc/`, numbered by category (ranges of 10)

```
00-process/          00-rfc-process.md  01-tdd-policy.md  02-security-principles.md
10-platform/         10-architecture.md  11-api-conventions.md  12-error-codes.md
20-auth/             20-invitation.md  21-password.md  22-login-session.md  23-totp.md  24-rate-limiting.md
30-access/           30-permissions-catalog.md  31-roles.md  32-authorization-checks.md
40-data-protection/  40-pii-encryption.md  41-audit-log.md  42-subject-rights.md
50-admin/            50-user-management.md  51-role-management.md
```

Business categories (`60-…`) come later. Index in `docs/rfc/README.md`.

### RFC format

Header: `RFC-NN <title>` · Status (`draft` / `accepted` / `superseded`) · Category · Supersedes. Sections: Context, Rules (numbered `R1, R2, …` — each rule testable), Data model, API, Open questions, Changelog. Rule IDs are stable; tests and code reference `RFC-22 R3`, never prose.

### Code linkage — mandatory

Every exported module/function carries a JSDoc `@rfc RFC-22 R3-R5` tag. A custom test `rfc-links.test.ts` scans `apps/api/src/**` and `apps/web/src/**` (excluding `*.test.ts` and barrel `index.ts`) and fails when an exported function lacks `@rfc` or points to a non-existent RFC/rule. Tests use `describe('RFC-22 R3: …')`.

### Change rule

New or changed business rule → RFC first (status `draft`), then test, then code. Code without an RFC is a bug. No rule lives only in a comment.

### TDD

Red/green/refactor per RFC rule. No production code without a failing test first. The `test-driven-development` skill applies to every implementation. Coverage is not the target; covered rules are.

### Documentation

- `README.md` — project handbook: durable rules only (stack and versions, commands, where things live, policies: RFC, TDD, security, language). Short; points to RFCs and gotchas. Never a log. AI-assistant configuration files (`CLAUDE.md`, `.claude/`, `.superpowers/`) are local to each developer and gitignored; the repository must be self-sufficient without any agent.
- `docs/gotchas/<area>.md` — concrete code/infra pitfalls; one entry = symptom, cause, fix.
- `docs/specs/` — design documents (this file).
- `docs/plans/` — implementation plans.

### Git

Conventional commits (`feat(auth): …`). `main` protected once the remote exists; short-lived branches. The foundation is committed in stages, not as one block.

## 11. Testing strategy

From fastest to slowest:

1. **Unit** (Vitest, `*.test.ts` next to the code): pure functions — password policy, `pii.encrypt/decrypt`, TTL math, `requirePermission` with stubs, `contracts` schemas. No database.
2. **Integration** (Vitest + testcontainers): ephemeral Postgres 18 + Redis 8 per test file, migrations applied, repositories and services tested against the real database. No database mocks. Each test runs inside a transaction that is rolled back.
3. **API** (Vitest + Hono `app.request()`): full route — middleware, validation, permission, handler — against the real database. Most RFC tests live here, e.g. "RFC-22 R4: wrong password returns 401 `AUTH_INVALID_CREDENTIALS` and writes an audit entry". Mandatory negative tests: no session → 401, missing permission → 403, extra body field → 400, invalid `Origin` → 403.
4. **Security meta-tests** (Vitest): `routes-guarded.test.ts` (every route guarded or allowlisted), `rfc-links.test.ts`, `permissions-sync.test.ts` (catalog equals table), `env-schema.test.ts` (missing secret aborts boot), `log-redaction.test.ts`.
5. **E2E** (Playwright): critical browser flows against a test Compose stack — invitation → set password → login → TOTP → admin creates a role → user without permission sees no button and the API denies. Few, slow; run in CI and before releases.

**Frontend** (Vitest + Testing Library + msw): components and route guards with a mocked API. Verifies the UI reacts to `permissions`, 401 and 403. No business rules are tested in the frontend because none exist there.

**Fixtures:** factories `createUser({ roles, status })`, `createRole({ permissions })`, `loginAs(user)` returning a cookie. No shared seed between tests.

**Commands:** `pnpm test` (unit + integration + API), `pnpm test:e2e`, `pnpm test:watch`. CI runs everything; any failure blocks.

## 12. Out of scope (deferred to feature RFCs)

- Scientific data model, sample/measurement entities, projects.
- Row-level authorization (project membership).
- File uploads and object storage.
- Notifications beyond transactional email.
- Internationalization (UI is English only).
- SSO / ORCID / passkeys.
