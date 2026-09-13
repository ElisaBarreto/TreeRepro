# RFC-63 — Trait records and provenance

| Field | Value |
|---|---|
| Status | draft |
| Category | dataset |
| Supersedes | — |

## Context

A trait record is one claim: a reference reports that a species has a trait with a value. Sources disagree, harmonisation fails for some rows, and scientists will confirm, dispute and add claims. The owner's requirements: the original imported value is marked as such and never lost; every addition and every curation step is traceable, including intermediate states. Records are therefore insert-only; a correction is a new record plus a dispute of the old one (RFC-65), never an edit.

## Rules

- **R1** Table `trait_records`: `id uuid default uuidv7()`; `species_id uuid references species restrict`; `trait_id uuid references traits restrict`; `level_id uuid null references trait_levels restrict`; `numeric_value numeric null`; `value_text text not null` (the harmonised value as imported or entered, trimmed); `harmonisation text` (R5); `raw_value text null` (the source's `original_value_clean`); `original_trait_name text null`; `original_species_name text null`; `secondary_source_species_name text null`; `raw_category text null`; `primary_reference_id uuid null references bibliographic_references restrict`; `secondary_reference_id uuid null references bibliographic_references restrict`; `origin text in ('import', 'manual')`; `import_batch_id uuid null references import_batches restrict`; `import_row_no bigint null`; `created_by uuid null references users`; `note text null`; `created_at timestamptz default now()`.
- **R2** Check constraints: at least one of `primary_reference_id`, `secondary_reference_id` is not null; `origin = 'import'` implies `import_batch_id` and `import_row_no` not null and `created_by` null; `origin = 'manual'` implies `created_by` and `primary_reference_id` not null and `import_batch_id` null; `harmonisation = 'harmonised'` implies `level_id` or `numeric_value` not null; `level_id` and `numeric_value` are never both set.
- **R3** Claim uniqueness: `(species_id, trait_id, value_text, raw_value, primary_reference_id, secondary_reference_id)` is unique with nulls not distinct (constraint `trait_records_claim_key`). An identical claim is never stored twice; the import counts the collision as a duplicate (RFC-64 R8).
- **R4** Immutability: `UPDATE`, `DELETE` and `TRUNCATE` never succeed on `trait_records`, `record_annotations` and `accepted_values`: a trigger raises `insufficient_privilege` and the `treerepro_app` role holds neither `UPDATE` nor `DELETE` on them (`0012_dataset_append_only.sql`). Corrections are new records; retractions are annotations (RFC-65).
- **R5** Harmonisation axis, set when the record is created and never changed: `harmonised` (categorical with a `level_id`, or quantitative with a `numeric_value`), `unknown_level` (categorical, no level matches), `multi_value` (categorical, the value contains `;`), `not_numeric` (quantitative, the value is not a number per RFC-64 R6), `empty` (blank value).
- **R6** Review axis, derived when a record is read: `withdrawn` when any `withdraw` annotation exists; else `disputed` when the latest non-withdraw annotation of any actor is `dispute`; else `confirmed` when the latest annotation of any actor is `confirm`; else `unreviewed`. The accepted value of a species and trait is the newest `accepted_values` row when its decision is `accepted`, otherwise none.
- **R7** Curation tables, written by plan 07 (RFC-65) and read here: `record_annotations(id uuid default uuidv7(), record_id uuid references trait_records restrict, actor_id uuid references users, kind text in ('confirm', 'dispute', 'neutral', 'withdraw'), note text null, created_at timestamptz; check: note not null when kind in ('dispute', 'withdraw'))`; `accepted_values(id uuid default uuidv7(), species_id uuid references species restrict, trait_id uuid references traits restrict, record_id uuid null references trait_records restrict, decision text in ('accepted', 'cleared'), actor_id uuid references users, note text null, created_at timestamptz; check: record_id not null iff decision = 'accepted')`. A trigger refuses an accepted record whose species or trait differ from the row's.
- **R8** Representations. Record item: `{ id, speciesId, trait: { id, key, valueType, unit }, valueText, level: { id, key } | null, numericValue, harmonisation, review, primaryReference: { id, citationKey } | null, secondaryReference, origin, createdAt, createdBy: { id, name } | null }`. Record detail adds `rawValue, originalTraitName, originalSpeciesName, secondarySourceSpeciesName, rawCategory, note, importBatch: { id, fileName, startedAt } | null, importRowNo, annotations: [{ id, kind, note, actor: { id, name }, createdAt }], acceptedHistory: [{ id, decision, recordId, actor, note, createdAt }]` (newest first). User names are decrypted (RFC-40 R8); `dataset.read` is the permission that grants seeing them, as `audit.read` does for audit entries. Nullable fields are `null`, never omitted.
- **R9** `GET /api/records?speciesId=&traitId=&referenceId=&cursor=&limit=` (`dataset.read`): either `speciesId` and `traitId` together, or `referenceId` alone (primary or secondary); any other combination answers 400 `VALIDATION_FAILED` with detail path `speciesId`. Order `id` descending; keyset cursor on `id`. `GET /api/records/:id` returns the detail; unknown id answers 404 `RECORD_NOT_FOUND`.
- **R10** `GET /api/species/:id/traits` (`dataset.read`): `[{ category: { key, label }, traits: [{ trait, recordCount, harmonisationCounts: { harmonised, unknownLevel, multiValue, notNumeric, empty }, levels: [{ levelId, key, count }] | null, numeric: { min, median, max, count } | null, accepted: { recordId, valueText, decidedAt } | null }] }]` — categories in dictionary order, traits by key, only traits with at least one record; `levels` for categorical traits (harmonised records, count descending then key), `numeric` for quantitative traits (harmonised records; null when none); unknown species answers 404 `SPECIES_NOT_FOUND`.

## Open questions

None.

## Changelog

- 2026-09-13 — created.
