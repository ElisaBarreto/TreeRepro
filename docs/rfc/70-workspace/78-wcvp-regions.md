# RFC-78 — WCVP regions

| Field | Value |
|---|---|
| Status | accepted |
| Category | workspace |
| Supersedes | — |

## Context

The maps (RFC-76) show, for each WCVP / TDWG level-3 region, how many of the species native there have data for a trait. They need the World Checklist of Vascular Plants (WCVP, Kew): its accepted species, each species' native regions, and every accepted species of a region for the completeness denominator. The platform loads the two files Kew distributes, `wcvp_names.csv` and `wcvp_distribution.csv`, and keeps only what the owner's `wcvp_region_index()` keeps (`platform_package/R/region_summary_tables.R`; epic #286, issue #291). The weekly snapshot (#292) reads these tables.

## Rules

- **R1** Tables. `wcvp_species` holds one row per WCVP accepted species: `plant_name_id`, `taxon_name`, `is_tree` and `file_order` (its line in `wcvp_names.csv`). `wcvp_regions` holds one row per level-3 region: `area_code_l3` and its `name`. `wcvp_distribution` holds one row per accepted species × region where the species is native (R4). They hold the last load only. The app role reads them; only the import (R2) writes them.
- **R2** Import. `pnpm --filter @treerepro/api import:wcvp --names <wcvp_names.csv> --distribution <wcvp_distribution.csv>` reads Kew's files: pipe-separated (`|`), UTF-8, LF or CRLF line endings, a header line, no quoting (a `"` is an ordinary character). It reads both headers first and refuses, before any write, a file missing a column it needs, naming the file and the columns: `plant_name_id`, `taxon_rank`, `taxon_status`, `taxon_name` and `lifeform_description` in the names file; `plant_name_id`, `area_code_l3`, `area`, `introduced`, `extinct` and `location_doubtful` in the distribution file. Other columns are ignored. One transaction replaces the previous load wholesale, so a failure leaves the previous load in place. It prints the counts of accepted species, tree species, regions and distribution rows kept. A run is not recorded in `import_batches` (RFC-68 R1): it replaces reference data rather than adding records, and has no rows to accept or reject one by one.
- **R3** Accepted species. A names row is kept when its `taxon_status` is `Accepted`, its `taxon_rank` is `Species`, and neither its `plant_name_id` nor its `taxon_name` is blank. `taxon_name` is stored trimmed, with each run of whitespace collapsed to one space. `is_tree` is true when `lifeform_description` contains, ignoring case, the whole word `tree` (`shrub or tree` is a tree, `treelet` is not), or `arborescent`, or `phanerophyte`; a blank `lifeform_description` is not a tree. The flag serves only the trees completeness denominator.
- **R4** Distribution. A distribution row is kept when its `area_code_l3` is not blank, its `plant_name_id` is a kept accepted species (R3), and none of `introduced`, `extinct` and `location_doubtful` is `1`: native, extant and non-doubtful occurrences only. The code is upper-cased first (WCVP v15 has a few lower-case codes, such as `nep` for Nepal). A species × region pair is stored once.
- **R5** Regions. Every upper-cased, non-blank `area_code_l3` of the distribution file is a region, whether or not a kept row uses it. Its name is the first non-blank `area` given for the code in file order, or the code itself if none is.
- **R6** Matching. A platform species matches the WCVP accepted species whose `taxon_name` equals the species' `canonical_name`, both trimmed with whitespace collapsed (R3). A name shared by two accepted species matches the first in WCVP file order (`file_order`). A species with no match (a GBIF-only or Unplaced name) has no region and appears in no map; its species summary (RFC-77) is unaffected. The view `wcvp_species_match (species_id, plant_name_id)` answers this rule, one row per matched species.

## Open questions

None.

## Changelog

- 2026-10-23 — created and accepted (epic #286, issue #291).
