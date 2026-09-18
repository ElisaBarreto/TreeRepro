# RFC-72 — Workspace dashboard

| Field | Value |
|---|---|
| Status | accepted |
| Category | workspace |
| Supersedes | — |

## Context

The workspace landing page still says the research data arrives in a later release. A contributor arriving from an invitation needs, in one screen, what the project is, what their scope is, where data is missing in it, what awaits their validation, and what they have already done; managers and admins need the same screen to say how far the dataset is and what sits in the queues. Every number here comes from a stored counter or a small table (RFC-69), never from a scan of the whole dataset per page load.

## Rules

- **R1** `GET /api/me/dashboard` (`dataset.read`) answers `{ dataset, scope, contributor, curation }`:
  - `dataset: { speciesCount, referenceCount, recordCount, computedAt }` — global counts (active species only for `speciesCount`), cached one hour in Redis under `stats:dataset` (RFC-69 numbers).
  - `scope: { plots: [{ id, code, name, speciesCount }], speciesCount, restricted } | null` — null when the viewer has no plots.
  - `contributor: { missingCells, awaitingValidation: { count, records: [<record item>…] (≤ 20, newest first) }, topMissingTraits: [{ trait: { id, key, valueType, unit }, category: { key, label }, missingSpeciesCount }] (≤ 10, descending; a trait that no visible species misses is left out, so the list is shorter than ten, or empty, once the gaps are filled), summary: <RFC-71 R4> }` — the scope-dependent numbers are computed over the viewer's plot species; for a viewer without plots, `missingCells` and `awaitingValidation` are `null` and `topMissingTraits` is computed over every visible active species from the coverage table (`speciesWithData` per trait subtracted from the visible species count). The whole `contributor` object is cached five minutes per viewer under `dashboard:<viewer id>`; creating a record (`POST /api/records`), mapping a pending group (`POST /api/records/pending/map`, which creates records of its own), annotating a record (`POST /api/records/:id/annotations`), or changing the viewer's own plots (`PUT /api/admin/users/:id/plots`) drops it, so each shows up on that viewer's own next load rather than waiting out the cache.
  - `curation: { coverage: { cells, withData, accepted, percentWithData, percentAccepted }, queues: { pendingGroups, disputed, contested, proposals } } | null` — present for viewers with `records.review`; `coverage` is RFC-69 R5 with no filter (cached); `pendingGroups` counts RFC-65 R8 groups, `disputed` RFC-65 R10 records, `contested` records with `intent = 'contest'` whose responded record is not withdrawn and has no accepted decision newer than the contest, `proposals` open proposals (RFC-75; 0 until plan 12c). The disputed item (RFC-65 R10 amended by plan 11b) gains `contestedBy: [{ id, valueText, createdBy }]` — the records whose contest generated the standing dispute — so the queue shows the competing value, not only the id in the generated note.
- **R2** Every list in the answer applies RFC-33 and RFC-67 (plot-bound viewers never receive species outside their plots).
- **R3** The web app renders the description of the project with `dataset` counts substituted: "TreeRepro is a collective data assembly of reproductive trait data for trees, covering traits across all reproductive stages — flower, fruits, and seeds. Its core data comes from open-source papers and data repositories spanning *N* references and *M* records over *S* species. It is shared here with a community of specialist scientists to fill gaps and validate existing records. For questions, contact elisabpereira@gmail.com." The copy lives in `apps/web/src/content/project.ts` so the owner can edit it in one place.

## Open questions

None.

## Changelog

- 2026-09-18 — created (plan 11b).
- 2026-09-18 — R1: `topMissingTraits` leaves out the traits no visible species misses, so the ranking can be shorter than ten or empty; "top traits missing data" that lists a trait nothing misses is a wrong answer, and the rule was in the code before it was in the rule (plan 11b).
- 2026-09-18 — accepted.
- 2026-09-18 — R1: mapping a pending group (`POST /api/records/pending/map`) joins the list of writes that drop `dashboard:<viewer id>`; it inserts `trait_records` with `created_by = <actor>` and `origin = 'manual'`, so it is "creating a record" as R1 already meant it, and the route was the one sibling not dropping the entry (plan 11b).
- 2026-09-18 — amended: R1 names the `contributor` cache's three invalidators — record creation and annotation, and now a change to the viewer's own plots — since assigning a plot did not drop it: the dashboard could answer `scope` with the new plot while `contributor` still answered as if there were none, for up to five minutes (plan 11b).
