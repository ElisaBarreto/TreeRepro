# Foundation 01 — Scaffold, Infrastructure and Process — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running, tested skeleton of Elisa: pnpm monorepo, Hono API with security baseline and health endpoints, PII encryption module, append-only audit log, React SPA placeholder, Docker Compose stack (Postgres 18, Redis 8, Caddy), CI workflow, RFC process with automated code-linkage enforcement.

**Architecture:** Monorepo with a physical front/back boundary. `apps/api` (Hono on Node 24) is the only process that touches Postgres, Redis and secrets. `apps/web` (Vite + React SPA) only renders and calls `/api/*` on the same origin through Caddy. `packages/contracts` holds shared Zod schemas. `tools/rfc-lint` enforces that every exported symbol links to an RFC rule. Business rules live in `docs/rfc/`.

**Tech Stack:** Node 24.21 LTS, pnpm 12.4, TypeScript 7.0, Hono 4.13, Zod 4.6, Drizzle ORM 0.45 + postgres.js 3.4, ioredis 6.0, pino 10.3, React 19.3, Vite 8.3, TanStack Router 1.170 / Query 5.102, Tailwind 4.3, Vitest 5.0, testcontainers 12.1, Biome 2.5, PostgreSQL 18.6, Redis 8.8, Caddy 2.9, Docker Compose v5.5.

**Spec:** `docs/superpowers/specs/2026-09-12-foundation-design.md`

This is plan 1 of 5. Later plans: 02 auth, 03 RBAC, 04 admin + self-service + GDPR, 05 frontend + E2E.

## Global Constraints

- All artifacts in English: code, comments, docs, RFCs, commit messages, UI text.
- Exact versions in every `package.json` (no `^`, no `~`). `.npmrc` has `save-exact=true`.
- Node `>=24.21.0 <25`. pnpm `12.4.1`. TypeScript `7.0.2`.
- Every exported symbol under `apps/*/src` and `packages/*/src` carries a JSDoc `@rfc RFC-NN [Rx…]` tag (type-only exports and re-exports exempt). `pnpm rfc:check` and `pnpm test` fail otherwise.
- TDD: write the failing test, run it, see it fail, then write the minimum code. Every task's steps follow this order.
- No database mocks. Integration tests use real Postgres 18 and Redis 8 via testcontainers (Docker must be running).
- Secrets only from files in `/run/secrets` (overridable via `SECRETS_DIR` for tests). Never in `environment:`.
- Frontend never contains business rules.
- Run `pnpm lint:fix` before every commit (Biome sorts imports and formats; `biome check` fails on unsorted imports). Commit after every task with a conventional commit message.
- Use `pnpm` for everything; never `npm install` inside the repo.
- Node runs TypeScript directly (type stripping). Relative imports use explicit `.ts`/`.tsx` extensions. Only erasable TypeScript syntax (no `enum`, no `namespace`, no parameter properties).

---

## File structure (end state of this plan)

```
elisa/
├── .github/workflows/ci.yml
├── .dockerignore  .env.example  .gitignore  .node-version  .npmrc
├── biome.json  package.json  pnpm-workspace.yaml  tsconfig.json  vitest.config.ts
├── CLAUDE.md
├── compose.yml  compose.dev.yml  compose.prod.yml
├── scripts/gen-secrets.sh
├── infra/
│   ├── docker/api.Dockerfile  web.Dockerfile  dev.Dockerfile  backup.Dockerfile
│   ├── docker/Caddyfile.dev  Caddyfile.prod  backup.sh
│   ├── postgres/init/01-roles.sh
│   └── secrets/.gitkeep  README.md
├── packages/
│   ├── config/package.json  tsconfig.base.json  tsconfig.web.json
│   └── contracts/
│       ├── package.json  tsconfig.json  tsconfig.build.json  vitest.config.ts
│       └── src/index.ts  error-codes.ts  error-codes.test.ts  envelope.ts  envelope.test.ts  health.ts
├── tools/rfc-lint/
│   ├── package.json  tsconfig.json  vitest.config.ts
│   └── src/scan.ts  scan.test.ts  rfc-index.ts  rfc-index.test.ts  lint.ts  lint.test.ts  repo.test.ts  cli.ts
├── apps/api/
│   ├── package.json  tsconfig.json  tsconfig.build.json  drizzle.config.ts
│   ├── drizzle/0000_audit_log.sql  0001_audit_log_append_only.sql  meta/
│   ├── test/global-setup.ts  setup.ts  helpers/db.ts  helpers/pii.ts
│   └── src/
│       ├── config.ts  config.test.ts  logger.ts  logger.test.ts  app.ts  app.test.ts  server.ts
│       ├── http/env.ts  errors.ts  errors.test.ts  validate.ts  validate.test.ts
│       ├── http/origin-check.ts  origin-check.test.ts  health-checks.ts  health-checks.integration.test.ts
│       ├── http/routes/health.ts
│       ├── security/pii.ts  pii.test.ts
│       ├── db/client.ts  client.integration.test.ts  migrator.ts  migrate.ts
│       ├── db/types/encrypted-text.ts  schema/index.ts  schema/audit-log.ts
│       ├── redis/client.ts  client.integration.test.ts
│       └── audit/actions.ts  audit.ts  audit.integration.test.ts
├── apps/web/
│   ├── package.json  tsconfig.json  vite.config.ts  index.html
│   └── src/main.tsx  styles.css  vite-env.d.ts  routeTree.gen.ts
│       ├── routes/__root.tsx  index.tsx
│       ├── pages/HomePage.tsx  HomePage.test.tsx
│       ├── api/client.ts  client.test.ts
│       └── test/setup.ts
└── docs/
    ├── rfc/README.md
    ├── rfc/00-process/00-rfc-process.md  01-tdd-policy.md  02-security-principles.md
    ├── rfc/10-platform/10-architecture.md  11-api-conventions.md  12-error-codes.md
    ├── rfc/40-data-protection/40-pii-encryption.md  41-audit-log.md
    ├── gotchas/README.md  node.md  postgres.md  pnpm.md  docker.md
    └── superpowers/specs/…  plans/…
```

Responsibilities:

- `packages/config` — shared `tsconfig` bases only. No code.
- `packages/contracts` — Zod schemas and constants shared by API and web: error codes, response envelopes, health response.
- `tools/rfc-lint` — scanner that enforces `@rfc` linkage; has a CLI and a repo-wide test.
- `apps/api/src/config.ts` — the only module reading `process.env` and secret files.
- `apps/api/src/security/pii.ts` — the only module doing PII encryption.
- `apps/api/src/http/*` — HTTP concerns: errors, validation, origin check, health.
- `apps/api/src/db/*` — Drizzle client, schema, migrations.
- `apps/api/src/audit/*` — audit log writes.
- `apps/web/src/api/client.ts` — the only module in web that calls `fetch`.

---

### Task 1: Monorepo skeleton and tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.node-version`, `biome.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `packages/config/package.json`, `packages/config/tsconfig.base.json`, `packages/config/tsconfig.web.json`

**Interfaces:**
- Produces: `@elisa/config/tsconfig.base.json` (Node/library projects) and `@elisa/config/tsconfig.web.json` (browser projects). Root scripts `lint`, `typecheck`, `test`, `build`, `rfc:check`.

- [ ] **Step 1: Root package.json**

```json
{
  "name": "elisa",
  "private": true,
  "packageManager": "pnpm@12.4.1",
  "engines": {
    "node": ">=24.21.0 <25"
  },
  "scripts": {
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "pnpm -r build",
    "rfc:check": "pnpm --filter @elisa/rfc-lint check"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.13",
    "@types/node": "24.13.4",
    "typescript": "7.0.2",
    "vite": "8.3.0",
    "vitest": "5.0.0"
  }
}
```

- [ ] **Step 2: Workspace, npmrc, node version**

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
  - tools/*
onlyBuiltDependencies:
  - esbuild
```

`.npmrc`:
```
save-exact=true
engine-strict=true
auto-install-peers=true
strict-peer-dependencies=false
```

`.node-version`:
```
24.21.0
```

- [ ] **Step 3: Biome config**

`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.13/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "includes": ["**", "!**/dist", "!**/drizzle", "!**/routeTree.gen.ts", "!**/pnpm-lock.yaml"]
  },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": { "noConsole": "error" },
      "style": { "noNonNullAssertion": "error" }
    }
  },
  "javascript": { "formatter": { "quoteStyle": "single", "trailingCommas": "all" } },
  "assist": { "actions": { "source": { "organizeImports": "on" } } }
}
```

- [ ] **Step 4: Shared tsconfig bases**

`packages/config/package.json`:
```json
{
  "name": "@elisa/config",
  "version": "0.0.0",
  "private": true,
  "files": ["tsconfig.base.json", "tsconfig.web.json"]
}
```

`packages/config/tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "customConditions": ["development"],
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`packages/config/tsconfig.web.json`:
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["es2024", "dom", "dom.iterable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "types": ["vite/client"]
  }
}
```

- [ ] **Step 5: Root tsconfig and vitest config**

`tsconfig.json`:
```json
{
  "extends": "./packages/config/tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["vitest.config.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: ['packages/*', 'tools/*'],
  },
});
```
(`apps/api` projects are added in Tasks 5 and 11; `apps/web` in Task 14. Listing a folder that does not exist yet makes Vitest fail.)

- [ ] **Step 6: Install and verify**

Run: `pnpm install`
Expected: creates `pnpm-lock.yaml`, no errors. If pnpm prints "Ignored build scripts", run `pnpm approve-builds`, select the listed packages, and confirm they were added to `onlyBuiltDependencies` in `pnpm-workspace.yaml`.

Run: `pnpm lint`
Expected: `Checked N files … No fixes applied` with zero errors.

Run: `pnpm test`
Expected: exits 0 (`No test files found` is fine because `passWithNoTests` is on).

Run: `pnpm exec tsc --version`
Expected: `Version 7.0.2`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo with biome, typescript 7 and vitest 5"
```

---

### Task 2: Process documentation — CLAUDE.md, RFC index, RFC-00/01/02/10, gotchas index

**Files:**
- Create: `CLAUDE.md`, `docs/rfc/README.md`, `docs/gotchas/README.md`
- Create: `docs/rfc/00-process/00-rfc-process.md`, `docs/rfc/00-process/01-tdd-policy.md`, `docs/rfc/00-process/02-security-principles.md`, `docs/rfc/10-platform/10-architecture.md`

**Interfaces:**
- Produces: RFC IDs and rule numbers referenced by every later task's `@rfc` tags. The RFC format (rules as `- **Rn**` list items) is what `tools/rfc-lint` parses in Task 3.

- [ ] **Step 1: CLAUDE.md**

```markdown
# Elisa

Scientific data-collection platform. Everything sits behind login. GDPR applies to user data.

## Stack (exact versions pinned in package.json; rationale in RFC-10)

Node 24 LTS · pnpm 12 · TypeScript 7 · Hono 4 (`apps/api`) · React 19 + Vite 8 + TanStack Router/Query + Tailwind 4 (`apps/web`) · Drizzle ORM + PostgreSQL 18 · Redis 8 (ioredis) · Zod 4 · Vitest 5 + testcontainers · Playwright · Biome 2 · Docker Compose + Caddy 2.

## Layout

- `apps/api` — the only process that touches Postgres, Redis and secrets.
- `apps/web` — UI only. Calls `/api/*` on the same origin. Contains no business rules.
- `packages/contracts` — Zod schemas and constants shared by API and web.
- `packages/config` — shared tsconfig bases.
- `tools/rfc-lint` — enforces `@rfc` linkage in code.
- `infra/` — Dockerfiles, Caddyfiles, Postgres init, secrets (gitignored).
- `docs/rfc/` — business rules, the source of truth.
- `docs/gotchas/<area>.md` — concrete code/infra pitfalls.
- `docs/superpowers/specs`, `docs/superpowers/plans` — design docs and implementation plans.

## Commands

- `pnpm install` — install (run `pnpm approve-builds` if pnpm reports ignored build scripts).
- `pnpm lint` / `pnpm lint:fix` — Biome.
- `pnpm typecheck` — `tsc --noEmit` in every package.
- `pnpm test` — unit + integration + API tests. Needs Docker running (testcontainers).
- `pnpm rfc:check` — verify every export links to an existing RFC rule.
- `pnpm build` — build contracts, api, web.
- `docker compose up` — full dev stack. First time: `cp .env.example .env && ./scripts/gen-secrets.sh`.
- `pnpm --filter @elisa/api db:generate` — generate a migration from the Drizzle schema.

## Non-negotiable rules

1. **RFC first** (RFC-00). A business rule lives in `docs/rfc/<category>/NN-slug.md` as a numbered rule `**Rn**`. Change order: RFC → failing test → code. Every exported symbol in `apps/*/src` and `packages/*/src` has a JSDoc `@rfc RFC-NN Rx` tag.
2. **TDD** (RFC-01). No production code without a failing test first. No database mocks.
3. **Never trust the frontend** (RFC-02). Validation, computation and authorization happen only in `apps/api`. Strict Zod schemas on every input.
4. **Security from day one** (RFC-02, RFC-40). Secrets only from `/run/secrets`. PII encrypted at the application level. Logs redacted. Every route guarded.
5. **English everywhere.** Code, comments, docs, UI, commits.
6. **Latest stable versions, pinned exact.** No legacy versions.

## Where things go

| Kind | Place |
|---|---|
| Business rule (formula, state, contract, policy) | `docs/rfc/NN-*.md` |
| Code/infra pitfall specific to this project | `docs/gotchas/<area>.md` |
| Design decision | `docs/superpowers/specs/` |
| Implementation plan | `docs/superpowers/plans/` |
| Durable project rules | this file — never a log |
```

- [ ] **Step 2: RFC index**

`docs/rfc/README.md`:
```markdown
# RFC index

RFCs are the source of truth for how Elisa behaves. Process: RFC-00.

| Range | Category | Directory |
|---|---|---|
| 00–09 | process | `00-process/` |
| 10–19 | platform | `10-platform/` |
| 20–29 | auth | `20-auth/` |
| 30–39 | access control | `30-access/` |
| 40–49 | data protection | `40-data-protection/` |
| 50–59 | admin | `50-admin/` |
| 60+ | business domains (assigned when features arrive) | |

| RFC | Title | Status |
|---|---|---|
| RFC-00 | RFC process | draft |
| RFC-01 | TDD policy | draft |
| RFC-02 | Security principles | draft |
| RFC-10 | Architecture | draft |
| RFC-11 | API conventions | draft |
| RFC-12 | Error codes | draft |
| RFC-40 | PII encryption | draft |
| RFC-41 | Audit log | draft |
```

- [ ] **Step 3: RFC-00 RFC process**

`docs/rfc/00-process/00-rfc-process.md`:
```markdown
# RFC-00 — RFC process

| Field | Value |
|---|---|
| Status | draft |
| Category | process |
| Supersedes | — |

## Context

Business rules must have one home that code, tests and reviewers can point at. That home is an RFC. Code implements RFCs; it never defines rules on its own.

## Rules

- **R1** Every business rule lives in exactly one RFC file at `docs/rfc/<category>/<NN>-<slug>.md`. `NN` is a unique two-digit number; categories own ranges of ten (see `docs/rfc/README.md`).
- **R2** An RFC starts with a header table (Status, Category, Supersedes) and has the sections Context, Rules, Data model (optional), API (optional), Open questions, Changelog. Status is one of `draft`, `accepted`, `superseded`.
- **R3** Rules are list items of the form `- **Rn** text`, numbered from R1 without gaps at creation. Rule IDs are stable: a rule is never renumbered. A retired rule keeps its number and is rewritten as `- **Rn** (retired) reason`.
- **R4** Every exported symbol in `apps/*/src/**` and `packages/*/src/**` carries a JSDoc block immediately above it containing `@rfc RFC-NN` optionally followed by rule references (`R3`, `R1-R4`, `R2, R5`). Type-only exports (`export type`, `export interface`), re-exports (`export { … } from`, `export * from`) and generated files (`*.gen.ts`) are exempt. `tools/rfc-lint` enforces this and fails when the RFC or rule does not exist.
- **R5** Tests name the rule they verify: `describe('RFC-NN Rn …')` or `it('RFC-NN Rn …')`.
- **R6** Order of change: write or amend the RFC (status `draft`) → write the failing test → write the code → set status `accepted` when merged. Code without an RFC is a defect.
- **R7** RFCs, code, comments, commits and UI text are written in English.
- **R8** When an RFC replaces another, the new one lists the old in `Supersedes` and the old one is set to `superseded` with a pointer to the new one. Files are never deleted.

## Open questions

None.

## Changelog

- 2026-09-12 — created.
```

- [ ] **Step 4: RFC-01 TDD policy**

`docs/rfc/00-process/01-tdd-policy.md`:
```markdown
# RFC-01 — TDD policy

| Field | Value |
|---|---|
| Status | draft |
| Category | process |
| Supersedes | — |

## Context

Tests are the executable form of the RFCs. Writing them first keeps rules explicit and prevents untested code from existing.

## Rules

- **R1** No production code is written without a failing test that demands it. Cycle: red → green → refactor.
- **R2** Test levels, fastest first: unit (pure functions, no I/O), integration (real PostgreSQL and Redis via testcontainers), API (full Hono route through `app.request()`), security meta-tests (repository-wide invariants), end-to-end (Playwright in a browser). Frontend components are tested with Testing Library against a mocked API.
- **R3** Databases are never mocked. Integration and API tests run against ephemeral PostgreSQL 18 and Redis 8 containers with migrations applied.
- **R4** Each integration test is isolated: it runs inside a transaction that is rolled back, or it creates and removes its own state. Tests never depend on ordering or on shared seed data.
- **R5** `pnpm test` must pass before a commit; CI blocks merges on any failure.
- **R6** Every API route has negative tests: unauthenticated → 401, missing permission → 403, unknown body field → 400, invalid `Origin` on a mutation → 403. (401/403 for sessions and permissions apply once RFC-22 and RFC-32 exist.)
- **R7** Test files sit next to the code they test: `foo.ts` → `foo.test.ts` (unit) or `foo.integration.test.ts` (needs containers).
- **R8** Coverage percentage is not a goal. Every RFC rule with observable behavior has at least one test naming it (RFC-00 R5).

## Open questions

None.

## Changelog

- 2026-09-12 — created.
```

- [ ] **Step 5: RFC-02 Security principles**

`docs/rfc/00-process/02-security-principles.md`:
```markdown
# RFC-02 — Security principles

| Field | Value |
|---|---|
| Status | draft |
| Category | process |
| Supersedes | — |

## Context

Elisa holds personal data of its users and scientific data whose integrity matters. These principles apply to every line of code. Specific mechanisms (sessions, permissions, encryption) have their own RFCs; this one sets the baseline.

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
```

- [ ] **Step 6: RFC-10 Architecture**

`docs/rfc/10-platform/10-architecture.md`:
```markdown
# RFC-10 — Architecture

| Field | Value |
|---|---|
| Status | draft |
| Category | platform |
| Supersedes | — |

## Context

Design: `docs/superpowers/specs/2026-09-12-foundation-design.md`. This RFC fixes the structural rules the code must follow.

## Rules

- **R1** The repository is a pnpm monorepo: `apps/api` (Hono HTTP API), `apps/web` (Vite + React SPA), `packages/contracts` (shared Zod schemas), `packages/config` (tsconfig bases), `tools/rfc-lint`, `infra/` (Docker, Caddy, Postgres init), `docs/`.
- **R2** Only `apps/api` connects to PostgreSQL and Redis and reads secrets. No other package imports a database or Redis driver.
- **R3** `apps/web` contains no business rules. It talks to the API only through `apps/web/src/api/client.ts`, which calls `/api/*` on the same origin with `credentials: 'include'`.
- **R4** Request and response shapes shared by API and web are Zod schemas in `packages/contracts`. The API validates with them; the web only derives types from them.
- **R5** Configuration is read only in `apps/api/src/config.ts`: non-secret values from environment variables, secrets from files (RFC-02 R6). The result is validated with Zod; the process refuses to start on any invalid or missing value.
- **R6** Database access goes through Drizzle ORM. Raw SQL is allowed only through the `sql` template tag (parameterized); string concatenation into SQL is forbidden.
- **R7** Schema changes are SQL migration files in `apps/api/drizzle/`, generated by `drizzle-kit generate` (or `--custom` for hand-written SQL such as triggers) and applied by the `migrate` service before the API starts, using the `elisa_migrator` role. The API runtime uses the `elisa_app` role, which cannot create or alter tables.
- **R8** Runtime versions: Node 24 LTS, PostgreSQL 18, Redis 8, Caddy 2. Libraries are pinned exact in `package.json`.
- **R9** Production processes: `caddy` (only public port; TLS; serves the SPA; proxies `/api/*`), `api`, `postgres`, `redis`, `migrate` (one-shot, before `api`), `backup` (daily encrypted `pg_dump`). Development adds `web` (Vite dev server), `mailpit`, and publishes Postgres/Redis ports for inspection.
- **R10** Health endpoints: `GET /api/health` is public and answers exactly `{"ok":true}` (no envelope, no version, no dependency status). `GET /api/health/ready` checks PostgreSQL and Redis, answers `{"ok":true}` or 503 `SERVICE_UNAVAILABLE`, and is never proxied by Caddy (internal network only).
- **R11** Node executes TypeScript source directly in development (`node --watch --conditions=development`) and compiled JavaScript (`tsc` output in `dist/`) in production. `packages/contracts` exposes source under the `development` export condition and `dist/` by default.
- **R12** Every response carries an `X-Request-Id` header; the same ID is attached to every log line about that request.

## Open questions

None.

## Changelog

- 2026-09-12 — created.
```

- [ ] **Step 7: Gotchas index**

`docs/gotchas/README.md`:
```markdown
# Gotchas

Concrete pitfalls of this project's code and infrastructure. One file per area, one entry per pitfall: **Symptom**, **Cause**, **Fix**. Business rules do not belong here — they go in `docs/rfc/`.

| Area | File |
|---|---|
| Node runtime | `node.md` |
| PostgreSQL | `postgres.md` |
| pnpm | `pnpm.md` |
| Docker / Compose / Caddy | `docker.md` |
```

- [ ] **Step 8: Verify and commit**

Run: `pnpm lint`
Expected: zero errors (Biome formats Markdown? No — Biome ignores `.md`; this confirms nothing else broke).

```bash
git add CLAUDE.md docs/
git commit -m "docs: add CLAUDE.md, RFC process (RFC-00/01/02/10) and gotchas index"
```

---

### Task 3: `tools/rfc-lint` — enforce `@rfc` linkage

**Files:**
- Create: `tools/rfc-lint/package.json`, `tools/rfc-lint/tsconfig.json`, `tools/rfc-lint/vitest.config.ts`
- Create: `tools/rfc-lint/src/scan.ts`, `scan.test.ts`, `rfc-index.ts`, `rfc-index.test.ts`, `lint.ts`, `lint.test.ts`, `repo.test.ts`, `cli.ts`

**Interfaces:**
- Consumes: RFC file format from RFC-00 R3 (`- **Rn**` rules; filenames `NN-slug.md`).
- Produces: `pnpm rfc:check` (exit 1 on violations) and the repo-wide test `repo.test.ts` that runs inside `pnpm test`. Every later task must keep it green.

- [ ] **Step 1: Package files**

`tools/rfc-lint/package.json`:
```json
{
  "name": "@elisa/rfc-lint",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "check": "node src/cli.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "@elisa/config": "workspace:*",
    "@types/node": "24.13.4",
    "typescript": "7.0.2",
    "vitest": "5.0.0"
  }
}
```

`tools/rfc-lint/tsconfig.json`:
```json
{
  "extends": "@elisa/config/tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "vitest.config.ts"]
}
```

`tools/rfc-lint/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'rfc-lint', include: ['src/**/*.test.ts'] },
});
```

Run: `pnpm install`
Expected: workspace link created, no errors.

- [ ] **Step 2: Failing tests for the export scanner**

`tools/rfc-lint/src/scan.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { findExports, parseRfcTags } from './scan.ts';

