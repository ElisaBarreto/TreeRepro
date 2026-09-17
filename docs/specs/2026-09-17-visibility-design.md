# TreeRepro — Visibility Design (plans 08a, 08b)

**Date:** 2026-09-17
**Status:** approved design; plans `2026-09-17-visibility-08a-roles.md` and `2026-09-17-visibility-08b-plots.md`
**Scope:** who sees which species and traits. The three roles of the scientific workflow as seeded system roles; an `active` flag on species with API-level enforcement; field plots with a per-user home scope and an optional hard restriction; the supplementary import conventions every later dataset reuses. RFC-33 (data visibility), RFC-67 (field plots), RFC-68 (supplementary imports), and amendments to RFC-22, RFC-30, RFC-31, RFC-32, RFC-41, RFC-50, RFC-60, RFC-62, RFC-64. Programme index: `2026-09-17-contributor-launch-overview.md`.

## 1. Context

Today every authenticated viewer with `dataset.read` sees the same catalog: every species, every trait, every record. The owner needs three things before inviting contributors:

1. Some traits are still being defined and some species are outside the current phase (other continents, unverified taxonomy). They must be invisible to contributors but visible — clearly labelled — to the admin and the managers who prepare them.
2. Contributors are recruited through field plots, each with a species list. Their default view is their plots; the admin decides per user whether they may leave that scope.
3. Roles must read as *administrator*, *manager*, *contributor* without the admin composing permissions by hand for fifty invitations.

Constraints inherited: the backend is the only authority (RFC-02); RFC → failing test → code (RFC-01); one guard class per route (RFC-32 R5); never delete (RFC-60 R5, RFC-63 R4); no PII in audit metadata (RFC-41 R7); every dataset arrives through a CLI, never a web upload.

## 2. Decisions summary

| Topic | Decision |
|---|---|
| Roles | `manager` and `contributor` are **system roles** inserted by migration with fixed `role_permissions` rows. `is_system` now means "not editable or deletable" for every system role; only `admin` keeps the "no rows = everything" semantics. |
| Viewer classes | A *viewer* is the session user of a dataset request. *Unrestricted viewer*: holds `dataset.read_inactive`. *Restricted viewer*: does not. *Plot-bound viewer*: `users.restrict_to_assigned_plots = true` (only meaningful with at least one assigned plot). |
| Species flag | `species.active boolean not null default true`. Existing rows stay active; the owner's status file deactivates. Toggled in the UI with `taxa.manage`, in bulk with `import:species-status`. |
| Trait flag | Already exists (`traits.active`, `trait_levels.active`). What changes: restricted viewers no longer receive inactive traits and levels at all; `seed:traits` reads an optional `active` column so a trait can be loaded deactivated. |
| Enforcement | Every dataset read service takes a `Visibility` value derived from the viewer's permissions and plot settings and applies it in SQL. Detail routes answer 404 for an invisible row (it does not exist for that viewer). Integration tests exercise each route with a restricted and an unrestricted viewer. |
| Plots | Tables `plots`, `plot_species`, `user_plots`; `users.restrict_to_assigned_plots`. Three CLIs load them; Admin › Plots and the user page manage them; `GET /api/auth/me` tells the web app the viewer's plots and restriction. |
| Species scope | `GET /api/species?scope=plots\|all&plotId=`. Default `plots` for a viewer with plots, `all` otherwise. A plot-bound viewer asking for `all` or for a plot they are not assigned to gets 403 `PERMISSION_DENIED`; every other read of a species outside their plots answers 404. |
| Imports | `import_batches.kind` (`records`, `species_status`, `plots`, `plot_species`, `user_plots`, later `synonyms`, `references`, `distribution`). One command per kind, the same report shape, rejects in `import_rejects` with new reasons, one audit entry `imports.completed` per batch. |
| Cache | Permission cache (RFC-32 R2) is untouched: a migration that changes a system role's rows takes effect within 5 minutes for signed-in users, immediately for new sessions. |

## 3. Roles (RFC-31 amendments, plan 08a)

- **R2 amended.** System roles: `admin` (no stored permissions, holds everything), `manager` and `contributor` (stored permissions listed in this RFC). A system role cannot be renamed, edited or deleted (409 `ROLE_IS_SYSTEM`). The migration that introduces a system role inserts it with `is_system = true` and its `role_permissions` rows; a later migration that grants a system role a new permission inserts that row and this RFC lists the change.
- **R10 (new).** Permission sets:
  - `contributor`: `dataset.read`, `records.create`, `records.annotate`, `taxa.propose` (the last one is inserted by plan 12c).
  - `manager`: the contributor set plus `dataset.read_inactive`, `records.review` (plan 09a), `records.withdraw`, `imports.read`, `contributions.read` (plan 11a), `coverage.read` (plan 11c).
