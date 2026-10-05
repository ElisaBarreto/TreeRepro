# The 2026-10-05 observation layout (epic #255) — Plan

**Goal:** the import reads the owner's 35-column layout, where `harmonised_value` is a measurement only and `mean` and `median` have their own columns. Records keep the row's `unit`, `summary_source` and `records_behind_row`. Every numeric summary counts a repeated study summary once and never averages across units.

**Spec:** epic #255 (the owner's decisions of 2026-10-06) and the owner's `TABLE_LAYOUT.md` (2026-10-05) in the private export folder. The rules this plan relies on are copied into **Design**, so the plan can be read without that file.

**Work:** three sub-issues of #255, one PR each, in this order. Every one goes RFC → failing test → code.

| Sub-issue | Scope | Depends on |
|---|---|---|
| #256 — Import the 35-column layout; records keep unit, summary_source, records_behind_row | O1–O5 | — |
| #257 — Summaries count a repeated study summary once | O6 | — |
| #258 — Summaries per unit | O7 | #256 (`trait_records.unit`) |

After that, the owner reloads the imported records from a release in the new layout (O8).

## Design (settled with the owner, 2026-10-06)

- **O1 Header** (RFC-64 R2). The header must be exactly these 35 columns, in this order:
  `ID,primary_reference,secondary_reference,wcvp_species,wcvp_genus,wcvp_family,gbif_species,gbif_genus,gbif_family,gbif_usage_key,original_species_name,secondary_source_species_name,original_trait_name,final_standard_trait,broad_category,original_value_clean,trait_value_type,harmonised_value,statistic,mean,median,min,max,sd,se,sample_size,summary_source,unit,unit_harmonisation_status,source_folder,file_name,wcvp_taxonomic_status,gbif_order,taxon_order,records_behind_row`.
  Any other header is `header_mismatch`, the 30-column one of 2026-09-29 included.
- **O2 Import mapping** (RFC-64 R6). On a quantitative trait:
  - `harmonised_value` → `numeric_value`, and nothing else;
  - `mean` → `mean_value`, `median` → `median_value`;
  - `min`, `max`, `sd`, `se`, `sample_size` → as before.

  A row is `harmonised` when any of single, mean, median, min or max is present. It is `empty` when the value and all seven statistic columns are empty, and `not_numeric` otherwise. `statistic` is not stored.
- **O3 Checks** (RFC-64 R7, `invalid_measurement`):
  - `statistic` may be empty or `single_or_unspecified` only. `mean`, `median` and every other label are now rejected, because those statistics have columns of their own.
  - `mean` and `median` follow the number rule, as `min` … `se` do.
  - The "value not a number while a statistic is set" check and the "spread with nothing to spread around" check count `mean` and `median` among the statistics and among the things a spread can spread around.
  - On every row, categorical rows included: a non-empty `summary_source` must be one of `reported_by_study`, `derived_from_records` or `reported_and_derived`. A non-empty `records_behind_row` must match `^[0-9]{1,10}$` and lie between 1 and 2147483647.
  - `unit` is free text and is not checked.
- **O4 Record fields** (RFC-63 R1). Migration: `trait_records` gains `unit text`, `summary_source text` (a check limits it to the three values) and `records_behind_row integer` (a check requires `>= 1`), all nullable.
  - Every record of a row stores all three from the row, split categorical parts included; each is null when empty.
  - A null `unit` means the trait's standard unit. Manual records leave all three null.
  - None of the three enters `value_text` or the claim key.
- **O5 Record API, UI, export** (RFC-63 R8, RFC-66 R2, RFC-82).
  - The record item gains `unit` (its own, or null), `summarySource` and `recordsBehindRow`.
  - The table and the drawer show a value in the record's own unit, falling back to the trait's. The drawer lists the two provenance fields.
  - In `records.csv`, `unit` becomes the record's unit, falling back to the trait's, and `summary_source` and `records_behind_row` are added after `taxon_order`.
  - The route catalog, `docs/api/guide.md` and its changelog change in the same PR (CLAUDE.md rule 10).
  - `prepare:imports` checks `sample_data.csv` against O1.
- **O6 A repeated summary counts once** (RFC-63 R10, RFC-62 R7, R8).
  - Within one species, the mean, median, min and max entries of `means` average over the distinct (primary reference, secondary reference, value) of that field. A study's summary repeated on each of its measurement rows therefore counts once.
  - `single` still averages every record, since each one is a measurement.
  - `count` and `speciesCount` are unchanged. The trait page's per-species-first averaging (RFC-62 R7) is unchanged and works on these per-species figures.
  - Known limit: two summary-only rows from the same references with an identical mean collapse into one, which is accepted.
- **O7 One summary per unit** (RFC-63 R10, RFC-62 R7, R8).
  - Records are grouped by effective unit: the record's `unit`, or the trait's when null.
  - `numeric` becomes a list `[{ unit, means, count }]` (`speciesCount` on the trait page), ordered by count descending, then unit. It is null when empty, as today.
  - The species list summary's `numeric` becomes `[{ unit, means }]`.
  - `needs_unit_check` stays out and `unit_missing` stays in, as today.
  - The Redis key of the trait distribution moves to `v3`.
- **O8 Existing data.** The migration adds nullable columns, so existing records read as being in the trait's unit, with no provenance.
  - The owner reloads with `--replace-imported` from a release in the new layout.
  - The new layout renumbers `EB_n` (more rows). #224 therefore lands first if production holds `TR_` data.

## Unchanged

- #227 item 4: on a categorical row, the statistic columns are neither stored nor checked. `statistic`, `unit_harmonisation_status`, `summary_source` and `records_behind_row` are checked on every row.
- `needs_unit_check` is excluded from summaries and `unit_missing` is included (#227 item 7).
- The import never computes a midpoint, never converts `se` to `sd`, and never fills an empty value.