describe('RFC-00 R4 findExports', () => {
  it('finds named exports with their JSDoc', () => {
    const src = [
      '/** @rfc RFC-10 R1 */',
      'export function alpha() {}',
      '',
      '/**',
      ' * Multi-line.',
      ' * @rfc RFC-11 R2-R3',
      ' */',
      'export const beta = 1;',
      'export class Gamma {}',
      'export default function () {}',
      'export async function* delta() {}',
    ].join('\n');
    const sites = findExports(src);
    expect(sites.map((s) => [s.name, s.line, s.doc !== null])).toEqual([
      ['alpha', 2, true],
      ['beta', 8, true],
      ['Gamma', 9, false],
      ['default', 10, false],
      ['delta', 11, false],
    ]);
  });

  it('ignores type-only exports and re-exports', () => {
    const src = [
      'export type A = string;',
      'export interface B {}',
      'export { x } from "./x.ts";',
      'export * from "./y.ts";',
      'export declare const z: number;',
    ].join('\n');
    expect(findExports(src)).toEqual([]);
  });

  it('does not accept a plain block comment as JSDoc', () => {
    const src = ['/* @rfc RFC-10 R1 */', 'export const a = 1;'].join('\n');
    expect(findExports(src)[0]?.doc).toBeNull();
  });

  it('requires the JSDoc to end on the line directly above', () => {
    const src = ['/** @rfc RFC-10 R1 */', '', 'export const a = 1;'].join('\n');
    expect(findExports(src)[0]?.doc).toBeNull();
  });
});

describe('RFC-00 R4 parseRfcTags', () => {
  it('parses a single rfc without rules', () => {
    expect(parseRfcTags('/** @rfc RFC-10 */')).toEqual([{ rfc: 10, rules: [], trailing: '' }]);
  });

  it('parses rule lists and ranges', () => {
    expect(parseRfcTags('/** @rfc RFC-22 R3-R5, R7 */')).toEqual([
      { rfc: 22, rules: [3, 4, 5, 7], trailing: '' },
    ]);
  });

  it('parses several tags', () => {
    const doc = ['/**', ' * @rfc RFC-10 R1', ' * @rfc RFC-11 R2', ' */'].join('\n');
    expect(parseRfcTags(doc).map((t) => t.rfc)).toEqual([10, 11]);
  });

  it('reports trailing garbage after the rules', () => {
    expect(parseRfcTags('/** @rfc RFC-10 R1, RFC-11 R2 */')[0]?.trailing).toBe(', RFC-11 R2');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @elisa/rfc-lint test`
Expected: FAIL — `Cannot find module './scan.ts'` (or equivalent).

- [ ] **Step 4: Implement the scanner**

`tools/rfc-lint/src/scan.ts`:
```ts
export interface ExportSite {
  /** 1-based line of the export statement. */
  line: number;
  name: string;
  /** JSDoc block ending on the line directly above the export, or null. */
  doc: string | null;
}

export interface RfcRef {
  rfc: number;
  rules: number[];
  /** Anything left on the tag line after the rule list; must be empty. */
  trailing: string;
}

const EXEMPT_RE = /^export\s+(type|interface|declare|\{|\*)/;
const NAMED_RE =
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
const DEFAULT_RE = /^export\s+default\b/;

export function findExports(source: string): ExportSite[] {
  const lines = source.split('\n');
  const sites: ExportSite[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (EXEMPT_RE.test(line)) continue;
    const named = NAMED_RE.exec(line);
    const name = named?.[1] ?? (DEFAULT_RE.test(line) ? 'default' : null);
    if (name === null) continue;
    sites.push({ line: i + 1, name, doc: docAbove(lines, i) });
  }
  return sites;
}

function docAbove(lines: string[], exportIndex: number): string | null {
  let i = exportIndex - 1;
  if (i < 0 || !(lines[i] ?? '').trim().endsWith('*/')) return null;
  const collected: string[] = [];
  for (; i >= 0; i--) {
    const line = lines[i] ?? '';
    collected.unshift(line);
    const trimmed = line.trim();
    if (trimmed.startsWith('/**')) return collected.join('\n');
    if (trimmed.startsWith('/*')) return null;
  }
  return null;
}

const TAG_RE = /@rfc\s+RFC-(\d{2})\b((?:\s*,?\s*R\d+(?:\s*-\s*R?\d+)?)*)([^\n]*)/g;
const RULE_RE = /R(\d+)(?:\s*-\s*R?(\d+))?/g;

export function parseRfcTags(doc: string): RfcRef[] {
  const refs: RfcRef[] = [];
  for (const match of doc.matchAll(TAG_RE)) {
    const rules: number[] = [];
    for (const rule of (match[2] ?? '').matchAll(RULE_RE)) {
      const from = Number(rule[1]);
      const to = rule[2] === undefined ? from : Number(rule[2]);
      for (let k = from; k <= to; k++) rules.push(k);
    }
    const trailing = (match[3] ?? '').replace(/\*\/\s*$/, '').trimEnd();
    refs.push({ rfc: Number(match[1]), rules, trailing });
  }
  return refs;
}
```

- [ ] **Step 5: Run scanner tests**

Run: `pnpm --filter @elisa/rfc-lint test`
Expected: all `scan.test.ts` tests PASS.

- [ ] **Step 6: Failing tests for the RFC index**

`tools/rfc-lint/src/rfc-index.test.ts`:
```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRfcIndex } from './rfc-index.ts';

function makeRfcDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rfc-index-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

describe('RFC-00 R1, R3 loadRfcIndex', () => {
  it('indexes RFC numbers and rule ids from nested category folders', () => {
    const dir = makeRfcDir({
      'README.md': '# index',
      '00-process/00-rfc-process.md': '- **R1** a\n- **R2** b\n',
      '10-platform/10-architecture.md': '- **R1** only\n',
    });
    const index = loadRfcIndex(dir);
    expect([...index.keys()].sort()).toEqual([0, 10]);
    expect([...(index.get(0)?.rules ?? [])]).toEqual([1, 2]);
    expect([...(index.get(10)?.rules ?? [])]).toEqual([1]);
  });

  it('throws on duplicate RFC numbers', () => {
    const dir = makeRfcDir({
      '00-process/00-a.md': '- **R1** a\n',
      '10-platform/00-b.md': '- **R1** b\n',
    });
    expect(() => loadRfcIndex(dir)).toThrow(/duplicate RFC number 00/);
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `pnpm --filter @elisa/rfc-lint test`
Expected: FAIL — cannot find `./rfc-index.ts`.

- [ ] **Step 8: Implement the RFC index**

`tools/rfc-lint/src/rfc-index.ts`:
```ts
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface RfcEntry {
  id: number;
  path: string;
  rules: Set<number>;
}

const FILE_RE = /^(\d{2})-[a-z0-9-]+\.md$/;
const RULE_RE = /\*\*R(\d+)\*\*/g;

export function loadRfcIndex(rfcDir: string): Map<number, RfcEntry> {
  const index = new Map<number, RfcEntry>();
  for (const rel of readdirSync(rfcDir, { recursive: true, encoding: 'utf8' })) {
    const match = FILE_RE.exec(basename(rel));
    if (!match) continue;
    const id = Number(match[1]);
    const path = join(rfcDir, rel);
    const existing = index.get(id);
    if (existing) {
      throw new Error(`duplicate RFC number ${match[1]}: ${existing.path} and ${path}`);
    }
    const rules = new Set<number>();
    for (const rule of readFileSync(path, 'utf8').matchAll(RULE_RE)) rules.add(Number(rule[1]));
    index.set(id, { id, path, rules });
  }
  return index;
}
```

- [ ] **Step 9: Run index tests**

Run: `pnpm --filter @elisa/rfc-lint test`
Expected: PASS.

- [ ] **Step 10: Failing tests for the linter**

`tools/rfc-lint/src/lint.test.ts`:
```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, discoverRoots, lint, lintSource } from './lint.ts';
import { loadRfcIndex } from './rfc-index.ts';

function makeTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rfc-lint-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

const RFCS = {
  'docs/rfc/10-platform/10-architecture.md': '- **R1** a\n- **R2** b\n',
};

describe('RFC-00 R4 lintSource', () => {
  const index = loadRfcIndex(join(makeTree(RFCS), 'docs/rfc'));

  it('accepts a tagged export', () => {
    const src = '/** @rfc RFC-10 R1-R2 */\nexport const ok = 1;\n';
    expect(lintSource({ path: 'a.ts', source: src }, index)).toEqual([]);
  });

  it('flags an export without JSDoc', () => {
    const out = lintSource({ path: 'a.ts', source: 'export const bad = 1;\n' }, index);
    expect(out).toEqual([{ file: 'a.ts', line: 1, message: 'export "bad" has no JSDoc @rfc tag' }]);
  });

  it('flags a JSDoc without @rfc', () => {
    const out = lintSource({ path: 'a.ts', source: '/** hello */\nexport const bad = 1;\n' }, index);
    expect(out[0]?.message).toBe('export "bad" JSDoc has no @rfc tag');
  });

  it('flags an unknown RFC', () => {
    const out = lintSource({ path: 'a.ts', source: '/** @rfc RFC-99 */\nexport const bad = 1;\n' }, index);
    expect(out[0]?.message).toBe('export "bad" references unknown RFC-99');
  });

  it('flags an unknown rule', () => {
    const out = lintSource({ path: 'a.ts', source: '/** @rfc RFC-10 R7 */\nexport const bad = 1;\n' }, index);
    expect(out[0]?.message).toBe('export "bad" references RFC-10 R7 which does not exist');
  });

  it('flags a malformed tag with trailing text', () => {
    const src = '/** @rfc RFC-10 R1, RFC-10 R2 */\nexport const bad = 1;\n';
    const out = lintSource({ path: 'a.ts', source: src }, index);
    expect(out[0]?.message).toBe('export "bad" has a malformed @rfc tag (one @rfc line per RFC)');
  });
});

describe('RFC-00 R4 collectSourceFiles and discoverRoots', () => {
  it('collects .ts/.tsx and skips tests, generated, declarations, node_modules and dist', () => {
    const root = makeTree({
      'src/a.ts': '',
      'src/b.tsx': '',
      'src/a.test.ts': '',
      'src/c.integration.test.ts': '',
      'src/routeTree.gen.ts': '',
      'src/types.d.ts': '',
      'src/node_modules/x.ts': '',
      'src/dist/y.ts': '',
      'src/nested/d.ts': '',
    });
    const files = collectSourceFiles(join(root, 'src')).map((f) => f.slice(root.length + 1));
    expect(files).toEqual(['src/a.ts', 'src/b.tsx', 'src/nested/d.ts']);
  });

  it('discovers apps/*/src and packages/*/src', () => {
    const root = makeTree({
      'apps/api/src/x.ts': '',
      'apps/web/src/x.ts': '',
      'packages/contracts/src/x.ts': '',
      'packages/config/tsconfig.base.json': '{}',
      'tools/rfc-lint/src/x.ts': '',
    });
    const roots = discoverRoots(root).map((r) => r.slice(root.length + 1));
    expect(roots).toEqual(['apps/api/src', 'apps/web/src', 'packages/contracts/src']);
  });
});

describe('RFC-00 R4 lint', () => {
  it('reports violations with paths relative to displayRoot', () => {
    const root = makeTree({
      ...RFCS,
      'apps/api/src/good.ts': '/** @rfc RFC-10 R1 */\nexport const good = 1;\n',
      'apps/api/src/bad.ts': 'export const bad = 1;\n',
    });
    const out = lint({ roots: discoverRoots(root), rfcDir: join(root, 'docs/rfc'), displayRoot: root });
    expect(out).toEqual([
      { file: 'apps/api/src/bad.ts', line: 1, message: 'export "bad" has no JSDoc @rfc tag' },
    ]);
  });
});
```

- [ ] **Step 11: Run to verify it fails**

Run: `pnpm --filter @elisa/rfc-lint test`
Expected: FAIL — cannot find `./lint.ts`.

- [ ] **Step 12: Implement the linter**

`tools/rfc-lint/src/lint.ts`:
```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type RfcEntry, loadRfcIndex } from './rfc-index.ts';
import { findExports, parseRfcTags } from './scan.ts';

export interface Violation {
  file: string;
  line: number;
  message: string;
}

export interface SourceFile {
  path: string;
  source: string;
}

export interface LintOptions {
  roots: string[];
  rfcDir: string;
  /** When set, reported file paths are relative to this directory. */
  displayRoot?: string;
}

const SOURCE_RE = /\.tsx?$/;
const IGNORED_RE = /(\.test\.tsx?|\.gen\.tsx?|\.d\.ts)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist']);

export function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (SOURCE_RE.test(entry.name) && !IGNORED_RE.test(entry.name)) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

export function discoverRoots(repoRoot: string): string[] {
  const roots: string[] = [];
  for (const group of ['apps', 'packages']) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      const src = join(groupDir, entry.name, 'src');
      if (entry.isDirectory() && existsSync(src)) roots.push(src);
    }
  }
  return roots.sort();
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function lintSource(file: SourceFile, index: Map<number, RfcEntry>): Violation[] {
  const violations: Violation[] = [];
  const add = (line: number, message: string): void => {
    violations.push({ file: file.path, line, message });
  };
  for (const site of findExports(file.source)) {
    if (site.doc === null) {
      add(site.line, `export "${site.name}" has no JSDoc @rfc tag`);
      continue;
    }
    const refs = parseRfcTags(site.doc);
    if (refs.length === 0) {
      add(site.line, `export "${site.name}" JSDoc has no @rfc tag`);
      continue;
    }
    const tagCount = (site.doc.match(/@rfc\b/g) ?? []).length;
    if (tagCount !== refs.length || refs.some((r) => r.trailing !== '')) {
      add(site.line, `export "${site.name}" has a malformed @rfc tag (one @rfc line per RFC)`);
      continue;
    }
    for (const ref of refs) {
      const entry = index.get(ref.rfc);
      if (!entry) {
        add(site.line, `export "${site.name}" references unknown RFC-${pad(ref.rfc)}`);
        continue;
      }
      for (const rule of ref.rules) {
        if (!entry.rules.has(rule)) {
          add(
            site.line,
            `export "${site.name}" references RFC-${pad(ref.rfc)} R${rule} which does not exist`,
          );
        }
      }
    }
  }
  return violations;
}

export function lint(options: LintOptions): Violation[] {
  const index = loadRfcIndex(options.rfcDir);
  const violations: Violation[] = [];
  for (const root of options.roots) {
    for (const path of collectSourceFiles(root)) {
      const display = options.displayRoot ? relative(options.displayRoot, path) : path;
      violations.push(...lintSource({ path: display, source: readFileSync(path, 'utf8') }, index));
    }
  }
  return violations;
}
```

- [ ] **Step 13: Run linter tests**

Run: `pnpm --filter @elisa/rfc-lint test`
Expected: PASS.

- [ ] **Step 14: Repo-wide meta-test and CLI**

`tools/rfc-lint/src/repo.test.ts`:
```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverRoots, lint } from './lint.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');

describe('RFC-00 R4 repository linkage', () => {
  it('every exported symbol in apps/*/src and packages/*/src links to an existing RFC rule', () => {
    const violations = lint({
      roots: discoverRoots(repoRoot),
      rfcDir: resolve(repoRoot, 'docs/rfc'),
      displayRoot: repoRoot,
    });
    expect(violations.map((v) => `${v.file}:${v.line}: ${v.message}`)).toEqual([]);
  });
});
```

`tools/rfc-lint/src/cli.ts`:
```ts
import { resolve } from 'node:path';
import { discoverRoots, lint } from './lint.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const violations = lint({
  roots: discoverRoots(repoRoot),
  rfcDir: resolve(repoRoot, 'docs/rfc'),
  displayRoot: repoRoot,
});

for (const v of violations) process.stderr.write(`${v.file}:${v.line}: ${v.message}\n`);
if (violations.length > 0) {
  process.stderr.write(`rfc-lint: ${violations.length} violation(s)\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('rfc-lint: ok\n');
}
```

Run: `pnpm --filter @elisa/rfc-lint test`
Expected: PASS (no `apps/*/src` yet, so zero violations).

Run: `pnpm rfc:check`
Expected: `rfc-lint: ok`, exit 0. If Node prints an `ExperimentalWarning` about type stripping, record it in `docs/gotchas/node.md` (Task 16) and add `--disable-warning=ExperimentalWarning` to the `check` script.

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 15: Commit**

```bash
git add tools/rfc-lint pnpm-lock.yaml
git commit -m "feat(tooling): add rfc-lint enforcing @rfc linkage on exports (RFC-00 R4)"
```

---

### Task 4: `packages/contracts` — error codes, envelopes, health schema; RFC-11 and RFC-12

**Files:**
- Create: `docs/rfc/10-platform/11-api-conventions.md`, `docs/rfc/10-platform/12-error-codes.md`
- Create: `packages/contracts/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`
- Create: `packages/contracts/src/index.ts`, `error-codes.ts`, `error-codes.test.ts`, `envelope.ts`, `envelope.test.ts`, `health.ts`

**Interfaces:**
- Produces (imported by the API in Tasks 8–13 and by web in Task 14):
  - `ERROR_CODES: Record<ErrorCode, number>` and `type ErrorCode`
  - `errorEnvelopeSchema`, `type ErrorEnvelope`, `errorDetailSchema`, `type ErrorDetail`
  - `dataEnvelopeSchema(dataSchema)`, `type DataEnvelope<T>`
  - `healthResponseSchema`, `type HealthResponse`

- [ ] **Step 1: RFC-11 API conventions**

`docs/rfc/10-platform/11-api-conventions.md`:
```markdown
# RFC-11 — API conventions

| Field | Value |
|---|---|
| Status | draft |
| Category | platform |
| Supersedes | — |

## Context

One shape for every request and response so that the web client, tests and future scripts (R, Python) can rely on it.

## Rules

- **R1** Every API route is mounted under `/api`. Caddy proxies `/api/*` to the API process and nothing else.
- **R2** Successful responses have the shape `{ "data": <payload> }`. List responses add `"meta": { "nextCursor": <string | null> }`. The only exceptions are the health endpoints (RFC-10 R10).
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
```

- [ ] **Step 2: RFC-12 error codes**

`docs/rfc/10-platform/12-error-codes.md`:
```markdown
# RFC-12 — Error codes

| Field | Value |
|---|---|
| Status | draft |
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
```

Also add both rows to `docs/rfc/README.md` if not already present (they are, from Task 2).

- [ ] **Step 3: Package files**

`packages/contracts/package.json`:
```json
{
  "name": "@elisa/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "development": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "4.6.2"
  },
  "devDependencies": {
    "@elisa/config": "workspace:*",
    "@types/node": "24.13.4",
    "typescript": "7.0.2",
    "vitest": "5.0.0"
  }
}
```

`packages/contracts/tsconfig.json`:
```json
{
  "extends": "@elisa/config/tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "vitest.config.ts"]
}
```

`packages/contracts/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/contracts/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'contracts', include: ['src/**/*.test.ts'] },
});
```

Run: `pnpm install`

- [ ] **Step 4: Failing tests**

`packages/contracts/src/error-codes.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './error-codes.ts';

describe('RFC-12 R3 error code catalog', () => {
  it('matches the table in docs/rfc/10-platform/12-error-codes.md exactly', () => {
    const doc = readFileSync(
      new URL('../../../docs/rfc/10-platform/12-error-codes.md', import.meta.url),
      'utf8',
    );
    const rows = [...doc.matchAll(/^\|\s*`([A-Z_]+)`\s*\|\s*(\d{3})\s*\|/gm)].map((m) => [
      m[1],
      Number(m[2]),
    ]);
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.fromEntries(rows)).toEqual(ERROR_CODES);
  });

  it('RFC-12 R1 codes are SCREAMING_SNAKE_CASE', () => {
    for (const code of Object.keys(ERROR_CODES)) expect(code).toMatch(/^[A-Z][A-Z_]+$/);
  });
});
```

`packages/contracts/src/envelope.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { dataEnvelopeSchema, errorEnvelopeSchema } from './envelope.ts';

describe('RFC-11 R3 error envelope', () => {
  it('accepts a known code with message and optional details', () => {
    const ok = errorEnvelopeSchema.safeParse({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: [{ path: 'email', message: 'Invalid email' }],
      },
    });
    expect(ok.success).toBe(true);
  });

  it('rejects an unknown code', () => {
    const bad = errorEnvelopeSchema.safeParse({ error: { code: 'NOPE', message: 'x' } });
    expect(bad.success).toBe(false);
  });

  it('rejects extra fields', () => {
    const bad = errorEnvelopeSchema.safeParse({
      error: { code: 'NOT_FOUND', message: 'x', stack: 'leak' },
    });
    expect(bad.success).toBe(false);
  });
});

describe('RFC-11 R2 data envelope', () => {
  const schema = dataEnvelopeSchema(z.array(z.string()));

  it('accepts data with optional meta.nextCursor', () => {
    expect(schema.safeParse({ data: ['a'] }).success).toBe(true);
    expect(schema.safeParse({ data: ['a'], meta: { nextCursor: null } }).success).toBe(true);
    expect(schema.safeParse({ data: ['a'], meta: { nextCursor: 'abc' } }).success).toBe(true);
  });

  it('rejects extra top-level fields', () => {
    expect(schema.safeParse({ data: [], extra: 1 }).success).toBe(false);
  });
});
```

- [ ] **Step 5: Run to verify they fail**

Run: `pnpm --filter @elisa/contracts test`
Expected: FAIL — modules not found.

- [ ] **Step 6: Implement**

`packages/contracts/src/error-codes.ts`:
```ts
/**
 * Error code → HTTP status. Mirrors the catalog table in RFC-12.
 * @rfc RFC-12 R1-R4
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  VALIDATION_INVALID_JSON: 400,
  SECURITY_INVALID_ORIGIN: 403,
  NOT_FOUND: 404,
  REQUEST_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
```

`packages/contracts/src/envelope.ts`:
```ts
import { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from './error-codes.ts';

const errorCodes = Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]];

/** @rfc RFC-11 R3 */
export const errorDetailSchema = z.strictObject({
  path: z.string(),
  message: z.string(),
});

/** @rfc RFC-11 R3 */
export const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(errorCodes),
    message: z.string().min(1),
    details: z.array(errorDetailSchema).optional(),
  }),
});

