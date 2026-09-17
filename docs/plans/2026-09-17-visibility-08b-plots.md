# Visibility 08b — Field Plots, User Assignment, Species Scope — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`).

**Goal:** Field plots as data (`plots`, `plot_species`, `user_plots`, `users.restrict_to_assigned_plots`), three import commands, plot management routes and pages, per-user assignment with the restriction flag, the viewer's plots on `GET /api/auth/me`, and the species scope (`scope=plots|all`, `plotId=`) enforced by `Visibility.plotIds`.

**Architecture:** Plots are configuration, not scientific data: they have `PATCH` routes and membership removal, all audited. `visibilityOf` (plan 08a) now reads the viewer's `restrict_to_assigned_plots` and `user_plots` in one query and fills `plotIds`; `speciesVisible` adds an `exists` over `plot_species` when `plotIds` is set. The species list gains `scope` / `plotId` on top. Three supplementary import kinds reuse `runSupplementaryImport` (plan 08a).

**Tech Stack:** unchanged. No new dependencies.

**Spec:** `docs/specs/2026-09-17-visibility-design.md` (§4 R6, R8; §8; §9) and `docs/specs/2026-09-17-contributor-launch-overview.md`. Depends on plan 08a merged.

## Global Constraints

Same as plan 08a (English artifacts, PATH prefix, RFC first, `@rfc` tags, TDD with testcontainers, random fixture names, `AppError` codes, `sql` tag only, `.ts` imports, lint/typecheck/rfc:check before each commit, one commit per task, attribution line). Branch `feat/visibility-08b` from `origin/main` in a worktree `../Elisa-08b`. The route-guard meta-test lists every route; each task that adds routes appends them.

## File structure (end state)

```
docs/rfc/60-dataset/67-field-plots.md                       # new
docs/rfc/30-access/33-data-visibility.md                    # R6, R8 now implemented (wording)
docs/rfc/20-auth/20-users-and-invitations.md                # R1: restrict_to_assigned_plots
docs/rfc/20-auth/22-login-and-sessions.md                   # R10: me.scope
docs/rfc/30-access/30-permission-catalog.md                 # + plots.manage
docs/rfc/40-data-protection/41-audit-log.md                 # + plots.*, users.plots_changed
docs/rfc/50-admin/50-user-administration.md                 # R1 plots fields; R13 PUT plots
docs/rfc/60-dataset/60-taxonomy-catalog.md                  # R6 scope/plotId; R7 plots
docs/rfc/60-dataset/68-supplementary-imports.md             # R9–R11
docs/rfc/10-platform/12-error-codes.md                      # PLOT_*
docs/rfc/10-platform/13-presentation-layer.md               # routes
apps/api/drizzle/0018_permissions_plots.sql                 # custom
apps/api/drizzle/0019_plots.sql                             # generated
apps/api/src/db/schema/plots.ts (+ tests in dataset.integration.test.ts)
apps/api/src/db/schema/users.ts                             # restrictToAssignedPlots
apps/api/src/access/visibility.ts                           # plotIds lookup; plot predicate
apps/api/src/dataset/plots.ts (+ .integration.test.ts)      # list/get/species/users/writes
apps/api/src/dataset/taxa.ts                                # scope, plotId, plots on detail
apps/api/src/admin/users.ts                                 # setUserPlots; toUser plots
apps/api/src/auth/… (me payload)                            # scope
apps/api/src/dataset/imports/plots.ts (+ test)              # kinds plots, plot_species, user_plots
apps/api/src/cli/import-plots.ts, import-plot-species.ts, import-user-plots.ts
apps/api/src/http/routes/dataset/plots.ts (+ .integration.test.ts)
apps/api/src/http/routes/admin/users.ts                     # PUT /:id/plots
apps/api/src/http/routes/auth.ts                            # me.scope
apps/api/src/audit/actions.ts
apps/api/test/helpers/dataset.ts                            # createPlot, assignPlots
packages/contracts/src/plots.ts (+ .test.ts)                # schemas
packages/contracts/src/dataset.ts                           # scope, plotId; species.plots
packages/contracts/src/users.ts                             # plots, restrictToAssignedPlots; setUserPlotsBodySchema
packages/contracts/src/auth.ts                              # meResponseSchema.scope
packages/contracts/src/permissions.ts, error-codes.ts, audit.ts
apps/web/src/api/plots.ts, admin.ts, dataset.ts
apps/web/src/pages/admin/PlotsPage.tsx, PlotPage.tsx (+ tests)
apps/web/src/components/admin/PlotDialog.tsx, UserPlotsSection.tsx, PlotSpeciesSection.tsx (+ tests)
apps/web/src/components/dataset/SpeciesSearchForm.tsx       # scope group
apps/web/src/pages/dataset/SpeciesSearchPage.tsx, SpeciesPage.tsx
apps/web/src/routes/app/admin/plots/index.tsx, $id.tsx
apps/web/src/components/shell/nav.ts
apps/web/src/test/fixtures.ts, admin-fixtures.ts, dataset-fixtures.ts
apps/e2e/tests/plots.spec.ts
README.md
```

