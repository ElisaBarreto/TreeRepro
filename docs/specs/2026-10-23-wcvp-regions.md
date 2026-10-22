# WCVP regions — Design

**Status:** approved by the owner, 2026-10-23 (epic #286, issue #291). The rules are RFC-78.

## Why

The weekly region tables behind the maps (#292) need WCVP v15: the accepted species, their native level-3 regions (the numerator) and every accepted species of a region (the completeness denominator). The platform has no WCVP data today. The owner's `wcvp_region_index()` (`platform_package/R/region_summary_tables.R`) says what to keep; this ports it to SQL, with no R at runtime (epic decision 3).

## Design

- **D1 Three tables, last load only** (RFC-78 R1): `wcvp_species`, `wcvp_regions`, `wcvp_distribution`, with foreign keys from the distribution to the other two. No history: a new WCVP release replaces the old one.
- **D2 COPY into staging, then SQL** (RFC-78 R2). `apps/api/src/dataset/wcvp.ts` reads each header, checks the needed columns, and streams the file through `COPY … (FORMAT csv, DELIMITER '|', HEADER true, QUOTE E'\x01')` into a temporary table with one text column per header column (`c1` … `cN`, so no file-supplied name becomes an identifier). Kew's files do not quote fields but contain bare `"` (e.g. `Bol. Mus. Paraense "Emilio Goeldi"`), which CSV mode would read as a quote; `\x01`, absent from both files, turns quoting off. The staging row number is the file order. Every COPY goes through `pipelineWithIdleGuard` (docs/gotchas/import.md).
- **D3 One transaction, TRUNCATE + INSERT … SELECT.** The three tables are truncated together and refilled from staging. The migration grants `TRUNCATE` on them to `treerepro_app` (the runtime role, which runs the CLI), as the default privileges stop at DML. A failure rolls back to the previous load.
- **D4 No import batch** (RFC-78 R2). An `import_batches` row needs a new kind (a check migration, `IMPORT_BATCH_KINDS` and a web label) for a run that has no row-level outcome; the CLI prints its counts instead.
- **D5 Matching as a view** (RFC-78 R6). `wcvp_species_match (species_id, plant_name_id)`: `distinct on (species.id)`, ordered by `file_order`, joining on the collapsed name. #292 joins it to `wcvp_distribution`. `wcvp_species.taxon_name` is stored collapsed, so only the species side is normalised in the view.
- **D6 Upper-cased codes, first non-blank name** (RFC-78 R4, R5). As the owner's script does since DECISIONS.md section 73 (`nep` → `NEP`). Real v15: six lower-case codes, all with an upper-case twin, and 1,318 rows with no code, dropped.

## Out of scope

The snapshot and the region tables themselves (#292); distribution by country on the species page (#77).

## Testing

Integration tests (testcontainers, as `treerepro_app`) write tiny pipe-separated files: accepted, synonym and infraspecific rows; `tree`, `shrub or tree`, `treelet`, `Arborescent`, `phanerophyte`; a field with a bare `"`; introduced, extinct and doubtful occurrences; a duplicate occurrence; a lower-case code; a region with no name. They cover a header missing a column refused before any write, a re-run replacing the previous load, a failed run leaving it, and the matching view (exact name, whitespace, homonym order, unmatched). The real v15 files are loaded once in a scratch database before the PR.
