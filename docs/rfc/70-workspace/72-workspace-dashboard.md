# RFC-72 — Workspace dashboard

| Field | Value |
|---|---|
| Status | draft |
| Category | workspace |
| Supersedes | — |

## Context

The workspace landing page still says the research data arrives in a later release. A contributor arriving from an invitation needs, in one screen, what the project is, what their scope is, where data is missing in it, what awaits their validation, and what they have already done; managers and admins need the same screen to say how far the dataset is and what sits in the queues. Every number here comes from a stored counter or a small table (RFC-69), never from a scan of the whole dataset per page load.

## Rules

- **R1** `GET /api/me/dashboard` (`dataset.read`) answers `{ dataset, scope, contributor, curation }`:
  - `dataset: { speciesCount, referenceCount, recordCount, computedAt }` — global counts (active species only for `speciesCount`), cached one hour in Redis under `stats:dataset` (RFC-69 numbers).
  - `scope: { plots: [{ id, code, name, speciesCount }], speciesCount, restricted } | null` — null when the viewer has no plots.
  - `contributor: { missingCells, awaitingValidation: { count, records: [<record item>…] (≤ 20, newest first) }, topMissingTraits: [{ trait: { id, key, valueType, unit }, category: { key, label }, missingSpeciesCount }] (≤ 10, descending), summary: <RFC-71 R4> }` — the scope-dependent numbers are computed over the viewer's plot species; for a viewer without plots, `missingCells` and `awaitingValidation` are `null` and `topMissingTraits` is computed over every visible active species from the coverage table (`speciesWithData` per trait subtracted from the visible species count).
  - `curation: { coverage: { cells, withData, accepted, percentWithData, percentAccepted }, queues: { pendingGroups, disputed, contested, proposals } } | null` — present for viewers with `records.review`; `coverage` is RFC-69 R5 with no filter (cached); `pendingGroups` counts RFC-65 R8 groups, `disputed` RFC-65 R10 records, `contested` records with `intent = 'contest'` whose responded record is not withdrawn and has no accepted decision newer than the contest, `proposals` open proposals (RFC-75; 0 until plan 12c). The disputed item (RFC-65 R10 amended by plan 11b) gains `contestedBy: [{ id, valueText, createdBy }]` — the records whose contest generated the standing dispute — so the queue shows the competing value, not only the id in the generated note.
- **R2** Every list in the answer applies RFC-33 and RFC-67 (plot-bound viewers never receive species outside their plots).
- **R3** The web app renders the description of the project with `dataset` counts substituted: "TreeRepro is a collective data assembly of reproductive trait data for trees, covering traits across all reproductive stages — flower, fruits, and seeds. Its core data comes from open-source papers and data repositories spanning *N* references and *M* records over *S* species. It is shared here with a community of specialist scientists to fill gaps and validate existing records. For questions, contact elisabpereira@gmail.com." The copy lives in `apps/web/src/content/project.ts` so the owner can edit it in one place.

## Open questions

None.

## Changelog

- 2026-09-18 — created (plan 11b).