---

### Task 1: RFC-67 and the amendments

**Files:** as listed under `docs/rfc/` above.

- [ ] **Step 1: Write RFC-67** (`docs/rfc/60-dataset/67-field-plots.md`), status `draft`, category dataset, context from the spec §1, and these rules verbatim from the spec §8 R1–R11, with these clarifications folded in:
  - R1 `plots.updated_at timestamptz not null default now()`; unique index `plots_code_lower_idx on (lower(code))`; checks `plots_latitude_check (latitude between -90 and 90)`, `plots_longitude_check (longitude between -180 and 180)`.
  - R3 item `speciesCount` is `count(*)` from `plot_species` for the plot (plots are hundreds; species per plot hundreds — computed per request).
  - R6 `PUT /api/admin/users/:id/plots` audits `users.plots_changed` with `metadata: { added: [plotId…], removed: [plotId…], restricted: boolean }`.
  - R8 species detail `plots` (RFC-60 R7): the plots the species belongs to among the viewer's assigned plots, or every plot it belongs to for a `plots.manage` holder.
- [ ] **Step 2: Amendments**
  - RFC-30 row: `| \`plots.manage\` | Create and edit field plots and their species |`.
  - RFC-12 rows: `PLOT_NOT_FOUND` 404 "Plot id does not exist (RFC-67 R3)"; `PLOT_CODE_TAKEN` 409 "Another plot has this code, case-insensitively (RFC-67 R5)"; `PLOT_SPECIES_EXISTS` 409 "The species is already in the plot (RFC-67 R5)".
  - RFC-41 rows: `plots.created`, `plots.updated`, `plots.species_added`, `plots.species_removed`, `users.plots_changed`.
  - RFC-20 R1: `users` gains `restrict_to_assigned_plots boolean not null default false`.
  - RFC-22 R10: `GET /api/auth/me` answers `{ user, permissions, scope: { plots: [{ id, code, name }], restricted } }`.
  - RFC-50 R1: `user` gains `plots: [{ id, code, name }]` (by code) and `restrictToAssignedPlots`; new **R13** `PUT /api/admin/users/:id/plots { plotIds, restrictToAssignedPlots }` (`users.update`) per RFC-67 R6.
  - RFC-60 R6: `scope=`, `plotId=` per RFC-33 R6; R7: `plots`.
  - RFC-33 R6, R8: drop the "(Implemented by plan 08b…)" parentheses.
  - RFC-68: append R9–R11 (spec §8 R9–R11).
  - RFC-13 R2: routes `/app/admin/plots`, `/app/admin/plots/$id`.
  - README index row for RFC-67.
- [ ] **Step 3: Commit** — `docs(rfc): RFC-67 field plots; amend RFC-12/20/22/30/33/41/50/60/68 (plan 08b)`.

---

### Task 2: Contracts

**Files:** `packages/contracts/src/plots.ts` (new), `plots.test.ts`, `dataset.ts`, `users.ts`, `auth.ts`, `permissions.ts`, `error-codes.ts`, `audit.ts`, `index.ts`

**Interfaces (produces):**