- **R11 (new).** `GET /api/admin/roles` items carry `isSystem`; the web role list renders system roles read-only with their permission list (the admin one reads "every permission").

Migration `00NN_roles_system.sql` (custom, hand-written like `0004`): insert the two roles (`uuidv7()` ids, `is_system = true`) and their `role_permissions` rows for the permissions that exist at that point (`dataset.read`, `records.create`, `records.annotate`; manager adds `dataset.read_inactive`, `records.withdraw`, `imports.read`). It runs after the permissions migration of the same plan.

Invitation flow: the admin invites a user (RFC-50 R3) and assigns the `contributor` role on the user page as today (RFC-31 R6). No change to the invitation itself. A future convenience (`POST /api/admin/users { email, name, roleIds }`) is out of scope.

## 4. Data visibility (RFC-33, new)

Category access control, file `docs/rfc/30-access/33-data-visibility.md`.

### Rules

- **R1** Viewer. Every dataset read and write is evaluated for a *viewer*: the session user, their effective permissions (RFC-32 R1) and their plot settings (RFC-67). `Visibility` is the value `{ inactive: boolean, plotIds: string[] | null }`: `inactive` is true when the viewer holds `dataset.read_inactive`; `plotIds` is the viewer's assigned plots when `restrict_to_assigned_plots` is true, else `null` (no plot restriction). It is computed once per request by `visibilityOf(ctx, c)` and passed to every service call.
- **R2** A species is *visible* to a viewer when (`species.active` or `visibility.inactive`) and (`visibility.plotIds` is null or the species belongs to one of those plots). A trait is visible when `traits.active` or `visibility.inactive`. A level is visible when `trait_levels.active` or `visibility.inactive`. A record is visible when its species and its trait are visible.
- **R3** Lists omit invisible rows: `GET /api/species`, `GET /api/genera` and `GET /api/families` (a genus or family with no visible species is omitted), `GET /api/traits` (invisible traits and levels omitted; an unrestricted viewer still receives everything with `active: false` as today), `GET /api/species/:id/traits`, `GET /api/records`, `GET /api/records/pending/traits`, `GET /api/records/pending`, `GET /api/records/disputed`, `GET /api/references` counts are stored and unaffected, but `GET /api/references/:id` and its records list omit invisible records. Later RFCs (trait page, contributions, dashboard, coverage) apply the same rule.
- **R4** Detail routes answer 404 for an invisible row with the resource's code: `SPECIES_NOT_FOUND`, `TRAIT_NOT_FOUND`, `RECORD_NOT_FOUND`. The existence of an invisible row is never disclosed.
- **R5** Writes: `POST /api/records` and `POST /api/records/pending/map` on an invisible species, trait or level answer the same 404 / 400 as for an unknown one; `POST /api/records/:id/annotations` on an invisible record answers 404; `PUT /api/species/:id/traits/:traitId/accepted` needs `accepted.manage`, which only unrestricted viewers hold, so it is unaffected. Catalog writes (`taxa.manage`, `traits.manage`, `references.manage`) are unaffected: their holders are unrestricted by role design, and the API does not assume it — the services still take the visibility and a restricted holder would get 404s.
- **R6** Species scope. `GET /api/species` accepts `scope=plots|all` and `plotId=`. Default: `plots` when the viewer has at least one assigned plot, else `all`. `scope=plots` restricts the list to the species of the viewer's plots; `scope=all` lists every visible species; `plotId` restricts to one plot and ignores `scope`. A plot-bound viewer asking `scope=all`, or `plotId` of a plot they are not assigned to, answers 403 `PERMISSION_DENIED`. An unknown `plotId` answers 404 `PLOT_NOT_FOUND`.
- **R7** Representation: the species list item and detail carry `active: boolean` (RFC-60 R6, R7 amended); the trait entry already carries `active`. A restricted viewer only ever receives `true`.
- **R8** `GET /api/auth/me` carries `scope: { plots: [{ id, code, name }], restricted: boolean }` (RFC-22 R10 amended) so the web app can render the plot toggle and default the species list; it is presentation only (RFC-13 R3).
- **R9** Every service that reads species, traits, levels or records has an integration test with two viewers — one restricted, one unrestricted — over the same fixture (an inactive species with a record on an active trait, an active species with a record on an inactive trait) and asserts omission versus presence; the plot rules (R6) are tested with a plot-bound viewer, a viewer with plots but unbound, and a viewer without plots.

