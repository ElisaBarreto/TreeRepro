# RFC-77 — Species summaries

| Field | Value |
|---|---|
| Status | accepted |
| Category | workspace |
| Supersedes | — |

## Context

A species' value for a trait is not the mean of its records. The owner's pipeline (EB) reduces a species' records to one summary with fixed rules: for a continuous trait, the median of the per-source medians; for a categorical trait, the state stated by the most references and how far the sources agree; one piece of evidence counts once (DECISIONS.md section 75). The platform computes the same summaries from the records it holds, so its numbers equal the owner's (`platform_package/README.md`, "The rules"; epic #286, issue #289). The species page (RFC-63 R10), the maps (RFC-76) and the export (RFC-66) use them.

The records come from the import (RFC-64), one record per observation row, except that a categorical row stating several states is split into one record per state (RFC-64 R6). They also come from platform contributions (`TR_`, RFC-65).

## Rules

- **R1** Records that count. A summary is computed over the records of one species × trait that are visible (RFC-33 R2) and `harmonised` (RFC-63 R5). A withdrawn record (RFC-63 R13), a copy of evidence (RFC-63 R17), a record pending harmonisation and a record of an invisible species or trait never count. A trait is continuous when its `value_type` is `quantitative`, and categorical when it is `categorical` (RFC-62).
- **R2** Observation. An imported record belongs to the observation of its batch and row (`import_batch_id`, `import_row_no`), so the parts of a split row are one observation again. A platform record is an observation of its own.
- **R3** Source. Each observation has one source, which gets one vote: an imported record's `source_folder`; a platform record's primary reference, which for a personal observation is the contributor's own personal-observation reference (RFC-61 R7) (owner, 2026-10-22).
- **R4** Continuous values. Each record contributes:
  - **a central value**: its `numeric_value` (the single value); if that is null and its `summary_source` is null, its own `mean_value`; if that is also null, its own `median_value`. The weight of a central value is the record's `n` when its `summary_source` is null and `n` ≥ 1, and 1 otherwise.
  - **bounds and spread**: its `min_value`, `max_value`, `sd_value` and `se_value`, each weighted by the record's `n` (1 when null), when its `summary_source` is null. When its `summary_source` is `reported_by_study`, they are the study's summary repeated on each of its measurement records, so they are taken only from the first record of each group sharing the source, `source_file`, `primary_reference_id`, trait, `unit`, `min_value`, `max_value`, `sd_value`, `se_value` and `n`. `derived_from_records` and `reported_and_derived` statistics are not taken again.

  A value is **usable** when the record's `unit_status` is not `needs_unit_check`.
- **R5** Continuous summary, one row per species × trait with at least one value:
  - `central_median` = the median of the per-source medians of the usable central values;
  - `median_of_mins` / `median_of_maxs` = the medians of the usable bounds;
  - `species_median` = `central_median` (`summary_basis` `median_of_source_medians`); else the midpoint of `median_of_mins` and `median_of_maxs` (`range_midpoint`); else whichever one exists (`single_bound`); else null (`none`);
  - `species_mean` = the weighted mean of the usable central values (`mean_basis` `central_values`); else the midpoint of the plain means of the usable minima and maxima (`range_midpoint`); else whichever exists (`single_bound`); else null (`none`);
  - `species_sd` = the weighted standard deviation of the usable central values, `sqrt(Σ w (v − m)² / Σ w)`, null under two values;
  - `species_min` / `species_max` = the lowest and highest of the usable central values and bounds;
  - `n_records` = the observations that contributed any value, usable or not; `n_sources` = their distinct sources;
  - `outlier_flags` = `unit_factor`, `trait_extreme` and/or `bounds_inverted` (joined with `;`, in that order): `unit_factor` and `trait_extreme` when any contributing record's `outlier_flag` names it on a central value or a bound, `bounds_inverted` when any contributing record's `outlier_flag` names it (owner, 2026-10-27);
  - `unit` = the trait's standard unit.

  A median is the middle value, or the mean of the two middle values. A row with no `species_median`, `species_mean`, `species_min` or `species_max` is not reported.
- **R6** Categorical summary, one row per species × trait × state, counted in references, never in records or `records_behind_row` (owner's DECISIONS.md section 75):
  - a record's **reference** is, for an imported record, its `source_folder` with its primary reference, or its secondary reference when it has no primary one (the owner's `source_folder` + `primary_reference`, else `secondary_reference`); for a platform record, its primary reference (R3);
  - a reference states the distinct levels of its records, once each, however many records state them;
  - `n_references` = the references stating the state; `n_sources` = the distinct sources (R3) of the records stating it;
  - `n_references_species_trait` / `n_sources_species_trait` = the same over every record of the species × trait, each reference and source counted once however many states it states;
  - `share_of_references` and `share_of_sources` = the state's counts over those totals (a trait's shares can add up to more than 1);
  - `n_levels` = the number of states the species has for the trait;
  - `is_main_state` = the state has the most references (ties are all main states); `main_state` = the main states joined with `;`, in key order.
- **R7** Per species × categorical trait: `main_state` and `share` (the main state's `share_of_references`, rounded to 4 decimals); `majority` = `share` ≥ 0.5; `states` = the states that are not a clear minority — a state is one only when it has under 10 % of the references **and** under 10 % of the sources; `all_states` = every state. Both lists are ordered by references, descending, then by key, and joined with `;`. `n_references` (the trait's `n_references_species_trait`) and `n_states` complete the row.
- **R8** Scope. The same computation serves one species (the species page, live, under the viewer's visibility) and every species (the weekly snapshot, RFC-76). Plot restriction (RFC-33 R6) applies to the first: summaries are trait data.
- **R9** Verification. `pnpm --filter @treerepro/api verify:summaries --expected <dir> [--trees-only]` computes every species' summaries and compares them with the owner's `species_continuous_traits_long.csv` and `species_categorical_traits_long.csv` in `<dir>`, restricted to the rows whose `is_tree_species` is TRUE when `--trees-only` is passed. It compares `species_median`, `summary_basis`, `species_mean`, `mean_basis`, `species_sd`, `species_min`, `species_max`, `n_records`, `n_sources` and `outlier_flags`, and `n_references`, `n_sources`, `n_references_species_trait`, `n_sources_species_trait`, `share_of_references`, `share_of_sources`, `n_levels_for_species_trait`, `is_main_state` and `main_state`. Numbers match within a relative 1e-9. It prints the count of compared rows, then one line per missing, extra or differing row (at most 50, then a count), and exits 1 if any. It writes nothing.

## Open questions

None.

## Changelog

- 2026-10-22 — created and accepted (epic #286, issue #289).
- 2026-10-27 — R1: a copy of evidence never counts (RFC-63 R17); R5: `outlier_flags` may name `bounds_inverted`; R6, R7: categorical support is counted in references (`n_references`, `share_of_references`, `n_references_species_trait`), with no `records_behind_row` weight; R9: the owner's renamed columns (issue #345).