```ts
// plots.ts
export const plotRefSchema = z.strictObject({ id: z.uuid(), code: z.string(), name: z.string() });
export const plotSchema = plotRefSchema.extend({
  description: z.string(), latitude: z.number().nullable(), longitude: z.number().nullable(),
  country: z.string().nullable(), biome: z.string().nullable(), speciesCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});
export const plotDetailSchema = plotSchema.extend({ userCount: z.number().int().nonnegative().nullable() });
export const listPlotsQuerySchema = cursorQuerySchema.extend({ q: z.string().trim().min(1).max(100).optional() });
export const plotCodeSchema = z.string().trim().min(1).max(64);
export const createPlotBodySchema = z.strictObject({
  code: plotCodeSchema, name: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).optional(),
  latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(),
  country: z.string().trim().min(1).max(100).optional(), biome: z.string().trim().min(1).max(100).optional(),
});
export const updatePlotBodySchema = nonEmpty({ code, name, description, latitude: …nullable().optional(), longitude, country, biome }, 'code');
export const plotSpeciesBodySchema = z.strictObject({ speciesId: z.uuid() });
export const plotUserSchema = z.strictObject({ id: z.uuid(), name: z.string(), email: z.string(), status: z.enum(USER_STATUSES), restricted: z.boolean() });
export const SPECIES_SCOPES = ['plots', 'all'] as const;
// dataset.ts: listSpeciesQuerySchema += scope: z.enum(SPECIES_SCOPES).optional(), plotId: z.uuid().optional(); speciesSchema += plots: z.array(plotRefSchema)
// users.ts: userSchema += plots: z.array(plotRefSchema), restrictToAssignedPlots: z.boolean();
//   export const setUserPlotsBodySchema = z.strictObject({ plotIds: z.array(z.uuid()).max(100), restrictToAssignedPlots: z.boolean() })
//     .refine((b) => !b.restrictToAssignedPlots || b.plotIds.length > 0, { path: ['plotIds'], message: 'A restricted user needs at least one plot' });
// auth.ts: meResponseSchema += scope: z.strictObject({ plots: z.array(plotRefSchema), restricted: z.boolean() })
// permissions.ts: 'plots.manage'; error-codes.ts: PLOT_NOT_FOUND 404, PLOT_CODE_TAKEN 409, PLOT_SPECIES_EXISTS 409; audit.ts: the five actions
```

(`nonEmpty` is the helper `curation.ts` uses for PATCH bodies — import it or move it to a shared module `packages/contracts/src/schema-helpers.ts` if it is not exported.)

- [ ] **Step 1: Failing test** `plots.test.ts`: `createPlotBodySchema` rejects latitude 91; `setUserPlotsBodySchema` rejects `{ plotIds: [], restrictToAssignedPlots: true }` with path `plotIds`; `meResponseSchema` requires `scope`.
- [ ] **Step 2: Implement; export from `index.ts`; run contracts tests (the permissions / codes / audit tests parse the RFC tables); build.**
- [ ] **Step 3: Commit** — `feat(contracts): plots, species scope, user plots, me.scope (RFC-67, RFC-33 R6, R8)`.

---

### Task 3: Schema and migrations

**Files:** `apps/api/src/db/schema/plots.ts` (new), `users.ts`, `index.ts`, migrations `0018_permissions_plots.sql` (custom), `0019_plots.sql` (generated); tests in `dataset.integration.test.ts`, `users.integration.test.ts`.

- [ ] **Step 1: Failing schema test**

```ts
describe('RFC-67 R1 plot tables', () => {
  const t = useTestDb();
  it('code is unique case-insensitively; coordinates are checked; memberships are keyed', async () => {
    await withRollback(t.db, async (tx) => {
      const code = `P-${rand()}`;
      const [plot] = await tx.insert(plots).values({ code, name: 'Plot' }).returning();
      expect(plot?.description).toBe('');
      await expect(unwrapDbError(tx.transaction((sp) => sp.insert(plots).values({ code: code.toLowerCase(), name: 'x' })))).rejects.toMatchObject({ code: '23505' });
      await expect(unwrapDbError(tx.transaction((sp) => sp.insert(plots).values({ code: `Q-${rand()}`, name: 'x', latitude: 91 })))).rejects.toMatchObject({ code: '23514' });
      const sp1 = await createSpecies(tx);
      await tx.insert(plotSpecies).values({ plotId: plot?.id as string, speciesId: sp1.id });
      await expect(unwrapDbError(tx.transaction((sp) => sp.insert(plotSpecies).values({ plotId: plot?.id as string, speciesId: sp1.id })))).rejects.toMatchObject({ code: '23505' });
      const { user } = await createUser(tx);
      await tx.insert(userPlots).values({ userId: user.id, plotId: plot?.id as string });
      expect(user.restrictToAssignedPlots).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Schema**

```ts
// plots.ts
import { sql } from 'drizzle-orm';
import { check, doublePrecision, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { species } from './taxa.ts';
import { users } from './users.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** @rfc RFC-67 R1 */
export const plots = pgTable(
  'plots',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    country: text('country'),
    biome: text('biome'),
    createdAt: ts('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('plots_code_lower_idx').on(sql`lower(${t.code})`),
    check('plots_latitude_check', sql`${t.latitude} is null or ${t.latitude} between -90 and 90`),
    check('plots_longitude_check', sql`${t.longitude} is null or ${t.longitude} between -180 and 180`),
  ],
);

/** @rfc RFC-67 R1 */
export const plotSpecies = pgTable(
  'plot_species',
  {
    plotId: uuid('plot_id').notNull().references(() => plots.id, { onDelete: 'restrict' }),
    speciesId: uuid('species_id').notNull().references(() => species.id, { onDelete: 'restrict' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.plotId, t.speciesId] }), index('plot_species_species_idx').on(t.speciesId)],
);

