# Visibility 08a — System Roles, Species Activation, Visibility Enforcement, Supplementary Imports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`).

**Goal:** Land the E2E harness every later plan relies on; seed the `manager` and `contributor` system roles (with `records.review`, which moves the curation queues to manager work); add `species.active`; hide inactive species, traits and levels from every viewer without `dataset.read_inactive` at the API level; let `seed:traits` load a trait deactivated; introduce the supplementary-import framework (`import_batches.kind`) with its first command, `import:species-status`; show the status in the web app.

**Architecture:** A `Visibility` value (`apps/api/src/access/visibility.ts`) is derived once per request from the viewer's permissions and passed into every dataset read service, which folds `speciesVisible(v)` / `traitVisible(v)` / `levelVisible(v)` predicates into its SQL. Detail routes answer the resource's 404 for an invisible row. System roles are rows with `is_system = true` and stored permissions; the existing `requireEditable` already refuses every system role. Supplementary imports share `runSupplementaryImport` (`apps/api/src/dataset/imports/framework.ts`): stage with COPY, apply a per-kind SQL function, store rejects, finalise the batch and audit `imports.completed`.

**Tech Stack:** unchanged (Node 24.21, TypeScript 7.0, Hono 4.13, Zod 4.6, Drizzle 0.45.2 + drizzle-kit 0.31.10 + postgres.js 3.4, Vitest 5.0 + testcontainers 12.1, React 19, TanStack Router/Query, Biome 2.5, Playwright). No new dependencies.

**Spec:** `docs/specs/2026-09-17-visibility-design.md` (sections 3–7, 9–10) and `docs/specs/2026-09-17-contributor-launch-overview.md`. Plan 08b (plots) follows this one and fills `Visibility.plotIds`.

## Global Constraints

- All artifacts in English: code, comments, docs, RFCs, commit messages. Conversation with the owner in Portuguese.
- Exact versions in `package.json`; no new dependencies. Prefix every command with `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH` on the development machine.
- RFC first (RFC-00 R6): RFC-33 and RFC-68 start as `draft` and become `accepted` in the last task; amendments to accepted RFCs get a changelog line dated 2026-09-17.
- Every exported symbol under `apps/*/src` and `packages/*/src` carries a JSDoc `@rfc RFC-NN [Rx…]` tag (type-only exports and re-exports exempt). `pnpm rfc:check` fails otherwise. Files under `apps/api/test/` are exempt.
- TDD (RFC-01): failing test first, seen failing for the expected reason, then the minimum code. No database mocks; integration tests use real Postgres 18 and Redis 8 via testcontainers (Docker running). Tests name the rule they verify.
- Unit tests: `src/**/*.test.ts` (project `api:unit`); Postgres/Redis: `src/**/*.integration.test.ts` (project `api:integration`; the trait dictionary is seeded by `test/global-setup.ts`).
- Integration test files share one database and run in parallel: every test creates its own species, references, traits and records with random names through `test/helpers/dataset.ts` and asserts only on them. Never rename, deactivate or add levels to a seeded dictionary trait in a test — create a trait with `createTrait` and work on that one.
- Services throw `AppError` with an RFC-12 code; routes do not translate errors. Raw SQL only through the `sql` template tag (RFC-10 R6).
- Relative imports use explicit `.ts` extensions. Only erasable TypeScript syntax.
- Run `pnpm lint:fix`, `pnpm typecheck`, `pnpm rfc:check` and the relevant tests before every commit; conventional commit messages; one commit per task unless the task says otherwise. Commit messages end with the attribution line the session reminder gives.
- Branch: `feat/visibility-08a` from `origin/main`, in a worktree (`git worktree add ../Elisa-08a -b feat/visibility-08a origin/main`). The spec is already on `main`.
- The route-guard meta-test `apps/api/src/routes-guarded.integration.test.ts` lists every route exactly; a task that adds a route appends it there in the same commit.
- Migration numbers quoted in this and every later plan of the programme are indicative: `db:generate` assigns the next free number; cite the real one in the RFC changelog.
- Commands: integration tests for one file `pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration <path>`; unit `--project api:unit`; contracts `pnpm --filter @treerepro/contracts exec vitest run <path>`; web `pnpm --filter @treerepro/web test`; rebuild contracts after a contracts change: `pnpm --filter @treerepro/contracts build`.

## Setup (before Task 1)

```bash
cd /Users/rafael/Documents/Aplicativos/Elisa
git fetch origin
git worktree add ../Elisa-08a -b feat/visibility-08a origin/main
cd ../Elisa-08a
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm install
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts build
docker info > /dev/null
```

## File structure (end state)

```
docs/rfc/30-access/33-data-visibility.md                    # new
docs/rfc/60-dataset/68-supplementary-imports.md             # new
docs/rfc/30-access/30-permission-catalog.md                 # + dataset.read_inactive
docs/rfc/30-access/31-roles.md                              # R2 amended; R10, R11 new
docs/rfc/30-access/32-authorization-enforcement.md          # R7 amended
docs/rfc/40-data-protection/41-audit-log.md                 # + imports.completed
docs/rfc/60-dataset/60-taxonomy-catalog.md                  # R1, R6, R7, R9 amended
docs/rfc/60-dataset/62-trait-dictionary.md                  # R2, R5 amended
docs/rfc/60-dataset/64-bulk-import.md                       # R3, R11 amended
docs/rfc/README.md                                          # rows for RFC-33, RFC-68
docs/gotchas/dataset.md                                     # + visibility parameter; import framework notes
apps/api/drizzle/0016_permissions_visibility.sql            # custom: permission + system roles
apps/api/drizzle/0017_species_active.sql                    # generated: species.active, import_batches.kind
apps/api/src/db/schema/taxa.ts                              # active
apps/api/src/db/schema/imports.ts                           # kind
apps/api/src/db/schema/roles.ts                             # SYSTEM_ROLE_NAMES
apps/api/src/access/visibility.ts (+ .integration.test.ts)  # Visibility, visibilityOf, predicates
apps/api/src/access/roles.integration.test.ts               # system roles seeded
apps/api/src/dataset/taxa.ts                                # visibility, status, active
apps/api/src/dataset/dictionary.ts                          # visibility
apps/api/src/dataset/summary.ts                             # visibility
apps/api/src/dataset/records.ts                             # visibility
apps/api/src/dataset/queues.ts                              # visibility
apps/api/src/dataset/curation.ts                            # requireSpecies/requireTrait take visibility
apps/api/src/dataset/references.ts                          # getReference unchanged; records list handles it
apps/api/src/dataset/catalog.ts                             # updateSpecies active
apps/api/src/dataset/seed.ts                                # optional active column
apps/api/src/dataset/imports/framework.ts (+ .integration.test.ts)   # runSupplementaryImport
apps/api/src/dataset/imports/species-status.ts (+ .integration.test.ts)
apps/api/src/dataset/import.ts                              # kind on list/filter
apps/api/src/cli/import-species-status.ts
apps/api/src/http/routes/dataset/*.ts                       # visibilityOf in every handler
apps/api/src/audit/actions.ts                               # imports.completed
apps/api/package.json                                       # import:species-status script
apps/api/test/helpers/visibility.ts                         # UNRESTRICTED, RESTRICTED
apps/api/test/helpers/roles.ts                              # systemRoleId
packages/contracts/src/permissions.ts                       # dataset.read_inactive
packages/contracts/src/audit.ts                             # imports.completed
packages/contracts/src/dataset.ts                           # active, status, IMPORT_BATCH_KINDS, reasons, kind
packages/contracts/src/curation.ts                          # updateSpeciesBodySchema.active
apps/web/src/api/dataset.ts                                 # status, kind params
apps/web/src/components/dataset/SpeciesList.tsx             # inactive badge
apps/web/src/components/dataset/SpeciesSearchForm.tsx       # status select
apps/web/src/components/catalog/SpeciesDialog.tsx           # active checkbox
apps/web/src/pages/dataset/SpeciesPage.tsx                  # inactive badge
apps/web/src/pages/dataset/ImportsPage.tsx                  # kind column + filter
apps/web/src/pages/admin/RolesPage.tsx                      # system roles read-only with counts
apps/web/src/test/dataset-fixtures.ts                       # active, kind
apps/e2e/tests/global-setup.ts, api.ts, users.ts             # new (Task 0); playwright.config.ts, scripts/e2e.sh, critical-flow.spec.ts adjusted
apps/e2e/tests/visibility.spec.ts                           # new
README.md                                                   # commands
```

---

### Task 0: E2E harness — admin storage state, seeded dictionary, `apiCall`