RFC-32 R7 is amended to: "Resource-level rules are the visibility rules of RFC-33, applied inside the services; `options.resource` stays available for future per-row checks."

### Implementation

- `apps/api/src/access/visibility.ts`: `interface Visibility`, `visibilityOf(ctx, c)` (reads `currentPermissions(c)` and the user's plot settings through one query on `users` + `user_plots`, cached in the request context), `speciesVisible(v)` / `traitVisible(v)` / `levelVisible(v)` returning Drizzle `SQL` predicates that the services `and(...)` into their `where`. A plot-bound predicate is `exists (select 1 from plot_species ps where ps.species_id = species.id and ps.plot_id = any($plotIds))`.
- Services gain a `visibility` parameter (first optional parameter after `db` becomes required — every call site is updated; tests pass `UNRESTRICTED` from `test/helpers/visibility.ts`).
- The `species` search of RFC-60 R6 gains `scope` and `plotId`; the plot predicate joins `plot_species`.
- `GET /api/traits` for a restricted viewer filters both the trait rows and their levels.

## 5. Species activation (RFC-60 amendments, plan 08a)

- **R1 amended.** `species` gains `active boolean not null default true`.
- **R6, R7 amended.** Items carry `active`. `GET /api/species` gains `status=active|inactive|all` (default `all` for an unrestricted viewer, forced to `active` for a restricted one — the parameter is ignored, not refused, so shared links work for everyone).
- **R9 amended.** `PATCH /api/species/:id` accepts `active?: boolean`; audit `taxa.updated` with `fields: ['active']`.

Migration: generated by `db:generate` (column with default); no backfill.

Web (plan 08a): `SpeciesList` rows and the species header show a grey `inactive` badge when `active === false`; the search form shows a Status select (All / Active / Inactive) only when `hasPermission(me, 'dataset.read_inactive')`; `SpeciesDialog` gains an "Active — visible to contributors" checkbox with `taxa.manage`.

## 6. Trait dictionary (RFC-62 amendments, plan 08a)

- **R2 amended.** The CSV may carry an optional seventh column `active` (`true` / `false`, default `true`, case-insensitive); `seed:traits` stores it when it inserts the trait. As before, an existing trait is never updated by the seed; activation of an existing trait is `PATCH /api/traits/:id { active }`.
- **R5 amended.** For a restricted viewer the dictionary omits inactive traits and inactive levels (RFC-33 R3); for an unrestricted viewer the response is unchanged.

`apps/api/seed/trait-dictionary.csv` is unchanged (no `active` column yet: every row stays active); the header test accepts both six- and seven-column files.

## 7. Supplementary imports (RFC-68, new; RFC-64 amendment, plan 08a)

Category dataset, file `docs/rfc/60-dataset/68-supplementary-imports.md`.

- **R1** `import_batches` gains `kind text not null default 'records'`, checked against the list `records`, `species_status`, `plots`, `plot_species`, `user_plots`, `synonyms`, `references`, `distribution` (RFC-64 R3 amended; the batch item carries `kind`). The `records` kind is RFC-64; every other kind follows this RFC.
- **R2** Every command is `pnpm --filter @treerepro/api import:<kind-with-dashes> --file <csv> [--run-by <email>]`, runs inside the API container (`docs/gotchas/docker.md` for placing the file), exits 0 on completion, 1 when refused or failed, 2 on usage. `--force` does not exist: supplementary imports are idempotent (a row already applied counts as duplicate), so re-running the same file is harmless and the SHA-256 refusal of RFC-64 R3 does not apply to them.
- **R3** The first line must equal the kind's header exactly (this RFC lists each). The file is streamed with `COPY` into a session temporary table (RFC-64 R4); names are normalised per RFC-60 R2; e-mails are matched through `email_hash` (RFC-40).
- **R4** Resolution and counts, in one transaction with the batch row: `rows_total` staged rows; `rows_inserted` rows that changed the database (a row inserted, a flag set, a field filled); `rows_duplicate` rows already in the target state; `rows_rejected` rows that reference something unknown or conflicting, each stored in `import_rejects` with the raw row and one of the new reasons `unknown_species`, `unknown_plot`, `unknown_user`, `unknown_reference`, `doi_taken`, `invalid_value`; `rows_pending` is 0. On any failure the transaction rolls back and the batch is `failed` (RFC-64 R9).
- **R5** A completed batch records one audit entry `imports.completed` (RFC-41) with `target_type = 'import_batches'`, `target_id` the batch id and `metadata: { kind, rowsTotal, rowsInserted, rowsDuplicate, rowsRejected }`; `actor_user_id` is `run_by`.
- **R6** The command prints: file and SHA-256, batch id, elapsed time, the four counts, and rejections by reason (first 30 with their row numbers).
- **R7** `GET /api/imports?kind=` filters by kind; the imports page shows the kind column and the same reject table for every kind (RFC-64 R11 amended).
- **R8** Kind `species_status`. Header `wcvp_species,active`. `active` is `true` or `false` (case-insensitive; anything else → `invalid_value`). Matches `species.canonical_name` (normalised); unknown → `unknown_species`. Sets `species.active`; a row whose value already matches is duplicate. This is one of the two kinds that changes an existing row, because its purpose is the flag.

Kinds `plots`, `plot_species`, `user_plots` are R9–R11 (section 9 below, plan 08b); `synonyms`, `references`, `distribution` come with plans 10b, 10d, 10e.

Implementation: `apps/api/src/dataset/imports/` gains a small framework used by every kind — `runSupplementaryImport(db, { kind, filePath, header, runBy, apply })` stages the file, creates the batch, calls `apply(tx, stagingTable)` which returns the counts and inserts the rejects, records the audit entry, finalises the batch; `apps/api/src/cli/import-species-status.ts` is the first command; `import-records.ts` is untouched except for `kind = 'records'`.

## 8. Field plots (RFC-67, new; plan 08b)

Category dataset, file `docs/rfc/60-dataset/67-field-plots.md`.

### Rules

- **R1** Tables (ids `uuid` default `uuidv7()`, timestamps `timestamptz` default `now()`):
  - `plots(id, code text unique, name text, description text default '', latitude double precision null, longitude double precision null, country text null, biome text null, created_at, created_by uuid null references users, updated_at)`. `code` is the owner's plot identifier (`plot_id` in the files), trimmed, 1–64 characters, unique case-insensitively (unique index on `lower(code)`). `latitude` in [−90, 90], `longitude` in [−180, 180] (checks). `country` and `biome` 1–100 characters when present.
  - `plot_species(plot_id uuid references plots restrict, species_id uuid references species restrict, created_at; primary key (plot_id, species_id); index (species_id))`.
  - `user_plots(user_id uuid references users, plot_id uuid references plots restrict, created_at; primary key (user_id, plot_id); index (plot_id))`.
  - `users.restrict_to_assigned_plots boolean not null default false` (RFC-20 R1 amended).
- **R2** A plot, a membership or an assignment is never deleted by an import; the API removes a species from a plot or a plot from a user (configuration, not scientific data) with an audit entry. A plot with memberships or assignments is never deleted; there is no delete route.
- **R3** `GET /api/plots?q=&cursor=&limit=` (`dataset.read`) lists plots by `code` then `id` (composite cursor); `q` is a 1–100 character case-insensitive prefix of `code` or substring of `name`. Item: `{ id, code, name, description, latitude, longitude, country, biome, speciesCount, createdAt, updatedAt }`. `GET /api/plots/:id` adds `userCount` (visible only to `plots.manage` holders: the route is `dataset.read` and the field is `null` for anyone else). Unknown id → 404 `PLOT_NOT_FOUND`.
- **R4** `GET /api/plots/:id/species?q=&cursor=&limit=` (`dataset.read`) lists the plot's species as species list items (RFC-60 R6, visibility applied); `GET /api/plots/:id/users?cursor=&limit=` (`plots.manage`) lists `{ id, name, email, status, restricted }` by name.
- **R5** Writes (`plots.manage`, strict bodies, audit in the same transaction): `POST /api/plots { code, name, description?, latitude?, longitude?, country?, biome? }` (409 `PLOT_CODE_TAKEN`), `PATCH /api/plots/:id` (same fields optional; `null` clears a nullable field; a `PATCH` with no field → 400; one that changes nothing records nothing), `POST /api/plots/:id/species { speciesId }` (404 `SPECIES_NOT_FOUND`; 409 `PLOT_SPECIES_EXISTS`), `DELETE /api/plots/:id/species/:speciesId` (404 when not a member). Audit actions `plots.created`, `plots.updated` (`metadata.fields`), `plots.species_added`, `plots.species_removed` (`metadata.speciesId`).
- **R6** User assignment. `PUT /api/admin/users/:id/plots { plotIds: uuid[], restrictToAssignedPlots: boolean }` (`users.update`) replaces the user's plots and sets the flag in one transaction; unknown plot → 404 `PLOT_NOT_FOUND`; audit `users.plots_changed` with `metadata: { added, removed, restricted }` (plot ids). The user representation (RFC-50 R1 amended) carries `plots: [{ id, code, name }]` and `restrictToAssignedPlots`. `restrictToAssignedPlots = true` with an empty `plotIds` is refused (400 `VALIDATION_FAILED`, path `plotIds`): a bound user with no plots would see nothing.
- **R7** The viewer's own plots come with `GET /api/auth/me` (RFC-33 R8). There is no self-service plot route.
- **R8** Species scope on `GET /api/species` is RFC-33 R6. `GET /api/species/:id` adds `plots: [{ id, code, name }]` — the plots the species belongs to among the viewer's assigned plots, or every plot it belongs to for a `plots.manage` holder (RFC-60 R7 amended).
- **R9** Kind `plots` (RFC-68). Header `plot_id,name,description,latitude,longitude,country,biome`. Inserts missing plots (matched by `lower(code)`); an existing code is duplicate (metadata is not updated; use the UI). Empty numeric cells are null; a non-numeric or out-of-range coordinate → `invalid_value`.
- **R10** Kind `plot_species`. Header `plot_id,wcvp_species`. Unknown plot → `unknown_plot`; unknown species → `unknown_species`; existing pair → duplicate.
- **R11** Kind `user_plots`. Header `user_email,plot_id`. The user is matched by e-mail hash and must exist in any status (an invited user may be assigned before accepting); unknown → `unknown_user`; unknown plot → `unknown_plot`; existing pair → duplicate. The restriction flag is not imported: the admin sets it on the user page (default `false`).

### Web (plan 08b)

- Admin › **Plots** (`/app/admin/plots`, `plots.manage`, nav icon `map`): table code / name / country / biome / species / users, search box, "New plot" dialog. Detail `/app/admin/plots/$id`: header with metadata and "Edit plot"; section Species (paginated list, "Add species" combobox over `GET /api/species?scope=all`, remove button with confirm); section Users (list with links to the user page).
- User page (`/app/admin/users/$id`): new section **Plots** — a multi-select of plots (checkbox list fed by `GET /api/plots`, searchable) and the checkbox "Restrict to assigned plots (the user never sees species outside them)"; Save calls R6.
- Species page (`/app/species`): when `me.scope.plots.length > 0` the list defaults to `scope=plots`; when `!me.scope.restricted` a checkbox **Show species outside my plots** switches to `scope=all` (URL search `scope=all`); a Plot select (the viewer's plots, or every plot for an unrestricted viewer without plots) sets `plotId`. Hidden when the viewer has no plots and no `plots.manage` (nothing to choose). The species header shows "In your plots: A, B" when applicable (from `GET /api/species/:id`, which gains `plots: [{ id, code, name }]` limited to the viewer's assigned plots — or every plot for `plots.manage` holders).
- `AppShell`: nothing new; `nav.ts` gains the Plots entry.

## 9. Error codes, audit actions, permissions

RFC-12 additions: `PLOT_NOT_FOUND` 404, `PLOT_CODE_TAKEN` 409, `PLOT_SPECIES_EXISTS` 409.

RFC-41 additions: `imports.completed`, `plots.created`, `plots.updated`, `plots.species_added`, `plots.species_removed`, `users.plots_changed`.

RFC-30 additions: `dataset.read_inactive` "See inactive species, traits and levels" (08a), `plots.manage` "Create and edit field plots and their species" (08b).

## 10. Testing

- Schema tests for the new columns, checks and indexes (`dataset.integration.test.ts` pattern).
- RFC-33 R9 two-viewer tests per read service and per route, plus the plot-scope matrix.
- RFC-31 tests: system roles exist with the exact permission sets; `updateRole` / `deleteRole` refuse them; the role list marks them.
- Import tests: one per kind with a synthetic CSV covering insert, duplicate and every reject reason; the batch row, the rejects and the audit entry; the CLI usage exit code.
- Web component tests: badge by `active`, status select by permission, plot toggle by `me.scope`, plots pages by permission, user page section.
- E2E (extends `apps/e2e`): an admin deactivates a species; a contributor session (seeded through the admin API with the `contributor` role) does not find it; a plot-bound contributor sees only their plot species and no toggle.

## 11. Out of scope

Plot polygons or maps; automatic plot assignment; contributor-visible plot pages beyond the filter; a `POST /api/admin/users` shortcut with roles; merging species.