/** @rfc RFC-67 R1 */
export const userPlots = pgTable(
  'user_plots',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    plotId: uuid('plot_id').notNull().references(() => plots.id, { onDelete: 'restrict' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.plotId] }), index('user_plots_plot_idx').on(t.plotId)],
);

export type PlotRow = typeof plots.$inferSelect;
```

`users.ts`: `restrictToAssignedPlots: boolean('restrict_to_assigned_plots').notNull().default(false)` (import `boolean`).

- [ ] **Step 3: Migrations** — `db:generate --custom --name permissions_plots` with `INSERT INTO permissions … ('plots.manage', 'Create and edit field plots and their species') ON CONFLICT (key) DO NOTHING;` (no role row: admin only); then `db:generate --name plots` and verify the generated SQL creates the three tables, the indexes, the checks and the users column.
- [ ] **Step 4: Run schema tests; commit** — `feat(db): plots, plot_species, user_plots, users.restrict_to_assigned_plots, plots.manage (RFC-67 R1)`.

---

### Task 4: `Visibility.plotIds` and the plot predicate

**Files:** `apps/api/src/access/visibility.ts`, `visibility.integration.test.ts`, `apps/api/test/helpers/dataset.ts` (`createPlot`, `addPlotSpecies`, `assignPlots`)

**Interfaces:**
- `visibilityOf(ctx, c)` now queries `users.restrict_to_assigned_plots` and `user_plots` for `c.get('user').id`; `plotIds` is the list when restricted, else `null`.
- `speciesVisible(v, activeCol?, idCol?)` adds `and exists (select 1 from plot_species ps where ps.species_id = <idCol> and ps.plot_id = any(<plotIds>))` when `v.plotIds !== null`. Every existing caller passes `species.id` by default; callers that alias `species` (queues, summary raw SQL) pass `sql\`s.id\``.
- Test helpers:
  ```ts
  export async function createPlot(db, options: { code?: string; name?: string } = {}): Promise<{ id: string; code: string; name: string }>
  export async function addPlotSpecies(db, plotId: string, speciesIds: string[]): Promise<void>
  export async function assignPlots(db, userId: string, plotIds: string[], restricted = false): Promise<void>  // inserts user_plots, updates users.restrict_to_assigned_plots
  ```

- [ ] **Step 1: Failing test** — a plot-bound viewer (`{ inactive: false, plotIds: [plot.id] }`) sees a species in the plot and not one outside; `visibilityOf` built through a real request: assign a user to a plot with `restricted = true`, log in, call `GET /api/species?q=<outside species name>` → empty, `GET /api/species/<outside id>` → 404, and both succeed for the same user after `assignPlots(…, false)`.
- [ ] **Step 2: Implement** — `visibilityOf`: after the permission-derived value, `select restrict_to_assigned_plots, array_agg(plot_id) …` for the user; when restricted, `plotIds = ids ?? []` (an empty array hides every species — RFC-67 R6 forbids saving that state, but a stale row must still fail closed). `speciesVisible` builds `and(activePredicate, plotPredicate)`.
- [ ] **Step 3: Update the species detail / summary / records / queues raw SQL to pass the aliased id column where `species` is aliased; run the whole `api:integration` project.**
- [ ] **Step 4: Commit** — `feat(api): plot-bound visibility (RFC-33 R1, R2; RFC-67 R6)`.

---

### Task 5: Plots service and routes

**Files:** `apps/api/src/dataset/plots.ts` (+ `.integration.test.ts`), `apps/api/src/http/routes/dataset/plots.ts` (+ `.integration.test.ts`), `dataset/index.ts`, `audit/actions.ts`, `routes-guarded.integration.test.ts`

