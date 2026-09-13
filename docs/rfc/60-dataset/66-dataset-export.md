# RFC-66 — Dataset export

| Field | Value |
|---|---|
| Status | accepted |
| Category | dataset |
| Supersedes | — |

## Context

Curators need the current accepted values as a file for analysis and publication. Handing over the whole curated dataset is a larger grant than browsing it, so the export has its own permission and every download is audited.

## Rules

- **R1** `GET /api/export/accepted.csv` requires `dataset.export`.
- **R2** One row per species and trait whose newest `accepted_values` decision is `accepted`. Columns, in order: `family, genus, species, name_source, category, trait, value, unit, level, numeric_value, primary_reference, secondary_reference, decided_at, record_id`. `value` is the record's `value_text`; `level` the level key or empty; `numeric_value` the number or empty; `primary_reference` and `secondary_reference` are citation keys (empty when absent); `decided_at` is ISO 8601 UTC. No column names a person (RFC-40).
- **R3** Rows are ordered by `family` and `genus` (nulls last), then `species`, then trait key.
- **R4** The body is RFC 4180 CSV: UTF-8 with a leading byte-order mark, CRLF row terminators, a header row, and a field quoted with `"` (inner quotes doubled) when it contains `"`, `,`, CR or LF. Headers: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="treerepro-accepted-<YYYY-MM-DD>.csv"`, `Cache-Control: no-store`.
- **R5** The response streams: rows are read through a server-side cursor in batches and written as they arrive; the file is never held in memory.
- **R6** An audit entry `dataset.exported` with `metadata: { format: 'csv', scope: 'accepted' }` is recorded before the first byte is sent; an interrupted download still counts as an export.
- **R7** Errors raised before the stream starts (401, 403) use the RFC-11 error envelope. The CSV body is the documented exception to RFC-11 R2.

## Open questions

None.

## Changelog

- 2026-09-13 — created.
- 2026-09-13 — accepted.
