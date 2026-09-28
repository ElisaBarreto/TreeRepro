# One field per quantity (issue #227) — Plan

**Goal:** a quantitative record holds each quantity in its own field — single, mean, median, min, max, sd, se, n — with no `statistic` label. The contributor says which field a number belongs to. A continuous value is always a new record, and validation happens only through ✓ Validate. Every numeric summary is a mean per field, averaged per species first. The import reads the owner's 30-column layout (`TABLE_LAYOUT.md`, 2026-09-27).

**Spec:** issue #227 (the decisions of #223 revisited, owner's answers of 2026-09-29) and the owner's `TABLE_LAYOUT.md` in the private export folder. The rules this plan relies on are copied into **Design** so the file is not needed.

**Work:** three sub-issues of #227, one PR each. Every one starts RFC → failing test → code, and each writes its own task-level plan when it is picked up.

| Sub-issue | Scope | Depends on |
|---|---|---|
| #232 — Value fields and the 30-column import | D1–D6, D9 | — |
| #233 — A continuous value is always a new record | D7 | — |
| #234 — Summaries: a mean per field, per species first | D8 | #232 (`median_value`) |

Then the owner reloads the imported records from a release in the new layout (D10).

## Design (settled with the owner, 2026-09-29)

- **D1 Fields** (RFC-63 R1, R15). A quantitative record has `numeric_value` (single), `mean_value`, `median_value` (new), `min_value`, `max_value`, `sd_value`, `se_value` and `n`, all nullable. The `statistic` column and `trait_records_statistic_value_check` are dropped. The user decides how to combine fields; the platform never derives one from another (no midpoint, no se→sd).
- **D2 Claim identity** (RFC-63 R3). `trait_records_claim_key` goes back to `(species_id, trait_id, value_text, raw_value, primary_reference_id, secondary_reference_id)`. A mean of 5 and a single 5 from the same source stay two records because their `value_text` differs (`mean=5` vs `5`), which keeps #227 item 1.
- **D3 `value_text`** (RFC-63 R15). Order `single, min, max, mean, median, sd, se, n`: `median` is inserted after `mean`, so every existing manual record keeps its `value_text`. The single value alone prints bare, as today.
- **D4 Header** (RFC-64 R2). Exactly these 30 columns, in order:
  `ID,primary_reference,secondary_reference,wcvp_species,wcvp_genus,wcvp_family,gbif_species,gbif_genus,gbif_family,gbif_usage_key,original_species_name,secondary_source_species_name,original_trait_name,final_standard_trait,broad_category,original_value_clean,trait_value_type,harmonised_value,statistic,sample_size,source_folder,file_name,wcvp_taxonomic_status,gbif_order,taxon_order,unit_harmonisation_status,min,max,sd,se`.
  `statistic_record_codes` is gone, and so are `folded_record_codes` and RFC-64 R15's fallback on it. Re-linking across a renumbered release is #224.
- **D5 Import mapping** (RFC-64 R6, R7). `harmonised_value` goes to the field its `statistic` names: `single_or_unspecified` or empty → `numeric_value`, `mean` → `mean_value`, `median` → `median_value`. Any other non-empty `statistic` (including `derived_midpoint`, which the layout rejected) is `invalid_measurement`. A quantitative row is `harmonised` when any of single, mean, median, min or max is present. On a categorical row the statistic columns are neither stored nor checked, while `statistic` and `unit_harmonisation_status` are checked on every row (#227 item 4, unchanged).
- **D6 Taxonomy provenance** (RFC-64 R5, RFC-63 R1). `families.order_name` is filled when empty from the first non-empty `gbif_order`, not `taxon_order`, in `row_no` order among all rows naming the family. `taxon_order` is stored on the record as provenance. `gbif_genus` and `gbif_family` are stored on the record as provenance, shown in the record drawer and exported. The platform's taxonomy stays WCVP.
- **D7 Contribution** (RFC-70 R3, R10; RFC-65 R1). A quantitative entry never matches an existing record. It always creates a record, and a quantitative contest always creates one responding to the contested record. A validation of a quantitative record is only ✓ Validate. The form keeps six fields (single, min, max, mean, SD, n): the field chosen is the contributor's statement of what the number is. An identical claim by the same author and reference still collides with the claim key and is reported in `duplicates`. Categorical entries are unchanged.
- **D8 Summaries** (RFC-62 R7, R8; RFC-63 R10). Every numeric summary is, for each of single, mean, median, min and max, the mean of that field. On the trait page (R7) the mean is taken per species first and then across species, so every species weighs the same. On a species' trait card (R10) and in the trait page's species list (R8) it is the mean over that species' records. sd, se and n are never summarised. A species has data when any value field is present. `needs_unit_check` stays out and `unit_missing` stays in (#227 item 7). The trait page's min, median and max are replaced, not kept alongside.
- **D9 Record API, UI, export** (RFC-63 R8, RFC-66 R2, RFC-82). `quantitative` gains `median`; `statistic` leaves the API; the record gains `gbifGenus`, `gbifFamily`, `taxonOrder`. The table and drawer show each field with its name. `records.csv` value columns become `value_single, value_mean, value_median, value_min, value_max, value_sd, value_se, value_n`. `statistic` and `folded_record_codes` are dropped, and `gbif_genus, gbif_family, taxon_order` are added after `taxonomic_status`. The route catalog, `docs/api/guide.md` and its changelog change in the same PR (CLAUDE.md rule 10).
- **D10 Existing data.** No in-place migration of values. After A is deployed, the owner runs `import:records --replace-imported` on a release in the new layout. Until then, an old record labelled `mean` or `median` shows its number as a single value, so the reload follows the deploy directly. If the release renumbers `EB_n` while platform (`TR_`) data exists, #224 must land first. Otherwise the re-link by `record_code` attaches annotations to the wrong rows.

## Unchanged from #223

- #227 item 4: categorical rows ignore the statistic columns.
- #227 item 7: `needs_unit_check` stays out of summaries and `unit_missing` stays in.
- The owner's explicit rulings on #223: one table, sd/se never summarised, no se→sd conversion.