**Interfaces (produces):**

```ts
export async function listPlots(db, input: { q?: string; cursor?: string; limit: number }): Promise<{ data: Plot[]; nextCursor: string | null }>
export async function getPlot(db, id: string, opts: { withUserCount: boolean }): Promise<PlotDetail | null>
export async function listPlotSpecies(db, visibility, plotId, input: { q?; cursor?; limit }): Promise<{ data: SpeciesListItem[]; nextCursor }>   // 404 PLOT_NOT_FOUND when unknown
export async function listPlotUsers(db, plotId, input: { cursor?; limit }): Promise<{ data: PlotUser[]; nextCursor }>
export async function createPlot(db, input: CreatePlotBody & { actorId: string }): Promise<PlotDetail>       // audit plots.created
export async function updatePlot(db, id, input: UpdatePlotBody & { actorId }): Promise<PlotDetail>          // audit plots.updated { fields }
export async function addPlotSpeciesMember(db, plotId, speciesId, actorId): Promise<void>                    // 404s, 409 PLOT_SPECIES_EXISTS, audit plots.species_added { speciesId }
export async function removePlotSpeciesMember(db, plotId, speciesId, actorId): Promise<void>                 // 404 when not a member, audit plots.species_removed
```

Routes (`/api/plots`): `GET /` (`dataset.read`), `POST /` (`plots.manage`, 201), `GET /:id` (`dataset.read`; `withUserCount = currentPermissions(c).has('plots.manage')`), `PATCH /:id` (`plots.manage`), `GET /:id/species` (`dataset.read`, visibility), `GET /:id/users` (`plots.manage`), `POST /:id/species` (`plots.manage`, 201 `{ data: { ok: true } }` — or answer the plot detail; choose the detail so the species count refreshes), `DELETE /:id/species/:speciesId` (`plots.manage`, 200 detail). Append the eight routes to the meta-test list.

- [ ] **Step 1: Failing service tests** — create, code collision (`PLOT_CODE_TAKEN` on `lower(code)`), update with no change records nothing (audit count unchanged), add/remove species with audit entries, `listPlotSpecies` respects visibility (an inactive species in the plot is hidden from `RESTRICTED`), `listPlotUsers` returns `restricted` and decrypted names, unknown plot → `PLOT_NOT_FOUND`.
- [ ] **Step 2: Implement** following `catalog.ts` patterns (transaction + `recordAudit`, `isUniqueViolation` → 409). `PlotUser.email` and `name` come from `users` rows (decrypted by the column type).
- [ ] **Step 3: Route tests** — permission matrix (contributor 403 on writes, 200 on `GET /`), `userCount` null for a contributor, 201/200/404/409 shapes.
- [ ] **Step 4: Commit** — `feat(api): plots service and routes (RFC-67 R2-R5)`.

---

### Task 6: User assignment, `me.scope`, species `scope` / `plotId` / `plots`

**Files:** `apps/api/src/admin/users.ts` (`setUserPlots`, `toUser` plots), `apps/api/src/http/routes/admin/users.ts` (`PUT /:id/plots`), `apps/api/src/http/routes/auth.ts` (`me.scope`), `apps/api/src/dataset/taxa.ts` (`scope`, `plotId`, `plots` on detail), `apps/api/src/http/routes/dataset/species.ts`, tests beside each, meta-test list (`PUT /api/admin/users/:id/plots`).