Every later E2E spec of the programme (this plan's Task 11, plans 08b–12d) needs an admin session, a seeded trait dictionary and a way to call the API. Today `apps/e2e/tests/critical-flow.spec.ts` consumes the one-shot `E2E_ADMIN_INVITE_LINK` itself with a module-local random password, `scripts/e2e.sh` never runs `seed:traits`, and spec files run alphabetically — so no other file can sign in as admin. This task fixes that first.

**Files:**
- Create: `apps/e2e/tests/global-setup.ts`, `apps/e2e/tests/api.ts`, `apps/e2e/tests/users.ts`
- Modify: `apps/e2e/playwright.config.ts` (`globalSetup`, `use.storageState` for the admin project), `scripts/e2e.sh` (seed the dictionary, pass `E2E_ADMIN_PASSWORD`), `apps/e2e/tests/critical-flow.spec.ts` (signs in with the env password instead of accepting the invite; the accept step moves to global setup), `apps/e2e/tests/env.ts`

**Interfaces (produces):**
```ts
// env.ts
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';          // set by scripts/e2e.sh (random per run)
export const ADMIN_STATE = 'test-results/admin-state.json';                   // storageState written by global setup
// api.ts — the browser context's cookies + Origin, the way Caddy sees the app
export async function apiCall<T = unknown>(context: BrowserContext, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }>
// users.ts
export async function inviteAndActivate(browser: Browser, admin: BrowserContext, input: { role: 'contributor' | 'manager'; name?: string }): Promise<{ context: BrowserContext; page: Page; email: string; password: string; userId: string }>
  // POST /api/admin/users → invite link from Mailpit (waitForLink) → accept in a new context → PATCH /api/admin/users/:id { roles: [<id from GET /api/admin/roles by name>] } → sign in → return the context
export async function adminContext(browser: Browser): Promise<BrowserContext>   // browser.newContext({ storageState: ADMIN_STATE })
```

- [ ] **Step 1:** `global-setup.ts`: open the invite link (`adminInviteLink()`), set `ADMIN_PASSWORD`, sign in, save `storageState` to `ADMIN_STATE`. `scripts/e2e.sh`: after `seed-admin`, run `compose run --rm --no-deps -T api node dist/cli/seed-traits.js`; export `E2E_ADMIN_PASSWORD="$(openssl rand -hex 16)"` into the Playwright environment. `critical-flow.spec.ts`: replace the accept-invite block with a sign-in using `ADMIN_EMAIL` / `ADMIN_PASSWORD`; the password-reset test keeps changing it and restores it at the end (or runs last with its own context).
- [ ] **Step 2:** `apiCall`: `context.request.fetch(BASE_URL + path, { method, data: body, headers: { origin: BASE_URL } })` — the context's cookies ride along; answer `{ status, json }`.
- [ ] **Step 3:** Run `pnpm test:e2e` — the existing suite passes with the harness; commit `test(e2e): admin storage state, seeded dictionary, apiCall and inviteAndActivate helpers`.

---

### Task 1: RFC-33, RFC-68 and the amendments

**Files:**
- Create: `docs/rfc/30-access/33-data-visibility.md`, `docs/rfc/60-dataset/68-supplementary-imports.md`
- Modify: `docs/rfc/30-access/30-permission-catalog.md`, `docs/rfc/30-access/31-roles.md`, `docs/rfc/30-access/32-authorization-enforcement.md`, `docs/rfc/40-data-protection/41-audit-log.md`, `docs/rfc/60-dataset/60-taxonomy-catalog.md`, `docs/rfc/60-dataset/62-trait-dictionary.md`, `docs/rfc/60-dataset/64-bulk-import.md`, `docs/rfc/README.md`
- Test: `packages/contracts/src/permissions.test.ts`, `packages/contracts/src/audit.test.ts` (they parse the RFC tables; they fail until Task 2)

**Interfaces:**
- Produces: rule ids every later task cites (`RFC-33 R1–R9`, `RFC-68 R1–R8`, `RFC-31 R10–R11`, `RFC-60 R6 status`, `RFC-62 R2 active`, `RFC-64 R3 kind`).

- [ ] **Step 1: Write RFC-33**

```markdown
# RFC-33 — Data visibility

| Field | Value |
|---|---|
| Status | draft |
| Category | access control |
| Supersedes | — |

## Context

Some species and traits are not ready for the contributor community: traits still being defined, species outside the current phase or with unverified taxonomy. Contributors are recruited through field plots (RFC-67) and may be confined to them. The catalog therefore has row-level visibility, decided by the API for every read and write (RFC-02 R1), never by the web app.

## Rules

- **R1** Viewer. Every dataset read and write is evaluated for a *viewer*: the session user, their effective permissions (RFC-32 R1) and their plot settings (RFC-67). `Visibility` is the value `{ inactive: boolean, plotIds: string[] | null }`: `inactive` is true when the viewer holds `dataset.read_inactive`; `plotIds` is the viewer's assigned plots when `restrict_to_assigned_plots` is true, else `null` (no plot restriction). It is computed once per request by `visibilityOf(ctx, c)` and passed to every service call.
- **R2** A species is *visible* to a viewer when (`species.active` or `visibility.inactive`) and (`visibility.plotIds` is null or the species belongs to one of those plots). A trait is visible when `traits.active` or `visibility.inactive`. A level is visible when `trait_levels.active` or `visibility.inactive`. A record is visible when its species and its trait are visible.
- **R3** Lists omit invisible rows: `GET /api/species`; `GET /api/genera` and `GET /api/families` (a genus or family with no visible species is omitted); `GET /api/traits` (invisible traits and levels omitted; an unrestricted viewer still receives everything with `active: false`); `GET /api/species/:id/traits`; `GET /api/records`; `GET /api/records/pending/traits`; `GET /api/records/pending`; `GET /api/records/disputed`. Reference counters (RFC-61 R4) are stored and unaffected. Later RFCs apply the same rule to the routes they add.
- **R4** Detail routes answer 404 for an invisible row with the resource's code: `SPECIES_NOT_FOUND`, `TRAIT_NOT_FOUND`, `RECORD_NOT_FOUND`. The existence of an invisible row is never disclosed.
- **R5** Writes: `POST /api/records` and `POST /api/records/pending/map` on an invisible species, trait or level answer the same 404 / 400 as for an unknown one; `POST /api/records/:id/annotations` on an invisible record answers 404. Catalog writes (`taxa.manage`, `traits.manage`, `references.manage`) take the same visibility; their holders are unrestricted by role design and the services do not assume it.
- **R6** Species scope (RFC-67): `GET /api/species` accepts `scope=plots|all` and `plotId=`. Default: `plots` when the viewer has at least one assigned plot, else `all`. `scope=plots` restricts the list to the species of the viewer's plots; `scope=all` lists every visible species; `plotId` restricts to one plot and ignores `scope`. A plot-bound viewer asking `scope=all`, or `plotId` of a plot they are not assigned to, answers 403 `PERMISSION_DENIED`. An unknown `plotId` answers 404 `PLOT_NOT_FOUND`. (Implemented by plan 08b; until then `scope` and `plotId` are not accepted.)
- **R7** Representation: the species list item and detail carry `active: boolean` (RFC-60 R6, R7); the trait entry already carries `active`. A restricted viewer only ever receives `true`.
- **R8** `GET /api/auth/me` carries `scope: { plots: [{ id, code, name }], restricted: boolean }` (RFC-22 R10) so the web app can render the plot toggle and default the species list; presentation only (RFC-13 R3). (Plan 08b.)
- **R9** Every service that reads species, traits, levels or records has an integration test with two viewers — one restricted, one unrestricted — over the same fixture (an inactive species with a record on an active trait; an active species with a record on an inactive trait) asserting omission versus presence.

## Open questions

None.

## Changelog

- 2026-09-17 — created (plan 08a).
```

- [ ] **Step 2: Write RFC-68**

```markdown
# RFC-68 — Supplementary imports

| Field | Value |
|---|---|
| Status | draft |
| Category | dataset |
| Supersedes | — |

## Context

Beyond the compiled dataset (RFC-64) the owner loads smaller files: which species are active, field plots and their species, user assignments, synonyms, enriched references, distribution. Each is a CLI command sharing one batch table, one report shape and one rejection table, so the imports page shows them all the same way.

## Rules

- **R1** `import_batches` gains `kind text not null default 'records'` checked against `records`, `species_status`, `plots`, `plot_species`, `user_plots`, `synonyms`, `references`, `distribution` (RFC-64 R3 amended; the batch item carries `kind`). The `records` kind is RFC-64; every other kind follows this RFC.
- **R2** Every command is `pnpm --filter @treerepro/api import:<kind-with-dashes> --file <csv> [--run-by <email>]`, runs inside the API container (`docs/gotchas/docker.md` for placing the file), exits 0 on completion, 1 when refused or failed, 2 on usage. There is no `--force`: supplementary imports are idempotent (a row already applied counts as duplicate), so the SHA-256 refusal of RFC-64 R3 does not apply to them.
- **R3** The first line must equal the kind's header exactly. The file is streamed with `COPY` into a session temporary table with a serial `row_no` (RFC-64 R4); names are normalised per RFC-60 R2; e-mails are matched through `email_hash` (RFC-40).
- **R4** Resolution and counts, in one transaction with the batch row: `rows_total` staged rows; `rows_inserted` rows that changed the database (a row inserted, a flag set, a field filled); `rows_duplicate` rows already in the target state; `rows_rejected` rows that reference something unknown or conflicting, each stored in `import_rejects` with the raw row and one of the reasons `unknown_species`, `unknown_plot`, `unknown_user`, `unknown_reference`, `doi_taken`, `invalid_value` (RFC-64 R7 amended); `rows_pending` is 0; `unknown_levels` is `[]`. On any failure the transaction rolls back and the batch is `failed` (RFC-64 R9).
- **R5** A completed batch records one audit entry `imports.completed` (RFC-41) with `target_type = 'import_batches'`, `target_id` the batch id and `metadata: { kind, rowsTotal, rowsInserted, rowsDuplicate, rowsRejected }`; `actor_user_id` is `run_by`.
- **R6** The command prints: file and SHA-256, batch id, elapsed time, the four counts, and rejections by reason (the first 30 with their row numbers).
- **R7** `GET /api/imports?kind=` filters by kind; the imports page shows the kind and the same reject table for every kind (RFC-64 R11 amended).
- **R8** Kind `species_status`. Header `wcvp_species,active`. `active` is `true` or `false` (case-insensitive; anything else → `invalid_value`). The species is matched by `canonical_name` after normalisation; unknown → `unknown_species`. Sets `species.active`; a row whose value already matches is duplicate. This kind changes existing rows because its purpose is the flag.

## Open questions

None.

## Changelog

- 2026-09-17 — created (plan 08a).
```

- [ ] **Step 3: Amend the accepted RFCs**

RFC-30 catalog table — append the rows and a changelog line:

```markdown
| `dataset.read_inactive` | See inactive species, traits and levels |
| `records.review` | Work the harmonisation and disputed queues; neutralise or dispute any record with a note |
```

RFC-65 — R8, R9 and R10 change their permission: `GET /api/records/pending/traits`, `GET /api/records/pending` and `GET /api/records/disputed` require `records.review` (was `dataset.read`); `POST /api/records/pending/map` requires `records.review` (was `records.create`). Changelog: `- 2026-09-17 — R8–R10: the queues are manager work, behind records.review (RFC-31 R10, plan 08a).`

RFC-12 — the `ROLE_IS_SYSTEM` row reads "A system role (`admin`, `manager`, `contributor`) cannot be changed or deleted (RFC-31 R2)."
```markdown
- 2026-09-17 — dataset.read_inactive (RFC-33, plan 08a).
```

RFC-31 — replace R2 and append R10, R11 and a changelog line:

```markdown
- **R2** System roles (`is_system = true`): `admin`, inserted by migration 0004 with no `role_permissions` rows — a user holding it has every permission of the catalog, including permissions added later; `manager` and `contributor`, inserted by the migration the changelog names with the stored permissions of R10. A system role cannot be renamed, edited or deleted (409 `ROLE_IS_SYSTEM`). A later migration that grants a system role a new permission inserts the `role_permissions` row, and R10 lists the change.
```
```markdown
- **R10** Permission sets of the seeded roles. `contributor`: `dataset.read`, `records.create`, `records.annotate`. `manager`: the contributor set plus `dataset.read_inactive`, `records.review`, `records.withdraw`, `imports.read`. Managers do not hold `traits.manage`: a missing level is escalated to the admin. Later plans append: `taxa.propose` (contributor and manager, RFC-75), `contributions.read` (manager, RFC-71), `coverage.read` (manager, RFC-69).
- **R11** `GET /api/admin/roles` items carry `isSystem` and, for a system role with stored permissions, its permission keys; the web role list renders system roles read-only.
```
```markdown
- 2026-09-17 — R2 amended, R10–R11 added: manager and contributor system roles (plan 08a).
```

RFC-32 — replace R7:

```markdown
- **R7** Resource-level rules are the visibility rules of RFC-33, applied inside the services with the `Visibility` value the route derives; `options.resource` stays available for future per-row checks.
```
```markdown
- 2026-09-17 — R7: visibility rules live in RFC-33 (plan 08a).
```

RFC-41 actions table — append:

```markdown
| `imports.completed` | A supplementary import batch completed (RFC-68 R5). |
```
```markdown
- 2026-09-17 — imports.completed (RFC-68, plan 08a).
```

RFC-60 — amend R1 (`species` line), R6, R7, R9:

```markdown
  - `species(id, genus_id uuid null references genera restrict, canonical_name text unique, name_source text in ('wcvp', 'gbif', 'original'), active boolean not null default true, created_at, created_by)`
```
In R6, replace the query line and add `active` to the item and the status rule:
```markdown
- **R6** `GET /api/species?q=&familyId=&genusId=&unresolved=&status=&cursor=&limit=` (`dataset.read`; visibility RFC-33 R3). … Item: `{ id, canonicalName, nameSource, active, genus, family, matchedName, unresolvedTaxon }` … `status` is `active`, `inactive` or `all` (default `all`); a restricted viewer (RFC-33 R1) gets `active` whatever the parameter says — the parameter is ignored, not refused, so a shared link works for everyone.
```
In R7 add: "An invisible species (RFC-33 R2) answers 404 `SPECIES_NOT_FOUND`." In R9, `PATCH /api/species/:id { canonicalName?, nameSource?, genusId?, active? }`; audit `fields` may contain `active`. Changelog: `- 2026-09-17 — R1, R6, R7, R9: species.active, status filter, visibility (RFC-33, plan 08a).`

RFC-62 — amend R2 and R5:

```markdown
- **R2** … The file may carry an optional seventh column `active` (`true` / `false`, case-insensitive; default `true`): `seed:traits` stores it when it inserts the trait and, as before, never updates an existing one.
- **R5** … For a restricted viewer (RFC-33 R1) inactive traits and inactive levels are omitted; for an unrestricted viewer they are included with `active: false`.
```
Changelog: `- 2026-09-17 — R2 active column; R5 visibility (RFC-33, plan 08a).`

RFC-64 — amend R3 (`kind text not null default 'records'` in the column list, "checked per RFC-68 R1"), R7 (reason list gains RFC-68 R4's reasons), R11 (`kind` on the item; `GET /api/imports?kind=&cursor=&limit=`). Changelog: `- 2026-09-17 — R3, R7, R11: batch kind, supplementary reasons (RFC-68, plan 08a).`

RFC README — add rows `| RFC-33 | Data visibility | draft |` and `| RFC-68 | Supplementary imports | draft |` in their categories.

- [ ] **Step 4: Run the contracts tests to see the RFC/table mismatch**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts exec vitest run src/permissions.test.ts src/audit.test.ts`
Expected: FAIL — `dataset.read_inactive` and `imports.completed` are in the RFC tables and not in the code.

- [ ] **Step 5: Commit**

```bash
git add docs/rfc
git commit -m "docs(rfc): RFC-33 data visibility, RFC-68 supplementary imports; amend RFC-30/31/32/41/60/62/64 (plan 08a)"
```

---

### Task 2: Contracts — permission, audit action, active, status, import kinds

**Files:**
- Modify: `packages/contracts/src/permissions.ts`, `packages/contracts/src/audit.ts`, `packages/contracts/src/dataset.ts`, `packages/contracts/src/curation.ts`
- Test: `packages/contracts/src/dataset.test.ts`

**Interfaces:**
- Produces: `IMPORT_BATCH_KINDS`, `ImportBatchKind`, `speciesListItemSchema.active`, `listSpeciesQuerySchema.status`, `importBatchSchema.kind`, `listImportsQuerySchema` (new: `cursorQuerySchema.extend({ kind })`), `updateSpeciesBodySchema.active`, `IMPORT_REJECT_REASONS` extended.

- [ ] **Step 1: Write the failing contracts test**

Append to `packages/contracts/src/dataset.test.ts`:

```ts
describe('RFC-68 R1 import batch kinds', () => {
  it('lists every kind of RFC-68 and the batch schema requires one', () => {
    expect(IMPORT_BATCH_KINDS).toEqual([
      'records',
      'species_status',
      'plots',
      'plot_species',
      'user_plots',
      'synonyms',
      'references',
      'distribution',
    ]);
    expect(importBatchSchema.safeParse({ ...BATCH, kind: 'species_status' }).success).toBe(true);
    expect(importBatchSchema.safeParse({ ...BATCH, kind: 'nope' }).success).toBe(false);
  });
});

describe('RFC-60 R6 species item carries active; status filter', () => {
  it('requires active and accepts status=inactive', () => {
    expect(speciesListItemSchema.safeParse({ ...ITEM, active: false }).success).toBe(true);
    const { active: _a, ...without } = { ...ITEM, active: true };
    expect(speciesListItemSchema.safeParse(without).success).toBe(false);
    expect(listSpeciesQuerySchema.safeParse({ status: 'inactive' }).success).toBe(true);
    expect(listSpeciesQuerySchema.safeParse({ status: 'x' }).success).toBe(false);
  });
});
```

`BATCH` and `ITEM` are the fixtures the file already uses for `importBatchSchema` and `speciesListItemSchema` (add `kind: 'records'` to `BATCH` and `active: true` to `ITEM` where they are declared). Import `IMPORT_BATCH_KINDS` from `./dataset.ts`.

- [ ] **Step 2: Run it**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts exec vitest run src/dataset.test.ts`
Expected: FAIL — `IMPORT_BATCH_KINDS` is not exported.

- [ ] **Step 3: Implement**

`permissions.ts` — insert after `'dataset.export'`:

```ts
  'dataset.read_inactive': 'See inactive species, traits and levels',
  'records.review': 'Work the harmonisation and disputed queues; neutralise or dispute any record with a note',
```

`audit.ts` — append `'imports.completed'` to `AUDIT_ACTIONS` (after `'dataset.exported'`).

`dataset.ts`:

```ts
/** @rfc RFC-68 R1 */
export const IMPORT_BATCH_KINDS = [
  'records',
  'species_status',
  'plots',
  'plot_species',
  'user_plots',
  'synonyms',
  'references',
  'distribution',
] as const;
export type ImportBatchKind = (typeof IMPORT_BATCH_KINDS)[number];

/** @rfc RFC-64 R7, RFC-68 R4 */
export const IMPORT_REJECT_REASONS = [
  'no_species_name',
  'unknown_trait',
  'no_reference',
  'unknown_species',
  'unknown_plot',
  'unknown_user',
  'unknown_reference',
  'doi_taken',
  'invalid_value',
] as const;

/** @rfc RFC-60 R6, RFC-33 R7 */
export const SPECIES_STATUSES = ['active', 'inactive', 'all'] as const;
export type SpeciesStatus = (typeof SPECIES_STATUSES)[number];
```

`listSpeciesQuerySchema` gains `status: z.enum(SPECIES_STATUSES).optional()`. `speciesListItemSchema` gains `active: z.boolean()` after `nameSource`. `importBatchSchema` gains `kind: z.enum(IMPORT_BATCH_KINDS)` after `fileSha256`. Add:

```ts
/** @rfc RFC-68 R7 */
export const listImportsQuerySchema = cursorQuerySchema.extend({
  kind: z.enum(IMPORT_BATCH_KINDS).optional(),
});
export type ListImportsQuery = z.infer<typeof listImportsQuerySchema>;
```

`curation.ts` — `updateSpeciesBodySchema` gains `active: z.boolean().optional()` (inside the `nonEmpty` object).

- [ ] **Step 4: Run contracts tests, build**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts test && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts build`
Expected: PASS (permissions, audit and dataset tests now match the RFC tables).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): dataset.read_inactive, imports.completed, species active/status, import batch kinds (RFC-33, RFC-68)"
```

---

### Task 3: Migrations — permission, system roles, `species.active`, `import_batches.kind`

**Files:**
- Create: `apps/api/drizzle/0016_permissions_visibility.sql` (custom), `apps/api/drizzle/0017_species_active.sql` (generated)
- Modify: `apps/api/src/db/schema/taxa.ts`, `apps/api/src/db/schema/imports.ts`, `apps/api/src/db/schema/roles.ts`
- Test: `apps/api/src/db/schema/dataset.integration.test.ts`, `apps/api/src/db/schema/access.integration.test.ts`

**Interfaces:**
- Produces: `species.active`, `importBatches.kind`, `SYSTEM_ROLE_NAMES = ['admin', 'manager', 'contributor']`, `MANAGER_ROLE_NAME`, `CONTRIBUTOR_ROLE_NAME`.

- [ ] **Step 1: Failing schema tests**

In `dataset.integration.test.ts`, inside `describe('RFC-60 R1 taxonomy tables')`:

```ts
  it('R1 species.active defaults to true', async () => {
    await withRollback(t.db, async (tx) => {
      const [sp1] = await tx
        .insert(species)
        .values({ canonicalName: `Act-${rand()}`, nameSource: 'wcvp' })
        .returning();
      expect(sp1?.active).toBe(true);
    });
  });
```

Add a new describe for imports:

```ts
describe('RFC-68 R1 import batch kind', () => {
  const t = useTestDb();

  it('defaults to records and is checked', async () => {
    await withRollback(t.db, async (tx) => {
      const [b] = await tx
        .insert(importBatches)
        .values({ fileName: 'x.csv', fileSha256: 'a'.repeat(64) })
        .returning();
      expect(b?.kind).toBe('records');
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp
              .insert(importBatches)
              .values({ fileName: 'y.csv', fileSha256: 'b'.repeat(64), kind: 'nope' as never }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});
```

In `access.integration.test.ts`, inside `describe('RFC-31 R1, R2 roles tables')`:

```ts
  it('R2, R10 manager and contributor are system roles with the seeded permissions', async () => {
    const rows = await t.db.select().from(roles).where(inArray(roles.name, ['manager', 'contributor']));
    expect(rows.map((r) => r.isSystem)).toEqual([true, true]);
    const byName = new Map(rows.map((r) => [r.name, r.id]));
    const keys = async (name: string) =>
      (
        await t.db
          .select({ key: rolePermissions.permissionKey })
          .from(rolePermissions)
          .where(eq(rolePermissions.roleId, byName.get(name) ?? ''))
      )
        .map((r) => r.key)
        .sort();
    expect(await keys('contributor')).toEqual(['dataset.read', 'records.annotate', 'records.create']);
    expect(await keys('manager')).toEqual([
      'dataset.read',
      'dataset.read_inactive',
      'imports.read',
      'records.annotate',
      'records.create',
      'records.review',
      'records.withdraw',
    ]);
  });
```

(`inArray` from `drizzle-orm`.)

- [ ] **Step 2: Run them**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/db/schema/dataset.integration.test.ts src/db/schema/access.integration.test.ts`
Expected: FAIL — `active` undefined on the species row; no `manager` role; `kind` undefined.

- [ ] **Step 3: Schema changes**

`taxa.ts` — add `boolean` to the imports from `drizzle-orm/pg-core` and, in `species`, after `nameSource`:

```ts
    active: boolean('active').notNull().default(true),
```

`imports.ts` — import `IMPORT_BATCH_KINDS` from contracts and `check` from pg-core; in `importBatches` after `fileSha256`:

```ts
    kind: text('kind', { enum: IMPORT_BATCH_KINDS }).notNull().default('records'),
```

and in the index callback add:

```ts
    check(
      'import_batches_kind_check',
      sql`${t.kind} in ('records', 'species_status', 'plots', 'plot_species', 'user_plots', 'synonyms', 'references', 'distribution')`,
    ),
```

`roles.ts` — after `ADMIN_ROLE_NAME`:

```ts
/** @rfc RFC-31 R2, R10 */
export const MANAGER_ROLE_NAME = 'manager';
/** @rfc RFC-31 R2, R10 */
export const CONTRIBUTOR_ROLE_NAME = 'contributor';
/** @rfc RFC-31 R2 */
export const SYSTEM_ROLE_NAMES = [ADMIN_ROLE_NAME, MANAGER_ROLE_NAME, CONTRIBUTOR_ROLE_NAME] as const;
```

- [ ] **Step 4: Custom migration (permissions + system roles; the number is whatever `db:generate` assigns)**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api db:generate --custom --name permissions_visibility` and fill the file:

```sql
-- RFC-30 R3: dataset.read_inactive (RFC-33, plan 08a).
INSERT INTO permissions (key, description) VALUES
  ('dataset.read_inactive', 'See inactive species, traits and levels'),
  ('records.review', 'Work the harmonisation and disputed queues; neutralise or dispute any record with a note')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
-- RFC-31 R2, R10: the manager and contributor system roles with their stored permissions.
INSERT INTO roles (name, description, is_system) VALUES
  ('contributor', 'Browses the active catalog, validates records and adds entries.', true),
  ('manager', 'Everything a contributor does, plus inactive species and traits, the queues and withdrawals.', true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM roles r, permissions p
WHERE r.name = 'contributor' AND p.key IN ('dataset.read', 'records.create', 'records.annotate')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM roles r, permissions p
WHERE r.name = 'manager' AND p.key IN ('dataset.read', 'records.create', 'records.annotate', 'dataset.read_inactive', 'records.review', 'records.withdraw', 'imports.read')
ON CONFLICT DO NOTHING;
```

(`roles_name_lower_idx` is the unique index; `ON CONFLICT DO NOTHING` without a target covers it.)

- [ ] **Step 5: Generated migration 0017**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api db:generate --name species_active`
Expected file content (verify): `ALTER TABLE "species" ADD COLUMN "active" boolean DEFAULT true NOT NULL;`, `ALTER TABLE "import_batches" ADD COLUMN "kind" text DEFAULT 'records' NOT NULL;`, `ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_kind_check" CHECK (...)`.

- [ ] **Step 6: Run the schema tests**

Same command as Step 2. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/drizzle apps/api/src/db/schema
git commit -m "feat(db): species.active, import_batches.kind, dataset.read_inactive, manager and contributor system roles (RFC-31 R10, RFC-60 R1, RFC-68 R1)"
```

---

### Task 4: `Visibility` and its predicates

**Files:**
- Create: `apps/api/src/access/visibility.ts`, `apps/api/src/access/visibility.integration.test.ts`, `apps/api/test/helpers/visibility.ts`
- Modify: `apps/api/src/http/env.ts` (context variable), `apps/api/test/helpers/roles.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Visibility { inactive: boolean; plotIds: string[] | null }
  export const UNRESTRICTED: Visibility  // { inactive: true, plotIds: null }
  export function visibilityFor(permissions: ReadonlySet<string>): Visibility  // plotIds null (08b adds the lookup)
  export async function visibilityOf(ctx: AccessContext, c: Context<AppEnv>): Promise<Visibility>
  export function speciesVisible(v: Visibility, col?: typeof species.active): SQL   // `col or true`
  export function traitVisible(v: Visibility): SQL
  export function levelVisible(v: Visibility): SQL
  ```
  Test helper `test/helpers/visibility.ts`: `export const RESTRICTED: Visibility = { inactive: false, plotIds: null }` and re-export `UNRESTRICTED`. `test/helpers/roles.ts` gains `systemRoleId(db, name)`.

- [ ] **Step 1: Failing test**

`apps/api/src/access/visibility.integration.test.ts`:

```ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createSpecies, createTrait } from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { species } from '../db/schema/taxa.ts';
import { traits } from '../db/schema/dictionary.ts';
import { speciesVisible, traitVisible, visibilityFor } from './visibility.ts';

describe('RFC-33 R1 visibilityFor', () => {
  it('reads dataset.read_inactive; plotIds is null until plan 08b', () => {
    expect(visibilityFor(new Set(['dataset.read']))).toEqual({ inactive: false, plotIds: null });
    expect(visibilityFor(new Set(['dataset.read', 'dataset.read_inactive']))).toEqual({
      inactive: true,
      plotIds: null,
    });
  });
});

describe('RFC-33 R2 predicates', () => {
  const t = useTestDb();

  it('hide an inactive species and trait from a restricted viewer only', async () => {
    const hidden = await createSpecies(t.db);
    await t.db.update(species).set({ active: false }).where(sql`${species.id} = ${hidden.id}`);
    const shown = await createSpecies(t.db);
    const rows = async (v: typeof RESTRICTED) =>
      (
        await t.db
          .select({ id: species.id })
          .from(species)
          .where(sql`${species.id} in (${hidden.id}, ${shown.id}) and ${speciesVisible(v)}`)
      ).map((r) => r.id);
    expect(await rows(RESTRICTED)).toEqual([shown.id]);
    expect((await rows(UNRESTRICTED)).sort()).toEqual([hidden.id, shown.id].sort());

    const off = await createTrait(t.db, { active: false });
    const [restricted] = await t.db
      .select({ id: traits.id })
      .from(traits)
      .where(sql`${traits.id} = ${off.id} and ${traitVisible(RESTRICTED)}`);
    expect(restricted).toBeUndefined();
    const [unrestricted] = await t.db
      .select({ id: traits.id })
      .from(traits)
      .where(sql`${traits.id} = ${off.id} and ${traitVisible(UNRESTRICTED)}`);
    expect(unrestricted?.id).toBe(off.id);
  });
});
```

- [ ] **Step 2: Run it** — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `visibility.ts`**

```ts
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { species } from '../db/schema/taxa.ts';
import type { AppEnv } from '../http/env.ts';
import { currentPermissions } from '../http/middleware/require-permission.ts';
import type { AccessContext } from './context.ts';

/**
 * What one viewer may see (RFC-33 R1). `plotIds` stays null until plan 08b
 * reads the viewer's plot settings.
 * @rfc RFC-33 R1
 */
export interface Visibility {
  inactive: boolean;
  plotIds: string[] | null;
}

/** A viewer who sees everything: CLI commands, migrations, admin-only services. @rfc RFC-33 R1 */
export const UNRESTRICTED: Visibility = { inactive: true, plotIds: null };

/** @rfc RFC-33 R1 */
export function visibilityFor(permissions: ReadonlySet<string>): Visibility {
  return { inactive: permissions.has('dataset.read_inactive'), plotIds: null };
}

/** The viewer of the current request; computed once and kept on the context. @rfc RFC-33 R1 */
export async function visibilityOf(_ctx: AccessContext, c: Context<AppEnv>): Promise<Visibility> {
  const cached = c.get('visibility');
  if (cached) return cached;
  const v = visibilityFor(currentPermissions(c));
  c.set('visibility', v);
  return v;
}

/** `species` row predicate; `alias` lets a joined alias be used instead of the table. @rfc RFC-33 R2 */
export function speciesVisible(v: Visibility, activeCol: SQL | typeof species.active = species.active): SQL {
  return v.inactive ? sql`true` : sql`${activeCol}`;
}

/** @rfc RFC-33 R2 */
export function traitVisible(v: Visibility, activeCol: SQL | typeof traits.active = traits.active): SQL {
  return v.inactive ? sql`true` : sql`${activeCol}`;
}

/** @rfc RFC-33 R2 */
export function levelVisible(
  v: Visibility,
  activeCol: SQL | typeof traitLevels.active = traitLevels.active,
): SQL {
  return v.inactive ? sql`true` : sql`${activeCol}`;
}
```

`http/env.ts` — add `visibility?: Visibility` to the `Variables` of `AppEnv` (import the type from `../access/visibility.ts`).

`test/helpers/visibility.ts`:

```ts
import { UNRESTRICTED, type Visibility } from '../../src/access/visibility.ts';

export { UNRESTRICTED };
/** A contributor: no inactive rows, no plot restriction. */
export const RESTRICTED: Visibility = { inactive: false, plotIds: null };
```

`test/helpers/roles.ts` — append:

```ts
export async function systemRoleId(db: DbExecutor, name: 'admin' | 'manager' | 'contributor'): Promise<string> {
  const [row] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, name));
  if (!row) throw new Error(`system role ${name} missing: is the permissions_visibility migration applied?`);
  return row.id;
}
```

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/access/visibility.ts apps/api/src/access/visibility.integration.test.ts apps/api/src/http/env.ts apps/api/test/helpers
git commit -m "feat(api): Visibility value and SQL predicates (RFC-33 R1, R2)"
```

