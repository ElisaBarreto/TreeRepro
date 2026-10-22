# The v1 observation table: Parquet import, trees only — Design

**Status:** approved by the owner, 2026-10-22 (epic #286, issue #288).

## Why

Release v1 replaces `sample_data.csv` (36 columns in a fixed order, trees only) with `observation_level_trait_values.parquet`. The new file is 247 MB, holds 7,013,914 rows for every species, and its columns are read by name (`TABLE_LAYOUT.md`, 49 columns). The `.csv` twin carries the same rows and columns. Phase 1 keeps the trees: the rows where `is_tree_species` is TRUE (1.88 M rows, 61,685 species). `import:records` refuses the file today, both because of its header and because it is Parquet.

## Facts measured on the file of 2026-10-22

- The file has 7 row groups of about 1 M rows each and uses ZSTD compression (`parquet-cpp-arrow 25.0.1`).
- Read through `hyparquet` with `hyparquet-compressors`, in windows of 100,000 rows, the whole file takes 54 s, with a peak RSS of 526 MB. No container has a memory limit.
- The file has 46 columns. `is_tree_species`, `tree_basis` and `tree_flag` are missing; the owner is regenerating it (epic decision 1).
- `outlier_flag` holds `unit_factor` (3,556 rows), `trait_extreme` (1,509) and `unit_factor;trait_extreme` (44), across all species. The check of #281 only allows `species_disagreement`, `trait_extreme` and `both`.
- `trait_value_type` holds `quantitative_or_text` or `categorical`.
- `unit_harmonisation_status` holds `not_numeric` on 103 rows, a value the import refuses today.

## Design

- **D1 Two inputs, one path** (RFC-64 R2, R4). `--file` takes `.parquet` or `.csv`, chosen by extension.
  - **Parquet:** `hyparquet` reads only the columns the import uses, in windows of 100,000 rows, and writes them as CSV text into the same `COPY … FROM STDIN` the CSV path uses. The file is never held in memory whole.
  - **CSV:** the staging table is created from the file's own header, every column `text`, so COPY loads the columns in the file's order and an extra column is simply never read.
  - The new runtime dependencies are `hyparquet` and `hyparquet-compressors` (pure JS; ZSTD and Snappy), pinned exact and past the 7-day cooldown.
- **D2 Columns by name** (RFC-64 R2). The header must contain every column the import uses, in any order. They are the 36 columns of the old layout, with `original_species_name` renamed `primary_source_species_name`, plus `species` (37), and `is_tree_species` when `--trees-only` is passed. Each missing column is named in a `header_mismatch` refusal. A name repeated in the header is `header_mismatch` too. Other columns are ignored.
- **D3 `--trees-only`** (RFC-64 R1, R3, R8, R10). Staged rows whose `is_tree_species` is not `true` (case-insensitive; Parquet booleans arrive as `true` and `false`) are removed before resolution. They are neither records nor rejects. A new counter, `import_batches.rows_filtered` (migration), holds them; the report prints it and `GET /api/imports` returns it as `rowsFiltered`. The filter is applied in SQL after staging, so the Parquet and CSV paths share it. Without the flag every row is imported.
- **D4 Species** (RFC-64 R5). The species name is the first non-empty of `species`, `wcvp_species`, `gbif_species`, `primary_source_species_name` and `secondary_source_species_name`. `name_source` is `wcvp` when `wcvp_species` is set, else `gbif` when `gbif_species` is set, else `original`. Genus, family, alternative names and references are resolved as before.
- **D5 `outlier_flag`** (RFC-64 R7, RFC-63 R1). The values become `unit_factor`, `trait_extreme` and `unit_factor;trait_extreme`, after the same trim and collapse as before. A migration replaces the check with one that is `NOT VALID`, so the records still holding the old values are left alone. The reload replaces them all; the runbook migrates and reloads in one stop. Then `OUTLIER_FLAGS`, the web badge labels and the API guide are updated.
- **D5b `unit_harmonisation_status`** (RFC-64 R7, RFC-63 R1). v1 adds `not_numeric` (103 rows: a quantitative value such as `many`). It joins the allowed values in the import check, the database check (a widening, so no data is touched) and `UNIT_STATUSES`. The summaries treat it like any status other than `needs_unit_check`: such a row carries no number anyway.
- **D6 Nothing new is stored on records.** The summaries (#289) need `source_folder`, `file_name`, the references, `unit`, the statistics, `summary_source`, `unit_harmonisation_status`, `outlier_flag` and `records_behind_row`, and all of them are already stored. The per-species tree flag waits for phase 2 (#295).
- **D7 Docs and API.**
  - RFC-64 R1, R2, R3, R5, R7, R8 and R10; RFC-63 R1.
  - The handbook's command entries.
  - `docs/gotchas/import.md`: the reload with the Parquet file mounted from `/srv/imports`, `--replace --discard-platform --sync-dictionary --trees-only`, and a header check written for Parquet.
  - The API guide: `rowsFiltered` on import batches, the new `outlierFlag` values, the changelog and the openapi hash (rule 10).
  - The supplementary files (`refs_with_citations_filtered.csv`, `PIs_per_plot_filtered.csv`, `Species_per_plot_filtered.csv`) are run through `prepare:imports` once to confirm their headers are unchanged.

## Out of scope

Every species, and a stored tree flag (#295). Computing the tree flag ourselves.

## Testing

- **Unit:** header validation by name (missing column, repeated column, extra column ignored, `is_tree_species` required only with `--trees-only`).
- **Integration:**
  - The existing fixture, rewritten in the v1 column names and in a shuffled order, imports as before.
  - The same rows written as Parquet (with `hyparquet-writer`, a dev dependency) import identically, booleans included.
  - `--trees-only` drops non-tree rows into `rows_filtered`.
  - The new `outlier_flag` values are stored, and an old value is `invalid_measurement`.
  - `species` wins over `wcvp_species` for the name, while `name_source` still says `wcvp`.
- **Web:** the badge labels for the new values.
