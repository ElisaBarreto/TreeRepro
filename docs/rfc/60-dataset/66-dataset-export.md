# RFC-66 — Dataset export

| Field | Value |
|---|---|
| Status | draft |
| Category | dataset |
| Supersedes | — |

## Context

Curators need the dataset as files for analysis and publication: every record with its references, validations and contests. Handing over the curated dataset as files is a larger grant than browsing it, so the export has its own permission and every download is audited. The permission widens nothing, though: the archive is the viewer's slice of the dataset under RFC-33, not a publication artefact.

## Rules

- **R1** `GET /api/export/dataset.zip` requires `dataset.export`, which no seeded role stores (RFC-31 R10), so only `admin` holds it. It replaces `GET /api/export/accepted.csv`.
- **R2** The archive holds two files, both over the viewer's visibility: the route resolves `visibilityOf(ctx, c)`, and every query carries `speciesVisible`, `traitVisible` and the record visibility of RFC-33 R2, so withdrawn records never appear (RFC-63 R13). `records.csv` has one row per visible record, pending ones included with their raw value. Its columns, in order: `record_code, family, genus, species, name_source, category, trait, unit, level, value_single, value_min, value_max, value_mean, value_sd, value_n, raw_value, references, origin, intent, responds_to, contested, n_validations, n_contests, created_at`. `annotations.csv` has one row per validation (`confirm`) and per contest on a visible record, with the columns `record_code, kind, user_name, date, reference, contest_record_code`; `kind` is `validation` or `contest`. In `records.csv`: `level` is the level key or empty; the value columns print as PostgreSQL prints `numeric`, or are empty; `references` is the record's references, primary first (RFC-63 R16), joined by `; `, each printed as its citation key or as `Personal observation` for a reference of kind `personal_observation`; `responds_to` is the responded record's `record_code`; `contested` is `true` or `false` (RFC-63 R14); `n_validations` and `n_contests` are RFC-63 R8's `validationCount` and `contestCount`, which count distinct users. In `annotations.csv`: a contest row's `record_code` is the record the contest responds to and its `contest_record_code` is the contest's own code; a validation row leaves `contest_record_code` empty; `reference` is the validation's supporting reference as a citation key, or empty; `user_name` is the actor's name. User names only, never an e-mail address (RFC-02 R14, RFC-40). `created_at` and `date` are ISO 8601 UTC.
- **R3** `records.csv` rows are ordered by `family` and `genus` (nulls last), then `species`, then trait key, then `record_code`. `annotations.csv` rows are ordered by `record_code`, then `date`.
- **R4** Each file is RFC 4180 CSV: UTF-8 with a leading byte-order mark, CRLF row terminators, a header row, and a field quoted with `"` (inner quotes doubled) when it contains `"`, `,`, CR or LF. A field starting with `=`, `+`, `-`, `@`, tab, carriage return or line feed that is not a plain number is prefixed with `'`, so spreadsheet software never evaluates it as a formula. Response headers: `Content-Type: application/zip`, `Content-Disposition: attachment; filename="treerepro-dataset-<YYYY-MM-DD>.zip"`, `Cache-Control: no-store`.
- **R5** The response streams: rows are read through a server-side cursor in batches and written into the archive as they arrive. The archive uses ZIP64, so `records.csv` may exceed 4 GiB. Neither a file nor the archive is ever held in memory.
- **R6** An audit entry `dataset.exported` with `metadata: { format: 'zip', scope }` — `scope` being the request's `all` or `platform` (R9) — is recorded before the first byte is sent; an interrupted download still counts as an export.
- **R7** Errors raised before the stream starts (401, 403) use the RFC-11 error envelope. The file body is the documented exception to RFC-11 R2.
- **R8** (interim: written by plan 13e, retired by plan 13i) `GET /api/export/records.csv` (`dataset.export`) streams a single CSV of every visible record (R2's population). Its columns, in order: `family, genus, species, name_source, category, trait, value, unit, level, numeric_value, raw_value, primary_reference, secondary_reference, origin, intent, created_at, record_id`. `value` is `value_text`, and the references print as in R2. Rows follow R3's order with `record_id` as the last key. The format follows R4 with `Content-Type: text/csv; charset=utf-8` and `filename="treerepro-records-<YYYY-MM-DD>.csv"`, the streaming follows R5, and the audit follows R6 with `metadata: { format: 'csv', scope: 'records' }`. It replaces `GET /api/export/accepted.csv` until `dataset.zip` exists.
- **R9** Platform-only export. `GET /api/export/dataset.zip?scope=platform` gives `records.csv` with the `TR_` records only (RFC-63 R12) and `annotations.csv` with every validation and contest made by users, on `TR_` and `EB_` records alike. `scope` is `all` (the default, R1–R3) or `platform`; any other value answers 400 `VALIDATION_FAILED` with path `scope`. Both scopes follow R2–R7, and the audit entry carries the scope (R6). There is no scheduled copy: the daily encrypted backup already holds everything.

## Open questions

None.

## Changelog

- 2026-09-13 — created.
- 2026-09-13 — accepted.
- 2026-09-13 — R4 amended: a field starting with `=`, `+`, `-`, `@`, tab or CR that is not a plain number is prefixed with `'` (CSV formula injection guard).
- 2026-09-17 — Personal observation label in R2 (plan 09a).
- 2026-09-20 — R2 and Context: the export takes the viewer's visibility (RFC-33 R1–R3); security audit 2026-09-19, issue #118 F-01.
- 2026-09-25 — Context, R1–R7 amended: `dataset.zip` with `records.csv` and `annotations.csv` replaces `accepted.csv`, and the formula guard covers a leading line feed; R8 added: the interim single-file export of plan 13e; R9 added: the platform-only scope (record model revision R-17, R-21; plan 13a). `draft` until plan 13i.
