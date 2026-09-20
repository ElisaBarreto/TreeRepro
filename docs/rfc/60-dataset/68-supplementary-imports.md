# RFC-68 — Supplementary imports

| Field | Value |
|---|---|
| Status | accepted |
| Category | dataset |
| Supersedes | — |

## Context

Beyond the compiled dataset (RFC-64) the owner loads smaller files: which species are active, field plots and their species, user assignments, synonyms, enriched references, distribution. Each is a CLI command sharing one batch table, one report shape and one rejection table, so the imports page shows them all the same way.

## Rules

- **R1** `import_batches` gains `kind text not null default 'records'` checked against `records`, `species_status`, `plots`, `plot_species`, `user_plots`, `synonyms`, `references`, `distribution` (RFC-64 R3 amended; the batch item carries `kind`). The `records` kind is RFC-64; every other kind follows this RFC.
- **R2** Every command is `pnpm --filter @treerepro/api import:<kind-with-dashes> --file <csv> [--run-by <email>]`, runs inside the API container (`docs/gotchas/docker.md` for placing the file), exits 0 on completion, 1 when refused or failed, 2 on usage. There is no `--force`: supplementary imports are idempotent (a row already applied counts as duplicate), so the SHA-256 refusal of RFC-64 R3 does not apply to them.
- **R3** The first line must equal the kind's header exactly. The file is streamed with `COPY` into a session temporary table with a serial `row_no` (RFC-64 R4); names are normalised per RFC-60 R2; e-mails are matched through `email_hash` (RFC-40).
- **R4** Resolution and counts, in one transaction with the batch row: `rows_total` staged rows; `rows_inserted` rows whose final effect changed the database (a row inserted, a flag set, a field filled) — when a key repeats, only its last row can count, earlier rows are duplicate whatever they say, so a sequence `true, false, true` on an active species is three duplicates; `rows_duplicate` rows already in the target state, plus every non-winning row of a repeated key; `rows_rejected` rows that reference something unknown or conflicting, each stored in `import_rejects` with the raw row and one of the reasons `unknown_species`, `unknown_plot`, `unknown_user`, `unknown_reference`, `doi_taken`, `invalid_value` (RFC-64 R7 amended); `rows_pending` is 0; `unknown_levels` is `[]`. On any failure the transaction rolls back and the batch is `failed` (RFC-64 R9).
- **R5** A completed batch records one audit entry `imports.completed` (RFC-41) with `target_type = 'import_batches'`, `target_id` the batch id and `metadata: { kind, rowsTotal, rowsInserted, rowsDuplicate, rowsRejected }`; `actor_user_id` is `run_by`.
- **R6** The command prints: file and SHA-256, batch id, elapsed time, the four counts, and rejections by reason (the first 30 with their row numbers).
- **R7** `GET /api/imports?kind=` filters by kind; the imports page shows the kind and the same reject table for every kind (RFC-64 R11 amended).
- **R8** Kind `species_status`. Header `wcvp_species,active`. `active` is `true` or `false` (case-insensitive; anything else → `invalid_value`). The species is matched by `canonical_name` after normalisation; unknown → `unknown_species`. Sets `species.active`; a row whose value already matches is duplicate. This kind changes existing rows because its purpose is the flag. When a species appears more than once, the last row wins and the earlier rows count as duplicate.
- **R9** Kind `plots`. Header `plot_id,name,description,latitude,longitude,country,biome`. Inserts missing plots (matched by `lower(code)`); an existing code is duplicate (metadata is not updated; use the UI). Empty numeric cells are null; a non-numeric or out-of-range coordinate → `invalid_value` (RFC-67 R9).
- **R10** Kind `plot_species`. Header `plot_id,wcvp_species`. Unknown plot → `unknown_plot`; unknown species → `unknown_species`; existing pair → duplicate (RFC-67 R10).
- **R11** Kind `user_plots`. Header `user_email,plot_id`. The user is matched by e-mail hash and must exist in any status (an invited user may be assigned before accepting); e-mails are matched through the blind index, computed by the command inside the import transaction; unknown → `unknown_user`; unknown plot → `unknown_plot`; existing pair → duplicate. To prevent persisting plaintext PII (RFC-40 R1), rejected rows record `raw_row` with a masked e-mail (`a***@domain.com`) in `user_email`. The restriction flag is not imported: the admin sets it on the user page (default `false`) (RFC-67 R11).
- **R12** Kind `synonyms`. Header `wcvp_canonical_name,synonym_or_common_name,name_type,source`. The species is matched by `wcvp_canonical_name` after normalisation (RFC-60 R2); unknown → `unknown_species`. `name_type` is `synonym` or `common_<lang>` (`lang` two lowercase letters); anything else → `invalid_value`. A name equal to the species' canonical name or already stored for the species (whatever its type) → duplicate. Empty `source` → `'import'`.
- **R13** Kind `references`. Header `reference_key,short_citation,full_citation,doi,url`. The reference is matched by `citation_key`; unknown → `unknown_reference`. Fills `short_citation`, `full_citation`, `doi` and `url` only when the stored value is null (the second kind, after R8, that changes an existing row); a row that fills none of the four → duplicate. A `doi` already held by another reference → `doi_taken`; a malformed DOI (RFC-80 R1) → `invalid_value`. DOIs are normalised before storage (RFC-80 R1).

