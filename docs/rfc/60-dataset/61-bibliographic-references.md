# RFC-61 — Bibliographic references

| Field | Value |
|---|---|
| Status | draft |
| Category | dataset |
| Supersedes | — |

## Context

Every trait value is a claim made by a publication. The compiled dataset identifies publications by a citation key (`Alfaro_et_al_2023_GEB`) or by a full citation string, and distinguishes the primary reference (where the measurement was published) from the secondary reference (the compilation the row was collected from, such as `TRY` or `BIEN`).

## Rules

- **R1** Table `bibliographic_references(id uuid default uuidv7(), citation_key text unique, title text null, authors text null, year smallint null, journal text null, doi text null unique where not null, url text null, created_at timestamptz, created_by uuid null references users)`. The table is not named `references` because that word is reserved in SQL; the API path is `/api/references`.
- **R2** `citation_key` is the identity of a reference: the exact string the source uses, trimmed. The import creates references with the key alone; metadata is filled later through the UI (plan 07).
- **R3** A trait record names a primary reference and, when the row was taken from a compilation, a secondary reference; at least one is present (RFC-63 R2). Manual records name the primary reference.
- **R4** `GET /api/references?q=&cursor=&limit=` (`dataset.read`): `q` is 2–100 characters matched case-insensitively as a substring of `citation_key` or `title`; order `citation_key` then `id`, composite cursor. Item: `{ id, citationKey, title, authors, year, journal, doi, url, createdAt }`. `GET /api/references/:id` adds `recordCount` (records naming it as primary or secondary); unknown id answers 404 `REFERENCE_NOT_FOUND`.
- **R5** A reference named by any record cannot be deleted (foreign keys `restrict`). No route deletes or edits references in plan 06.

## Open questions

None.

## Changelog

- 2026-09-13 — created.