/** @rfc RFC-11 R2, R6 */
export const listMetaSchema = z.strictObject({
  nextCursor: z.string().nullable(),
});

/** @rfc RFC-11 R2 */
export function dataEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({ data, meta: listMetaSchema.optional() });
}

export type ErrorDetail = z.infer<typeof errorDetailSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type ListMeta = z.infer<typeof listMetaSchema>;
export type DataEnvelope<T> = { data: T; meta?: ListMeta };
```

`packages/contracts/src/health.ts`:
```ts
import { z } from 'zod';

/** @rfc RFC-10 R10 */
export const healthResponseSchema = z.strictObject({ ok: z.literal(true) });

export type HealthResponse = z.infer<typeof healthResponseSchema>;
```

`packages/contracts/src/index.ts`:
```ts
export * from './error-codes.ts';
export * from './envelope.ts';
export * from './health.ts';
```

- [ ] **Step 7: Run tests, typecheck, build, rfc-lint**

Run: `pnpm --filter @elisa/contracts test`
Expected: PASS.

Run: `pnpm --filter @elisa/contracts build && ls packages/contracts/dist`
Expected: `index.js index.d.ts error-codes.js … envelope.js … health.js …` and imports inside `dist/index.js` end with `.js` (rewritten from `.ts`).

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all clean; `repo.test.ts` passes (contracts exports are tagged).

- [ ] **Step 8: Commit**

```bash
git add packages/contracts docs/rfc pnpm-lock.yaml
git commit -m "feat(contracts): add error codes, response envelopes and health schema (RFC-11, RFC-12)"
```

---

### Task 5: PII encryption module and RFC-40

**Files:**
- Create: `docs/rfc/40-data-protection/40-pii-encryption.md`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`
- Create: `apps/api/src/security/pii.ts`, `apps/api/src/security/pii.test.ts`
- Modify: `vitest.config.ts` (add `api:unit` project)

**Interfaces:**
- Produces:
  - `interface PiiKeyring { current: string; keys: ReadonlyMap<string, Buffer> }`
  - `keyringFromHex(current: string, keysHex: Record<string, string>): PiiKeyring`
  - `encryptPii(keyring, plaintext: string): string` / `decryptPii(keyring, stored: string): string`
  - `normalizeForIndex(value: string): string` / `blindIndex(hmacKey: Buffer, value: string): string`
  - `configurePii(keyring, hmacKey)`, `getPii(): { encrypt, decrypt, blindIndex }`, `resetPii()`
  - `class PiiError`, `class PiiDecryptError extends PiiError`

- [ ] **Step 1: RFC-40**

`docs/rfc/40-data-protection/40-pii-encryption.md`:
```markdown
# RFC-40 — PII encryption

| Field | Value |
|---|---|
| Status | draft |
| Category | data-protection |
| Supersedes | — |

## Context

Personal data of system users (name, email, IP address, user agent) must be unreadable in database dumps, backups and disk images. Encryption happens in the API process; the database never sees keys or plaintext.

## Rules

- **R1** PII columns are stored encrypted; plaintext is never persisted. Columns: `users.name`, `users.email` (both defined with RFC-2x), `audit_log.ip`, `audit_log.user_agent` (RFC-41).
- **R2** Algorithm: AES-256-GCM with a fresh 12-byte random IV per encryption and a 16-byte authentication tag. Stored format: `v<version>:<iv>:<tag>:<ciphertext>`, each part base64url without padding.
- **R3** Keys are 32 bytes. Each key version is a secret file `pii_encryption_key_v<N>` containing 64 lowercase hex characters. The keyring maps version label (`v1`, `v2`, …) to key; the version named by `PII_CURRENT_KEY_VERSION` (default `v1`) encrypts; every version in the keyring can decrypt.
- **R4** Decrypting a malformed value, an unknown version, or a value whose authentication fails throws `PiiDecryptError`. No partial plaintext is ever returned.
- **R5** Blind index for equality lookups: `HMAC-SHA256(pii_hmac_key, normalize(value))` as lowercase hex, where `normalize` = Unicode NFKC → trim → lowercase. The HMAC key is a separate 32-byte secret `pii_hmac_key`.
- **R6** Keys never appear in logs, database rows, API responses or error messages.
- **R7** Rotation: add `pii_encryption_key_v<N+1>`, set `PII_CURRENT_KEY_VERSION=v<N+1>`, restart; re-encrypt rows in batches (each row read via the keyring and written with the current key); remove the old secret only after `SELECT count(*) … WHERE col LIKE 'v<N>:%'` is zero for every PII column.
- **R8** The Drizzle column type `encryptedText` applies R2 on write and R4 on read, so business code never handles ciphertext.
- **R9** The PII module is configured once at process start (`configurePii`). Using `getPii()` before configuration throws `PiiError`.
- **R10** Random bytes come from `node:crypto` `randomBytes` (RFC-02 R13).

## Open questions

None.

## Changelog

- 2026-09-12 — created.
```

- [ ] **Step 2: API package files**

`apps/api/package.json`:
```json
{
  "name": "@elisa/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch --conditions=development src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run --config ../../vitest.config.ts --project api:unit --project api:integration",
    "test:unit": "vitest run --config ../../vitest.config.ts --project api:unit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "node --conditions=development src/db/migrate.ts"
  },
  "dependencies": {
    "@elisa/contracts": "workspace:*",
    "@hono/node-server": "2.1.1",
    "@hono/zod-validator": "0.9.1",
    "drizzle-orm": "0.45.2",
    "hono": "4.13.7",
    "ioredis": "6.0.0",
    "pino": "10.3.1",
    "postgres": "3.4.9",
    "zod": "4.6.2"
  },
  "devDependencies": {
    "@elisa/config": "workspace:*",
    "@testcontainers/postgresql": "12.1.0",
    "@testcontainers/redis": "12.1.0",
    "@types/node": "24.13.4",
    "drizzle-kit": "0.31.10",
    "testcontainers": "12.1.0",
    "typescript": "7.0.2",
    "vitest": "5.0.0"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "@elisa/config/tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test", "drizzle.config.ts"]
}
```

`apps/api/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

Modify root `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      'packages/*',
      'tools/*',
      {
        test: {
          name: 'api:unit',
          root: 'apps/api',
          include: ['src/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'src/**/*.integration.test.ts'],
        },
      },
    ],
  },
});
```

Run: `pnpm install`

- [ ] **Step 3: Failing tests**

`apps/api/src/security/pii.test.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PiiDecryptError,
  PiiError,
  blindIndex,
  configurePii,
  decryptPii,
  encryptPii,
  getPii,
  keyringFromHex,
  normalizeForIndex,
  resetPii,
} from './pii.ts';

const k1 = randomBytes(32).toString('hex');
const k2 = randomBytes(32).toString('hex');
const keyring = keyringFromHex('v1', { v1: k1 });
const hmacKey = randomBytes(32);

describe('RFC-40 R2 encryptPii / decryptPii', () => {
  it('round-trips and uses the v1:iv:tag:ct format', () => {
    const stored = encryptPii(keyring, 'Ada Lovelace');
    const parts = stored.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    expect(Buffer.from(parts[1] ?? '', 'base64url')).toHaveLength(12);
    expect(Buffer.from(parts[2] ?? '', 'base64url')).toHaveLength(16);
    expect(stored).not.toContain('Ada');
    expect(decryptPii(keyring, stored)).toBe('Ada Lovelace');
  });

  it('round-trips unicode and empty strings', () => {
    for (const s of ['', 'çãé 日本 🧬']) expect(decryptPii(keyring, encryptPii(keyring, s))).toBe(s);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptPii(keyring, 'x')).not.toBe(encryptPii(keyring, 'x'));
  });
});

describe('RFC-40 R4 decrypt failures', () => {
  it('rejects malformed values', () => {
    expect(() => decryptPii(keyring, 'plain text')).toThrow(PiiDecryptError);
    expect(() => decryptPii(keyring, 'v1:a:b')).toThrow(PiiDecryptError);
  });

  it('rejects unknown key versions', () => {
    const stored = encryptPii(keyring, 'x').replace(/^v1/, 'v9');
    expect(() => decryptPii(keyring, stored)).toThrow(PiiDecryptError);
  });

  it('rejects tampered ciphertext', () => {
    const stored = encryptPii(keyring, 'sensitive');
    const parts = stored.split(':');
    const ct = Buffer.from(parts[3] ?? '', 'base64url');
    ct[0] = (ct[0] ?? 0) ^ 0xff;
    parts[3] = ct.toString('base64url');
    expect(() => decryptPii(keyring, parts.join(':'))).toThrow(PiiDecryptError);
  });

  it('rejects a value encrypted with a different key of the same version', () => {
    const other = keyringFromHex('v1', { v1: k2 });
    expect(() => decryptPii(other, encryptPii(keyring, 'x'))).toThrow(PiiDecryptError);
  });
});

describe('RFC-40 R3, R7 keyring and rotation', () => {
  it('keyringFromHex validates 64 hex characters and the current version', () => {
    expect(() => keyringFromHex('v1', { v1: 'abc' })).toThrow(PiiError);
    expect(() => keyringFromHex('v2', { v1: k1 })).toThrow(PiiError);
    expect(keyringFromHex('v1', { v1: k1 }).keys.get('v1')).toHaveLength(32);
  });

  it('encrypts with the current key and still decrypts older versions', () => {
    const rotated = keyringFromHex('v2', { v1: k1, v2: k2 });
    const old = encryptPii(keyring, 'legacy');
    const fresh = encryptPii(rotated, 'new');
    expect(fresh.startsWith('v2:')).toBe(true);
    expect(decryptPii(rotated, old)).toBe('legacy');
    expect(decryptPii(rotated, fresh)).toBe('new');
  });
});

describe('RFC-40 R5 blind index', () => {
  it('normalizes with NFKC, trim and lowercase', () => {
    expect(normalizeForIndex('  Ada@Example.COM ')).toBe('ada@example.com');
    expect(normalizeForIndex('ﬁ')).toBe('fi');
  });

  it('is deterministic for equivalent inputs and differs across keys', () => {
    const a = blindIndex(hmacKey, 'Ada@Example.com');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(blindIndex(hmacKey, ' ada@example.com ')).toBe(a);
    expect(blindIndex(randomBytes(32), 'ada@example.com')).not.toBe(a);
  });
});

