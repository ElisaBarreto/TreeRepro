# RFC-67 — Field plots

| Field | Value |
|---|---|
| Status | draft |
| Category | dataset |
| Supersedes | — |

## Context

Today every authenticated viewer with `dataset.read` sees the same catalog. Contributors are recruited through field plots, each with a species list. Their default view is their plots; the admin decides per user whether they may leave that scope. Plots are configuration, not scientific data: they have management routes and membership removal, all audited.

## Rules

- **R1** Tables (ids `uuid` default `uuidv7()`, timestamps `timestamptz` default `now()`):
  - `plots(id, code text unique, name text, description text default '', latitude double precision null, longitude double precision null, country text null, biome text null, created_at, created_by uuid null references users, updated_at)` with `plots.updated_at timestamptz not null default now()`. `code` is the owner's plot identifier (`plot_id` in the files), trimmed, 1–64 characters, unique case-insensitively via unique index `plots_code_lower_idx on (lower(code))`. Coordinates are checked by `plots_latitude_check (latitude is null or latitude between -90 and 90)` and `plots_longitude_check (longitude is null or longitude between -180 and 180)`. `country` and `biome` 1–100 characters when present.
  - `plot_species(plot_id uuid references plots restrict, species_id uuid references species restrict, created_at; primary key (plot_id, species_id); index (species_id))`.
  - `user_plots(user_id uuid references users, plot_id uuid references plots restrict, created_at; primary key (user_id, plot_id); index (plot_id))`.
  - `users.restrict_to_assigned_plots boolean not null default false` (RFC-20 R1 amended).
- **R2** A plot, a membership or an assignment is never deleted by an import; the API removes a species from a plot or a plot from a user (configuration, not scientific data) with an audit entry. A plot with memberships or assignments is never deleted; there is no delete route.
- **R3** `GET /api/plots?q=&cursor=&limit=` (`dataset.read`) lists plots by `code` then `id` (composite cursor); `q` is a 1–100 character case-insensitive prefix of `code` or substring of `name`. Item: `{ id, code, name, description, latitude, longitude, country, biome, speciesCount, createdAt, updatedAt }`. `speciesCount` is `count(*)` from `plot_species` for the plot (computed per request). `GET /api/plots/:id` adds `userCount` (visible only to `plots.manage` holders: the route is `dataset.read` and the field is `null` for anyone else). Unknown id → 404 `PLOT_NOT_FOUND`. Every viewer with `dataset.read` sees the list of plots and their species counts, plot-bound viewers included: plots are the recruitment structure, not scientific data.
- **R4** `GET /api/plots/:id/species?q=&cursor=&limit=` (`dataset.read`) lists the plot's species as species list items (RFC-60 R6, visibility applied); `GET /api/plots/:id/users?cursor=&limit=` (`plots.manage`) lists `{ id, name, email, status, restricted }` by name.
- **R5** Writes (`plots.manage`, strict bodies, audit in the same transaction): `POST /api/plots { code, name, description?, latitude?, longitude?, country?, biome? }` (409 `PLOT_CODE_TAKEN`), `PATCH /api/plots/:id` (same fields optional; `null` clears a nullable field; a `PATCH` with no field → 400; one that changes nothing records nothing), `POST /api/plots/:id/species { speciesId }` (404 `SPECIES_NOT_FOUND`; 409 `PLOT_SPECIES_EXISTS`), `DELETE /api/plots/:id/species/:speciesId` (404 when not a member). Audit actions `plots.created`, `plots.updated` (`metadata.fields`), `plots.species_added`, `plots.species_removed` (`metadata.speciesId`).
- **R6** User assignment. `PUT /api/admin/users/:id/plots { plotIds: uuid[], restrictToAssignedPlots: boolean }` (`users.update`) replaces the user's plots and sets the flag in one transaction; unknown plot → 404 `PLOT_NOT_FOUND`; audits `users.plots_changed` with `metadata: { added: [plotId...], removed: [plotId...], restricted: boolean }`. The user representation (RFC-50 R1 amended) carries `plots: [{ id, code, name }]` and `restrictToAssignedPlots`. `restrictToAssignedPlots = true` with an empty `plotIds` is refused (400 `VALIDATION_FAILED`, path `plotIds`): a bound user with no plots would see nothing.
- **R7** The viewer's own plots come with `GET /api/auth/me` (RFC-33 R8). There is no self-service plot route.
- **R8** Species scope on `GET /api/species` is RFC-33 R6. `GET /api/species/:id` adds `plots: [{ id, code, name }]` — the plots the species belongs to among the viewer's assigned plots, or every plot it belongs to for a `plots.manage` holder (RFC-60 R7 amended).
- **R9** Kind `plots` (RFC-68). Header `plot_id,name,description,latitude,longitude,country,biome`. Inserts missing plots (matched by `lower(code)`); an existing code is duplicate (metadata is not updated; use the UI). Empty numeric cells are null; a non-numeric or out-of-range coordinate → `invalid_value`.
- **R10** Kind `plot_species`. Header `plot_id,wcvp_species`. Unknown plot → `unknown_plot`; unknown species → `unknown_species`; existing pair → duplicate.
- **R11** Kind `user_plots`. Header `user_email,plot_id`. The user is matched by e-mail hash and must exist in any status (an invited user may be assigned before accepting); unknown → `unknown_user`; unknown plot → `unknown_plot`; existing pair → duplicate. The restriction flag is not imported: the admin sets it on the user page (default `false`).

## Open questions

None.

## Changelog

- 2026-09-17 — created (plan 08b).
