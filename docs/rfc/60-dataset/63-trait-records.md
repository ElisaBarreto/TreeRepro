# RFC-63 — Trait records and provenance

| Field | Value |
|---|---|
| Status | accepted |
| Category | dataset |
| Supersedes | — |

## Context

A trait record is one claim: a reference reports that a species has a trait with a value. Sources disagree, harmonisation fails for some rows, and scientists will confirm, dispute and add claims. The owner's requirements: the original imported value is marked as such and never lost; every addition and every curation step is traceable, including intermediate states. Records are therefore insert-only; a correction is a new record plus a dispute of the old one (RFC-65), never an edit.

## Rules

- **R1** A trait record has `intent`, `responds_to_record_id`, `species_id`, `trait_id`, `level_id`, `numeric_value`, `value_text`, `harmonisation`, `raw_value`, `original_trait_name`, `original_species_name`, `secondary_source_species_name`, `raw_category`, `primary_reference_id`, `secondary_reference_id`, `origin`, `import_batch_id`, `import_row_no`, `created_by`, `note`, `supersedes_record_id`, `created_at`.
- **R2** Inserts are via `intent` null iff `responds_to_record_id` null; a trigger refuses a response to a record of another species or trait. Checks apply per origin and harmonisation.
- **R3** Claim uniqueness: `(species_id, trait_id, value_text, raw_value, primary_reference_id, secondary_reference_id)` is unique with nulls not distinct (constraint `trait_records_claim_key`). An identical claim is never stored twice; the import counts the collision as a duplicate (RFC-64 R8).
- **R4** Immutability: `UPDATE`, `DELETE` and `TRUNCATE` never succeed on `trait_records`, `record_annotations` and `accepted_values`: a trigger raises `insufficient_privilege` and the `treerepro_app` role holds neither `UPDATE` nor `DELETE` on them (`0012_dataset_append_only.sql`). Corrections are new records; retractions are annotations (RFC-65). The one sanctioned exception is RFC-64 R12, a replacing import: it runs as `treerepro_migrator`, disables these triggers inside its transaction and restores them there. `treerepro_app` never holds `UPDATE` or `DELETE` on these tables, so the guarantee is unchanged for the application.
- **R5** Harmonisation axis, set when the record is created and never changed: `harmonised` (categorical with a `level_id`, or quantitative with a `numeric_value`), `unknown_level` (categorical, no level matches), `not_numeric` (quantitative, the value is not a number per RFC-64 R6), `empty` (blank value). `multi_value` remains a valid stored status for records created before this rule, but is never produced: a categorical value containing `;` reports several states and is split into one record per part (RFC-64 R6).
- **R6** Review axis, derived when a record is read: `withdrawn` when any `withdraw` annotation exists; else `disputed` when the latest non-withdraw annotation of any actor is `dispute`; else `confirmed` when the latest annotation of any actor is `confirm`; else `unreviewed`. The accepted value of a species and trait is the newest `accepted_values` row when its decision is `accepted`, otherwise none.
- **R7** A record has many `record_annotations` (with `reference_id` and `generated`), written by plan 07 (RFC-65) and read here. `accepted_values` are also tracked.
- **R8** `GET /api/records/:id` The item exposes `intent`, `respondsTo`. The detail exposes `responses`. An annotation exposes `reference`, `generated`.
- **R9** `GET /api/records?speciesId=&traitId=&referenceId=&cursor=&limit=` (`dataset.read`): either `speciesId` and `traitId` together, or `referenceId` alone (primary or secondary); any other combination answers 400 `VALIDATION_FAILED` with detail path `speciesId`. Order `id` descending; keyset cursor on `id`. `GET /api/records/:id` returns the detail; unknown id answers 404 `RECORD_NOT_FOUND`.
- **R10** `GET /api/species/:id/traits` supports `includeMissing`. It answers `[{ category: { key, label }, traits: [{ trait, recordCount, harmonisationCounts: { harmonised, unknownLevel, multiValue, notNumeric, empty }, levels: [{ levelId, key, count }] | null, numeric: { min, median, max, count } | null, accepted: { recordId, valueText, decidedAt } | null }] }]` — categories in dictionary order, traits by key, only traits with at least one record; `levels` for categorical traits (harmonised records, count descending then key), `numeric` for quantitative traits (harmonised records; null when none); unknown species answers 404 `SPECIES_NOT_FOUND`.

## Open questions

None.

## Changelog

- 2026-09-13 — created.
- 2026-09-13 — accepted.
- 2026-09-13 — R8 amended: the record item carries `species: { id, canonicalName }` so a row reads without a second request (UX-01).
- 2026-09-13 — R1 supersedes_record_id, R2 converse check and the manual-reference rule for superseding records, R8 supersedes fields (RFC-65, plan 07).
- 2026-09-17 — R1, R2, R7, R8, R10 amended (plan 09a).
