# TreeRepro

Scientific data-collection platform. Everything sits behind login. GDPR applies to user data. This file is the project handbook: durable rules and pointers only, never a log.

## Stack (exact versions pinned in package.json; rationale in RFC-10)

Node 24 LTS · pnpm 12 · TypeScript 7 · Hono 4 (`apps/api`) · React 19 + Vite 8 + TanStack Router/Query + Tailwind 4 (`apps/web`) · Drizzle ORM + PostgreSQL 18 · Redis 8 (ioredis) · Zod 4 · Vitest 5 + testcontainers · Playwright · Biome 2 · Docker Compose + Caddy 2.

## Layout

- `apps/api` — the only process that touches Postgres, Redis and secrets.
- `apps/api/seed` — the trait dictionary (versioned vocabulary).
- `apps/web` — UI only. Calls `/api/*` on the same origin. Contains no business rules. The workspace lives under `/app` (settings, admin from plan 05b; dataset search and species detail at `/app/species` and `/app/species/$id` from plan 06); public pages are `/`, `/invite/:token`, `/forgot-password`, `/reset-password/:token` (RFC-13). Curation pages (plan 07b): `/app/curation/pending` (harmonisation queue) and `/app/curation/disputed`, plus an Unresolved taxa entry on `/app/species?unresolved=true`; the species page gains an Add value action and, on the record drawer, confirm / dispute / withdraw / set as accepted, with the accepted value shown on the trait panel; an Export accepted values (CSV) link (`dataset.export`) sits on the species search header.
- `packages/contracts` — Zod schemas and constants shared by API and web.
- `packages/config` — shared tsconfig bases.
- `tools/rfc-lint` — enforces `@rfc` linkage in code.
- `infra/` — Dockerfiles, Caddyfiles, Postgres init, secrets (gitignored).
- `docs/rfc/` — business rules, the source of truth.
- `docs/gotchas/<area>.md` — concrete code/infra pitfalls.
- `docs/specs`, `docs/plans` — design docs and implementation plans.

## Commands

- `pnpm install` — install (run `pnpm approve-builds` if pnpm reports ignored build scripts).
- `pnpm lint` / `pnpm lint:fix` — Biome.
- `pnpm typecheck` — `tsc --noEmit` in every package.
- `pnpm test` — unit + integration + API tests. Needs Docker running (testcontainers).
- `pnpm rfc:check` — verify every export links to an existing RFC rule.
- `pnpm build` — build contracts, api, web.
- `docker compose up` — full dev stack. First time: `cp .env.example .env && ./scripts/gen-secrets.sh`.
- `pnpm --filter @treerepro/api db:generate` — generate a migration from the Drizzle schema.
- `pnpm seed:admin --email <email> --name <name>` — invite the first user and assign the `admin` role (prints the invitation link; needs the dev stack or a reachable Postgres/Redis/SMTP). Against the dev stack: `docker compose exec api pnpm --filter @treerepro/api seed:admin --email … --name …`. In production: `docker compose exec api node dist/cli/seed-admin.js --email … --name …`.
- `pnpm --filter @treerepro/api seed:traits` — load the trait dictionary (`apps/api/seed/trait-dictionary.csv`); idempotent, but a level renamed through the API reappears under its old key on the next run unless the CSV is updated too (see `docs/gotchas/dataset.md`). Against the dev stack: `docker compose exec api pnpm --filter @treerepro/api seed:traits`. In production: `docker compose exec api node dist/cli/seed-traits.js`.
- `pnpm --filter @treerepro/api import:records --file <csv> [--run-by <email>] [--force]` — import a compiled-dataset CSV (RFC-64); prints the batch report. The file must be reachable from *inside* the container `api` runs in — `api`'s filesystem is `read_only` with `/tmp` as `tmpfs`, so `docker compose cp` and a plain `docker compose exec` cannot place it there (see `docs/gotchas/docker.md`). Production, mounting the host directory that holds the file read-only (reuses `api`'s image, env and secrets; `--no-deps` skips re-verifying `migrate`/`redis`, which a running production stack already has): `docker compose run --rm --no-deps -v /srv/imports:/imports:ro api node dist/cli/import-records.js --file /imports/sample_data.csv`. Dev stack, for small files only: stream the file into the container's tmpfs `/tmp` with `docker compose exec -T api sh -c 'cat > /tmp/sample_data.csv' < ./docs/exemplos/sample_data.csv`, then `docker compose exec api pnpm --filter @treerepro/api import:records --file /tmp/sample_data.csv`.
- Admin API (`/api/admin/users`, `/api/admin/roles`, `/api/admin/audit`, `/api/admin/permissions`; every route permission-guarded) and `PATCH /api/me`: RFC-50, RFC-51. Users are never erased — offboarding is suspension (RFC-50 R12). Audit entries older than 2 years are purged by the API's daily timer through `audit_log_purge()` (RFC-42).
- Curation API (manual records, confirm/dispute/withdraw annotations, the accepted value per species and trait, the harmonisation and disputed queues, catalog writes on families, genera, species, references, traits and levels; every route permission-guarded): RFC-65. `GET /api/export/accepted.csv` (`dataset.export`, streamed RFC 4180 CSV, audited): RFC-66.
- `./scripts/github-admin.sh` — owner only: apply the GitHub security settings and the `main` ruleset (`--check` to inspect).

## License and contributions

PolyForm Noncommercial 1.0.0 (`LICENSE.md`): the project is public so the participating scientists can validate and improve it; use is limited to noncommercial purposes. Contribution terms and workflow: `CONTRIBUTING.md`.

## Security automation

Every PR must pass `Verify`, `Images` (build + Trivy), `CodeQL`, `Dependency review`, `Gitleaks`, `Zizmor` and `Trivy config`; the `main` ruleset enforces it. All of them except `Dependency review` (PR-only) re-run weekly on `main`, Scorecard grades the repo weekly, and Dependabot proposes updates weekly after a 7-day release cooldown (`.github/dependabot.yml`); pnpm applies the same cooldown locally (`minimumReleaseAge` in `pnpm-workspace.yaml`). Actions are pinned by commit SHA. Report vulnerabilities per `SECURITY.md`. Details and admin-only settings: `docs/gotchas/github-security.md`.

## Non-negotiable rules

1. **RFC first** (RFC-00). A business rule lives in `docs/rfc/<category>/NN-slug.md` as a numbered rule `**Rn**`. Change order: RFC → failing test → code. Every exported symbol in `apps/*/src` and `packages/*/src` has a JSDoc `@rfc RFC-NN Rx` tag.
2. **TDD** (RFC-01). No production code without a failing test first. No database mocks.
3. **Never trust the frontend** (RFC-02). Validation, computation and authorization happen only in `apps/api`. Strict Zod schemas on every input.
4. **Security from day one** (RFC-02, RFC-40). Secrets only from `/run/secrets`. PII encrypted at the application level. Logs redacted. Every route guarded: every route is public, self-service (`requireSession`) or permission-guarded (`requirePermission`), enforced by a meta-test (RFC-32).
5. **English everywhere.** Code, comments, docs, UI, commits.
6. **Latest stable versions, pinned exact.** No legacy versions.

## Where things go

| Kind | Place |
|---|---|
| Business rule (formula, state, contract, policy) | `docs/rfc/NN-*.md` |
| Code/infra pitfall specific to this project | `docs/gotchas/<area>.md` |
| Design decision | `docs/specs/` |
| Implementation plan | `docs/plans/` |
| Durable project rules | this `README.md` — never a log |
