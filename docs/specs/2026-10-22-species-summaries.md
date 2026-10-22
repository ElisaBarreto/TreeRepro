# Species summaries — Design

**Status:** approved by the owner, 2026-10-22 (epic #286, issue #289). The rules are RFC-77.

## Why

The owner's species values (the median of per-source medians, the main categorical state, and so on) come from fixed EB rules (`platform_package/R`). The platform must compute the same numbers from its own records, for the species page (#290), the maps (#292, #293) and the export (#294), with no R at runtime (epic decision 3).

## What the owner decided

- **O1** The regenerated v1 file has no mixed units, so the EB rules apply as they are: no per-unit split.
- **O2** Each source has one vote. A platform record's source is its reference, or the contributor for a personal observation.

## Design

- **D1 One module, one SQL pass per kind.** `apps/api/src/dataset/species-summary.ts` exports `continuousSummaries(db, visibility, speciesIds | null)` and `categoricalSummaries(...)`. Each is one SQL statement with CTEs (`percentile_cont(0.5)` for medians), so 61,685 species cost one scan of `trait_records`. `speciesTraitStates(rows)` derives the per-trait row of RFC-77 R7 in TypeScript.
- **D2 Observation and source** (RFC-77 R2, R3).
  - The observation key is `import_batch_id:import_row_no` for an imported record, and the record id otherwise.
  - The source is `source_folder` for an imported record, and `ref:<primary_reference_id>` for a platform one.
- **D3 Harmonised records only** (RFC-77 R1). A record pending harmonisation (an `unknown_level` state) does not count, so every viewer sees summaries over the same records. If the owner's file holds states outside the dictionary, `verify:summaries` shows them as differences.
- **D4 `verify:summaries`** (RFC-77 R9) streams the owner's two long CSVs line by line, with the header parser the importer already has. The 313 MB file is never loaded whole. The files are private and never committed.

## Out of scope

Showing the summaries (#290), the snapshot (#292), the export (#294).

## Testing

Integration tests import a small v1 CSV per rule into the shared test database (each with its own species tag) and assert the summary:
- the median of source medians against the plain median;
- the range midpoint and single bound;
- the weighted mean and sd;
- a study's summary used once;
- `derived_from_records` not reused;
- `needs_unit_check` counted but not used;
- outlier flags;
- a categorical split row counted once in the totals;
- `records_behind_row` weights;
- main-state ties;
- the majority, and the minority rule;
- a platform record's source, and a withdrawn record left out.

Unit tests cover the verification parser and comparator.