---

### Task 5: Species and taxa services take a visibility; `status`; `active` on items

**Files:**
- Modify: `apps/api/src/dataset/taxa.ts`, `apps/api/src/dataset/catalog.ts` (`updateSpecies` active), `apps/api/src/http/routes/dataset/species.ts`, `apps/api/src/http/routes/dataset/taxa.ts`
- Test: `apps/api/src/dataset/taxa.integration.test.ts`, `apps/api/src/http/routes/dataset/species.integration.test.ts`

**Interfaces:**
- Produces: `searchSpecies(db, visibility, input)` with `input.status?: SpeciesStatus`; `getSpecies(db, visibility, id)`; `listFamilies(db, visibility, input)`; `listGenera(db, visibility, input)`; `getFamily`, `getGenus` unchanged; `updateSpecies` accepts `active`. Every call site (routes, tests, `catalog.ts` which calls `getSpecies` after a write) passes a visibility — grep `getSpecies(` and `searchSpecies(`.

- [ ] **Step 1: Failing service tests**

Append to `taxa.integration.test.ts`:

```ts
describe('RFC-33 R2, R3 species visibility', () => {
  const t = useTestDb();

  it('a restricted viewer never lists or reads an inactive species; an unrestricted one does with active=false', async () => {
    const family = await createFamily(t.db);
    const genus = await createGenus(t.db, { familyId: family.id });
    const name = `Hidden vis-${Math.random().toString(16).slice(2)}`;
    const hidden = await createSpecies(t.db, { canonicalName: name, genusId: genus.id });
    await t.db.update(species).set({ active: false }).where(eq(species.id, hidden.id));

    const restricted = await searchSpecies(t.db, RESTRICTED, { q: name, limit: 10 });
    expect(restricted.data).toEqual([]);
    const unrestricted = await searchSpecies(t.db, UNRESTRICTED, { q: name, limit: 10 });
    expect(unrestricted.data.map((s) => [s.id, s.active])).toEqual([[hidden.id, false]]);
    const onlyInactive = await searchSpecies(t.db, UNRESTRICTED, { q: name, status: 'inactive', limit: 10 });
    expect(onlyInactive.data).toHaveLength(1);
    const forcedActive = await searchSpecies(t.db, RESTRICTED, { q: name, status: 'all', limit: 10 });
    expect(forcedActive.data).toEqual([]);

    expect(await getSpecies(t.db, RESTRICTED, hidden.id)).toBeNull();
    expect((await getSpecies(t.db, UNRESTRICTED, hidden.id))?.active).toBe(false);

    // a genus and family whose only species is hidden disappear for the restricted viewer
    const genera = await listGenera(t.db, RESTRICTED, { familyId: family.id, limit: 10 });
    expect(genera.data.map((g) => g.id)).not.toContain(genus.id);
    // Walk the family list to the page that would hold this family (names sort; the
    // random suffix can land anywhere), then assert absence vs presence on that page.
    const pageHolding = async (v: typeof RESTRICTED) => {
      let cursor: string | undefined;
      for (;;) {
        const page = await listFamilies(t.db, v, { limit: 200, cursor });
        const last = page.data[page.data.length - 1];
        if (!page.nextCursor || !last || last.name >= family.name) return page.data.map((f) => f.id);
        cursor = page.nextCursor;
      }
    };
    expect(await pageHolding(RESTRICTED)).not.toContain(family.id);
    expect(await pageHolding(UNRESTRICTED)).toContain(family.id);
    expect((await listGenera(t.db, UNRESTRICTED, { familyId: family.id, limit: 10 })).data.map((g) => g.id)).toContain(genus.id);
  });
});
```