**Interfaces:**
- `setUserPlots(ctx, { userId, plotIds, restrictToAssignedPlots, actor })` → `User`; 404 `USER_NOT_FOUND` / `PLOT_NOT_FOUND`; in one transaction: delete `user_plots` not in the set, insert the missing, update the flag, audit `users.plots_changed`; invalidates nothing in the permission cache (visibility is read per request).
- `userScope(db, userId)` → `{ plots: PlotRef[], restricted: boolean }` used by `me` and by `visibilityOf` (share the query).
- `searchSpecies(db, visibility, input)` gains `scope?: 'plots' | 'all'`, `plotId?: string`, `viewerPlotIds: string[]` (the viewer's assigned plots regardless of restriction, from `userScope`) — the route computes `viewerPlotIds`; the service: `plotId` → `exists plot_species for that plot` (403 `PERMISSION_DENIED` when `visibility.plotIds !== null && !visibility.plotIds.includes(plotId)`; 404 when the plot does not exist); else `scope ?? (viewerPlotIds.length > 0 ? 'plots' : 'all')`; `plots` → `exists plot_species with plot_id = any(viewerPlotIds)`; `all` with `visibility.plotIds !== null` → 403.
- `getSpecies(db, visibility, id, opts: { viewerPlotIds: string[]; allPlots: boolean })` → `plots` (RFC-67 R8).

- [ ] **Step 1: Failing tests** — admin service: assignment replaces the set and audits `{ added, removed, restricted }`; refuses `restricted` with empty set (the schema does; the service also guards, 400 `VALIDATION_FAILED` path `plotIds`); `me` carries `scope` for a user with two plots; species route matrix: (a) contributor with plots, unbound: default lists plot species only, `scope=all` lists the outside species too; (b) bound: `scope=all` → 403, `plotId=<other plot>` → 403, detail of an outside species → 404; (c) manager without plots: default `all`, `plotId=<any>` works; (d) `plots` on the detail lists the viewer's plots containing the species and every plot for an admin.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** — `feat(api): user plot assignment, me.scope, species scope and plotId (RFC-67 R6-R8, RFC-33 R6, R8)`.

---

### Task 7: Import kinds `plots`, `plot_species`, `user_plots`

**Files:** `apps/api/src/dataset/imports/plots.ts` (+ `.integration.test.ts`), three CLI files, `package.json` scripts.

**Interfaces:**
```ts
export const PLOTS_HEADER = ['plot_id', 'name', 'description', 'latitude', 'longitude', 'country', 'biome'] as const;
export const PLOT_SPECIES_HEADER = ['plot_id', 'wcvp_species'] as const;
export const USER_PLOTS_HEADER = ['user_email', 'plot_id'] as const;
export async function importPlots(db, input: { filePath; runBy; copyIdleTimeoutMs? }): Promise<ImportBatch>
export async function importPlotSpecies(db, input): Promise<ImportBatch>
export async function importUserPlots(db, input): Promise<ImportBatch>
```

- [ ] **Step 1: Failing tests** (one `it` per kind, synthetic CSVs as in plan 08a Task 8):
  - `plots`: inserts two, the second run counts both as duplicate, a row with `latitude = 'north'` → `invalid_value`, `latitude = '95'` → `invalid_value`; existing code with a different name → duplicate (not updated).
  - `plot_species`: unknown plot code → `unknown_plot`; unknown species → `unknown_species`; existing pair → duplicate; inserts the rest.
  - `user_plots`: the e-mail is matched by `email_hash` (`getPii().blindIndex(email)` in the test to build the CSV from a created user; the apply step cannot compute the hash in SQL — see Step 2); unknown e-mail → `unknown_user`; unknown plot → `unknown_plot`; an `invited` user is accepted; existing pair → duplicate.
- [ ] **Step 2: Implement** — `plots`: `insert into plots (code, name, description, latitude, longitude, country, biome) select … where not exists (lower(code) = lower(s.plot_id))`, with `latitude`/`longitude` parsed by `case when x ~ '^[+-]?[0-9]+(\.[0-9]+)?$' then x::double precision end` and range-checked in the outcome column. `plot_species`: join `plots` on `lower(code)`, `species` on normalised name. `user_plots`: the e-mail hash cannot be computed in SQL — before the transaction the command reads the CSV once in Node (streaming line reader), computes `blindIndex(email)` per row and writes a **temporary copy of the file** with an extra column `email_hash` into the scratch directory (`mkdtemp`), and stages that file with header `user_email,plot_id,email_hash`; the `apply` step joins `users.email_hash`. `raw_row` stores only `user_email` and `plot_id` (no hash). Document this in RFC-68 R11 ("the command hashes e-mails before staging").
- [ ] **Step 3: CLIs and scripts** (`import:plots`, `import:plot-species`, `import:user-plots`), each a copy of `import-species-status.ts` bound to its function.
- [ ] **Step 4: Run; commit** — `feat(api): import:plots, import:plot-species, import:user-plots (RFC-68 R9-R11)`.

---

### Task 8: Web — Admin › Plots, user page section, species scope

**Files:** listed in the file structure (web section).

- [ ] **Step 1: API layer** — `apps/web/src/api/plots.ts`: `plotKeys`, `listPlots`, `fetchPlot`, `fetchPlotSpecies`, `fetchPlotUsers`, `createPlot`, `updatePlot`, `addPlotSpecies`, `removePlotSpecies`; `admin.ts`: `setUserPlots(id, body)`; `dataset.ts`: `searchSpecies` gains `scope`, `plotId`.
- [ ] **Step 2: Failing page tests** (`PlotsPage.test.tsx`, `PlotPage.test.tsx`, `UserPlotsSection.test.tsx`, `SpeciesSearchForm.test.tsx`, `SpeciesSearchPage.test.tsx`, `AppShell.test.tsx` nav entry):
  - Plots list renders code / name / country / biome / species / users columns and the New plot button with `plots.manage`; `NoPermission` otherwise.
  - Plot page: metadata, Edit plot dialog saves `updatePlot`, Species section paginates `fetchPlotSpecies`, Add species combobox calls `addPlotSpecies`, Remove asks for confirmation (`ConfirmDialog`) then calls `removePlotSpecies`; Users section lists names with links to `/app/admin/users/$id`.
  - User page section: checkbox list of plots (from `listPlots`), the restriction checkbox disabled while no plot is checked, Save calls `setUserPlots(id, { plotIds, restrictToAssignedPlots })`.
  - Species search form: with `me.scope.plots = [A, B]` and `restricted = false`, the "Show species outside my plots" checkbox is rendered and toggles `scope` between `plots` and `all`; with `restricted = true` no checkbox; with no plots and no `plots.manage` no scope group; a Plot select lists `me.scope.plots` (or every plot from `listPlots` with `plots.manage`) and sets `plotId`.
  - Species page header: "In your plots: A, B" line when `species.plots` is non-empty.
- [ ] **Step 3: Implement** — routes `routes/app/admin/plots/index.tsx` and `$id.tsx` under the admin layout; `nav.ts` entry `{ to: '/app/admin/plots', label: 'Plots', icon: 'map', permission: 'plots.manage', section: 'admin' }` (add `map` to `Icon.tsx` — a simple 24×24 path); `PlotDialog` (create/edit; fields per `createPlotBodySchema`, validated with the shared schema, API details under fields); `PlotSpeciesSection` (table + `Combobox` over `searchSpecies({ scope: 'all', q })`); `UserPlotsSection` on `/app/admin/users/$id`; `SpeciesSearchValue` gains `scope?: 'plots' | 'all'`, `plotId?: string`; `validateSearch` of the species route accepts `scope` and `plotId` so links carry them; `ME` fixture gains `scope: { plots: [], restricted: false }`; user fixtures gain `plots: []`, `restrictToAssignedPlots: false`; species fixtures gain `plots: []`.
- [ ] **Step 4: Run web tests, lint, typecheck; commit** — `feat(web): Admin › Plots, user plot assignment, species scope toggle and plot filter (RFC-67, RFC-33 R6, R8)`.

---

### Task 9: End-to-end test, docs, close-out

- [ ] **Step 1:** `apps/e2e/tests/plots.spec.ts`: the admin creates a plot through the UI, adds a species to it, assigns a contributor to the plot **restricted**; the contributor's species page lists that species only and shows no "Show species outside my plots" checkbox; the admin unticks the restriction; after reload the contributor sees the checkbox and, ticked, the full list.
- [ ] **Step 2:** README commands for the three imports (with the file-placement note) and the Admin › Plots page in the Layout paragraph; `docs/gotchas/import.md`: "user_plots hashes e-mails in Node before staging — the CSV that reaches COPY is a temporary copy".
- [ ] **Step 3:** RFC-67 → `accepted`; RFC-33 stays `accepted` (already); spec status line.
- [ ] **Step 4:** `pnpm lint`, `pnpm typecheck`, `pnpm rfc:check`, `pnpm test`, `pnpm build`, `pnpm test:e2e -- tests/plots.spec.ts`; commit, push, PR `feat: field plots, user assignment and species scope (plan 08b)`, one CodeRabbit run.

## Self-review

- Spec §8 R1–R11 → Tasks 3, 5, 6, 7; §4 R6, R8 → Tasks 4, 6; §8 web → Task 8; §9 codes/actions/permission → Tasks 1–2; §10 tests → each task + Task 9.
- Names: `searchSpecies(db, visibility, { …, scope, plotId, viewerPlotIds })` (Task 6) is what the species route (Task 6) and the plot species list (Task 5, which calls it with `plotId`) use; `userScope(db, userId)` feeds both `me` and `visibilityOf` (Tasks 4, 6).
