# The v1 trait dictionary — Design

**Status:** approved by the owner, 2026-10-22 (epic #286, issue #287).

## Why

Release v1 of the owner's data (`Final_data_v1_Oct26`) ships a new trait dictionary, `standard_trait_dictionary_final.csv`. The v1 records are imported by trait key (#288), so the dictionary has to be loaded first. Compared with the committed `apps/api/seed/trait-dictionary.csv` (95 traits):

- **Header.** The columns are renamed: `standard_trait, broad_category, value_type, standard_unit, description, harmonised_levels`. The 25 `text` rows (`taxonomy`, `reference`, `record`) are skipped, as before.
- **Keys.** 12 traits are new and 9 are gone, most of them renames: `diaspore_dry_weight` → `diaspore_dry_mass`, `diaspore_thickness_heigth` → `diaspore_thickness_height`, `fruit_color_RBG` → `fruit_color_RGB`, `dispersal_broad_mode` → `dispersal_mode`, `lifespan` → `annual_perennial`, and so on.
- **Type.** `flowering_start`, `flowering_end`, `fruiting_start` and `fruiting_end` change from quantitative (unit `month`) to categorical, with the month names plus `variable` as levels.
- **Other changes.** Units change on 10 traits, levels on 17 (some removed, some added, `whole plant` becomes `whole_plant`), and descriptions on 6.

`seed:traits` only inserts what is missing (RFC-62 R2), and a trait's key, value type and unit are immutable while records point at it (RFC-62 R3, R6). Run as it is, the seed would add the new keys, keep the old ones, and leave the four phenology traits quantitative. The v1 file would then import its month names as `not_numeric`.

## What the owner decided

- **F1** The platform is still in its test phase. The v1 file is loaded with the total `--replace --discard-platform` (epic #286, decision 6), which empties every record, annotation and contest.
- **F2** The committed dictionary is the owner's v1 file, as delivered.

## Design

- **D1 Header** (RFC-62 R2). `seed:traits` reads the v1 header: `standard_trait, broad_category, value_type, standard_unit, description, harmonised_levels`, plus the optional seventh column `active`. The names are checked before COPY, so the old header is refused with an error that names the mismatch, rather than loaded under the wrong names. (COPY's `HEADER MATCH` would refuse it too, but a refused COPY can hang the driver, `docs/gotchas/import.md`.)
- **D1b Repeated levels.** (The owner's updated file of 2026-10-22 21:05 drops `dispersal_mode_raw`, so no level repeats any more; the rule stays.) The v1 file lists some levels of `dispersal_mode_raw` twice in different case (`aveG` and `AveG`). Levels are unique by `lower(key)` (RFC-62 R1), so the first spelling is kept, by the seed and the sync alike. `apps/api/seed/trait-dictionary.csv` becomes the owner's v1 file.
- **D2 Sync during a total replace** (new RFC-62 R9, RFC-64 R1 and R12). `import:records --replace --sync-dictionary` makes the dictionary equal to the committed file. This happens inside the replace transaction, right after the wipe of RFC-64 R12 and before the file is staged:
  - categories, traits and levels the file lists are inserted or updated: a trait's category, value type, unit, description and `active`; a level's position, and the spelling of its key;
  - traits and levels the file does not list are deleted, and so is a category with no trait left.

  This is safe only there. Every table that references a trait or a level (`trait_records`, `contests`, `contest_levels`, `reference_traits`, `species_trait_coverage`) is in R12's truncation closure, so after the wipe nothing points at them. A failure anywhere rolls the sync back with the rest of the run. `--sync-dictionary` without `--replace` is a usage error (exit 2), and `importRecords` refuses it too.
- **D3 Renames need no mapping.** Records are re-imported by key, so an old key is deleted and its new key inserted. Trait ids change; nothing stored outside the closure holds one. Cached dictionary entries (10 minutes) may name the old ids until they expire; the runbook keeps the API stopped during the reload.
- **D4 Plain `seed:traits` is unchanged**: insert only, never update or delete. Fresh installs and the test suite keep using it.
- **D5 Report.** The command prints a `Dictionary:` line with the number of traits and levels after the sync.

## Out of scope

- Migrating platform records to renamed traits (F1).
- A sync outside a total replace: once the test phase ends, the dictionary changes through the trait editors (RFC-62 R6) or a reviewed migration.

## Testing

- **Seed** (integration): the v1 header loads; the old header is refused.
- **Sync** (integration, in the isolated replace database): after a sync,
  - a trait missing from the file is gone;
  - a trait whose type, unit and description changed is updated;
  - a removed level is gone and a reordered one moved;
  - an unused category is gone.

  Plus: a sync failure rolls back the wipe; `--sync-dictionary` without `--replace` is refused by `importRecords` and by the argument parser.
- **Existing tests.** The whitespace test that used `diaspore_type`'s `whole plant` (gone in v1) uses `sexual_system`'s `hermaphrodite or monoecious` instead.