Update every existing call in the file to pass `UNRESTRICTED` as the second argument (import from `../../test/helpers/visibility.ts`).

- [ ] **Step 2: Run** — Expected: FAIL (type errors on the second argument; `active` missing).

- [ ] **Step 3: Implement in `taxa.ts`**

Signature and predicates:

```ts
import { speciesVisible, type Visibility } from '../access/visibility.ts';
// …
export async function searchSpecies(
  db: DbExecutor,
  visibility: Visibility,
  input: {
    q?: string;
    familyId?: string;
    genusId?: string;
    unresolved?: boolean;
    status?: SpeciesStatus;
    cursor?: string;
    limit: number;
  },
): Promise<{ data: SpeciesListItem[]; nextCursor: string | null }> {
  const conditions: SQL[] = [speciesVisible(visibility)];
  // RFC-60 R6: a restricted viewer's `status` is ignored — the predicate above already keeps only active rows.
  const status = visibility.inactive ? (input.status ?? 'all') : 'active';
  if (status === 'active') conditions.push(eq(species.active, true));
  if (status === 'inactive') conditions.push(eq(species.active, false));
  // … existing q / familyId / genusId / unresolved / cursor conditions unchanged …
```

Add `active: species.active` to `speciesColumns`, `active: boolean` to `SpeciesJoinedRow`, and `active: r.active` to `toListItem`.