- **R14** Command `pnpm --filter @treerepro/api prepare:imports --source <dir> --out <dir> [--skip-anomalies]` turns the raw exports into the headers of R9, R10, R12, R13 and RFC-64 R2; it does not generate the `user_plots` file of R11. It reads files, never a database. Exit codes: 0 written, 1 anomalies found without `--skip-anomalies`, 2 usage. Mappings, all after the normalisation of RFC-60 R2: `Species_per_plot_filtered.csv` gives `plot-species.import.csv` (`plot.id` → `plot_id`, `wcvp_species` unchanged, rows missing either dropped, pairs distinct) and `synonyms.import.csv` (rows whose `species.cor` differs from `wcvp_species` → `wcvp_canonical_name`, `synonym_or_common_name`, `name_type` `synonym`, `source` `original.species.name`, pairs distinct); that file and `PIs_per_plot_filtered.csv` together give `plots.import.csv` (the union of plot codes, `PlotCode` split on `|`, `name` = the code, the other columns empty); `refs_with_citations_filtered.csv` gives `references.import.csv` (`secondary_reference` → both `reference_key` and `short_citation`, `Full citation` → `full_citation`, `DOI` → `doi`, `url` empty so RFC-61 R4 builds the resolver link). `sample_data.csv` is not transformed: its header is checked against RFC-64 R2 and reported. Anomalies, reported every run and never silently dropped: a plot code of digits only (reported with the date it decodes to as an Excel serial and the code that implies), a plot code outside `^[A-Z]{3}-[0-9]+$`, a blank required field, a `reference_key` appearing twice with different DOIs, and a `species.cor` resolving to more than one `wcvp_species`. An output whose input has anomalies is not written unless `--skip-anomalies`, which writes it and lists every dropped row. Today's damaged values are never hard-coded: a corrected export must flow through unchanged.

## Open questions

None.

## Changelog

- 2026-09-17 — created (plan 08a).
- 2026-09-17 — R8: the last-row-wins rule for a repeated species, and that earlier rows count as duplicate (plan 08a review).
- 2026-09-17 — accepted.
- 2026-09-17 — R4: repeated keys (CodeRabbit).
- 2026-09-17 — R9–R11: kinds plots, plot_species, user_plots (RFC-67, plan 08b).
- 2026-09-18 — R12: kind `synonyms` (RFC-60 R4, R6; plan 10b).
- 2026-09-18 — R13: kind `references` (RFC-61 R9; plan 10d).
- 2026-09-20 — R14: `prepare:imports` records the raw-export column mappings as code.
