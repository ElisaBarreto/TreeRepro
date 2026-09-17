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