`getSpecies(db, visibility, id)`: add `.where(and(eq(species.id, id), speciesVisible(visibility)))`.

`listFamilies(db, visibility, input)`: add the condition

```ts
sql`exists (select 1 from ${species} s join ${genera} g on g.id = s.genus_id where g.family_id = ${families.id} and ${speciesVisible(visibility, sql`s.active`)})`
```

`listGenera(db, visibility, input)`: add

```ts
sql`exists (select 1 from ${species} s where s.genus_id = ${genera.id} and ${speciesVisible(visibility, sql`s.active`)})`
```

(For an unrestricted viewer `speciesVisible` is `true`, so the `exists` becomes "has any species" — a genus without species would vanish for admins too. Guard: only push these two conditions when `!visibility.inactive`.)

`catalog.ts` — `updateSpecies` accepts `active?: boolean`; when given and different from the stored value, set it and push `'active'` into `fields`; its final `getSpecies(tx, UNRESTRICTED, id)` (the writer has `taxa.manage`; the answer is the row it just wrote).

Routes (`species.ts`, `taxa.ts`): `const visibility = await visibilityOf(ctx, c);` at the top of each handler; pass it; `status: q.status`; the `GET /:id` 404 stays as is (the service returns null for an invisible row).

- [ ] **Step 4: Failing route test**

In `species.integration.test.ts` add:

```ts
describe('RFC-33 R4, RFC-60 R6 species routes by viewer', () => {
  const t = useTestApp();

  it('404 for a contributor, 200 with active=false for a manager; status filter; PATCH active', async () => {
    const contributorRole = await systemRoleId(t.db, 'contributor');
    const managerRole = await systemRoleId(t.db, 'manager');
    const { user: reader } = await createUser(t.db, { roles: [contributorRole] });
    const { user: manager } = await createUser(t.db, { roles: [managerRole] });
    const admin = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const sp = await createSpecies(t.db);
    const [r, m, a] = await Promise.all([loginAs(t, reader), loginAs(t, manager), loginAs(t, admin.user)]);

    const off = await call(t.app, 'PATCH', `/api/species/${sp.id}`, { cookie: a.cookie, body: { active: false } });
    expect(off.status).toBe(200);
    expect((await off.json()).data.active).toBe(false);

    expect((await call(t.app, 'GET', `/api/species/${sp.id}`, { cookie: r.cookie })).status).toBe(404);
    const seen = await call(t.app, 'GET', `/api/species/${sp.id}`, { cookie: m.cookie });
    expect(seen.status).toBe(200);
    expect((await seen.json()).data.active).toBe(false);

    const list = await call(t.app, 'GET', `/api/species?q=${encodeURIComponent(sp.canonicalName)}&status=inactive`, { cookie: m.cookie });
    expect((await list.json()).data.map((s: { id: string }) => s.id)).toEqual([sp.id]);
    const forced = await call(t.app, 'GET', `/api/species?q=${encodeURIComponent(sp.canonicalName)}&status=all`, { cookie: r.cookie });
    expect((await forced.json()).data).toEqual([]);
  });
});
```

Imports: `systemRoleId`, `adminRoleId` from `../../../../test/helpers/roles.ts`.

- [ ] **Step 5: Run service + route tests** — Expected: PASS. Then run the whole `api:integration` project once: other files call `searchSpecies` / `getSpecies` (queues, catalog, records tests) — fix every call site to pass `UNRESTRICTED`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/dataset/taxa.ts apps/api/src/dataset/catalog.ts apps/api/src/http/routes/dataset apps/api/src/dataset/taxa.integration.test.ts apps/api/src/http/routes/dataset/species.integration.test.ts
git commit -m "feat(api): species visibility, status filter, active on items and PATCH (RFC-33 R2-R4, RFC-60 R6-R9)"
```

---

### Task 6: Dictionary, summary, records and queues take a visibility

**Files:**
- Modify: `apps/api/src/dataset/dictionary.ts`, `apps/api/src/dataset/summary.ts`, `apps/api/src/dataset/records.ts`, `apps/api/src/dataset/queues.ts`, `apps/api/src/dataset/curation.ts`, `apps/api/src/dataset/references.ts` (no change unless it lists records), the routes `traits.ts`, `records.ts`, `species.ts` (`/:id/traits`), `references.ts`
- Test: `dictionary.integration.test.ts`, `summary.integration.test.ts`, `records.integration.test.ts`, `queues` tests in `curation.integration.test.ts` / `records.integration.test.ts` routes

**Interfaces:**
- Produces: `getDictionary(db, visibility)`, `getTrait(db, visibility, id)`, `speciesTraitSummary(db, visibility, speciesId)` (returns `null` for an invisible species so the route answers 404), `listRecords(db, visibility, input)`, `getRecord(db, visibility, id)`, `pendingTraits(db, visibility)`, `pendingGroups(db, visibility, input)`, `listDisputed(db, visibility, input)`, `requireSpecies(db, visibility, id)`, `requireTrait(db, visibility, id)`, `createRecord(db, visibility, input)`, `annotateRecord(db, visibility, input)`, `mapPending(db, visibility, input)`, `getAccepted` / `setAccepted` unchanged (admin).

- [ ] **Step 1: Failing tests (one per service, same fixture)**

Shared fixture helper — add to `apps/api/test/helpers/dataset.ts`:

```ts
/**
 * RFC-33 R9 fixture: an inactive species with a record on an active trait, and
 * an active species with a record on an inactive trait. Both records are
 * invisible to a restricted viewer; `visible` is a control record.
 */
export async function createVisibilityFixture(db: DbExecutor, actorId: string) {
  const reference = await createReference(db);
  const activeTrait = await createTrait(db, { levels: ['one'] });
  const inactiveTrait = await createTrait(db, { levels: ['one'], active: false });
  const hiddenSpecies = await createSpecies(db);
  await db.update(species).set({ active: false }).where(eq(species.id, hiddenSpecies.id));
  const shownSpecies = await createSpecies(db);
  const level = (t: { levels: { id: string; key: string }[] }) => t.levels[0]?.id as string;
  const onHiddenSpecies = await createRecord(db, {
    speciesId: hiddenSpecies.id, traitId: activeTrait.id, valueText: 'one', levelId: level(activeTrait),
    primaryReferenceId: reference.id, origin: 'manual', createdBy: actorId,
  });
  const onInactiveTrait = await createRecord(db, {
    speciesId: shownSpecies.id, traitId: inactiveTrait.id, valueText: 'one', levelId: level(inactiveTrait),
    primaryReferenceId: reference.id, origin: 'manual', createdBy: actorId,
  });
  const visible = await createRecord(db, {
    speciesId: shownSpecies.id, traitId: activeTrait.id, valueText: 'one', levelId: level(activeTrait),
    primaryReferenceId: reference.id, origin: 'manual', createdBy: actorId,
  });
  return { reference, activeTrait, inactiveTrait, hiddenSpecies, shownSpecies, onHiddenSpecies, onInactiveTrait, visible };
}
```

Tests:

`dictionary.integration.test.ts`:
```ts
describe('RFC-33 R3, RFC-62 R5 dictionary by viewer', () => {
  const t = useTestDb();
  it('omits an inactive trait and inactive levels for a restricted viewer', async () => {
    const trait = await createTrait(t.db, { levels: ['on', 'off'] });
    const offLevel = trait.levels[1] as { id: string };
    await t.db.update(traitLevels).set({ active: false }).where(eq(traitLevels.id, offLevel.id));
    const inactive = await createTrait(t.db, { active: false });
    const flat = (d: Dictionary) => d.flatMap((c) => c.traits);
    const restricted = flat(await getDictionary(t.db, RESTRICTED));
    expect(restricted.find((x) => x.id === inactive.id)).toBeUndefined();
    expect(restricted.find((x) => x.id === trait.id)?.levels.map((l) => l.key)).toEqual(['on']);
    const unrestricted = flat(await getDictionary(t.db, UNRESTRICTED));
    expect(unrestricted.find((x) => x.id === inactive.id)?.active).toBe(false);
    expect(unrestricted.find((x) => x.id === trait.id)?.levels).toHaveLength(2);
    expect(await getTrait(t.db, RESTRICTED, inactive.id)).toBeNull();
  });
});
```

`summary.integration.test.ts`:
```ts
  it('RFC-33 R3 omits the inactive trait and answers null for the hidden species to a restricted viewer', async () => {
    const { user } = await createUser(t.db);
    const f = await createVisibilityFixture(t.db, user.id);
    const restricted = await speciesTraitSummary(t.db, RESTRICTED, f.shownSpecies.id);
    expect(restricted?.flatMap((c) => c.traits).map((x) => x.trait.id)).toEqual([f.activeTrait.id]);
    expect(await speciesTraitSummary(t.db, RESTRICTED, f.hiddenSpecies.id)).toBeNull();
    const unrestricted = await speciesTraitSummary(t.db, UNRESTRICTED, f.shownSpecies.id);
    expect(unrestricted?.flatMap((c) => c.traits)).toHaveLength(2);
  });
