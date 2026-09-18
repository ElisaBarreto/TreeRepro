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
  - `species(id, genus_id uuid null references genera restrict, canonical_name text unique, name_source text in ('wcvp', 'gbif', 'original'), active boolean not null default true, trait_count integer not null default 0, created_at, created_by)`
  - `species_names(id, species_id uuid references species restrict, name text, source text default 'gbif', gbif_usage_key text null, created_at; unique (species_id, name))`
- **R2** Names are stored trimmed with internal whitespace collapsed to one space; case is preserved. Lookups during import compare the normalised strings exactly.
- **R3** The canonical name of a species is its WCVP name (`name_source = 'wcvp'`). When no WCVP name is known the GBIF name is used (`gbif`), and failing that the name given by the original source (`original`). A species whose `name_source` is not `wcvp` is an *unresolved taxon*; a species without a genus or a genus without a family is *unresolved taxonomy*. Both are reported by the API and never block an import.
- **R4** Every GBIF name that differs from the canonical name is kept in `species_names` with its GBIF usage key. Species search (R6) matches canonical and alternative names.
- **R5** A family, genus or species referenced by any other row cannot be deleted (foreign keys `restrict`). No route deletes or merges taxa; renames and reassignments are the writes of R9.
- **R6** `GET /api/species?q=&familyId=&genusId=&unresolved=&status=&scope=&plotId=&categoryKey=&traitId=&traitData=&sort=&cursor=&limit=` (`dataset.read`; visibility RFC-33 R3). `q` is 2–100 characters and matches case-insensitively as a substring of the canonical name or of any alternative name (`pg_trgm` indexes). `unresolved=true` keeps only unresolved taxa and unresolved taxonomy. `traitId` (uuid of a visible trait; unknown or invisible → 404 `TRAIT_NOT_FOUND`) with `traitData=with` (default) keeps species that have a coverage row (RFC-69 R1) for the trait; `traitData=missing` keeps species with none. `categoryKey` (existing category; unknown → 400, path `categoryKey`) without `traitId`: `with` keeps species with a coverage row for any visible trait of the category; `missing` keeps species with none. With `traitId`, `categoryKey` must be the trait's category (400 otherwise). `sort=name` (default) is the current order — `canonical_name` ascending, then `id`, with the same composite keyset cursor (RFC-11 R6); `sort=completeness` orders by `trait_count` ascending, then `canonical_name` ascending, then `id` ascending, with the composite cursor `[trait_count, canonical_name, id]`. Item: `{ id, canonicalName, nameSource, active, genus: { id, name } | null, family: { id, name } | null, matchedName, unresolvedTaxon, traitCount, traitRecordCount }`, where `matchedName` is the alternative name that matched when the canonical name did not, else `null`, `unresolvedTaxon` is the R3 flag (either kind), `traitCount` is `species.trait_count`, and `traitRecordCount` is `null` unless `traitId` is given, in which case it is the coverage `record_count`, `0` in missing mode. `status` is `active`, `inactive` or `all` (default `all`); a restricted viewer (RFC-33 R1) gets `active` whatever the parameter says — the parameter is ignored, not refused, so a shared link works for everyone. `scope` (`plots` or `all`) and `plotId` filter by plot membership per RFC-33 R6.
- **R7** `GET /api/species/:id` (`dataset.read`) returns the item (R6) plus `names: [{ name, source, gbifUsageKey }]`, `plots: [{ id, code, name }]` (the plots the species belongs to among the viewer's assigned plots, or every plot it belongs to for a `plots.manage` holder, RFC-67 R8), `recordCount` and `traitCount` (distinct traits with at least one record); unknown id answers 404 `SPECIES_NOT_FOUND`. An invisible species (RFC-33 R2) answers 404 `SPECIES_NOT_FOUND`.
- **R8** `GET /api/families?cursor=&limit=` and `GET /api/genera?familyId=&q=&cursor=&limit=` (`dataset.read`) list `{ id, name }` (genera add `family`) ordered by name then id with a composite cursor; `q` on genera is a case-insensitive prefix match of 1–100 characters.
- **R9** Writes require `taxa.manage`; bodies are strict JSON; names are 1–200 characters normalised per R2; nothing is deleted. `POST /api/families` `{ name }` and `PATCH /api/families/:id` `{ name }` answer `{ id, name }` (409 `FAMILY_NAME_TAKEN`; 404 `FAMILY_NOT_FOUND`). `POST /api/genera` `{ name, familyId? }` and `PATCH /api/genera/:id` `{ name?, familyId? }` — `familyId: null` detaches the genus — answer the genus item of R8 (409 `GENUS_NAME_TAKEN`; 404 `GENUS_NOT_FOUND`, `FAMILY_NOT_FOUND`). `POST /api/species` `{ canonicalName, nameSource, genusId? }` and `PATCH /api/species/:id` `{ canonicalName?, nameSource?, genusId?, active? }` — `genusId: null` detaches — answer the species detail of R7 (409 `SPECIES_NAME_TAKEN`; 404 `SPECIES_NOT_FOUND`, `GENUS_NOT_FOUND`); audit `fields` may contain `active`. `POST /api/species/:id/names` `{ name, gbifUsageKey? }` (`gbifUsageKey` 1–64 characters) adds an alternative name with `source = 'gbif'` and answers the species detail; 409 `SPECIES_NAME_TAKEN` when the name equals the species' canonical name or one of its alternative names. Creates answer 201, updates 200. A `PATCH` whose fields all equal the stored values changes nothing and records nothing; a `PATCH` with no field answers 400 `VALIDATION_FAILED`.
- **R10** Every write of R9 records an audit entry in its transaction (RFC-41 R5): `taxa.created` or `taxa.updated`; `target_type` is the table (`families`, `genera`, `species`, `species_names`), `target_id` the row id; `metadata.kind` is `family`, `genus`, `species` or `species_name`; `metadata.fields` lists the changed fields on an update; `metadata.speciesId` accompanies a name. Names never enter the metadata.

## Data model

See R1. Indexes: unique on `families.name`, `genera.name`, `species.canonical_name`; `genera(family_id)`, `species(genus_id)`, `species(trait_count, canonical_name, id)` (the completeness order of R6); GIN trigram on `species.canonical_name` and `species_names.name`.

## Open questions

Merging two species rows (synonyms discovered later) and WCVP/GBIF lookups when a scientist creates a species are deferred to a later RFC.

## Changelog

- 2026-09-13 — created.
- 2026-09-13 — accepted.
- 2026-09-13 — R5–R7 amended, R9–R10 added: catalog writes and their audit (RFC-65, plan 07).
- 2026-09-17 — R1, R6, R7, R9: species.active, status filter, visibility (RFC-33, plan 08a).
- 2026-09-17 — R6 scope, plotId; R7 plots on species detail (RFC-67 R8, RFC-33 R6, plan 08b).
- 2026-09-18 — R1, R6: trait_count, trait filters and completeness order (RFC-69, plan 10a).