describe('RFC-40 R9 process-wide configuration', () => {
  afterEach(() => resetPii());

  it('throws before configuration', () => {
    expect(() => getPii()).toThrow(PiiError);
  });

  it('exposes encrypt/decrypt/blindIndex after configuration', () => {
    configurePii(keyring, hmacKey);
    const pii = getPii();
    expect(pii.decrypt(pii.encrypt('x'))).toBe('x');
    expect(pii.blindIndex('X')).toBe(blindIndex(hmacKey, 'x'));
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter @elisa/api test:unit`
Expected: FAIL — cannot find `./pii.ts`.

- [ ] **Step 5: Implement**

`apps/api/src/security/pii.ts`:
```ts
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export interface PiiKeyring {
  /** Version label used for new encryptions, e.g. "v1". */
  current: string;
  /** Version label → 32-byte key. */
  keys: ReadonlyMap<string, Buffer>;
}

export interface Pii {
  encrypt(plaintext: string): string;
  decrypt(stored: string): string;
  blindIndex(value: string): string;
}

/** @rfc RFC-40 R4, R9 */
export class PiiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PiiError';
  }
}

/** @rfc RFC-40 R4 */
export class PiiDecryptError extends PiiError {
  constructor() {
    super('PII value cannot be decrypted');
    this.name = 'PiiDecryptError';
  }
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_HEX_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^v\d+$/;

/** @rfc RFC-40 R3 */
export function keyringFromHex(current: string, keysHex: Record<string, string>): PiiKeyring {
  const keys = new Map<string, Buffer>();
  for (const [version, hex] of Object.entries(keysHex)) {
    if (!VERSION_RE.test(version)) throw new PiiError(`invalid key version label "${version}"`);
    if (!KEY_HEX_RE.test(hex)) throw new PiiError(`key ${version} must be 64 hex characters`);
    keys.set(version, Buffer.from(hex, 'hex'));
  }
  if (!keys.has(current)) throw new PiiError(`current key version ${current} is not in the keyring`);
  return { current, keys };
}

/** @rfc RFC-40 R2, R10 */
export function encryptPii(keyring: PiiKeyring, plaintext: string): string {
  const key = keyring.keys.get(keyring.current);
  if (!key) throw new PiiError('current key missing from keyring');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    keyring.current,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

/** @rfc RFC-40 R2, R4 */
export function decryptPii(keyring: PiiKeyring, stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 4) throw new PiiDecryptError();
  const [version, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  const key = keyring.keys.get(version);
  if (!key) throw new PiiDecryptError();
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new PiiDecryptError();
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    throw new PiiDecryptError();
  }
}

/** @rfc RFC-40 R5 */
export function normalizeForIndex(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

/** @rfc RFC-40 R5 */
export function blindIndex(hmacKey: Buffer, value: string): string {
  return createHmac('sha256', hmacKey).update(normalizeForIndex(value), 'utf8').digest('hex');
}

let configured: Pii | null = null;

/** @rfc RFC-40 R9 */
export function configurePii(keyring: PiiKeyring, hmacKey: Buffer): void {
  configured = {
    encrypt: (plaintext) => encryptPii(keyring, plaintext),
    decrypt: (stored) => decryptPii(keyring, stored),
    blindIndex: (value) => blindIndex(hmacKey, value),
  };
}

/** @rfc RFC-40 R9 */
export function getPii(): Pii {
  if (configured === null) throw new PiiError('PII module is not configured');
  return configured;
}

/** @rfc RFC-40 R9 */
export function resetPii(): void {
  configured = null;
}
```

- [ ] **Step 6: Run tests, typecheck, lint, rfc-lint**

Run: `pnpm --filter @elisa/api test:unit`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint && pnpm rfc:check`
Expected: clean. If `tsc` (TypeScript 7) rejects any option in `tsconfig.base.json`, remove that option, note the reason in `docs/gotchas/typescript.md` (create it) and add the file to the gotchas index.

- [ ] **Step 7: Commit**

```bash
git add apps/api docs/rfc vitest.config.ts pnpm-lock.yaml
git commit -m "feat(api): add PII encryption module with keyring and blind index (RFC-40)"
```

---

### Task 6: Configuration and secrets loader

**Files:**
- Create: `apps/api/src/config.ts`, `apps/api/src/config.test.ts`

**Interfaces:**
- Consumes: `keyringFromHex`, `PiiKeyring` from Task 5.
- Produces:
  - `interface AppConfig { nodeEnv; port; logLevel; appOrigin; db: { url }; redis: { url }; pii: { keyring; hmacKey }; sessionSecret }`
  - `loadConfig(env?: NodeJS.ProcessEnv): AppConfig`
  - `readSecret(secretsDir: string, name: string): string`
  - `buildDbUrl({ host, port, name, user, password })`, `buildRedisUrl({ host, port, password })`
  - `class ConfigError`, `type LogLevel`

- [ ] **Step 1: Failing tests**

`apps/api/src/config.test.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, buildDbUrl, buildRedisUrl, loadConfig, readSecret } from './config.ts';

const hex = () => randomBytes(32).toString('hex');

const ALL_SECRETS = {
  db_app_password: 'dbpw',
  redis_password: 'redispw',
  pii_encryption_key_v1: hex(),
  pii_hmac_key: hex(),
  session_secret: hex(),
};

const dirs: string[] = [];
function secretsDir(secrets: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'elisa-secrets-'));
  dirs.push(dir);
  for (const [name, value] of Object.entries(secrets)) writeFileSync(join(dir, name), `${value}\n`);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    APP_ORIGIN: 'http://localhost',
    DB_HOST: 'postgres',
    DB_NAME: 'elisa',
    DB_USER: 'elisa_app',
    REDIS_HOST: 'redis',
    SECRETS_DIR: secretsDir(ALL_SECRETS),
    ...overrides,
  };
}

describe('RFC-10 R5 loadConfig', () => {
  it('builds a config from env and secret files', () => {
    const config = loadConfig(env());
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
    expect(config.appOrigin).toBe('http://localhost');
    expect(config.db.url).toBe('postgres://elisa_app:dbpw@postgres:5432/elisa');
    expect(config.redis.url).toBe('redis://:redispw@redis:6379');
    expect(config.pii.keyring.current).toBe('v1');
    expect(config.pii.hmacKey).toHaveLength(32);
    expect(config.sessionSecret).toHaveLength(32);
  });

  it('rejects an invalid environment naming the field, not the value', () => {
    expect(() => loadConfig(env({ APP_ORIGIN: 'not a url' }))).toThrow(
      new ConfigError('invalid environment: APP_ORIGIN'),
    );
  });

  it('coerces numeric ports', () => {
    expect(loadConfig(env({ PORT: '4000', DB_PORT: '6543' })).port).toBe(4000);
  });
});

describe('RFC-02 R6 secrets', () => {
  it('fails when a secret file is missing and names it', () => {
    const { pii_hmac_key: _omit, ...rest } = ALL_SECRETS;
    expect(() => loadConfig(env({ SECRETS_DIR: secretsDir(rest) }))).toThrow(/missing secret "pii_hmac_key"/);
  });

  it('fails on an empty secret file', () => {
    const dir = secretsDir({ ...ALL_SECRETS, session_secret: '' });
    expect(() => loadConfig(env({ SECRETS_DIR: dir }))).toThrow(/secret "session_secret" is empty/);
  });

  it('never includes secret values in error messages', () => {
    const dir = secretsDir({ ...ALL_SECRETS, pii_hmac_key: 'nothex' });
    try {
      loadConfig(env({ SECRETS_DIR: dir }));
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain('nothex');
      expect((e as Error).message).toMatch(/pii_hmac_key/);
    }
  });

  it('readSecret trims trailing newlines', () => {
    expect(readSecret(secretsDir({ x: 'value' }), 'x')).toBe('value');
  });
});

describe('RFC-40 R3 keyring loading', () => {
  it('loads every pii_encryption_key_v* file and honours PII_CURRENT_KEY_VERSION', () => {
    const dir = secretsDir({ ...ALL_SECRETS, pii_encryption_key_v2: hex() });
    const config = loadConfig(env({ SECRETS_DIR: dir, PII_CURRENT_KEY_VERSION: 'v2' }));
    expect(config.pii.keyring.current).toBe('v2');
    expect([...config.pii.keyring.keys.keys()].sort()).toEqual(['v1', 'v2']);
  });

  it('fails when the current version file is missing', () => {
    expect(() => loadConfig(env({ PII_CURRENT_KEY_VERSION: 'v3' }))).toThrow(
      /missing secret "pii_encryption_key_v3"/,
    );
  });
});

describe('RFC-10 R5 url builders', () => {
  it('percent-encodes credentials', () => {
    expect(buildDbUrl({ host: 'h', port: 1, name: 'd', user: 'u@x', password: 'p:w' })).toBe(
      'postgres://u%40x:p%3Aw@h:1/d',
    );
    expect(buildRedisUrl({ host: 'h', port: 2, password: 'p/w' })).toBe('redis://:p%2Fw@h:2');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @elisa/api test:unit`
Expected: FAIL — cannot find `./config.ts`.

- [ ] **Step 3: Implement**

`apps/api/src/config.ts`:
```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { type PiiKeyring, keyringFromHex } from './security/pii.ts';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  APP_ORIGIN: z.url(),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
  PII_CURRENT_KEY_VERSION: z.string().regex(/^v\d+$/).default('v1'),
  SECRETS_DIR: z.string().min(1).default('/run/secrets'),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: LogLevel;
  appOrigin: string;
  db: { url: string };
  redis: { url: string };
  pii: { keyring: PiiKeyring; hmacKey: Buffer };
  sessionSecret: Buffer;
}

/** @rfc RFC-10 R5 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const HEX_32_BYTES = /^[0-9a-f]{64}$/;
const KEY_FILE_RE = /^pii_encryption_key_(v\d+)$/;

/** @rfc RFC-02 R6 */
export function readSecret(secretsDir: string, name: string): string {
  const path = join(secretsDir, name);
  if (!existsSync(path)) throw new ConfigError(`missing secret "${name}" in ${secretsDir}`);
  const value = readFileSync(path, 'utf8').trim();
  if (value.length === 0) throw new ConfigError(`secret "${name}" is empty`);
  return value;
}

function readHexSecret(secretsDir: string, name: string): Buffer {
  const value = readSecret(secretsDir, name);
  if (!HEX_32_BYTES.test(value)) throw new ConfigError(`secret "${name}" must be 64 hex characters`);
  return Buffer.from(value, 'hex');
}

/** @rfc RFC-10 R5 */
export function buildDbUrl(p: {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
}): string {
  return `postgres://${encodeURIComponent(p.user)}:${encodeURIComponent(p.password)}@${p.host}:${p.port}/${p.name}`;
}

/** @rfc RFC-10 R5 */
export function buildRedisUrl(p: { host: string; port: number; password: string }): string {
  return `redis://:${encodeURIComponent(p.password)}@${p.host}:${p.port}`;
}

/** @rfc RFC-40 R3 */
function loadKeyring(secretsDir: string, current: string): PiiKeyring {
  const keysHex: Record<string, string> = {};
  const files = existsSync(secretsDir) ? readdirSync(secretsDir) : [];
  for (const file of files) {
    const match = KEY_FILE_RE.exec(file);
    if (match?.[1]) keysHex[match[1]] = readHexSecret(secretsDir, file).toString('hex');
  }
  if (!(current in keysHex)) {
    throw new ConfigError(`missing secret "pii_encryption_key_${current}" in ${secretsDir}`);
  }
  return keyringFromHex(current, keysHex);
}

/**
 * @rfc RFC-10 R5
 * @rfc RFC-02 R6
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new ConfigError(`invalid environment: ${fields}`);
  }
  const e = parsed.data;
  const dbPassword = readSecret(e.SECRETS_DIR, 'db_app_password');
  const redisPassword = readSecret(e.SECRETS_DIR, 'redis_password');
  const hmacKey = readHexSecret(e.SECRETS_DIR, 'pii_hmac_key');
  const sessionSecret = readHexSecret(e.SECRETS_DIR, 'session_secret');
  const keyring = loadKeyring(e.SECRETS_DIR, e.PII_CURRENT_KEY_VERSION);
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    appOrigin: e.APP_ORIGIN,
    db: {
      url: buildDbUrl({
        host: e.DB_HOST,
        port: e.DB_PORT,
        name: e.DB_NAME,
        user: e.DB_USER,
        password: dbPassword,
      }),
    },
    redis: { url: buildRedisUrl({ host: e.REDIS_HOST, port: e.REDIS_PORT, password: redisPassword }) },
    pii: { keyring, hmacKey },
    sessionSecret,
  };
}
```

Note: `loadKeyring` is not exported, so it needs no `@rfc` tag, but keeping one is harmless.

- [ ] **Step 4: Run tests and checks**

Run: `pnpm --filter @elisa/api test:unit`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint && pnpm rfc:check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/config.test.ts
git commit -m "feat(api): add validated configuration and secrets loader (RFC-10 R5, RFC-02 R6)"
```

---

### Task 7: Logger with PII redaction

**Files:**
- Create: `apps/api/src/logger.ts`, `apps/api/src/logger.test.ts`, `apps/api/test/helpers/logger.ts`

**Interfaces:**
- Consumes: `LogLevel` from Task 6.
- Produces: `createLogger({ level, stream? }): Logger`, `REDACT_PATHS`, `type Logger` (re-export of pino's). Test helper `captureLogger(): { logger, lines }`.

- [ ] **Step 1: Failing tests**

`apps/api/src/logger.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { captureLogger } from '../test/helpers/logger.ts';

describe('RFC-02 R7 log redaction', () => {
  it('redacts sensitive keys at the top level and one level deep', () => {
    const { logger, lines } = captureLogger();
    logger.info(
      {
        password: 'p',
        token: 't',
        secret: 's',
        email: 'e',
        ip: '1.2.3.4',
        userAgent: 'ua',
        user: { email: 'e2', name: 'n', id: 'keep' },
        err: new Error('boom'),
      },
      'hello',
    );
    const line = lines[0] as Record<string, unknown>;
    expect(line.password).toBe('[REDACTED]');
    expect(line.token).toBe('[REDACTED]');
    expect(line.secret).toBe('[REDACTED]');
    expect(line.email).toBe('[REDACTED]');
    expect(line.ip).toBe('[REDACTED]');
    expect(line.userAgent).toBe('[REDACTED]');
    expect(line.user).toEqual({ email: '[REDACTED]', name: '[REDACTED]', id: 'keep' });
    expect((line.err as { message: string }).message).toBe('boom');
    expect(line.msg).toBe('hello');
  });

  it('redacts cookie, authorization and set-cookie headers', () => {
    const { logger, lines } = captureLogger();
    logger.info({
      req: { headers: { cookie: 'a=1', authorization: 'Bearer x', accept: 'json' } },
      res: { headers: { 'set-cookie': 'a=1' } },
    });
    const line = lines[0] as { req: { headers: Record<string, string> }; res: { headers: Record<string, string> } };
    expect(line.req.headers).toEqual({ cookie: '[REDACTED]', authorization: '[REDACTED]', accept: 'json' });
    expect(line.res.headers).toEqual({ 'set-cookie': '[REDACTED]' });
  });

  it('honours the configured level and omits pid/hostname', () => {
    const { logger, lines } = captureLogger('warn');
    logger.info('dropped');
    logger.warn('kept');
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toHaveProperty('pid');
    expect(lines[0]).not.toHaveProperty('hostname');
    expect(lines[0]).toHaveProperty('time');
  });
});
```

`apps/api/test/helpers/logger.ts`:
```ts
import type { LogLevel } from '../../src/config.ts';
import { createLogger } from '../../src/logger.ts';

export function captureLogger(level: LogLevel = 'trace') {
  const lines: unknown[] = [];
  const logger = createLogger({
    level,
    stream: {
      write(chunk: string) {
        lines.push(JSON.parse(chunk));
      },
    },
  });
  return { logger, lines };
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @elisa/api test:unit`
Expected: FAIL — cannot find `../../src/logger.ts`.

- [ ] **Step 3: Implement**

`apps/api/src/logger.ts`:
```ts
import { type DestinationStream, type Logger, pino } from 'pino';
import type { LogLevel } from './config.ts';

/** @rfc RFC-02 R7 */
export const REDACT_PATHS = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'email',
  '*.email',
  'ip',
  '*.ip',
  'userAgent',
  '*.userAgent',
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'user.name',
  'body.name',
  'input.name',
] as const;

export interface LoggerOptions {
  level: LogLevel;
  /** Defaults to stdout. Tests pass a capturing stream. */
  stream?: DestinationStream;
}

/**
 * @rfc RFC-02 R7
 * @rfc RFC-10 R12
 */
export function createLogger(options: LoggerOptions): Logger {
  const pinoOptions = {
    level: options.level,
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return options.stream ? pino(pinoOptions, options.stream) : pino(pinoOptions);
}

export type { Logger };
```

- [ ] **Step 4: Run tests and checks**

Run: `pnpm --filter @elisa/api test:unit`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint && pnpm rfc:check`
Expected: clean. If TypeScript cannot find the named export `pino`, switch to `import pino from 'pino'` and `pino.stdTimeFunctions` stays the same.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/logger.ts apps/api/src/logger.test.ts apps/api/test/helpers/logger.ts
git commit -m "feat(api): add pino logger with PII redaction (RFC-02 R7)"
```

---

### Task 8: HTTP errors, app factory, health routes

**Files:**
- Create: `apps/api/src/http/env.ts`, `apps/api/src/http/errors.ts`, `apps/api/src/http/errors.test.ts`
- Create: `apps/api/src/http/routes/health.ts`
- Create: `apps/api/src/app.ts`, `apps/api/src/app.test.ts`

**Interfaces:**
- Consumes: `ERROR_CODES`, `errorEnvelopeSchema`, `HealthResponse` (Task 4); `Logger` (Task 7); `AppConfig` (Task 6).
- Produces:
  - `type AppEnv = { Variables: RequestIdVariables }`
  - `class AppError(code: ErrorCode, message: string, details?: ErrorDetail[])` with `.status`
  - `errorBody(code, message, details?): ErrorEnvelope`
  - `createErrorHandler(logger): ErrorHandler<AppEnv>`
  - `interface HealthChecks { database(): Promise<boolean>; redis(): Promise<boolean> }`
  - `healthRoutes(checks): Hono<AppEnv>`
  - `interface AppDeps { config: Pick<AppConfig, 'appOrigin'>; logger: Logger; health: HealthChecks }`
  - `createApp(deps: AppDeps): Hono<AppEnv>`, `type App`, `BODY_LIMIT_BYTES`

- [ ] **Step 1: Failing tests for errors**

`apps/api/src/http/errors.test.ts`:
```ts
import { errorEnvelopeSchema } from '@elisa/contracts';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../test/helpers/logger.ts';
import type { AppEnv } from './env.ts';
import { AppError, createErrorHandler, errorBody } from './errors.ts';

describe('RFC-11 R3-R4 AppError and errorBody', () => {
  it('derives the HTTP status from the code', () => {
    const err = new AppError('NOT_FOUND', 'Nope');
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Nope');
  });

  it('omits details when absent and includes them when present', () => {
    expect(errorBody('NOT_FOUND', 'x')).toEqual({ error: { code: 'NOT_FOUND', message: 'x' } });
    const withDetails = errorBody('VALIDATION_FAILED', 'x', [{ path: 'a', message: 'b' }]);
    expect(withDetails.error.details).toEqual([{ path: 'a', message: 'b' }]);
    expect(errorEnvelopeSchema.safeParse(withDetails).success).toBe(true);
  });
});

describe('RFC-02 R9 error handler', () => {
  function app() {
    const { logger, lines } = captureLogger();
    const a = new Hono<AppEnv>();
    a.use(requestId());
    a.onError(createErrorHandler(logger));
    a.get('/app-error', () => {
      throw new AppError('RATE_LIMITED', 'Slow down');
    });
    a.get('/http-413', () => {
      throw new HTTPException(413, { message: 'too big' });
    });
    a.get('/http-400', () => {
      throw new HTTPException(400, { message: 'Malformed JSON in request body' });
    });
    a.get('/http-418', () => {
      throw new HTTPException(418, { message: 'teapot' });
    });
    a.get('/boom', () => {
      throw new Error('secret internal detail');
    });
    return { a, lines };
  }

  it('maps AppError to its code and status', async () => {
    const res = await app().a.request('/app-error');
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: 'RATE_LIMITED', message: 'Slow down' } });
  });

  it('maps HTTPException 413 and 400 to catalog codes', async () => {
    const { a } = app();
    const r413 = await a.request('/http-413');
    expect(r413.status).toBe(413);
    expect((await r413.json()).error.code).toBe('REQUEST_TOO_LARGE');
    const r400 = await a.request('/http-400');
    expect(r400.status).toBe(400);
    expect((await r400.json()).error.code).toBe('VALIDATION_INVALID_JSON');
  });

  it('maps any other HTTPException to INTERNAL_ERROR without leaking its message', async () => {
    const res = await app().a.request('/http-418');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('teapot');
    expect(JSON.parse(text).error.code).toBe('INTERNAL_ERROR');
  });

  it('hides unexpected errors and logs them with the request id', async () => {
    const { a, lines } = app();
    const res = await a.request('/boom', { headers: { 'x-request-id': 'req-123' } });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret internal detail');
    expect(JSON.parse(text)).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
    const logged = lines.find((l) => (l as { msg: string }).msg === 'unhandled error') as {
      requestId: string;
      err: { message: string };
    };
    expect(logged.requestId).toBe('req-123');
    expect(logged.err.message).toBe('secret internal detail');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @elisa/api test:unit`
Expected: FAIL — cannot find `./errors.ts`.

- [ ] **Step 3: Implement env and errors**

`apps/api/src/http/env.ts`:
```ts
import type { RequestIdVariables } from 'hono/request-id';

export type AppEnv = { Variables: RequestIdVariables };
```

`apps/api/src/http/errors.ts`:
```ts
import { ERROR_CODES, type ErrorCode, type ErrorDetail, type ErrorEnvelope } from '@elisa/contracts';
import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Logger } from '../logger.ts';
import type { AppEnv } from './env.ts';

/** @rfc RFC-11 R3-R4 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ContentfulStatusCode;
  readonly details: ErrorDetail[] | undefined;

  constructor(code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code] as ContentfulStatusCode;
    this.details = details;
  }
}

/** @rfc RFC-11 R3 */
export function errorBody(code: ErrorCode, message: string, details?: ErrorDetail[]): ErrorEnvelope {
  return { error: details ? { code, message, details } : { code, message } };
}

const INTERNAL = errorBody('INTERNAL_ERROR', 'An unexpected error occurred');

/**
 * @rfc RFC-11 R3-R4
 * @rfc RFC-02 R9
 */
export function createErrorHandler(logger: Logger): ErrorHandler<AppEnv> {
  return (err, c) => {
    const requestId = c.get('requestId');
    if (err instanceof AppError) {
      return c.json(errorBody(err.code, err.message, err.details), err.status);
    }
    if (err instanceof HTTPException) {
      if (err.status === 413) {
        return c.json(errorBody('REQUEST_TOO_LARGE', 'Request body exceeds 1 MiB'), 413);
      }
      if (err.status === 400) {
        return c.json(errorBody('VALIDATION_INVALID_JSON', 'Request body is not valid JSON'), 400);
      }
      logger.warn({ requestId, status: err.status }, 'unmapped http exception');
      return c.json(INTERNAL, 500);
    }
    logger.error({ requestId, err }, 'unhandled error');
    return c.json(INTERNAL, 500);
  };
}
```

- [ ] **Step 4: Run errors tests**

Run: `pnpm --filter @elisa/api test:unit`
Expected: `errors.test.ts` PASS.

- [ ] **Step 5: Failing tests for the app factory**

`apps/api/src/app.test.ts`:
```ts
import { errorEnvelopeSchema } from '@elisa/contracts';
import { describe, expect, it } from 'vitest';
import { captureLogger } from '../test/helpers/logger.ts';
import { type AppDeps, BODY_LIMIT_BYTES, createApp } from './app.ts';
import { AppError } from './http/errors.ts';

const ORIGIN = 'http://localhost';

function build(overrides: Partial<AppDeps> = {}) {
  const { logger, lines } = captureLogger();
  const deps: AppDeps = {
    config: { appOrigin: ORIGIN },
    logger,
    health: { database: async () => true, redis: async () => true },
    ...overrides,
  };
  return { app: createApp(deps), lines };
}

describe('RFC-10 R10 health', () => {
  it('GET /api/health answers exactly {"ok":true}', async () => {
    const res = await build().app.request('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('GET /api/health/ready is 200 when both checks pass and 503 otherwise', async () => {
    expect((await build().app.request('/api/health/ready')).status).toBe(200);
    const down = build({ health: { database: async () => true, redis: async () => false } });
    const res = await down.app.request('/api/health/ready');
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('SERVICE_UNAVAILABLE');
    const throwing = build({
      health: {
        database: async () => {
          throw new Error('db down');
        },
        redis: async () => true,
      },
    });
    expect((await throwing.app.request('/api/health/ready')).status).toBe(503);
  });
});

describe('RFC-11 R8 unknown routes', () => {
  it('answer 404 with the error envelope', async () => {
    const res = await build().app.request('/api/does-not-exist');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('RFC-10 R12 request id', () => {
  it('sets X-Request-Id and echoes a provided one', async () => {
    const { app } = build();
    const generated = await app.request('/api/health');
    expect(generated.headers.get('x-request-id')).toMatch(/\S+/);
    const echoed = await app.request('/api/health', { headers: { 'x-request-id': 'abc-123' } });
    expect(echoed.headers.get('x-request-id')).toBe('abc-123');
  });
});

describe('RFC-02 R5 security headers', () => {
  it('are present on every response', async () => {
    const res = await build().app.request('/api/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});

describe('RFC-02 R4 body limit', () => {
  it('rejects bodies over 1 MiB with 413 REQUEST_TOO_LARGE', async () => {
    const { app } = build();
    // Routes added to the app are prefixed with the /api basePath automatically.
    app.post('/echo', async (c) => c.json({ length: (await c.req.text()).length }));
    const big = 'x'.repeat(BODY_LIMIT_BYTES + 1);
    const res = await app.request('/api/echo', {
      method: 'POST',
      body: big,
      headers: { origin: ORIGIN, 'content-length': String(big.length) },
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('REQUEST_TOO_LARGE');
    const ok = await app.request('/api/echo', {
      method: 'POST',
      body: 'small',
      headers: { origin: ORIGIN, 'content-length': '5' },
    });
    expect(ok.status).toBe(200);
  });
});

describe('RFC-02 R9 error handling is wired', () => {
  it('maps AppError and hides unexpected errors', async () => {
    const { app, lines } = build();
    app.get('/app-error', () => {
      throw new AppError('RATE_LIMITED', 'Slow down');
    });
    app.get('/boom', () => {
      throw new Error('internal detail');
    });
    expect((await app.request('/api/app-error')).status).toBe(429);
    const res = await app.request('/api/boom');
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('internal detail');
    expect(lines.some((l) => (l as { msg: string }).msg === 'unhandled error')).toBe(true);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter @elisa/api test:unit`
Expected: FAIL — cannot find `./app.ts`.

- [ ] **Step 7: Implement health routes and app factory**

`apps/api/src/http/routes/health.ts`:
```ts
import type { HealthResponse } from '@elisa/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { errorBody } from '../errors.ts';

export interface HealthChecks {
  database(): Promise<boolean>;
  redis(): Promise<boolean>;
}

const OK: HealthResponse = { ok: true };

const safe = (check: () => Promise<boolean>): Promise<boolean> => check().catch(() => false);

/** @rfc RFC-10 R10 */
export function healthRoutes(checks: HealthChecks) {
  return new Hono<AppEnv>()
    .get('/', (c) => c.json(OK))
    .get('/ready', async (c) => {
      const [database, redis] = await Promise.all([safe(checks.database), safe(checks.redis)]);
      if (database && redis) return c.json(OK);
      return c.json(errorBody('SERVICE_UNAVAILABLE', 'A dependency is unavailable'), 503);
    });
}
```

`apps/api/src/app.ts`:
```ts
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { AppConfig } from './config.ts';
import type { AppEnv } from './http/env.ts';
import { createErrorHandler, errorBody } from './http/errors.ts';
import { type HealthChecks, healthRoutes } from './http/routes/health.ts';
import type { Logger } from './logger.ts';

export interface AppDeps {
  config: Pick<AppConfig, 'appOrigin'>;
  logger: Logger;
  health: HealthChecks;
}

/** @rfc RFC-02 R4 */
export const BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * @rfc RFC-11 R1, R5, R8
 * @rfc RFC-02 R4-R5
 * @rfc RFC-10 R12
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>().basePath('/api');

  app.use(requestId());
  app.use(
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      xFrameOptions: 'DENY',
      referrerPolicy: 'strict-origin-when-cross-origin',
    }),
  );
  app.use(bodyLimit({ maxSize: BODY_LIMIT_BYTES }));

  app.route('/health', healthRoutes(deps.health));

  app.notFound((c) => c.json(errorBody('NOT_FOUND', 'Route not found'), 404));
  app.onError(createErrorHandler(deps.logger));
  return app;
}

export type App = ReturnType<typeof createApp>;
```

- [ ] **Step 8: Run tests and checks**

Run: `pnpm --filter @elisa/api test:unit`
Expected: PASS. If the 413 test fails because `content-length` is ignored by `Request`, keep the test as is: `bodyLimit` also counts streamed bytes, and the `/api/echo` route reads the body, which triggers the 413 through the error handler. If it still returns 200, check that the route reads the body with `c.req.text()`.

Run: `pnpm typecheck && pnpm lint && pnpm rfc:check`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/http apps/api/src/app.ts apps/api/src/app.test.ts
git commit -m "feat(api): add app factory with error envelope, security headers, body limit and health routes (RFC-10 R10, RFC-11)"
```

---

### Task 9: Strict request validation middleware

**Files:**
- Create: `apps/api/src/http/validate.ts`, `apps/api/src/http/validate.test.ts`

**Interfaces:**
- Consumes: `errorBody`, `createErrorHandler` (Task 8).
- Produces: `validate(target: 'json' | 'query' | 'param' | 'header' | 'cookie' | 'form', schema)` — a Hono middleware; handlers read `c.req.valid(target)`.

- [ ] **Step 1: Failing tests**

`apps/api/src/http/validate.test.ts`:
```ts
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { captureLogger } from '../../test/helpers/logger.ts';
import type { AppEnv } from './env.ts';
import { createErrorHandler } from './errors.ts';
import { validate } from './validate.ts';

const bodySchema = z.strictObject({ name: z.string().min(1), age: z.number().int() });
const querySchema = z.strictObject({ limit: z.coerce.number().int().max(200).optional() });

function app() {
  const a = new Hono<AppEnv>();
  a.onError(createErrorHandler(captureLogger().logger));
  a.post('/things', validate('json', bodySchema), (c) => c.json({ data: c.req.valid('json') }));
  a.get('/things', validate('query', querySchema), (c) => c.json({ data: c.req.valid('query') }));
  return a;
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('RFC-02 R2 strict validation', () => {
  it('passes a valid body through to the handler', async () => {
    const res = await app().request('/things', json({ name: 'a', age: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { name: 'a', age: 1 } });
  });

  it('rejects unknown fields with 400 VALIDATION_FAILED and never echoes values', async () => {
    const res = await app().request('/things', json({ name: 'a', age: 1, extra: 'SECRET_VALUE' }));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain('SECRET_VALUE');
    const body = JSON.parse(text);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.some((d: { message: string }) => /extra/.test(d.message))).toBe(true);
  });

  it('reports the failing field path', async () => {
    const res = await app().request('/things', json({ name: 'a', age: 'x' }));
    const body = await res.json();
    expect(body.error.details.map((d: { path: string }) => d.path)).toContain('age');
  });

  it('RFC-11 R7 malformed JSON answers VALIDATION_INVALID_JSON', async () => {
    const res = await app().request('/things', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_INVALID_JSON');
  });

  it('RFC-11 R7 a non-JSON content type fails validation', async () => {
    const res = await app().request('/things', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'name=a',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual([{ path: '', message: 'Expected application/json' }]);
  });

  it('validates query strings', async () => {
    expect((await app().request('/things?limit=10')).status).toBe(200);
    const res = await app().request('/things?limit=999');
    expect(res.status).toBe(400);
    expect((await res.json()).error.details[0].path).toBe('limit');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @elisa/api test:unit`
Expected: FAIL — cannot find `./validate.ts`.

- [ ] **Step 3: Implement**

`apps/api/src/http/validate.ts`:
```ts
import { zValidator } from '@hono/zod-validator';
import type { MiddlewareHandler, ValidationTargets } from 'hono';
import type { z } from 'zod';
import { errorBody } from './errors.ts';

const JSON_CONTENT_TYPE = /^application\/json\b/i;

/**
 * @rfc RFC-02 R2
 * @rfc RFC-11 R3, R7
 */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  const inner = zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      }));
      return c.json(errorBody('VALIDATION_FAILED', 'Request validation failed', details), 400);
    }
  });
  if (target !== 'json') return inner;

  // RFC-11 R7: refuse non-JSON bodies ourselves so the answer does not depend on framework internals.
  const guarded: MiddlewareHandler = async (c, next) => {
    if (!JSON_CONTENT_TYPE.test(c.req.header('content-type') ?? '')) {
      return c.json(
        errorBody('VALIDATION_FAILED', 'Request body must be application/json', [
          { path: '', message: 'Expected application/json' },
        ]),
        400,
      );
    }
    return inner(c, next);
  };
  // The cast keeps zValidator's inferred types so handlers can call c.req.valid('json').
  return guarded as unknown as typeof inner;
}
```

- [ ] **Step 4: Run tests and checks**

Run: `pnpm --filter @elisa/api test:unit`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint && pnpm rfc:check`
Expected: clean. If `c.req.valid(target)` is typed as `never` in the test handlers, the generic inference of `zValidator` needs the hook typed explicitly; in that case change the signature to `zValidator<Schema, Target, AppEnv, string>(...)` and keep the tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/http/validate.ts apps/api/src/http/validate.test.ts
git commit -m "feat(api): add strict Zod validation middleware (RFC-02 R2, RFC-11 R7)"
```

---

### Task 10: Origin check for mutating requests

**Files:**
- Create: `apps/api/src/http/origin-check.ts`, `apps/api/src/http/origin-check.test.ts`
- Modify: `apps/api/src/app.ts` (wire middleware), `apps/api/src/app.test.ts` (add case)

**Interfaces:**
- Produces: `originCheck(appOrigin: string): MiddlewareHandler<AppEnv>`.

- [ ] **Step 1: Failing tests**

`apps/api/src/http/origin-check.test.ts`:
```ts
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../test/helpers/logger.ts';
import type { AppEnv } from './env.ts';
import { createErrorHandler } from './errors.ts';
import { originCheck } from './origin-check.ts';

const ORIGIN = 'https://elisa.example.org';

function app() {
  const a = new Hono<AppEnv>();
  a.onError(createErrorHandler(captureLogger().logger));
  a.use(originCheck(ORIGIN));
  for (const method of ['post', 'put', 'patch', 'delete'] as const) a[method]('/m', (c) => c.text('ok'));
  a.get('/g', (c) => c.text('ok'));
  return a;
}

describe('RFC-02 R3 origin check', () => {
  it('rejects mutations without an Origin header', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await app().request('/m', { method });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('SECURITY_INVALID_ORIGIN');
    }
  });

  it('rejects mutations from another origin, including a different port or scheme', async () => {
    for (const origin of ['https://evil.example', 'http://elisa.example.org', `${ORIGIN}:8443`]) {
      const res = await app().request('/m', { method: 'POST', headers: { origin } });
      expect(res.status).toBe(403);
    }
  });

  it('accepts mutations from the configured origin', async () => {
    const res = await app().request('/m', { method: 'POST', headers: { origin: ORIGIN } });
    expect(res.status).toBe(200);
  });

  it('does not require Origin on safe methods', async () => {
    expect((await app().request('/g')).status).toBe(200);
    expect((await app().request('/g', { method: 'HEAD' })).status).toBe(200);
  });
});
```

Add to `apps/api/src/app.test.ts`:
```ts
describe('RFC-02 R3 origin check is wired', () => {
  it('rejects a mutation without Origin before any handler runs', async () => {
    const { app } = build();
    let handlerRan = false;
    app.post('/mutate', (c) => {
      handlerRan = true;
      return c.json({ data: null });
    });
    const res = await app.request('/api/mutate', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(handlerRan).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @elisa/api test:unit`
Expected: FAIL — `origin-check.ts` missing; app test expects 403 but gets 200.

- [ ] **Step 3: Implement and wire**

`apps/api/src/http/origin-check.ts`:
```ts
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env.ts';
import { AppError } from './errors.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** @rfc RFC-02 R3 */
export function originCheck(appOrigin: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && c.req.header('origin') !== appOrigin) {
      throw new AppError('SECURITY_INVALID_ORIGIN', 'Request origin is not allowed');
    }
    await next();
  };
}
```

In `apps/api/src/app.ts` add the import and place the middleware right after `secureHeaders` and before `bodyLimit`:
```ts
import { originCheck } from './http/origin-check.ts';
// …
  app.use(originCheck(deps.config.appOrigin));
  app.use(bodyLimit({ maxSize: BODY_LIMIT_BYTES }));
```
Update the `@rfc` block on `createApp` so the RFC-02 line covers the origin rule:
```ts
/**
 * @rfc RFC-11 R1, R5, R8
 * @rfc RFC-02 R3-R5
 * @rfc RFC-10 R12
 */
```
(Reminder: `rfc-lint` accepts one RFC per `@rfc` line; a second RFC on the same line is a violation.)

- [ ] **Step 4: Run tests and checks**

Run: `pnpm --filter @elisa/api test:unit`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint && pnpm rfc:check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): reject mutations without a valid Origin header (RFC-02 R3)"
```

---

### Task 11: Database layer, Redis client, integration test harness, `audit_log` schema and RFC-41

**Files:**
- Create: `docs/rfc/40-data-protection/41-audit-log.md`
- Create: `apps/api/drizzle.config.ts`
- Create: `apps/api/src/db/client.ts`, `apps/api/src/db/migrator.ts`, `apps/api/src/db/migrate.ts`
- Create: `apps/api/src/db/types/encrypted-text.ts`, `apps/api/src/db/schema/index.ts`, `apps/api/src/db/schema/audit-log.ts`
- Generate: `apps/api/drizzle/0000_audit_log.sql`, `apps/api/drizzle/0001_audit_log_append_only.sql`, `apps/api/drizzle/meta/*`
- Create: `apps/api/src/redis/client.ts`
- Create: `apps/api/test/global-setup.ts`, `apps/api/test/setup.ts`, `apps/api/test/helpers/db.ts`, `apps/api/test/helpers/pii.ts`
- Create: `apps/api/src/db/client.integration.test.ts`, `apps/api/src/redis/client.integration.test.ts`
- Modify: `vitest.config.ts` (add `api:integration` project)

**Interfaces:**
- Consumes: `getPii`, `configurePii`, `keyringFromHex` (Task 5); `buildDbUrl`, `readSecret` (Task 6).
- Produces:
  - `createDb(url, { max? }): { db: Db; close(): Promise<void> }`, `type Db`, `type DbTransaction`, `type DbExecutor = Db | DbTransaction`
  - `runMigrations(url, folder?)`, `migrationsFolder()`
  - `encryptedText(name)` Drizzle column type
  - `auditLog` table, `type AuditLogRow`, `type NewAuditLogRow`
  - `createRedis(url): Redis`, `type Redis`
  - Test helpers: `useTestDb(): { db }`, `withRollback(db, fn)`, `TEST_KEYRING`, `TEST_HMAC_KEY`; Vitest `inject('databaseUrl')`, `inject('redisUrl')`, `inject('postgres')`, `inject('redis')`

- [ ] **Step 1: RFC-41**

`docs/rfc/40-data-protection/41-audit-log.md`:
```markdown
# RFC-41 — Audit log

| Field | Value |
|---|---|
| Status | draft |
| Category | data-protection |
| Supersedes | — |

## Context

Security-relevant events must be recorded immutably: accountability under the GDPR (Art. 5(2), Art. 32) and scientific integrity both require knowing who did what and when.

## Rules

- **R1** Table `audit_log` columns: `id` uuid primary key default `uuidv7()`; `at` timestamptz not null default `now()`; `actor_user_id` uuid nullable (foreign key to `users` added by RFC-2x); `action` text not null; `target_type` text nullable; `target_id` text nullable; `ip` text nullable (encrypted); `user_agent` text nullable (encrypted); `metadata` jsonb not null default `{}`. Indexes: `(at desc)` and `(actor_user_id, at desc)`.
- **R2** Append-only. A trigger rejects every `UPDATE` and `TRUNCATE`. It rejects `DELETE` unless the current transaction has executed `SET LOCAL elisa.allow_audit_purge = 'on'`; only the retention job (RFC-42, future) sets it.
- **R3** Actions are dot-separated identifiers `<domain>.<event>` from the catalog below, mirrored exactly by `AUDIT_ACTIONS` in `apps/api/src/audit/actions.ts` (a test compares the two). New actions are added to this RFC first.
- **R4** `ip` and `user_agent` are encrypted with RFC-40 before storage.
- **R5** `recordAudit` runs inside the same database transaction as the action it records. If the audit write fails, the action is rolled back (fail closed).
- **R6** Retention: entries older than 2 years are purged by the retention job (RFC-42, future). Until it exists nothing is purged.
- **R7** `metadata` never contains personal data or secrets. `recordAudit` rejects the keys `password`, `passwordHash`, `token`, `secret`, `email`, `name`, `ip`, `userAgent` at any depth before writing.
- **R8** `actor_user_id` is null for events without an authenticated actor (for example a failed login for an unknown email).
- **R9** The runtime role `elisa_app` never holds `UPDATE` or `TRUNCATE` on `audit_log`: the migration that creates the trigger also revokes `UPDATE` from `elisa_app` when that role exists. The trigger is the second line of defense.

## Actions

| Action | Meaning |
|---|---|
| `auth.login.success` | Password (and TOTP, if enabled) accepted; session created. |
| `auth.login.failure` | Login attempt rejected (unknown email, wrong password or wrong TOTP). |
| `auth.logout` | Current session revoked by the user. |
| `auth.logout_all` | All sessions of a user revoked. |
| `auth.invite.created` | Invitation issued (or re-issued) for a user. |
| `auth.invite.accepted` | Invitation accepted; password set. |
| `auth.password.reset_requested` | Password reset token issued. |
| `auth.password.reset` | Password replaced through a reset token. |
| `auth.password.changed` | Password replaced by the authenticated user. |
| `auth.totp.enabled` | TOTP second factor enabled. |
| `auth.totp.disabled` | TOTP second factor disabled. |
| `users.created` | User record created by an admin. |
| `users.updated` | User profile fields changed. |
| `users.roles_changed` | Roles assigned to or removed from a user. |
| `users.suspended` | User suspended. |
| `users.reactivated` | User reactivated. |
| `users.deleted` | User erased and anonymized. |
| `users.exported` | Personal data export produced. |
| `roles.created` | Role created. |
| `roles.updated` | Role name, description or permissions changed. |
| `roles.deleted` | Role deleted. |
| `sessions.revoked` | A session revoked by an admin. |
| `admin.accessed` | Admin area opened. |

## Open questions

None.

## Changelog

- 2026-09-12 — created.
```

- [ ] **Step 2: Drizzle config, schema, column type, client, migrator**

`apps/api/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
```

`apps/api/src/db/types/encrypted-text.ts`:
```ts
import { customType } from 'drizzle-orm/pg-core';
import { getPii } from '../../security/pii.ts';

/** @rfc RFC-40 R8 */
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'text';
  },
  toDriver(value) {
    return getPii().encrypt(value);
  },
  fromDriver(value) {
    return getPii().decrypt(value);
  },
});
```

`apps/api/src/db/schema/audit-log.ts`:
```ts
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from '../types/encrypted-text.ts';

/**
 * @rfc RFC-41 R1, R4
 * @rfc RFC-02 R8
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    ip: encryptedText('ip'),
    userAgent: encryptedText('user_agent'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('audit_log_at_idx').on(t.at.desc()),
    index('audit_log_actor_idx').on(t.actorUserId, t.at.desc()),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
```

`apps/api/src/db/schema/index.ts`:
```ts
export * from './audit-log.ts';
```

`apps/api/src/db/client.ts`:
```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.ts';

export interface DbOptions {
  /** Pool size. Default 10. */
  max?: number;
}

/**
 * @rfc RFC-10 R2, R6
 */
export function createDb(url: string, options: DbOptions = {}) {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => undefined });
  const db = drizzle(client, { schema });
  return {
    db,
    close: async (): Promise<void> => {
      await client.end();
    },
  };
}

export type Db = ReturnType<typeof createDb>['db'];
export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbExecutor = Db | DbTransaction;
```

`apps/api/src/db/migrator.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** @rfc RFC-10 R7 */
export function migrationsFolder(): string {
  return fileURLToPath(new URL('../../drizzle', import.meta.url));
}

/** @rfc RFC-10 R7 */
export async function runMigrations(url: string, folder = migrationsFolder()): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    await client.end();
  }
}
```

`apps/api/src/db/migrate.ts` (CLI entry, no exports):
```ts
import { z } from 'zod';
import { buildDbUrl, readSecret } from '../config.ts';
import { runMigrations } from './migrator.ts';

const env = z
  .object({
    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    DB_NAME: z.string().min(1),
    DB_MIGRATOR_USER: z.string().min(1),
    SECRETS_DIR: z.string().min(1).default('/run/secrets'),
  })
  .parse(process.env);

await runMigrations(
  buildDbUrl({
    host: env.DB_HOST,
    port: env.DB_PORT,
    name: env.DB_NAME,
    user: env.DB_MIGRATOR_USER,
    password: readSecret(env.SECRETS_DIR, 'db_migrator_password'),
  }),
);
process.stdout.write('migrations applied\n');
```

`apps/api/src/redis/client.ts`:
```ts
import { Redis } from 'ioredis';

/** @rfc RFC-10 R2 */
export function createRedis(url: string): Redis {
  return new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: false });
}

export type { Redis };
```

- [ ] **Step 3: Generate the migrations**

Run: `pnpm --filter @elisa/api db:generate --name audit_log`
Expected: creates `apps/api/drizzle/0000_audit_log.sql` and `apps/api/drizzle/meta/{_journal.json,0000_snapshot.json}`. Open the SQL and confirm it contains `CREATE TABLE "audit_log"` with the nine columns, `DEFAULT uuidv7()`, `DEFAULT now()`, `DEFAULT '{}'::jsonb`, and the two `CREATE INDEX` statements. (The PII module is not needed at generate time; `getPii()` is only called on read/write.)

Run: `pnpm --filter @elisa/api exec drizzle-kit generate --custom --name audit_log_append_only`
Expected: creates an empty `apps/api/drizzle/0001_audit_log_append_only.sql` and a journal entry. Fill the file with:
```sql
CREATE OR REPLACE FUNCTION audit_log_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('elisa.allow_audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
BEFORE TRUNCATE ON audit_log
FOR EACH STATEMENT EXECUTE FUNCTION audit_log_guard();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'elisa_app') THEN
    REVOKE UPDATE ON audit_log FROM elisa_app;
  END IF;
END;
$$;
```

- [ ] **Step 4: Test harness**

`apps/api/test/helpers/pii.ts`:
```ts
import { keyringFromHex } from '../../src/security/pii.ts';

export const TEST_KEYRING = keyringFromHex('v1', { v1: 'a'.repeat(64) });
export const TEST_HMAC_KEY = Buffer.alloc(32, 7);
```

`apps/api/test/setup.ts`:
```ts
import { configurePii } from '../src/security/pii.ts';
import { TEST_HMAC_KEY, TEST_KEYRING } from './helpers/pii.ts';

configurePii(TEST_KEYRING, TEST_HMAC_KEY);
```

`apps/api/test/global-setup.ts`:
```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../src/db/migrator.ts';

export interface PostgresInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface RedisInfo {
  host: string;
  port: number;
  password: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
    postgres: PostgresInfo;
    redis: RedisInfo;
  }
}

const REDIS_PASSWORD = 'test-redis-password';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:18.6-alpine').start(),
    new RedisContainer('redis:8.8-alpine').withPassword(REDIS_PASSWORD).start(),
  ]);
  await runMigrations(postgres.getConnectionUri());

  project.provide('databaseUrl', postgres.getConnectionUri());
  project.provide('redisUrl', redis.getConnectionUrl());
  project.provide('postgres', {
    host: postgres.getHost(),
    port: postgres.getPort(),
    database: postgres.getDatabase(),
    user: postgres.getUsername(),
    password: postgres.getPassword(),
  });
  project.provide('redis', { host: redis.getHost(), port: redis.getPort(), password: REDIS_PASSWORD });

  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
```

`apps/api/test/helpers/db.ts`:
```ts
import { TransactionRollbackError } from 'drizzle-orm';
import { afterAll, beforeAll, inject } from 'vitest';
import { type Db, type DbTransaction, createDb } from '../../src/db/client.ts';

/** Opens a pool for the current test file and closes it afterwards. */
export function useTestDb(): { readonly db: Db } {
  let handle: ReturnType<typeof createDb> | undefined;
  beforeAll(() => {
    handle = createDb(inject('databaseUrl'), { max: 2 });
  });
  afterAll(async () => {
    await handle?.close();
  });
  return {
    get db(): Db {
      if (!handle) throw new Error('useTestDb: pool not initialised');
      return handle.db;
    },
  };
}

/** Runs fn inside a transaction that is always rolled back (RFC-01 R4). */
export async function withRollback<T>(db: Db, fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  let result: T | undefined;
  let completed = false;
  try {
    await db.transaction(async (tx) => {
      result = await fn(tx);
      completed = true;
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
  if (!completed) throw new Error('withRollback: callback did not complete');
  return result as T;
}
```

Modify root `vitest.config.ts` — add the integration project after `api:unit`:
```ts
      {
        test: {
          name: 'api:integration',
          root: 'apps/api',
          include: ['src/**/*.integration.test.ts'],
          globalSetup: ['./test/global-setup.ts'],
          setupFiles: ['./test/setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
```

- [ ] **Step 5: Failing integration tests**

`apps/api/src/db/client.integration.test.ts`:
```ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useTestDb, withRollback } from '../../test/helpers/db.ts';

describe('RFC-10 R6-R7 database client and migrations', () => {
  const t = useTestDb();

  it('executes a parameterized query', async () => {
    const value = 41;
    const rows = await t.db.execute(sql`select ${value}::int + 1 as answer`);
    expect(rows[0]).toEqual({ answer: 42 });
  });

  it('applied the migrations: audit_log has the RFC-41 R1 columns', async () => {
    const rows = await t.db.execute(
      sql`select column_name from information_schema.columns where table_name = 'audit_log' order by ordinal_position`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'id',
      'at',
      'actor_user_id',
      'action',
      'target_type',
      'target_id',
      'ip',
      'user_agent',
      'metadata',
    ]);
  });

  it('RFC-02 R8 uuidv7() is available', async () => {
    const rows = await t.db.execute(sql`select uuidv7()::text as id`);
    expect(String(rows[0]?.id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('RFC-01 R4 withRollback leaves no trace', async () => {
    await withRollback(t.db, async (tx) => {
      await tx.execute(sql`create table rollback_probe (x int)`);
    });
    const rows = await t.db.execute(sql`select to_regclass('public.rollback_probe') as name`);
    expect(rows[0]?.name).toBeNull();
  });
});
```

`apps/api/src/redis/client.integration.test.ts`:
```ts
import { describe, expect, inject, it } from 'vitest';
import { createRedis } from './client.ts';

describe('RFC-10 R2 redis client', () => {
  it('connects with the password from the url, pings and round-trips a key', async () => {
    const redis = createRedis(inject('redisUrl'));
    await redis.connect();
    try {
      expect(await redis.ping()).toBe('PONG');
      await redis.set('probe', '1', 'EX', 5);
      expect(await redis.get('probe')).toBe('1');
    } finally {
      await redis.quit();
    }
  });
});
```

- [ ] **Step 6: Run integration tests**

Run: `pnpm --filter @elisa/api test` (Docker must be running)
Expected: containers start (first run pulls `postgres:18.6-alpine` and `redis:8.8-alpine`), migrations apply, both integration files PASS, unit tests still PASS.

If `getConnectionUrl` does not exist on the Redis container, use `getClientUrl()` (older name) — check `node_modules/@testcontainers/redis/build/redis-container.d.ts`. If the URL lacks the password, build it with `buildRedisUrl` from `../src/config.ts` using `redis.getHost()`, `redis.getPort()` and `REDIS_PASSWORD`.

Run: `pnpm typecheck && pnpm lint && pnpm rfc:check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api docs/rfc vitest.config.ts pnpm-lock.yaml
git commit -m "feat(api): add Drizzle client, migrations, Redis client, audit_log schema and testcontainers harness (RFC-10 R6-R7, RFC-41 R1-R2)"
```

---

### Task 12: Audit service

**Files:**
- Create: `apps/api/src/audit/actions.ts`, `apps/api/src/audit/actions.test.ts`
- Create: `apps/api/src/audit/audit.ts`, `apps/api/src/audit/audit.integration.test.ts`

**Interfaces:**
- Consumes: `auditLog`, `DbExecutor` (Task 11); `decryptPii`, `TEST_KEYRING` (Tasks 5, 11).
- Produces:
  - `AUDIT_ACTIONS` (readonly tuple), `type AuditAction`
  - `interface AuditEntry { actorUserId: string | null; action: AuditAction; targetType?: string; targetId?: string; ip?: string; userAgent?: string; metadata?: Record<string, unknown> }`
  - `recordAudit(db: DbExecutor, entry: AuditEntry): Promise<{ id: string }>`
  - `assertSafeMetadata(value: unknown): void`, `FORBIDDEN_METADATA_KEYS`, `class AuditMetadataError`, `class AuditActionError`

- [ ] **Step 1: Failing tests**

`apps/api/src/audit/actions.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from './actions.ts';

describe('RFC-41 R3 action catalog', () => {
  it('matches the Actions table in docs/rfc/40-data-protection/41-audit-log.md exactly', () => {
    const doc = readFileSync(
      new URL('../../../../docs/rfc/40-data-protection/41-audit-log.md', import.meta.url),
      'utf8',
    );
    const documented = [...doc.matchAll(/^\|\s*`([a-z_]+(?:\.[a-z_]+)+)`\s*\|/gm)].map((m) => m[1]);
    expect(documented.length).toBeGreaterThan(0);
    expect([...AUDIT_ACTIONS]).toEqual(documented);
  });
});
```

`apps/api/src/audit/audit.integration.test.ts`:
```ts
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useTestDb, withRollback } from '../../test/helpers/db.ts';
import { TEST_KEYRING } from '../../test/helpers/pii.ts';
import { auditLog } from '../db/schema/audit-log.ts';
import { decryptPii } from '../security/pii.ts';
import { AuditActionError, AuditMetadataError, assertSafeMetadata, recordAudit } from './audit.ts';

describe('RFC-41 recordAudit', () => {
  const t = useTestDb();

  it('R1, R8 inserts a row with a uuid v7 id, a timestamp and a null actor', async () => {
    await withRollback(t.db, async (tx) => {
      const { id } = await recordAudit(tx, { actorUserId: null, action: 'auth.login.failure' });
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
      const [row] = await tx.select().from(auditLog).where(eq(auditLog.id, id));
      expect(row?.action).toBe('auth.login.failure');
      expect(row?.actorUserId).toBeNull();
      expect(row?.at).toBeInstanceOf(Date);
      expect(row?.metadata).toEqual({});
      expect(row?.ip).toBeNull();
    });
  });

  it('R4 stores ip and user_agent encrypted and reads them back decrypted', async () => {
    await withRollback(t.db, async (tx) => {
      const { id } = await recordAudit(tx, {
        actorUserId: null,
        action: 'auth.login.success',
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
      });
      const raw = await tx.execute(sql`select ip, user_agent from audit_log where id = ${id}`);
      const stored = raw[0] as { ip: string; user_agent: string };
      expect(stored.ip.startsWith('v1:')).toBe(true);
      expect(stored.ip).not.toContain('203.0.113.7');
      expect(decryptPii(TEST_KEYRING, stored.ip)).toBe('203.0.113.7');
      expect(decryptPii(TEST_KEYRING, stored.user_agent)).toBe('Mozilla/5.0');
      const [row] = await tx.select().from(auditLog).where(eq(auditLog.id, id));
      expect(row?.ip).toBe('203.0.113.7');
      expect(row?.userAgent).toBe('Mozilla/5.0');
    });
  });

  it('R2 rejects UPDATE', async () => {
    await withRollback(t.db, async (tx) => {
      const { id } = await recordAudit(tx, { actorUserId: null, action: 'auth.logout' });
      await expect(
        tx.transaction((sp) => sp.update(auditLog).set({ action: 'x' }).where(eq(auditLog.id, id))),
      ).rejects.toThrow(/append-only/);
    });
  });

  it('R2 rejects DELETE without the purge flag and allows it with SET LOCAL', async () => {
    await withRollback(t.db, async (tx) => {
      const { id } = await recordAudit(tx, { actorUserId: null, action: 'auth.logout' });
      await expect(
        tx.transaction((sp) => sp.delete(auditLog).where(eq(auditLog.id, id))),
      ).rejects.toThrow(/append-only/);
      await tx.transaction(async (sp) => {
        await sp.execute(sql`set local elisa.allow_audit_purge = 'on'`);
        await sp.delete(auditLog).where(eq(auditLog.id, id));
      });
      const rows = await tx.select().from(auditLog).where(eq(auditLog.id, id));
      expect(rows).toHaveLength(0);
    });
  });

  it('R2 rejects TRUNCATE', async () => {
    await withRollback(t.db, async (tx) => {
      await expect(tx.transaction((sp) => sp.execute(sql`truncate audit_log`))).rejects.toThrow(
        /append-only/,
      );
    });
  });

  it('R7 rejects forbidden metadata keys at any depth before writing', async () => {
    await withRollback(t.db, async (tx) => {
      const before = await tx.select({ n: sql<number>`count(*)::int` }).from(auditLog);
      await expect(
        recordAudit(tx, {
          actorUserId: null,
          action: 'users.updated',
          metadata: { changes: [{ field: 'x' }, { nested: { email: 'a@b' } }] },
        }),
      ).rejects.toThrow(AuditMetadataError);
      const after = await tx.select({ n: sql<number>`count(*)::int` }).from(auditLog);
      expect(after[0]?.n).toBe(before[0]?.n);
    });
  });

  it('R3 rejects actions outside the catalog', async () => {
    await withRollback(t.db, async (tx) => {
      await expect(
        recordAudit(tx, { actorUserId: null, action: 'nope.nothing' as never }),
      ).rejects.toThrow(AuditActionError);
    });
  });
});

describe('RFC-41 R7 assertSafeMetadata', () => {
  it('accepts safe values and names the offending path', () => {
    expect(() => assertSafeMetadata({ count: 1, list: ['a'], nested: { ok: true } })).not.toThrow();
    expect(() => assertSafeMetadata({ nested: { deeper: { token: 'x' } } })).toThrow(
      'metadata key "nested.deeper.token" is not allowed',
    );
    expect(() => assertSafeMetadata({ items: [{ password: 'x' }] })).toThrow(
      'metadata key "items.0.password" is not allowed',
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @elisa/api test`
Expected: FAIL — cannot find `./actions.ts` / `./audit.ts`.

- [ ] **Step 3: Implement**

`apps/api/src/audit/actions.ts`:
```ts
/** @rfc RFC-41 R3 */
export const AUDIT_ACTIONS = [
  'auth.login.success',
  'auth.login.failure',
  'auth.logout',
  'auth.logout_all',
  'auth.invite.created',
  'auth.invite.accepted',
  'auth.password.reset_requested',
  'auth.password.reset',
  'auth.password.changed',
  'auth.totp.enabled',
  'auth.totp.disabled',
  'users.created',
  'users.updated',
  'users.roles_changed',
  'users.suspended',
  'users.reactivated',
  'users.deleted',
  'users.exported',
  'roles.created',
  'roles.updated',
  'roles.deleted',
  'sessions.revoked',
  'admin.accessed',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
```

`apps/api/src/audit/audit.ts`:
```ts
import type { DbExecutor } from '../db/client.ts';
import { auditLog } from '../db/schema/audit-log.ts';
import { AUDIT_ACTIONS, type AuditAction } from './actions.ts';

export interface AuditEntry {
  actorUserId: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/** @rfc RFC-41 R7 */
export const FORBIDDEN_METADATA_KEYS = [
  'password',
  'passwordHash',
  'token',
  'secret',
  'email',
  'name',
  'ip',
  'userAgent',
] as const;

/** @rfc RFC-41 R7 */
export class AuditMetadataError extends Error {
  constructor(path: string) {
    super(`metadata key "${path}" is not allowed`);
    this.name = 'AuditMetadataError';
  }
}

/** @rfc RFC-41 R3 */
export class AuditActionError extends Error {
  constructor(action: string) {
    super(`unknown audit action "${action}"`);
    this.name = 'AuditActionError';
  }
}

const forbidden = new Set<string>(FORBIDDEN_METADATA_KEYS);

/** @rfc RFC-41 R7 */
export function assertSafeMetadata(value: unknown, path = ''): void {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      assertSafeMetadata(item, path ? `${path}.${i}` : String(i));
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (forbidden.has(key)) throw new AuditMetadataError(childPath);
      assertSafeMetadata(child, childPath);
    }
  }
}

/**
 * Writes one audit row using the caller's executor, so it commits or rolls back
 * together with the action being recorded.
 * @rfc RFC-41 R1, R3-R5, R7-R8
 */
export async function recordAudit(db: DbExecutor, entry: AuditEntry): Promise<{ id: string }> {
  if (!(AUDIT_ACTIONS as readonly string[]).includes(entry.action)) {
    throw new AuditActionError(entry.action);
  }
  const metadata = entry.metadata ?? {};
  assertSafeMetadata(metadata);
  const [row] = await db
    .insert(auditLog)
    .values({
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      metadata,
    })
    .returning({ id: auditLog.id });
  if (!row) throw new Error('audit insert returned no row');
  return row;
}
```

- [ ] **Step 4: Run tests and checks**

Run: `pnpm --filter @elisa/api test`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint && pnpm rfc:check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/audit
git commit -m "feat(api): add append-only audit service with action catalog and metadata guard (RFC-41)"
```

---

### Task 13: Server entry, readiness checks and boot smoke test

**Files:**
- Create: `apps/api/src/http/health-checks.ts`, `apps/api/src/http/health-checks.integration.test.ts`
- Create: `apps/api/src/server.ts`, `apps/api/src/server.integration.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `createHealthChecks(db: Db, redis: Redis): HealthChecks`; the runnable entry `apps/api/src/server.ts` (`pnpm --filter @elisa/api dev`).

- [ ] **Step 1: Failing tests**

`apps/api/src/http/health-checks.integration.test.ts`:
```ts
import { describe, expect, inject, it } from 'vitest';
import { useTestDb } from '../../test/helpers/db.ts';
import { createRedis } from '../redis/client.ts';
import { createHealthChecks } from './health-checks.ts';

describe('RFC-10 R10 readiness checks', () => {
  const t = useTestDb();

  it('report true when PostgreSQL and Redis answer', async () => {
    const redis = createRedis(inject('redisUrl'));
    await redis.connect();
    const checks = createHealthChecks(t.db, redis);
    expect(await checks.database()).toBe(true);
    expect(await checks.redis()).toBe(true);
    await redis.quit();
  });

  it('report false or reject when Redis is disconnected', async () => {
    const redis = createRedis(inject('redisUrl'));
    const checks = createHealthChecks(t.db, redis);
    expect(await checks.redis().catch(() => false)).toBe(false);
  });
});
```

`apps/api/src/server.integration.test.ts`:
```ts
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';

const apiDir = resolve(import.meta.dirname, '..');
let child: ChildProcess | undefined;
let secretsDir: string | undefined;

function waitForListening(proc: ChildProcess): Promise<number> {
  return new Promise((resolvePort, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`api did not start:\n${buffer}`)), 25_000);
    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      for (const line of buffer.split('\n')) {
        if (!line.includes('api listening')) continue;
        clearTimeout(timer);
        resolvePort((JSON.parse(line) as { port: number }).port);
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
    });
    proc.on('exit', (code) => reject(new Error(`api exited with ${code}:\n${buffer}`)));
  });
}

afterAll(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((r) => child?.once('exit', r));
  }
  if (secretsDir) rmSync(secretsDir, { recursive: true, force: true });
});

describe('RFC-10 R5, R10, R11 server boot', () => {
  it('starts from TypeScript source, serves /api/health and /api/health/ready, and shuts down on SIGTERM', async () => {
    const pg = inject('postgres');
    const redis = inject('redis');
    secretsDir = mkdtempSync(join(tmpdir(), 'elisa-boot-'));
    const secrets: Record<string, string> = {
      db_app_password: pg.password,
      redis_password: redis.password,
      pii_encryption_key_v1: 'a'.repeat(64),
      pii_hmac_key: 'b'.repeat(64),
      session_secret: 'c'.repeat(64),
    };
    for (const [name, value] of Object.entries(secrets)) writeFileSync(join(secretsDir, name), value);

    child = spawn('node', ['--conditions=development', 'src/server.ts'], {
      cwd: apiDir,
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'test',
        PORT: '0',
        LOG_LEVEL: 'info',
        APP_ORIGIN: 'http://localhost',
        DB_HOST: pg.host,
        DB_PORT: String(pg.port),
        DB_NAME: pg.database,
        DB_USER: pg.user,
        REDIS_HOST: redis.host,
        REDIS_PORT: String(redis.port),
        SECRETS_DIR: secretsDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const port = await waitForListening(child);

    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const ready = await fetch(`http://127.0.0.1:${port}/api/health/ready`);
    expect(ready.status).toBe(200);

    const exit = new Promise<number | null>((r) => child?.once('exit', (code) => r(code)));
    child.kill('SIGTERM');
    expect(await exit).toBe(0);
  });

  it('refuses to start when a secret is missing', async () => {
    const pg = inject('postgres');
    const dir = mkdtempSync(join(tmpdir(), 'elisa-boot-missing-'));
    const proc = spawn('node', ['--conditions=development', 'src/server.ts'], {
      cwd: apiDir,
      env: {
        PATH: process.env.PATH ?? '',
        APP_ORIGIN: 'http://localhost',
        DB_HOST: pg.host,
        DB_NAME: pg.database,
        DB_USER: pg.user,
        REDIS_HOST: 'localhost',
        SECRETS_DIR: dir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    const code = await new Promise<number | null>((r) => proc.once('exit', (c) => r(c)));
    rmSync(dir, { recursive: true, force: true });
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/missing secret "db_app_password"/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @elisa/api test`
Expected: FAIL — `health-checks.ts` missing; server test fails with "api exited" because `src/server.ts` does not exist.

- [ ] **Step 3: Implement**

`apps/api/src/http/health-checks.ts`:
```ts
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import type { Redis } from '../redis/client.ts';
import type { HealthChecks } from './routes/health.ts';

/** @rfc RFC-10 R10 */
export function createHealthChecks(db: Db, redis: Redis): HealthChecks {
  return {
    database: async () => {
      await db.execute(sql`select 1`);
      return true;
    },
    redis: async () => (await redis.ping()) === 'PONG',
  };
}
```

`apps/api/src/server.ts`:
```ts
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { createHealthChecks } from './http/health-checks.ts';
import { createLogger } from './logger.ts';
import { createRedis } from './redis/client.ts';
import { configurePii } from './security/pii.ts';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
configurePii(config.pii.keyring, config.pii.hmacKey);

const { db, close: closeDb } = createDb(config.db.url);
const redis = createRedis(config.redis.url);
await redis.connect();

const app = createApp({ config, logger, health: createHealthChecks(db, redis) });

const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  logger.info({ port: info.port, env: config.nodeEnv }, 'api listening');
});

const shutdown = (signal: string): void => {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    Promise.allSettled([closeDb(), redis.quit()]).then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

- [ ] **Step 4: Run tests and checks**

Run: `pnpm --filter @elisa/api test`
Expected: PASS. Watch the boot test output: if Node prints `ExperimentalWarning: Type Stripping`, the test still passes; note it for `docs/gotchas/node.md` (Task 16). If the boot fails with `ERR_UNKNOWN_FILE_EXTENSION` or a resolution error for `@elisa/contracts`, the `development` export condition is not being applied — confirm the spawn args include `--conditions=development`.

Run: `pnpm --filter @elisa/api build && ls apps/api/dist`
Expected: `server.js`, `app.js`, `db/migrate.js`, … with `.js` relative imports.

Run: `pnpm typecheck && pnpm lint && pnpm rfc:check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): add server entry with readiness checks and graceful shutdown (RFC-10 R10-R11)"
```

---

### Task 14: Web SPA skeleton and API client

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `apps/web/src/main.tsx`, `styles.css`, `vite-env.d.ts`, `routes/__root.tsx`, `routes/index.tsx`, `pages/HomePage.tsx`, `pages/HomePage.test.tsx`, `api/client.ts`, `api/client.test.ts`, `test/setup.ts`
- Generate: `apps/web/src/routeTree.gen.ts`
- Modify: `.gitignore` (add `.tanstack/`)

**Interfaces:**
- Consumes: `errorEnvelopeSchema`, `ErrorDetail` (Task 4).
- Produces: `apiFetch<T>(path, { method?, json?, signal? }): Promise<T>`, `class ApiError { status; code; message; details? }`, `HomePage` component, file-based routes under `src/routes/`.

- [ ] **Step 1: Package files**

`apps/web/package.json`:
```json
{
  "name": "@elisa/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 5173 --strictPort",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@elisa/contracts": "workspace:*",
    "@tanstack/react-query": "5.102.8",
    "@tanstack/react-router": "1.170.35",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "zod": "4.6.2"
  },
  "devDependencies": {
    "@elisa/config": "workspace:*",
    "@tailwindcss/vite": "4.3.3",
    "@tanstack/router-plugin": "1.168.37",
    "@testing-library/jest-dom": "7.0.1",
    "@testing-library/react": "16.3.3",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
    "jsdom": "30.0.1",
    "tailwindcss": "4.3.3",
    "typescript": "7.0.2",
    "vite": "8.3.0",
    "vitest": "5.0.0"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "@elisa/config/tsconfig.web.json",
  "include": ["src", "vite.config.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const hmrClientPort = process.env.VITE_HMR_CLIENT_PORT;

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Behind Caddy in Docker the browser reaches Vite through port 80 (docs/gotchas/docker.md).
    hmr: hmrClientPort ? { clientPort: Number(hmrClientPort) } : undefined,
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Elisa</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
```

`apps/web/src/styles.css`:
```css
@import 'tailwindcss';
```

`apps/web/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

Append to `.gitignore`:
```
# tanstack router temp files
.tanstack/
```

Add `'apps/web'` to the `projects` list in the root `vitest.config.ts`, right after `'tools/*'`.

Run: `pnpm install`

- [ ] **Step 2: Failing tests**

`apps/web/src/pages/HomePage.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomePage } from './HomePage.tsx';

describe('RFC-10 R3 HomePage', () => {
  it('renders the product name', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: 'Elisa' })).toBeInTheDocument();
  });
});
```

`apps/web/src/api/client.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './client.ts';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('RFC-10 R3 apiFetch', () => {
  it('prefixes /api, sends cookies and a JSON body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { id: '1' } }));
    const result = await apiFetch<{ data: { id: string } }>('/things', { method: 'POST', json: { a: 1 } });
    expect(result).toEqual({ data: { id: '1' } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/things');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });

  it('rejects paths that do not start with /', async () => {
    await expect(apiFetch('things')).rejects.toThrow(/must start with \//);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns undefined for 204 responses', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await apiFetch('/things/1', { method: 'DELETE' })).toBeUndefined();
  });
});

describe('RFC-11 R3 error envelope handling', () => {
  it('turns an error envelope into ApiError with status, code, message and details', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          details: [{ path: 'age', message: 'Expected number' }],
        },
      }),
    );
    const error = await apiFetch('/things').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.code).toBe('VALIDATION_FAILED');
    expect(apiError.message).toBe('Request validation failed');
    expect(apiError.details).toEqual([{ path: 'age', message: 'Expected number' }]);
  });

  it('maps a non-envelope failure to UNKNOWN_ERROR with the status', async () => {
    fetchMock.mockResolvedValue(new Response('Bad Gateway', { status: 502 }));
    const error = (await apiFetch('/things').catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.status).toBe(502);
  });

  it('maps a network failure to NETWORK_ERROR with status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = (await apiFetch('/things').catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.status).toBe(0);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @elisa/web test`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

`apps/web/src/pages/HomePage.tsx`:
```tsx
/** @rfc RFC-10 R3 */
export function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-900">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Elisa</h1>
        <p className="mt-2 text-sm text-slate-600">Scientific data collection platform</p>
      </div>
    </main>
  );
}
```

`apps/web/src/routes/__root.tsx`:
```tsx
import { Outlet, createRootRoute } from '@tanstack/react-router';

/** @rfc RFC-10 R3 */
export const Route = createRootRoute({
  component: () => <Outlet />,
});
```

`apps/web/src/routes/index.tsx`:
```tsx
import { createFileRoute } from '@tanstack/react-router';
import { HomePage } from '../pages/HomePage.tsx';

/** @rfc RFC-10 R3 */
export const Route = createFileRoute('/')({
  component: HomePage,
});
```

`apps/web/src/api/client.ts`:
```ts
import { type ErrorDetail, errorEnvelopeSchema } from '@elisa/contracts';

/**
 * @rfc RFC-10 R3
 * @rfc RFC-11 R3
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetail[] | undefined;

  constructor(status: number, code: string, message: string, details?: ErrorDetail[], cause?: unknown) {
    super(message, { cause });
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  json?: unknown;
  signal?: AbortSignal;
}

/**
 * The only place in the web app that calls fetch. Same origin, cookies included,
 * every failure surfaces as ApiError.
 * @rfc RFC-10 R3
 * @rfc RFC-11 R2-R3
 */
export async function apiFetch<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!path.startsWith('/')) throw new Error('apiFetch: path must start with /');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.json !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.json === undefined ? undefined : JSON.stringify(options.json),
      credentials: 'include',
      signal: options.signal,
    });
  } catch (cause) {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server', undefined, cause);
  }

  if (response.status === 204) return undefined as T;
  if (response.ok) return (await response.json()) as T;

  const body: unknown = await response.json().catch(() => null);
  const parsed = errorEnvelopeSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, details } = parsed.data.error;
    throw new ApiError(response.status, code, message, details);
  }
  throw new ApiError(response.status, 'UNKNOWN_ERROR', `Request failed with status ${response.status}`);
}
```

`apps/web/src/main.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { routeTree } from './routeTree.gen.ts';
import './styles.css';

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 5: Generate the route tree, run tests and checks**

Run: `pnpm --filter @elisa/web build`
Expected: the router plugin writes `apps/web/src/routeTree.gen.ts`; Vite emits `apps/web/dist/index.html` and hashed assets; no inline `<script>` in `dist/index.html` (required by the production CSP, RFC-02 R5). Check: `grep -c '<script' apps/web/dist/index.html` prints `1` and that tag has a `src` attribute.

Run: `pnpm --filter @elisa/web test`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint && pnpm rfc:check && pnpm test`
Expected: clean. `repo.test.ts` passes because `routeTree.gen.ts` is excluded by name and every other web export is tagged.

- [ ] **Step 6: Commit**

```bash
git add apps/web .gitignore pnpm-lock.yaml
git commit -m "feat(web): add Vite + React + TanStack Router skeleton and API client (RFC-10 R3)"
```

---

### Task 15: Docker Compose stack, Caddy, Postgres roles, secrets, backups

**Files:**
- Create: `infra/docker/api.Dockerfile`, `web.Dockerfile`, `dev.Dockerfile`, `backup.Dockerfile`, `backup.sh`, `Caddyfile.dev`, `Caddyfile.prod`
- Create: `infra/postgres/init/01-roles.sh`
- Create: `infra/secrets/.gitkeep`, `infra/secrets/README.md`, `scripts/gen-secrets.sh`
- Create: `compose.yml`, `compose.dev.yml`, `compose.prod.yml`, `.env.example`, `.dockerignore`

**Interfaces:**
- Consumes: `apps/api` build output (`dist/server.js`, `dist/db/migrate.js`, `drizzle/`), `apps/web` build output (`dist/`), secret names from Task 6.
- Produces: `docker compose up` (dev) and `docker compose -f compose.yml -f compose.prod.yml up` (prod) stacks per RFC-10 R9.

- [ ] **Step 1: Dockerfiles**

`.dockerignore`:
```
.git
node_modules
**/node_modules
**/dist
**/.tanstack
**/coverage
**/test-results
**/playwright-report
infra/secrets
.env
.env.*
```

`infra/docker/api.Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine AS base
RUN npm install -g pnpm@12.4.1
WORKDIR /workspace

FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/
COPY tools/rfc-lint/package.json tools/rfc-lint/

FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter "@elisa/api..."
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @elisa/contracts build && pnpm --filter @elisa/api build

FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@elisa/api..."

FROM node:24.21.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=prod-deps /workspace/node_modules ./node_modules
COPY --from=prod-deps /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /workspace/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build /workspace/packages/contracts/package.json ./packages/contracts/
COPY --from=build /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /workspace/apps/api/package.json ./apps/api/
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/drizzle ./apps/api/drizzle
WORKDIR /workspace/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

`infra/docker/web.Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine AS build
RUN npm install -g pnpm@12.4.1
WORKDIR /workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/
COPY tools/rfc-lint/package.json tools/rfc-lint/
RUN pnpm install --frozen-lockfile --filter "@elisa/web..."
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN pnpm --filter @elisa/contracts build && pnpm --filter @elisa/web build

FROM caddy:2.9.1-alpine
COPY infra/docker/Caddyfile.prod /etc/caddy/Caddyfile
COPY --from=build /workspace/apps/web/dist /srv/web
```

`infra/docker/dev.Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine
RUN npm install -g pnpm@12.4.1
WORKDIR /workspace
```

`infra/docker/backup.Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1
FROM postgres:18.6-alpine
RUN apk add --no-cache age
COPY infra/docker/backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
USER postgres
ENTRYPOINT ["/bin/sh", "-c", "while true; do /usr/local/bin/backup.sh; sleep 86400; done"]
```

`infra/docker/backup.sh`:
```sh
#!/bin/sh
# Daily encrypted logical backup (design spec section 7; RFC-10 R9).
set -eu
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
PGPASSWORD="$(cat /run/secrets/db_migrator_password)"
export PGPASSWORD
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
target="/backups/elisa-${stamp}.sql.age"
pg_dump --host postgres --username elisa_migrator --dbname elisa --no-owner --format=plain \
  | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$target"
find /backups -name 'elisa-*.sql.age' -mtime +30 -delete
echo "backup written: $target"
```

- [ ] **Step 2: Caddyfiles**

`infra/docker/Caddyfile.dev`:
```
{
	auto_https off
}

:80 {
	@ready path /api/health/ready
	respond @ready 404

	handle /api/* {
		reverse_proxy api:3000
	}

	handle {
		reverse_proxy web:5173
	}
}
```

`infra/docker/Caddyfile.prod`:
```
{$DOMAIN} {
	encode zstd gzip

	@ready path /api/health/ready
	respond @ready 404

	handle /api/* {
		reverse_proxy api:3000
	}

	handle {
		root * /srv/web
		try_files {path} /index.html
		file_server
		header {
			Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
			Strict-Transport-Security "max-age=31536000; includeSubDomains"
			X-Content-Type-Options nosniff
			X-Frame-Options DENY
			Referrer-Policy strict-origin-when-cross-origin
			Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
			-Server
		}
	}
}
```

- [ ] **Step 3: Postgres roles and secrets tooling**

`infra/postgres/init/01-roles.sh` (runs once, on first initialization of an empty volume):
```sh
#!/bin/sh
# Creates the runtime and migrator roles (RFC-10 R7, RFC-41 R9).
set -eu
APP_PW="$(cat /run/secrets/db_app_password)"
MIG_PW="$(cat /run/secrets/db_migrator_password)"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
CREATE ROLE elisa_migrator LOGIN PASSWORD '${MIG_PW}';
CREATE ROLE elisa_app LOGIN PASSWORD '${APP_PW}';
GRANT CREATE ON DATABASE ${POSTGRES_DB} TO elisa_migrator;
GRANT CREATE, USAGE ON SCHEMA public TO elisa_migrator;
GRANT USAGE ON SCHEMA public TO elisa_app;
ALTER DEFAULT PRIVILEGES FOR ROLE elisa_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO elisa_app;
ALTER DEFAULT PRIVILEGES FOR ROLE elisa_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO elisa_app;
EOSQL
```
Make it executable: `chmod +x infra/postgres/init/01-roles.sh`.

`scripts/gen-secrets.sh`:
```sh
#!/bin/sh
# Generates development secrets in infra/secrets/ (RFC-02 R6). Never overwrites existing files.
# Values are hex only, so they are safe inside SQL and URLs.
set -eu
dir="$(cd "$(dirname "$0")/.." && pwd)/infra/secrets"
mkdir -p "$dir"

gen() {
  name="$1"
  bytes="$2"
  if [ -f "$dir/$name" ]; then
    echo "keep   $name"
    return
  fi
  openssl rand -hex "$bytes" > "$dir/$name"
  chmod 600 "$dir/$name"
  echo "create $name"
}

gen db_superuser_password 24
gen db_app_password 24
gen db_migrator_password 24
gen redis_password 24
gen pii_encryption_key_v1 32
gen pii_hmac_key 32
gen session_secret 32
```
Make it executable: `chmod +x scripts/gen-secrets.sh`.

`infra/secrets/.gitkeep` (empty file).

`infra/secrets/README.md`:
```markdown
# Secrets

Files in this directory are mounted as Docker secrets (`/run/secrets/<name>`) and are gitignored.
Generate development values with `./scripts/gen-secrets.sh`. In production, generate them on the
server the same way and back them up outside the server.

| File | Used by | Format |
|---|---|---|
| `db_superuser_password` | postgres (bootstrap only) | any, hex recommended |
| `db_app_password` | postgres init, api | any, hex recommended |
| `db_migrator_password` | postgres init, migrate, backup | any, hex recommended |
| `redis_password` | redis, api | any, hex recommended |
| `pii_encryption_key_v1` | api | 64 hex characters (RFC-40 R3) |
| `pii_hmac_key` | api | 64 hex characters (RFC-40 R5) |
| `session_secret` | api | 64 hex characters |

Key rotation: RFC-40 R7. Postgres role passwords are set only on the first initialization of the
data volume (`docs/gotchas/postgres.md`).
```

- [ ] **Step 4: Compose files**

`.env.example`:
```
# Copy to .env. Compose reads COMPOSE_FILE to pick the overrides.
COMPOSE_FILE=compose.yml:compose.dev.yml

# Origin the browser uses; the API rejects mutations from any other origin (RFC-02 R3).
APP_ORIGIN=http://localhost
LOG_LEVEL=debug
PII_CURRENT_KEY_VERSION=v1

# Production only (compose.prod.yml)
# COMPOSE_FILE=compose.yml:compose.prod.yml
# DOMAIN=elisa.example.org
# APP_ORIGIN=https://elisa.example.org
# BACKUP_AGE_RECIPIENT=age1...
```

`compose.yml`:
```yaml
name: elisa

x-api-env: &api-env
  NODE_ENV: production
  LOG_LEVEL: ${LOG_LEVEL:-info}
  APP_ORIGIN: ${APP_ORIGIN:?set APP_ORIGIN in .env}
  DB_HOST: postgres
  DB_PORT: "5432"
  DB_NAME: elisa
  DB_USER: elisa_app
  DB_MIGRATOR_USER: elisa_migrator
  REDIS_HOST: redis
  REDIS_PORT: "6379"
  PII_CURRENT_KEY_VERSION: ${PII_CURRENT_KEY_VERSION:-v1}

services:
  postgres:
    image: postgres:18.6-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: elisa
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD_FILE: /run/secrets/db_superuser_password
      POSTGRES_INITDB_ARGS: "--auth-host=scram-sha-256 --auth-local=scram-sha-256"
    secrets: [db_superuser_password, db_app_password, db_migrator_password]
    volumes:
      - postgres-data:/var/lib/postgresql
      - ./infra/postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d elisa"]
      interval: 5s
      timeout: 3s
      retries: 12
    networks: [internal]

  redis:
    image: redis:8.8-alpine
    restart: unless-stopped
    command:
      - sh
      - -c
      - exec redis-server --requirepass "$(cat /run/secrets/redis_password)" --maxmemory-policy noeviction --appendonly yes
    secrets: [redis_password]
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"$(cat /run/secrets/redis_password)\" --no-auth-warning ping | grep -q PONG"]
      interval: 5s
      timeout: 3s
      retries: 12
    networks: [internal]

  migrate:
    build:
      context: .
      dockerfile: infra/docker/api.Dockerfile
    image: elisa-api
    command: ["node", "dist/db/migrate.js"]
    environment: *api-env
    secrets: [db_migrator_password]
    depends_on:
      postgres:
        condition: service_healthy
    networks: [internal]

  api:
    image: elisa-api
    restart: unless-stopped
    environment: *api-env
    secrets: [db_app_password, redis_password, pii_encryption_key_v1, pii_hmac_key, session_secret]
    depends_on:
      migrate:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/api/health | grep -q '\"ok\":true'"]
      interval: 10s
      timeout: 3s
      retries: 6
    networks: [internal]

  caddy:
    image: caddy:2.9.1-alpine
    restart: unless-stopped
    volumes:
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      api:
        condition: service_healthy
    networks: [internal]

secrets:
  db_superuser_password:
    file: ./infra/secrets/db_superuser_password
  db_app_password:
    file: ./infra/secrets/db_app_password
  db_migrator_password:
    file: ./infra/secrets/db_migrator_password
  redis_password:
    file: ./infra/secrets/redis_password
  pii_encryption_key_v1:
    file: ./infra/secrets/pii_encryption_key_v1
  pii_hmac_key:
    file: ./infra/secrets/pii_hmac_key
  session_secret:
    file: ./infra/secrets/session_secret

volumes:
  postgres-data:
  redis-data:
  caddy-data:
  caddy-config:

networks:
  internal:
```

`compose.dev.yml`:
```yaml
services:
  deps:
    build:
      context: .
      dockerfile: infra/docker/dev.Dockerfile
    image: elisa-dev
    command: ["pnpm", "install", "--frozen-lockfile"]
    volumes:
      - .:/workspace
      - node-modules:/workspace/node_modules
      - pnpm-store:/root/.local/share/pnpm/store

  migrate:
    build: !reset null
    image: elisa-dev
    command: ["pnpm", "--filter", "@elisa/api", "db:migrate"]
    environment:
      NODE_ENV: development
    volumes:
      - .:/workspace
      - node-modules:/workspace/node_modules
    depends_on:
      deps:
        condition: service_completed_successfully

  api:
    image: elisa-dev
    command: ["pnpm", "--filter", "@elisa/api", "dev"]
    environment:
      NODE_ENV: development
    volumes:
      - .:/workspace
      - node-modules:/workspace/node_modules
    read_only: false
    ports:
      - "3000:3000"

  web:
    image: elisa-dev
    command: ["pnpm", "--filter", "@elisa/web", "dev"]
    environment:
      VITE_HMR_CLIENT_PORT: "80"
    volumes:
      - .:/workspace
      - node-modules:/workspace/node_modules
    depends_on:
      deps:
        condition: service_completed_successfully
    networks: [internal]

  mailpit:
    image: axllent/mailpit:v1.31
    restart: unless-stopped
    ports:
      - "8025:8025"
    networks: [internal]

  postgres:
    ports:
      - "5432:5432"

  redis:
    ports:
      - "6379:6379"

  caddy:
    ports:
      - "80:80"
    volumes:
      - ./infra/docker/Caddyfile.dev:/etc/caddy/Caddyfile:ro
    depends_on:
      web:
        condition: service_started

volumes:
  node-modules:
  pnpm-store:
```

`compose.prod.yml`:
```yaml
services:
  caddy:
    build:
      context: .
      dockerfile: infra/docker/web.Dockerfile
    image: elisa-web
    ports:
      - "80:80"
      - "443:443"
    environment:
      DOMAIN: ${DOMAIN:?set DOMAIN in .env}
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE]
    security_opt: ["no-new-privileges:true"]

  backup:
    build:
      context: .
      dockerfile: infra/docker/backup.Dockerfile
    image: elisa-backup
    restart: unless-stopped
    environment:
      BACKUP_AGE_RECIPIENT: ${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT in .env}
    secrets: [db_migrator_password]
    volumes:
      - backups:/backups
    depends_on:
      postgres:
        condition: service_healthy
    networks: [internal]

volumes:
  backups:
```

- [ ] **Step 5: Validate configuration**

Run: `cp .env.example .env && ./scripts/gen-secrets.sh`
Expected: seven `create …` lines; files with mode 600 in `infra/secrets/`; `git status` shows none of them (gitignored).

Run: `docker compose config --quiet`
Expected: exit 0 (dev composition valid; `!reset` accepted).

Run: `DOMAIN=example.org APP_ORIGIN=https://example.org BACKUP_AGE_RECIPIENT=age1test docker compose -f compose.yml -f compose.prod.yml config --quiet`
Expected: exit 0.

- [ ] **Step 6: Bring the dev stack up and verify end to end**

Run: `docker compose up -d --build --wait`
Expected: `deps` and `migrate` exit 0; `postgres`, `redis`, `api`, `web`, `caddy`, `mailpit` running; `api` healthy. Watch `docker compose logs migrate` for `migrations applied` and `docker compose logs api` for `api listening`.

Run and check each:
```bash
curl -s http://localhost/api/health                                   # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/health/ready   # 404 (not proxied)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/nope    # 404
curl -s -X POST http://localhost/api/health                           # {"error":{"code":"SECURITY_INVALID_ORIGIN",...}}
curl -s http://localhost/ | grep -c 'id="root"'                       # 1
curl -s -I http://localhost/api/health | grep -i x-request-id          # header present
docker compose exec -e PGPASSWORD="$(cat infra/secrets/db_app_password)" postgres \
  psql -U elisa_app -d elisa -c '\dt'                                 # lists audit_log
docker compose exec -e PGPASSWORD="$(cat infra/secrets/db_app_password)" postgres \
  psql -U elisa_app -d elisa -c "update audit_log set action = 'x'"   # ERROR: permission denied (RFC-41 R9)
docker compose exec redis redis-cli -a "$(cat infra/secrets/redis_password)" --no-auth-warning ping   # PONG
```
Open http://localhost in a browser: the "Elisa" page renders with Tailwind styles; editing `apps/web/src/pages/HomePage.tsx` hot-reloads. If HMR does not reconnect, see `docs/gotchas/docker.md` (Task 16) — `VITE_HMR_CLIENT_PORT` must be `80`.

Run: `docker compose down`

- [ ] **Step 7: Verify the production images**

Run: `docker build -f infra/docker/api.Dockerfile -t elisa-api .`
Expected: success.

Run: `docker run --rm elisa-api node --input-type=module -e "await import('./dist/app.js'); console.log('modules ok')"`
Expected: `modules ok` (proves `@elisa/contracts` resolves to `dist/` without the `development` condition and that pnpm symlinks survived the copy).

Run: `docker build -f infra/docker/web.Dockerfile -t elisa-web .`
Expected: success; `docker run --rm elisa-web ls /srv/web` lists `index.html` and `assets/`.

Run: `pnpm lint && pnpm test`
Expected: still clean (nothing in this task touches TypeScript).

- [ ] **Step 8: Commit**

```bash
git add compose.yml compose.dev.yml compose.prod.yml .env.example .dockerignore infra scripts
git commit -m "feat(infra): add Docker Compose stack with Caddy, Postgres 18 roles, Redis 8, secrets and encrypted backups (RFC-10 R9)"
```

---

### Task 16: CI workflow, gotchas, RFC acceptance

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `docs/gotchas/node.md`, `docs/gotchas/postgres.md`, `docs/gotchas/pnpm.md`, `docs/gotchas/docker.md`
- Modify: `docs/rfc/README.md` and every RFC header (status `draft` → `accepted`)

- [ ] **Step 1: CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
        with:
          version: 12.4.1
      - uses: actions/setup-node@v5
        with:
          node-version-file: .node-version
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm rfc:check
      - run: pnpm build
      - run: pnpm test
      - run: pnpm audit --audit-level high

  images:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v5
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: infra/docker/api.Dockerfile
          push: false
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: infra/docker/web.Dockerfile
          push: false
```
Testcontainers works on GitHub-hosted Ubuntu runners (Docker is preinstalled). When the GitHub repository is created, confirm the action major versions are current (`gh api repos/actions/checkout/releases/latest --jq .tag_name`, same for `setup-node`, `pnpm/action-setup`, `docker/build-push-action`) and bump if needed.

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest`
Expected: no output (workflow is valid).

- [ ] **Step 2: Gotchas**

`docs/gotchas/node.md`:
```markdown
# Node runtime

## Relative imports need explicit `.ts` extensions
**Symptom:** `ERR_MODULE_NOT_FOUND` at runtime for `./foo` while `tsc` is happy.
**Cause:** Node executes TypeScript source directly (type stripping) and resolves like ESM: no extension guessing.
**Fix:** Always write `./foo.ts` (or `.tsx`). `rewriteRelativeImportExtensions` turns them into `.js` in `dist/`.

## Only erasable TypeScript syntax
**Symptom:** `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on start.
**Cause:** Type stripping cannot run `enum`, `namespace`, parameter properties or `import x = require()`.
**Fix:** Use `as const` objects instead of enums; plain constructor assignments. `erasableSyntaxOnly` in `tsconfig.base.json` flags it at typecheck time.

## `@elisa/contracts` resolves to `dist/` unless the `development` condition is set
**Symptom:** `Cannot find module '.../packages/contracts/dist/index.js'` when running source.
**Cause:** Node refuses to type-strip files under `node_modules`, so the package exports built JS by default and source only under the `development` export condition.
**Fix:** Run source with `node --conditions=development …` (the `dev` and `db:migrate` scripts do; `rfc-lint` does not import contracts). Production runs `dist/` after `pnpm --filter @elisa/contracts build`.

## ExperimentalWarning on type stripping
**Symptom:** `ExperimentalWarning: Type Stripping is an experimental feature` in dev output.
**Cause:** Node prints it until the feature is marked stable.
**Fix:** Harmless. If it pollutes logs, add `--disable-warning=ExperimentalWarning` to the `dev` script.
```
Keep only the last entry if the warning actually appeared during Tasks 3, 11 or 13; delete it otherwise.

`docs/gotchas/postgres.md`:
```markdown
# PostgreSQL

## The `postgres:18` image moved the data directory
**Symptom:** Data disappears between restarts, or `initdb` complains the directory is not empty.
**Cause:** From 18 the image stores data at `/var/lib/postgresql/18/docker` and expects the volume at `/var/lib/postgresql`, not `/var/lib/postgresql/data`.
**Fix:** `compose.yml` mounts `postgres-data:/var/lib/postgresql`. Never mount `/var/lib/postgresql/data`.

## Init scripts run once
**Symptom:** New passwords in `infra/secrets/` are ignored; `elisa_app` cannot log in.
**Cause:** `/docker-entrypoint-initdb.d` runs only when the data volume is empty.
**Fix:** Development: `docker compose down -v` (destroys data), then `up`. Production: `ALTER ROLE … PASSWORD` manually, then update the secret file.

## `uuidv7()` needs PostgreSQL 18
**Symptom:** `function uuidv7() does not exist`.
**Cause:** Built-in since 18.
**Fix:** Every environment, including testcontainers (`postgres:18.6-alpine`), runs 18.

## Purging the audit log
**Symptom:** `audit_log is append-only` when deleting.
**Cause:** RFC-41 R2 trigger.
**Fix:** Only the retention job may delete, inside a transaction, after `SET LOCAL elisa.allow_audit_purge = 'on'`. `SET` without `LOCAL` is refused by the trigger design (the setting must not outlive the transaction).
```

`docs/gotchas/pnpm.md`:
```markdown
# pnpm

## Ignored build scripts
**Symptom:** `pnpm install` prints "Ignored build scripts: …" and a native dependency does not work.
**Cause:** pnpm blocks postinstall scripts unless allowed.
**Fix:** `pnpm approve-builds`, pick the packages, commit the resulting `onlyBuiltDependencies` entries in `pnpm-workspace.yaml`.

## Two `node_modules` worlds in development
**Symptom:** A package works on the host but not in `docker compose`, or vice versa.
**Cause:** Root `node_modules` inside containers is a named volume (`node-modules`), separate from the host's. Per-package `node_modules` directories on the bind mount contain relative symlinks that resolve in both.
**Fix:** After changing dependencies run `pnpm install` on the host and `docker compose run --rm deps` (or `docker compose up`, which re-runs `deps`). Never use `npm install` in this repo.
```

`docs/gotchas/docker.md`:
```markdown
# Docker, Compose, Caddy

## No CSP in development
**Symptom:** The production CSP would block the app in dev.
**Cause:** Vite and React Fast Refresh inject inline scripts in dev.
**Fix:** `Caddyfile.dev` sets no CSP; `Caddyfile.prod` sets the strict one (RFC-02 R5). The production build is verified to contain no inline script (Task 14 of the scaffold plan).

## `/api/health/ready` is 404 through Caddy on purpose
**Cause:** RFC-10 R10 — readiness reveals dependency state and is for the internal network only.
**Fix:** Query it from inside the network: `docker compose exec api wget -qO- http://127.0.0.1:3000/api/health/ready`.

## HMR behind Caddy
**Symptom:** Page loads but edits do not hot-reload; console shows a failed WebSocket to port 5173.
**Cause:** The browser reaches Vite through Caddy on port 80.
**Fix:** `compose.dev.yml` sets `VITE_HMR_CLIENT_PORT=80`, which `vite.config.ts` turns into `server.hmr.clientPort`.

## `!reset` in `compose.dev.yml`
**Cause:** The base `migrate` service builds the production image; in dev it must use `elisa-dev` instead, and Compose merges maps, so `build` has to be removed explicitly.
**Fix:** `build: !reset null`. Requires Compose v2.24 or newer.

## Base images are pinned by tag; pin by digest after the first build
**Cause:** RFC-02 R11.
**Fix:** `docker buildx imagetools inspect node:24.21.0-alpine` (and `postgres:18.6-alpine`, `redis:8.8-alpine`, `caddy:2.9.1-alpine`), then append `@sha256:…` to the `FROM`/`image:` lines. Refresh digests when bumping versions.
```

Add `typescript.md` to the index only if it was created in Task 5.

- [ ] **Step 3: Accept the RFCs**

In each of the eight RFC files change `| Status | draft |` to `| Status | accepted |` and append `- 2026-09-12 — accepted.` to the Changelog. Update the status column in `docs/rfc/README.md` to `accepted` for all eight.

Run: `pnpm test && pnpm rfc:check`
Expected: clean (rule ids unchanged).

- [ ] **Step 4: Commit**

```bash
git add .github docs
git commit -m "docs: add CI workflow, gotchas and accept foundation RFCs"
```

---

## Done criteria for this plan

- `pnpm install && pnpm lint && pnpm typecheck && pnpm rfc:check && pnpm build && pnpm test` all pass on a clean checkout with Docker running.
- `docker compose up -d --build --wait` brings the dev stack up; `curl http://localhost/api/health` returns `{"ok":true}`; the SPA renders at `http://localhost`.
- Production images build; `compose.prod.yml` validates.
- Eight RFCs accepted; every exported symbol tagged; `audit_log` append-only verified by tests against real PostgreSQL 18.

## What the next plans build on

- Plan 02 (auth): `users`, `invitations`, `sessions` in Redis, TOTP, the global and per-endpoint rate limiter (RFC-24; spec section 9); uses `validate`, `recordAudit`, `encryptedText`, `blindIndex`, `AppError`, the test harness and `withRollback`.
- Plan 03 (RBAC): `permissions`, `roles`, `requirePermission`, `routes-guarded` meta-test (RFC-02 R12).
- Plan 04 (admin + GDPR): admin routes, `/api/me`, export, erase, audit query, retention job (sets `elisa.allow_audit_purge`).
- Plan 05 (frontend + E2E): login flows, admin pages, Playwright against the Compose stack.