```

`records.integration.test.ts` (service):
```ts
  it('RFC-33 R3, R4 records on a hidden species or an inactive trait are invisible to a restricted viewer', async () => {
    const { user } = await createUser(t.db);
    const f = await createVisibilityFixture(t.db, user.id);
    const byRef = await listRecords(t.db, RESTRICTED, { referenceId: f.reference.id, limit: 10 });
    expect(byRef.data.map((r) => r.id)).toEqual([f.visible.id]);
    expect((await listRecords(t.db, UNRESTRICTED, { referenceId: f.reference.id, limit: 10 })).data).toHaveLength(3);
    expect(await getRecord(t.db, RESTRICTED, f.onHiddenSpecies.id)).toBeNull();
    expect(await getRecord(t.db, RESTRICTED, f.onInactiveTrait.id)).toBeNull();
    expect(await getRecord(t.db, UNRESTRICTED, f.onHiddenSpecies.id)).not.toBeNull();
  });
```

Queues (in the queues test file): create a pending record (`harmonisation: 'unknown_level'`, no level) on the hidden species and assert `pendingTraits(db, RESTRICTED)` does not list its trait while `UNRESTRICTED` does; a disputed record on the hidden species is absent from `listDisputed(db, RESTRICTED, …)`.

Curation: `createRecord(db, RESTRICTED, { speciesId: hidden… })` rejects with `SPECIES_NOT_FOUND`; with `UNRESTRICTED` it succeeds; `annotateRecord(db, RESTRICTED, { recordId: onHiddenSpecies… })` rejects `RECORD_NOT_FOUND`.

- [ ] **Step 2: Run** — Expected: FAIL on signatures.

- [ ] **Step 3: Implement**

`dictionary.ts`:
```ts
export async function getDictionary(db: DbExecutor, visibility: Visibility): Promise<Dictionary> {
  // traits: .where(traitVisible(visibility)); levels: .where(and(traitVisible(visibility), levelVisible(visibility)))
```
`getTrait(db, visibility, id)`: `.where(and(eq(traits.id, id), traitVisible(visibility)))`; levels filtered with `levelVisible`.

`summary.ts`: `speciesTraitSummary(db, visibility, speciesId): Promise<SpeciesTraits | null>` — first `select 1 from species where id = $1 and <speciesVisible>`; return `null` when absent; add `and ${traitVisible(visibility, sql\`t.active\`)}` to the aggregate query's `where`, and `join traits t on t.id = r.trait_id where … and ${traitVisible(visibility, sql\`t.active\`)}` to the level and accepted queries (join `traits` in both).

`records.ts`: `itemQuery(db)` unchanged; `listRecords(db, visibility, input)` and `getRecord(db, visibility, id)` push `speciesVisible(visibility)` and `traitVisible(visibility)` into their `where` (the joins on `species` and `traits` exist in `itemQuery`).

`queues.ts`: `pendingTraits` joins `traits t` and `species s` and adds both predicates; `pendingGroups` (after `requireTrait(db, visibility, traitId)`) adds `speciesVisible` through a join on `species`; `listDisputed` adds both.

`curation.ts`: `requireSpecies(db, visibility, id)` and `requireTrait(db, visibility, id)` add the predicate; `createRecord(db, visibility, input)` and `annotateRecord(db, visibility, input)` (the record read inside the transaction joins `species` and `traits` for the predicates; `mapPending(db, visibility, input)` in `queues.ts` uses `requireTrait`); `resolveValue` adds `levelVisible` to the level lookup.

Routes: every handler in `traits.ts`, `records.ts`, `species.ts` (`GET /:id/traits` answers 404 `SPECIES_NOT_FOUND` on `null`), `references.ts` (only if it lists records) computes `const visibility = await visibilityOf(ctx, c)` and passes it. In `records.ts` the four queue routes (`GET /pending/traits`, `GET /pending`, `POST /pending/map`, `GET /disputed`) switch to `requirePermission(ctx, 'records.review')` (RFC-65 R8–R10 amended in Task 1); their existing tests create the caller with the `manager` system role (`systemRoleId(t.db, 'manager')`) and add one case: a contributor gets 403 on each.

- [ ] **Step 4: Run the whole api:integration project** — Expected: PASS after every call site is updated (`grep -rn "getDictionary(\|getTrait(\|speciesTraitSummary(\|listRecords(\|getRecord(\|pendingTraits(\|pendingGroups(\|listDisputed(\|requireSpecies(\|requireTrait(\|createRecord(\|annotateRecord(\|mapPending(" apps/api/src`).

- [ ] **Step 5: Route-level two-viewer test**

In `apps/api/src/http/routes/dataset/records.integration.test.ts`:

```ts
describe('RFC-33 R4 record routes by viewer', () => {
  const t = useTestApp();
  it('a contributor gets 404 on a record of a hidden species; a manager reads it', async () => {
    const { user: reader } = await createUser(t.db, { roles: [await systemRoleId(t.db, 'contributor')] });
    const { user: manager } = await createUser(t.db, { roles: [await systemRoleId(t.db, 'manager')] });
    const f = await createVisibilityFixture(t.db, manager.id);
    const [r, m] = await Promise.all([loginAs(t, reader), loginAs(t, manager)]);
    expect((await call(t.app, 'GET', `/api/records/${f.onHiddenSpecies.id}`, { cookie: r.cookie })).status).toBe(404);
    expect((await call(t.app, 'GET', `/api/records/${f.onHiddenSpecies.id}`, { cookie: m.cookie })).status).toBe(200);
    const annotate = await call(t.app, 'POST', `/api/records/${f.onHiddenSpecies.id}/annotations`, { cookie: r.cookie, body: { kind: 'confirm' } });
    expect(annotate.status).toBe(404);
    const traitsRes = await call(t.app, 'GET', '/api/traits', { cookie: r.cookie });
    const keys = (await traitsRes.json()).data.flatMap((c: { traits: { id: string }[] }) => c.traits.map((x) => x.id));
    expect(keys).not.toContain(f.inactiveTrait.id);
  });
});
```

- [ ] **Step 6: Run, commit**

```bash
git add apps/api/src/dataset apps/api/src/http/routes/dataset apps/api/test/helpers/dataset.ts
git commit -m "feat(api): visibility in dictionary, summary, records, queues and curation services (RFC-33 R2-R5)"
```

---

### Task 7: `seed:traits` reads an optional `active` column

**Files:**
- Modify: `apps/api/src/dataset/seed.ts`
- Test: `apps/api/src/dataset/seed.integration.test.ts`

- [ ] **Step 1: Failing test**

```ts
  it('RFC-62 R2 stores active=false from an optional seventh column; six-column files still load', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'seed-'));
    const key = `seed_off_${Math.random().toString(16).slice(2)}`;
    const file = join(dir, 'dict.csv');
    await writeFile(
      file,
      `final_standard_trait,broad_category,trait_value_type,standard_unit,description,harmonised_levels,active\n${key},dispersal,categorical,,desc,a;b,false\n`,
    );
    await seedDictionary(t.db, file);
    const [row] = await t.db.select({ active: traits.active }).from(traits).where(eq(traits.key, key));
    expect(row?.active).toBe(false);
  });
```

- [ ] **Step 2: Run** — Expected: FAIL (header rejected or `active` true).

- [ ] **Step 3: Implement** — in `seed.ts`, accept a header equal to the six columns or the six plus `active`; when the column exists, parse `true`/`false` case-insensitively (anything else → throw `Invalid active value on line N`), and pass `active` into the trait insert (`on conflict do nothing` unchanged).

- [ ] **Step 4: Run, commit**

```bash
git add apps/api/src/dataset/seed.ts apps/api/src/dataset/seed.integration.test.ts
git commit -m "feat(api): seed:traits reads an optional active column (RFC-62 R2)"
```

---

### Task 8: Supplementary import framework and `import:species-status`

**Files:**
- Create: `apps/api/src/dataset/imports/framework.ts`, `apps/api/src/dataset/imports/framework.integration.test.ts`, `apps/api/src/dataset/imports/species-status.ts`, `apps/api/src/dataset/imports/species-status.integration.test.ts`, `apps/api/src/cli/import-species-status.ts`
- Modify: `apps/api/src/audit/actions.ts` (re-export covers it — verify the actions test passes), `apps/api/src/dataset/import.ts` (`listImportBatches` filter by kind; `toBatch` carries `kind`), `apps/api/src/http/routes/dataset/imports.ts` (`listImportsQuerySchema`), `apps/api/package.json`

**Interfaces:**
- Produces:
  ```ts
  export interface SupplementaryApplyResult { inserted: number; duplicate: number; rejected: number }
  export interface SupplementaryImportInput { kind: ImportBatchKind; filePath: string; header: readonly string[]; runBy: string | null; copyIdleTimeoutMs?: number;
    apply(tx: postgres.TransactionSql, batchId: string): Promise<SupplementaryApplyResult> }
  export async function runSupplementaryImport(db: Db, input: SupplementaryImportInput): Promise<ImportBatch>
  export async function importSpeciesStatus(db: Db, input: { filePath: string; runBy: string | null; copyIdleTimeoutMs?: number }): Promise<ImportBatch>
  export function supplementaryReport(batch: ImportBatch, report: { rejectReasons: Record<string, number> }, rejects: ImportReject[], seconds: string): string
  ```
  Staging table name is always `import_staging` with columns named after the header plus `row_no bigserial`; `apply` reads it and inserts its rejects into `import_rejects (batch_id, row_no, reason, raw_row)` itself (`raw_row` = `to_jsonb(s) - 'row_no'`).

- [ ] **Step 1: Failing test for the species-status kind (drives the framework)**

`species-status.integration.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createSpecies } from '../../../test/helpers/dataset.ts';
import { useTestDb } from '../../../test/helpers/db.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { auditLog } from '../../db/schema/audit-log.ts';
import { importRejects } from '../../db/schema/imports.ts';
import { species } from '../../db/schema/taxa.ts';
import { importSpeciesStatus } from './species-status.ts';

async function csv(lines: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'status-'));
  const file = join(dir, 'status.csv');
  await writeFile(file, `${lines.join('\n')}\n`);
  return file;
}

describe('RFC-68 R8 import:species-status', () => {
  const t = useTestDb();

  it('sets the flag, counts duplicates and rejects unknown species and bad values, audits the batch', async () => {
    const { user } = await createUser(t.db);
    const a = await createSpecies(t.db);
    const b = await createSpecies(t.db);
    const file = await csv([
      'wcvp_species,active',
      `${a.canonicalName},false`,
      `  ${b.canonicalName}  ,TRUE`,
      `No such species-${Math.random()},true`,
      `${a.canonicalName},maybe`,
    ]);
    const batch = await importSpeciesStatus(t.db, { filePath: file, runBy: user.id });
    expect(batch.kind).toBe('species_status');
    expect(batch.status).toBe('completed');
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([4, 1, 1, 2]);
    const [ra] = await t.db.select({ active: species.active }).from(species).where(eq(species.id, a.id));
    expect(ra?.active).toBe(false);
    const rejects = await t.db.select().from(importRejects).where(eq(importRejects.batchId, batch.id));
    expect(rejects.map((r) => [r.rowNo, r.reason]).sort()).toEqual([[3, 'unknown_species'], [4, 'invalid_value']]);
    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.targetId, batch.id));
    expect(entry?.action).toBe('imports.completed');
    expect(entry?.metadata).toMatchObject({ kind: 'species_status', rowsInserted: 1 });
    expect(entry?.actorUserId).toBe(user.id);

    // idempotent: the same file again is all duplicates
    const again = await importSpeciesStatus(t.db, { filePath: file, runBy: user.id });
    expect([again.rowsInserted, again.rowsDuplicate, again.rowsRejected]).toEqual([0, 2, 2]);
  });

  it('refuses a wrong header before creating a batch and fails the batch on a bad file', async () => {
    const bad = await csv(['species,active', 'x,true']);
    await expect(importSpeciesStatus(t.db, { filePath: bad, runBy: null })).rejects.toThrow(/header/i);
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `framework.ts`**

```ts
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import type { ImportBatch, ImportBatchKind, ImportReject } from '@treerepro/contracts';
import { eq } from 'drizzle-orm';
import type postgres from 'postgres';
import { recordAudit } from '../../audit/audit.ts';
import type { Db } from '../../db/client.ts';
import { DEFAULT_COPY_IDLE_TIMEOUT_MS, pipelineWithIdleGuard } from '../../db/copy.ts';
import { importBatches } from '../../db/schema/imports.ts';
import { getImportBatch, ImportRefusedError, readFirstLine, sha256File } from '../import.ts';

export interface SupplementaryApplyResult {
  inserted: number;
  duplicate: number;
  rejected: number;
}

export interface SupplementaryImportInput {
  kind: ImportBatchKind;
  filePath: string;
  /** The exact header line, as column names. */
  header: readonly string[];
  runBy: string | null;
  copyIdleTimeoutMs?: number;
  /**
   * Runs inside the transaction after staging. Reads `import_staging`
   * (`row_no` plus the header columns, raw text), writes the rows it rejects
   * into `import_rejects` for `batchId`, and answers the counts.
   */
  apply(tx: postgres.TransactionSql, batchId: string): Promise<SupplementaryApplyResult>;
}

/** Identifier-safe: headers are fixed literals in this module's callers. */
function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`bad column name ${name}`);
  return `"${name}"`;
}

/**
 * Stage, apply, finalise, audit — one transaction (RFC-68 R3–R5). The batch
 * row is created before the transaction so a failure is recorded on it.
 * @rfc RFC-68 R2-R5
 */
export async function runSupplementaryImport(
  db: Db,
  input: SupplementaryImportInput,
): Promise<ImportBatch> {
  const first = parseCsvLine(await readFirstLine(input.filePath));   // RFC-64 R2: the header is a CSV record, quotes allowed
  const expected = [...input.header];
  if (first.length !== expected.length || first.some((c, i) => c !== expected[i])) {
    throw new ImportRefusedError('bad_header', `Expected header "${expected.join(',')}", got "${first.join(',')}"`);
  }
  const fileSha256 = await sha256File(input.filePath);
  const [batch] = await db
    .insert(importBatches)
    .values({ fileName: basename(input.filePath), fileSha256, runBy: input.runBy, kind: input.kind })
    .returning({ id: importBatches.id });
  if (!batch) throw new Error('runSupplementaryImport: batch insert returned no row');
  const sql = db.$client;
  try {
    await sql.begin(async (tx) => {
      const cols = input.header.map(ident).join(', ');
      await tx.unsafe(
        `create temporary table import_staging (row_no bigserial primary key, ${input.header
          .map((h) => `${ident(h)} text`)
          .join(', ')}) on commit drop`,
      );
      const writable = await tx
        .unsafe(`copy import_staging (${cols}) from stdin with (format csv, header true, encoding 'UTF8')`)
        .writable();
      await pipelineWithIdleGuard(
        createReadStream(input.filePath),
        writable,
        input.copyIdleTimeoutMs ?? DEFAULT_COPY_IDLE_TIMEOUT_MS,
      );
      const [{ total }] = (await tx`select count(*)::int as total from import_staging`) as [{ total: number }];
      const counts = await input.apply(tx, batch.id);
      await tx`
        update import_batches set status = 'completed', finished_at = clock_timestamp(),
          rows_total = ${total}, rows_inserted = ${counts.inserted}, rows_duplicate = ${counts.duplicate},
          rows_rejected = ${counts.rejected}, rows_pending = 0
        where id = ${batch.id}`;
      // RFC-68 R5 — same transaction (RFC-41 R5). `recordAudit` takes a Drizzle
      // executor and this is a postgres.js transaction, so the row is written
      // with `tx` directly after the same RFC-41 R7 key check `recordAudit` runs.
      const metadata = {
        kind: input.kind,
        rowsTotal: total,
        rowsInserted: counts.inserted,
        rowsDuplicate: counts.duplicate,
        rowsRejected: counts.rejected,
      };
      assertSafeMetadata(metadata);
      await tx`
        insert into audit_log (actor_user_id, action, target_type, target_id, metadata)
        values (${input.runBy}, 'imports.completed', 'import_batches', ${batch.id}, ${JSON.stringify(metadata)}::jsonb)`;
    });
  } catch (err) {
    try {
      await db
        .update(importBatches)
        .set({ status: 'failed', finishedAt: new Date(), error: (err as Error).message.slice(0, 2000) })
        .where(eq(importBatches.id, batch.id));
    } catch (updateErr) {
      if (err instanceof Error && err.cause === undefined) err.cause = updateErr;
    }
    throw err;
  }
  const result = await getImportBatch(db, batch.id);
  if (!result) throw new Error('runSupplementaryImport: batch vanished');
  return result;
}
```

`assertSafeMetadata` is the RFC-41 R7 check `apps/api/src/audit/audit.ts` already exports (used by `recordAudit`); `parseCsvLine` is exported by `apps/api/src/dataset/import.ts`. The audit `action` literal must be in `AUDIT_ACTIONS` (Task 2 added it); `audit/actions.ts` re-exports the contracts list, so the actions test covers it.

Report:

```ts
/** @rfc RFC-68 R6 */
export function supplementaryReport(
  batch: ImportBatch,
  report: { rejectReasons: Record<string, number> },   // batchReport(db, batch.id) — totals over every reject, not the first 30
  rejects: ImportReject[],                              // the first 30, for the row numbers
  seconds: string,
): string {
  return [
    `File ${batch.fileName} (sha256 ${batch.fileSha256})`,
    `Batch ${batch.id} (${batch.kind}) completed in ${seconds}s`,
    `Rows: ${batch.rowsTotal} total, ${batch.rowsInserted} applied, ${batch.rowsDuplicate} duplicate, ${batch.rowsRejected} rejected`,
    `Rejections: ${Object.entries(report.rejectReasons).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    ...rejects.map((r) => `  row ${r.rowNo}: ${r.reason}`),
  ].join('\n');
}
```

`species-status.ts`:

```ts
import type { ImportBatch } from '@treerepro/contracts';
import type { Db } from '../../db/client.ts';
import { runSupplementaryImport, type SupplementaryApplyResult } from './framework.ts';

/** @rfc RFC-68 R8 */
export const SPECIES_STATUS_HEADER = ['wcvp_species', 'active'] as const;

/** @rfc RFC-68 R8 */
export async function importSpeciesStatus(
  db: Db,
  input: { filePath: string; runBy: string | null; copyIdleTimeoutMs?: number },
): Promise<ImportBatch> {
  return runSupplementaryImport(db, {
    kind: 'species_status',
    header: SPECIES_STATUS_HEADER,
    filePath: input.filePath,
    runBy: input.runBy,
    copyIdleTimeoutMs: input.copyIdleTimeoutMs,
    async apply(tx, batchId): Promise<SupplementaryApplyResult> {
      await tx`
        alter table import_staging
          add column species_name text, add column flag boolean, add column species_id uuid, add column outcome text`;
      await tx`
        update import_staging set
          species_name = nullif(trim(regexp_replace(coalesce(wcvp_species, ''), '\\s+', ' ', 'g')), ''),
          flag = case lower(trim(coalesce(active, ''))) when 'true' then true when 'false' then false else null end`;
      await tx`update import_staging s set species_id = sp.id from species sp where sp.canonical_name = s.species_name`;
      await tx`
        update import_staging set outcome = case
          when flag is null then 'invalid_value'
          when species_id is null then 'unknown_species'
          else 'apply' end`;
      await tx`
        insert into import_rejects (batch_id, row_no, reason, raw_row)
        select ${batchId}, row_no, outcome, jsonb_build_object('wcvp_species', coalesce(wcvp_species, ''), 'active', coalesce(active, ''))
        from import_staging where outcome <> 'apply' order by row_no`;
      // duplicate = already in the requested state; the last row wins when a species repeats
      const [{ duplicate }] = (await tx`
        select count(*)::int as duplicate from import_staging s join species sp on sp.id = s.species_id
        where s.outcome = 'apply' and sp.active = s.flag`) as [{ duplicate: number }];
      const applied = await tx`
        update species sp set active = s.flag
        from (select distinct on (species_id) species_id, flag from import_staging where outcome = 'apply' order by species_id, row_no desc) s
        where sp.id = s.species_id and sp.active <> s.flag`;
      const [{ rejected }] = (await tx`select count(*)::int as rejected from import_staging where outcome <> 'apply'`) as [{ rejected: number }];
      return { inserted: applied.count, duplicate, rejected };
    },
  });
}
```

(`rows_total = inserted + duplicate + rejected` holds when a species is not repeated; a repeated species with conflicting flags counts its earlier rows as duplicate or applied by the last one — document in the RFC-68 R8 wording: "the last row for a species wins".)

`cli/import-species-status.ts` — a copy of `import-records.ts` without `--force`, calling `importSpeciesStatus`, printing `supplementaryReport(batch, await batchReport(db, batch.id), (await listImportRejects(db, { batchId: batch.id, limit: 30 })).data, seconds)` (`batchReport` and `listImportRejects` exist in `import.ts`; `listImportRejects` takes an object). `package.json`: `"import:species-status": "node --conditions=development src/cli/import-species-status.ts"`.

`import.ts`: `toImportBatch` adds `kind: row.kind`; `listImportBatches(db, { kind?, cursor, limit })` adds `eq(importBatches.kind, kind)` when given; the imports route validates with `listImportsQuerySchema`.

- [ ] **Step 4: Run the tests** — Expected: PASS. Also `pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:unit src/audit/actions.test.ts` (catalog matches the RFC table).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/dataset/imports apps/api/src/cli/import-species-status.ts apps/api/src/dataset/import.ts apps/api/src/http/routes/dataset/imports.ts apps/api/package.json
git commit -m "feat(api): supplementary import framework and import:species-status (RFC-68 R1-R8)"
```

---

### Task 9: Roles service and route — system roles read-only, permissions listed

**Files:**
- Modify: `apps/api/src/access/roles.ts` (message), `apps/api/src/http/routes/admin/roles.ts` (nothing if `listRoles` already returns permissions of non-admin system roles)
- Test: `apps/api/src/access/roles.integration.test.ts`

- [ ] **Step 1: Failing test**

```ts
  it('RFC-31 R2, R11 manager and contributor cannot be edited or deleted and list their permissions', async () => {
    const id = await systemRoleId(t.db, 'contributor');
    await expect(updateRole(ctx, { id, description: 'x', actorUserId: null })).rejects.toMatchObject({ code: 'ROLE_IS_SYSTEM' });
    await expect(deleteRole(ctx, { id, actorUserId: null })).rejects.toMatchObject({ code: 'ROLE_IS_SYSTEM' });
    const listed = (await listRoles(t.db)).find((r) => r.id === id);
    expect(listed?.isSystem).toBe(true);
    expect(listed?.permissions.sort()).toEqual(['dataset.read', 'records.annotate', 'records.create']);
  });
```

- [ ] **Step 2: Run** — likely PASS already except the error message; change `requireEditable`'s message to `'A system role cannot be changed'` and keep the code. If `listRoles` special-cases `isSystem` to an empty permission list, change it to read `role_permissions` for every role (the admin one has none anyway).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/access
git commit -m "feat(api): system roles are read-only and list their stored permissions (RFC-31 R2, R11)"
```

---

### Task 10: Web — species status, active checkbox, imports kind, roles page

**Files:**
- Modify: `apps/web/src/api/dataset.ts` (`status`, `kind` params), `apps/web/src/components/dataset/SpeciesList.tsx`, `apps/web/src/components/dataset/SpeciesSearchForm.tsx`, `apps/web/src/pages/dataset/SpeciesSearchPage.tsx`, `apps/web/src/pages/dataset/SpeciesPage.tsx`, `apps/web/src/components/catalog/SpeciesDialog.tsx`, `apps/web/src/pages/dataset/ImportsPage.tsx`, `apps/web/src/pages/admin/RolesPage.tsx`, `apps/web/src/test/dataset-fixtures.ts`, tests beside each

- [ ] **Step 1: Fixtures** — add `active: true` to every `SpeciesListItem` / `Species` fixture and `kind: 'records'` to every `ImportBatch` fixture (the contracts schemas are strict; the web tests validate payloads). Run `pnpm --filter @treerepro/web test` and fix every inline fixture the run names.

- [ ] **Step 2: Failing component tests**

`SpeciesList.test.tsx` (create if the list has no test; otherwise append):
```ts
  it('RFC-33 R7 marks an inactive species', () => {
    render(<SpeciesList items={[{ ...ADENANTHERA, active: false }]} />);
    expect(screen.getByText('inactive')).toBeInTheDocument();
  });
```
`SpeciesSearchForm.test.tsx`:
```ts
  it('RFC-60 R6 shows the status select only with dataset.read_inactive', () => {
    renderWithProviders(<SpeciesSearchForm value={{ q: '', unresolved: false }} onChange={() => {}} />, { me: READER });
    expect(screen.queryByLabelText('Status')).toBeNull();
    renderWithProviders(<SpeciesSearchForm value={{ q: '', unresolved: false }} onChange={onChange} />, { me: { ...READER, permissions: ['dataset.read', 'dataset.read_inactive'] } });
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'inactive');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'inactive' }));
  });
```
(`renderWithProviders(ui, { me })` is the helper in `apps/web/src/test/render.tsx`; `renderAt(path)` in `test/router.tsx` mounts the shell for page tests.)

`SpeciesDialog.test.tsx`: editing a species shows the checkbox "Active — visible to contributors" checked for `active: true`; unchecking and saving calls `updateSpecies(id, { active: false })`.

`ImportsPage.test.tsx`: the table shows a Kind column with `species status` for a `kind: 'species_status'` batch; a Kind select filters (calls `fetchImports({ kind: 'species_status' })`).

`RolesPage.test.tsx`: a `manager` system role shows the `system` badge, its permission count, and no Edit / Delete buttons.

- [ ] **Step 3: Implement**

- `SpeciesSearchValue` gains `status?: 'active' | 'inactive' | 'all'`; the form renders `<Field label="Status"><Select …>` with All / Active / Inactive when `hasPermission(me, 'dataset.read_inactive')` (the form gains `useMe()`); the page passes `status` to `searchSpecies`.
- `SpeciesList` row: `{item.active ? null : <Badge tone="grey">inactive</Badge>}` beside the name (use the existing neutral `Badge` tone — check `Badge.tsx` for the tone name).
- `SpeciesPage` header: the same badge after the `unresolved taxon` badge.
- `SpeciesDialog`: a checkbox bound to `active` (edit mode only; create keeps the default), sent only when changed.
- `ImportsPage`: Kind column (`humaniseKey(batch.kind)`), a Kind select over `IMPORT_BATCH_KINDS` (from contracts) filtering the query.
- `RolesPage`: `role.isSystem` hides Edit / Delete for every system role; the permission cell shows `role.name === 'admin' ? 'all' : role.permissions.length`.
- `nav.ts`: the three Curation entries (Pending, Disputed, Unresolved taxa) switch to `permission: 'records.review'`; `PendingPage` / `DisputedPage` tests use a `me` with `records.review`; `AppShell.test.tsx` asserts a contributor session (`dataset.read`, `records.create`, `records.annotate`) sees no Curation group.

- [ ] **Step 4: Run web tests, lint, typecheck** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): species status filter and inactive badge, active checkbox, import kinds, read-only system roles (RFC-33 R7, RFC-60 R6, RFC-68 R7)"
```

---

### Task 11: End-to-end test

**Files:**
- Create: `apps/e2e/tests/visibility.spec.ts`
- Modify: `apps/e2e` helpers if a "create a user with a role through the admin API" helper is missing (look at the existing specs for how the admin session is obtained and how users are invited).

- [ ] **Step 1: Write the test**

```ts
import { expect, test } from '@playwright/test';
import { apiCall } from './api.ts';
import { adminContext, inviteAndActivate } from './users.ts';

test('RFC-33 an inactive species disappears for a contributor and stays, labelled, for the admin', async ({ browser }) => {
  const admin = await adminContext(browser);
  const adminPage = await admin.newPage();
  const name = `E2E hidden ${Date.now()}`;
  const created = await apiCall<{ data: { id: string } }>(admin, 'POST', '/api/species', { canonicalName: name, nameSource: 'wcvp' });
  await apiCall(admin, 'PATCH', `/api/species/${created.json.data.id}`, { active: false });
  const contributor = await inviteAndActivate(browser, admin, { role: 'contributor' });

  await contributor.page.goto('/app/species');
  await contributor.page.getByLabel('Species name').fill(name);
  await expect(contributor.page.getByText('No species match')).toBeVisible();

  await adminPage.goto('/app/species');
  await adminPage.getByLabel('Species name').fill(name);
  await adminPage.getByLabel('Status').selectOption('inactive');
  await expect(adminPage.getByRole('link', { name })).toBeVisible();
  await expect(adminPage.getByText('inactive', { exact: true })).toBeVisible();
});
```

The helpers come from Task 0. Playwright `getByText` is a substring match: pass `{ exact: true }` where a longer sibling text exists (`docs/gotchas/testing.md`).

- [ ] **Step 2: Run** — `PATH=… pnpm test:e2e -- tests/visibility.spec.ts` (builds the images; several minutes). Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e
git commit -m "test(e2e): inactive species hidden from a contributor, labelled for the admin (RFC-33)"
```

---

### Task 12: Docs, RFC status, README, gotchas, final checks

- [ ] **Step 1:** Set RFC-33 and RFC-68 to `accepted` (header and README rows); changelog `- 2026-09-17 — accepted.`
- [ ] **Step 2:** README — Commands: add `pnpm --filter @treerepro/api import:species-status --file <csv> [--run-by <email>]` with the container note; Layout: mention `dataset.read_inactive` and the system roles in the admin API paragraph.
- [ ] **Step 3:** `docs/gotchas/dataset.md` — two entries: "Every dataset read service takes a `Visibility` first — pass `UNRESTRICTED` from a CLI or a test, never `{ inactive: true }` literals"; "Supplementary imports stage into `import_staging`; the `apply` callback must insert its own rejects and the last row of a repeated key wins".
- [ ] **Step 4:** Update the species status line of `docs/specs/2026-09-17-visibility-design.md` (`Status: 08a implemented (PR #NN)`).
- [ ] **Step 5:** Run everything: `pnpm lint`, `pnpm typecheck`, `pnpm rfc:check`, `pnpm test`, `pnpm build`.
- [ ] **Step 6:** Commit `docs: RFC-33 and RFC-68 accepted; README commands; gotchas (plan 08a)`, push, open the PR (`gh pr create --title "feat: system roles, species activation, visibility enforcement, supplementary imports (plan 08a)" --body-file -` with a body listing the RFCs and the migration numbers, ending with the attribution line), run one CodeRabbit review.

## Self-review

- Spec coverage: E2E harness prerequisite (Task 0); §3 roles incl. `records.review` and the queue gate (Tasks 1, 3, 6, 9, 10), §4 visibility R1–R5, R7, R9 (Tasks 4–6; R6, R8 are 08b), §5 species activation (Tasks 3, 5, 10), §6 dictionary (Tasks 6, 7), §7 imports R1–R8 (Task 8), §9 codes/actions/permissions (Tasks 1–3), §10 tests (each task; E2E Task 11).
- Types: `searchSpecies(db, visibility, input)`, `getSpecies(db, visibility, id)`, `speciesTraitSummary(db, visibility, id): Promise<SpeciesTraits | null>` used consistently in Tasks 5, 6, 10 (web unchanged); `importSpeciesStatus(db, { filePath, runBy })` in Tasks 8 and 12.
