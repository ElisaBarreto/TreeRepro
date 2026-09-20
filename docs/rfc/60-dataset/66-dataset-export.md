# RFC-66 — Dataset export

| Field | Value |
|---|---|
| Status | accepted |
| Category | dataset |
| Supersedes | — |

## Context

Curators need the current accepted values as a file for analysis and publication. Handing over the curated dataset as a file is a larger grant than browsing it, so the export has its own permission and every download is audited. The permission widens nothing, though: the file is the viewer's slice of the dataset under RFC-33, not a publication artefact — a plot-bound contributor granted `dataset.export` downloads the accepted values of their plots, and inactive species and traits appear only for a viewer who holds `dataset.read_inactive`.

## Rules

- **R1** `GET /api/export/accepted.csv` requires `dataset.export`.
- **R2** One row per species and trait whose newest `accepted_values` decision is `accepted` and whose species and trait are visible to the viewer (RFC-33 R1, R2): the route resolves `visibilityOf(ctx, c)` and the query carries `speciesVisible` and `traitVisible`, like every other dataset read; a row of an invisible species or trait is omitted, never disclosed. Columns, in order: `family, genus, species, name_source, category, trait, value, unit, level, numeric_value, primary_reference, secondary_reference, decided_at, record_id`. `value` is the record's `value_text`; `level` the level key or empty; `numeric_value` the number or empty; `primary_reference` and `secondary_reference` are citation keys (empty when absent); `primary_reference` / `secondary_reference` print `Personal observation` for a reference of kind `personal_observation`. `decided_at` is ISO 8601 UTC. No column names a person (RFC-40).
- **R3** Rows are ordered by `family` and `genus` (nulls last), then `species`, then trait key.
- **R4** The body is RFC 4180 CSV: UTF-8 with a leading byte-order mark, CRLF row terminators, a header row, and a field quoted with `"` (inner quotes doubled) when it contains `"`, `,`, CR or LF. Headers: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="treerepro-accepted-<YYYY-MM-DD>.csv"`, `Cache-Control: no-store`. A field starting with `=`, `+`, `-`, `@`, tab or carriage return that is not a plain number is prefixed with `'` so spreadsheet software never evaluates it as a formula.
- **R5** The response streams: rows are read through a server-side cursor in batches and written as they arrive; the file is never held in memory.
- **R6** An audit entry `dataset.exported` with `metadata: { format: 'csv', scope: 'accepted' }` is recorded before the first byte is sent; an interrupted download still counts as an export.
- **R7** Errors raised before the stream starts (401, 403) use the RFC-11 error envelope. The CSV body is the documented exception to RFC-11 R2.

## Open questions

None.

## Changelog

- 2026-09-13 — created.
- 2026-09-13 — accepted.
- 2026-09-13 — R4 amended: a field starting with `=`, `+`, `-`, `@`, tab or CR that is not a plain number is prefixed with `'` (CSV formula injection guard).
- 2026-09-17 — Personal observation label in R2 (plan 09a).
- 2026-09-20 — R2 and Context: the export takes the viewer's visibility (RFC-33 R1–R3); security audit 2026-09-19, issue #118 F-01.
