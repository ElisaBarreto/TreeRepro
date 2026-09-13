# RFC-60 — Taxonomy catalog

| Field | Value |
|---|---|
| Status | accepted |
| Category | dataset |
| Supersedes | — |

## Context

Every trait record (RFC-63) belongs to a species. Species names in the compiled dataset are standardized to the World Checklist of Vascular Plants (WCVP), with the GBIF name as an alternative; some rows arrive without a WCVP name, a genus or a family. The catalog keeps one row per species, its alternative names, and the genus and family it belongs to, so filters and searches never depend on free text.

## Rules

- **R1** Tables (ids `uuid` default `uuidv7()`, `created_at timestamptz` default `now()`, `created_by uuid` referencing `users` and null for rows created by the import):
  - `families(id, name text unique, created_at, created_by)`
  - `genera(id, family_id uuid null references families restrict, name text unique, created_at, created_by)`
  - `species(id, genus_id uuid null references genera restrict, canonical_name text unique, name_source text in ('wcvp', 'gbif', 'original'), created_at, created_by)`
  - `species_names(id, species_id uuid references species restrict, name text, source text default 'gbif', gbif_usage_key text null, created_at; unique (species_id, name))`
- **R2** Names are stored trimmed with internal whitespace collapsed to one space; case is preserved. Lookups during import compare the normalised strings exactly.
- **R3** The canonical name of a species is its WCVP name (`name_source = 'wcvp'`). When no WCVP name is known the GBIF name is used (`gbif`), and failing that the name given by the original source (`original`). A species whose `name_source` is not `wcvp` is an *unresolved taxon*; a species without a genus or a genus without a family is *unresolved taxonomy*. Both are reported by the API and never block an import.
- **R4** Every GBIF name that differs from the canonical name is kept in `species_names` with its GBIF usage key. Species search (R6) matches canonical and alternative names.
- **R5** A family, genus or species referenced by any other row cannot be deleted (foreign keys `restrict`). No route deletes, merges or renames taxa in plan 06.
- **R6** `GET /api/species?q=&familyId=&genusId=&unresolved=&cursor=&limit=` (`dataset.read`). `q` is 2–100 characters and matches case-insensitively as a substring of the canonical name or of any alternative name (`pg_trgm` indexes). `unresolved=true` keeps only unresolved taxa and unresolved taxonomy. Order: `canonical_name` ascending, then `id`; the cursor is a composite keyset on both (RFC-11 R6). Item: `{ id, canonicalName, nameSource, genus: { id, name } | null, family: { id, name } | null, matchedName }`, where `matchedName` is the alternative name that matched when the canonical name did not, else `null`. No per-row counts.
- **R7** `GET /api/species/:id` (`dataset.read`) returns the item plus `names: [{ name, source, gbifUsageKey }]`, `recordCount`, `traitCount` (distinct traits with at least one record) and `unresolvedTaxon` (R3, either kind); unknown id answers 404 `SPECIES_NOT_FOUND`.
- **R8** `GET /api/families?cursor=&limit=` and `GET /api/genera?familyId=&q=&cursor=&limit=` (`dataset.read`) list `{ id, name }` (genera add `family`) ordered by name then id with a composite cursor; `q` on genera is a case-insensitive prefix match of 1–100 characters.

## Data model

See R1. Indexes: unique on `families.name`, `genera.name`, `species.canonical_name`; `genera(family_id)`, `species(genus_id)`; GIN trigram on `species.canonical_name` and `species_names.name`.

## Open questions

Merging two species rows (synonyms discovered later) and WCVP/GBIF lookups when a scientist creates a species are deferred to a later RFC.

## Changelog

- 2026-09-13 — created.
- 2026-09-13 — accepted.
