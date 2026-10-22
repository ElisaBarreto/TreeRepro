# Parquet import, trees only (issue #288) Implementation Plan

**Goal:** `import:records` reads the release v1 observation table, as Parquet or CSV and by column name, keeps only tree rows with `--trees-only`, and accepts the v1 vocabularies of `outlier_flag` and `unit_harmonisation_status`.

**Spec:** `docs/specs/2026-10-22-parquet-import.md` (D1–D7). **Epic:** #286. Builds on #287 (`--sync-dictionary`).

## Global constraints

- RFC first, then a failing test, then code. No database mocks. Every new export carries `@rfc`.
- New dependencies, pinned exact and past the 7-day cooldown: `hyparquet` 1.31.4 and `hyparquet-compressors` 1.1.2 (runtime, the file is ZSTD); `hyparquet-writer` (dev, test fixtures), at a version ≥ 7 days old.
- Check the migration number against `origin/main` right before the PR.
- Run every check in the verify container.

## Tasks

1. **RFCs.** RFC-64 R1–R5, R7, R8, R10, R11; RFC-63 R1. Changelogs.
2. **Header by name.**
   - `IMPORT_COLUMNS` becomes the required set (37), with `missingColumns(header, treesOnly)` reporting missing and repeated names.
   - A unit test for each case.
   - The fixture `records-small.csv` is rewritten in v1 names, with `ID` no longer first, an extra `sheet` column and `is_tree_species`.
3. **CSV staging by name.** The staging table has the used columns plus `extra_<n>` for unknown ones; the COPY column list follows the header. Every existing import test keeps passing.
4. **Parquet staging.** `parquetCsvStream(path, columns)` (hyparquet, 100,000-row windows, CSV-escaped) feeds the same COPY; `sha256File` works on any file. Test: the fixture's rows written as Parquet with `hyparquet-writer`, and a boolean `is_tree_species`, give identical records.
5. **`--trees-only`.**
   - Migration: `import_batches.rows_filtered`.
   - Delete the non-tree rows after staging; `rows_duplicate` subtracts them.
   - CLI flag and report line; `rowsFiltered` in the contracts and in `GET /api/imports`; the web import page shows it.
6. **Vocabularies.**
   - Migration: the `outlier_flag` check takes the v1 values (`NOT VALID`), and the `unit_status` check adds `not_numeric`.
   - Update `OUTLIER_FLAGS`, `UNIT_STATUSES`, the import's R7 check and the web `OUTLIER_LABELS`.
   - Tests: a v1 flag is stored, an old one is `invalid_measurement`, and `not_numeric` is stored.
7. **Species name.** `species` comes first in the resolution, while `name_source` is still decided by `wcvp_species` and `gbif_species`. Test included.
8. **Docs.**
   - The handbook's command entries.
   - The runbook in `docs/gotchas/import.md`: the Parquet reload, the header check, the flags.
   - The API guide (`rowsFiltered`, `outlierFlag`, `unitStatus`), its changelog and the openapi hash.
   - Run the supplementary files through `prepare:imports` once.
9. **Verify** (lint, typecheck, `rfc:check`, the API and web tests), run CodeRabbit locally, then open the PR (`Closes #288`).
