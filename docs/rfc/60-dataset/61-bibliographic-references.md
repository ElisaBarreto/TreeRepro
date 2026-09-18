# RFC-61 — Bibliographic references

| Field | Value |
|---|---|
| Status | accepted |
| Category | dataset |
| Supersedes | — |

## Context

Every trait value is a claim made by a publication. The compiled dataset identifies publications by a citation key (`Alfaro_et_al_2023_GEB`) or by a full citation string, and distinguishes the primary reference (where the measurement was published) from the secondary reference (the compilation the row was collected from, such as `TRY` or `BIEN`).

## Rules

- **R1** Table `bibliographic_references(id uuid default uuidv7(), citation_key text unique, title text null, authors text null, year smallint null, journal text null, doi text null unique where not null, url text null, created_at timestamptz, created_by uuid null references users, kind text not null default 'publication', observer_user_id uuid null references users, short_citation text null, full_citation text null)`. The table is not named `references` because that word is reserved in SQL; the API path is `/api/references`. `short_citation` (1–200 characters) and `full_citation` (1–2,000 characters) hold a derived or written display citation (R6, R8).
- **R2** `citation_key` is the identity of a reference: the exact string the source uses, trimmed. The import creates references with the key alone; metadata is filled later through the UI (plan 07).
- **R3** A trait record names a primary reference and, when the row was taken from a compilation, a secondary reference; at least one is present (RFC-63 R2). Manual records name the primary reference, except a record that supersedes a pending record (RFC-65 R7, R9), which inherits the superseded record's references — possibly a secondary reference alone (RFC-63 R2).
- **R4** `GET /api/references?q=&cursor=&limit=&kind=&traitId=&categoryKey=` (`dataset.read`): `q` is 2–100 characters matched case-insensitively as a substring of `citation_key`, `title` or `short_citation`; `kind` filters by `publication` | `personal_observation` | `all` (default `publication`); `traitId` (uuid of a visible trait; unknown or invisible → 404 `TRAIT_NOT_FOUND`) keeps references with a `reference_traits` row for the trait (R9); `categoryKey` (existing category; unknown → 400, path `categoryKey`) keeps references with a `reference_traits` row for any visible trait of the category. order by usage — `primaryCount + secondaryCount` descending, then `id` descending — with the composite cursor `[total, id]`. Item: `{ id, citationKey, shortCitation, fullCitation, title, authors, year, journal, doi, url, createdAt, primaryCount, secondaryCount, kind, observer }`, where `primaryCount` and `secondaryCount` are the records naming the reference as primary and as secondary (a record naming the same reference in both roles counts once in each). Both counts are stored on the reference row and kept in step by a database trigger on every insert into `trait_records` (records are append-only, so they never decrease); the list orders by the stored sum, so its cost does not grow with the number of records. `GET /api/references/:id` adds `recordCount` (records naming it in either role, counted once) and `traits: [{ trait: { id, key, valueType, unit }, recordCount }]` (R9's counters, visible traits only, ordered by count); unknown id answers 404 `REFERENCE_NOT_FOUND`.
- **R5** A reference named by any record cannot be deleted (foreign keys `restrict`). No route deletes or merges references; edits are the writes of R6.
- **R6** `POST /api/references` `{ citationKey, title?, authors?, year?, journal?, doi?, url?, shortCitation?, fullCitation? }` and `PATCH /api/references/:id` (the same fields, all optional; `null` clears a metadata field; `citationKey` is never null) require `references.manage`. Limits, all trimmed: `citationKey` 1–2,000 characters, `title`, `authors`, `journal` 1–1,000, `year` an integer 1500–2100, `doi` and `url` 1–500, `shortCitation` 1–200, `fullCitation` 1–2,000. Codes: 409 `REFERENCE_KEY_TAKEN`, 409 `REFERENCE_DOI_TAKEN`, 404 `REFERENCE_NOT_FOUND`. Both answer the detail of R4 (201 on create, 200 on update); a `PATCH` whose fields all equal the stored values changes nothing; one with no field answers 400 `VALIDATION_FAILED`. Each write records `references.created` or `references.updated` in its transaction (RFC-41 R5) with `target_type = 'bibliographic_references'`, `target_id` the row id and `metadata.fields` on update.
- **R7** Personal observations. A reference of kind `personal_observation` belongs to an observer.
- **R8** DOI-created references. A reference can be created by resolving a DOI (RFC-80). When Crossref answers, `short_citation` is derived: the first author's family name alone for one author; `<family> and <family>` for two; `<family> et al.` for three or more; then ` (<year>)`; nothing when there is no author or year. `full_citation` is `<authors> (<year>). <title>. <journal>. https://doi.org/<doi>` when a title is present, where `<authors>` is the same derived string, `<year>` and `<doi>` (normalised) come from the reference row.
- **R9** Table `reference_traits(reference_id uuid references bibliographic_references restrict, trait_id uuid references traits restrict, record_count integer not null; primary key (reference_id, trait_id); index (trait_id))` — one row per reference × trait; `record_count` counts the records naming the reference in either role (primary or secondary) once per record. Maintained by the `trait_records` insert trigger (`trait_records_reference_usage()`) and backfilled by the migration (`references_enriched`), the pattern of `species_trait_coverage` (RFC-69 R2–R3).

## Open questions

None.

## Changelog

- 2026-09-13 — created.
- 2026-09-13 — accepted.
- 2026-09-13 — R4 amended (UX-02): items carry `primaryCount` and `secondaryCount`; the list is ordered by usage instead of citation key.
- 2026-09-13 — R5 amended, R6 added: reference writes and their audit (plan 07).
- 2026-09-13 — R3 amended: a record superseding a pending record inherits the superseded record's references, possibly a secondary reference alone (RFC-65 R7, R9).
- 2026-09-13 — R4 amended: `primaryCount` and `secondaryCount` are stored counters maintained by the `trait_records` insert trigger, not aggregated per request (issue #47).
- 2026-09-17 — R1, R4 amended; R7, R8 new (plan 09a).
- 2026-09-18 — R1, R4, R6, R8 amended, R9 added: `short_citation`, `full_citation`, `q` over `short_citation`, `traitId`/`categoryKey` filters, the DOI-derivation rule, `reference_traits` — migration `references_enriched` (RFC-68 R13; plan 10d).
