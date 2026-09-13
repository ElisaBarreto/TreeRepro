# TreeRepro — Scientific Dataset Design (plans 06–07)

**Date:** 2026-09-13
**Status:** approved design; plan 06 implements sections 3–9 except the curation tables' write paths (plan 07)
**Scope:** the scientific domain the platform exists for — a unified database of plant reproductive traits compiled from hundreds of publications, curated by specialist scientists. Taxonomy, bibliographic references and trait dictionary catalogs; immutable trait records with full provenance; bulk import of the compiled dataset; read API; the dataset pages of the web application (species search, species page, dictionary, references, imports). RFCs 60–64 and the amendments they force. Curation (confirm, dispute, accepted values, catalog editing) is designed here as the data model and delivered by plan 07 (RFC-65). The authenticated `/app` shell, the invitation-acceptance and password-reset screens and the admin UI are plan 05 (issue #20, `feat/ui-05`), built in parallel; the dataset pages mount inside that shell. Dataset export comes with plan 07.

## 1. Context

Plans 01–04 built the platform: encrypted PII, append-only audit log, invitations, sessions, TOTP, permissions, roles, admin API. The web application is a landing page with sign-in; plan 05 (in progress on `feat/ui-05`) adds the authenticated shell, the auth screens and the admin UI. Nothing scientific exists yet.

The science: a survey of hundreds of articles produced one denormalized spreadsheet of about eight million rows. Each row says "reference R reports that species S has trait T with value V", with the species name standardized to WCVP (GBIF name as an alternative), the trait name harmonised to a controlled dictionary of about one hundred traits in thirteen categories, and the value harmonised to the dictionary's levels (categorical) or to a number in the dictionary's unit (quantitative). Sources disagree, traits are missing, and harmonisation failed for a measurable share of rows (in a 15,000-row sample: 5% of categorical values are outside the dictionary — plurals, `a;b` combinations, new levels — and 4% of quantitative values are text such as `Within 1 year`, `Aug`, `?`). Specialist scientists will confirm what is right, add what is missing with its bibliographic reference, flag divergences, and decide the accepted value per species and trait.

Non-negotiables stated by the project owner:

- Every original imported value is marked as such and is never lost.
- Every addition and every curation step is traceable — who, when, what — including intermediate states.
- Vocabularies are controlled: no free text where a filter or search will later be needed. A new flower color is a new dictionary level, never a typed string.
- A trait or a trait level that is in use is never deleted.

Decisions taken with the owner during design: records are immutable (a correction is a new record plus a dispute of the old one, never an edit); besides the records, curators mark one accepted value per species×trait; who may create catalog items is a matter of permissions (existing RBAC), not of a proposal queue; the import is a CLI run by an administrator, occasional, not recurring; the import loads every row and marks the non-conforming ones as pending harmonisation instead of rejecting or auto-expanding the dictionary; the trait dictionary is versioned in the repository as seed data; the sample spreadsheet is not versioned and is used locally to validate the import.

Constraints inherited: backend is the only authority (RFC-02); RFC → failing test → code (RFC-01); every route belongs to exactly one guard class (RFC-32 R5); API conventions (RFC-11); error codes (RFC-12); English everywhere.

## 2. Decisions summary

| Topic | Decision |
|---|---|
| Record identity | A record is one claim: species × trait × value × primary reference × secondary reference (× raw value). Records are insert-only; the database role used by the API has no `UPDATE` or `DELETE` on the table and a trigger refuses both, the same technique as the audit log. |
| Provenance | Every record carries its origin (`import` with batch and row number, or `manual` with the creating user), its raw source columns, and `created_at`. Curation steps (plan 07) are append-only rows that reference the record; the current stance of a scientist is their latest annotation; the current accepted value is the latest decision. Nothing is ever overwritten. |
| Status | Never a stored column. Two derived axes: **harmonisation** (stored per record at creation: `harmonised`, `unknown_level`, `multi_value`, `not_numeric`, `empty`) and **review** (derived from annotations: `withdrawn` > `disputed` > `confirmed` > `unreviewed`). |
| Duplicates | A unique index over the claim (nulls not distinct) makes an identical claim impossible to store twice; the import counts the collisions as duplicates; a scientist trying to add an existing claim is told to confirm it instead (plan 07). |
| Accepted value | One per species×trait, always pointing at a record (a value with a reference, never a free value); a decision may also clear the accepted value; history kept. Plan 07 writes it; plan 06 reads it as `null`. |
| Taxonomy | Canonical species name is the WCVP name. Rows without one get the GBIF name or, failing that, the original name, and the species is flagged as an unresolved taxon. Alternative names (GBIF, with usage key) live in their own table because one WCVP species arrives with several GBIF names. Genus and family are nullable (the source omits them for some rows). |
| References | Identified by `citation_key`, the exact source string (a short key such as `Alfaro_et_al_2023_GEB` or a full citation up to ~2,000 characters). Metadata (title, authors, year, journal, DOI, URL) is optional and filled later through the UI (plan 07). Records keep both the primary reference (original source) and the secondary one (where the row was collected from, such as `TRY`); at least one is required; manual records require the primary. |
| Dictionary | `trait_categories`, `traits`, `trait_levels` seeded from `apps/api/src/db/seed/trait-dictionary.csv` by an idempotent `seed:traits` command that only inserts what is missing. The spreadsheet's `broad_category` and `trait_value_type` columns are ignored (the dictionary wins) and kept raw on the record. No delete path for traits or levels; `active=false` hides them from new entries. |
| Import | `import:records --file <csv>`: header validated, file hashed, batch row created, CSV streamed with `COPY` into a session temporary table, normalisation and insertion in one set-based SQL transaction, batch counts and a terminal report. Re-running is safe: same hash refused unless `--force`; the unique claim index prevents duplicates either way. |
| Rejections | Only rows that cannot be attached to anything: no species name in any of the four name columns, trait key not in the dictionary, no reference at all. Stored with the raw row in `import_rejects`; nothing disappears. |
| Permissions | Plan 06: `dataset.read`, `imports.read`. Plan 07: `records.create`, `records.annotate`, `records.withdraw`, `accepted.manage`, `taxa.manage`, `references.manage`, `traits.manage`. No new system role: administrators create a "scientist" role in the existing UI. |
| Read API shape | Species search over canonical and alternative names with `pg_trgm`; species page = aggregated per-trait summary in one call + paginated records per trait through a generic `GET /api/records` filtered by species+trait or by reference. Lists never carry per-row counts (eight million rows). |
| Web | Dataset pages under the `/app` shell that plan 05 delivers: species search, species page, dictionary browser, references, imports. Backend tasks of plan 06 run in parallel with plan 05; the web tasks start after plan 05 merges. |
| Module layout | `apps/api/src/dataset/` (`taxa.ts`, `references.ts`, `dictionary.ts`, `records.ts`, `import.ts`, `summary.ts`) and `apps/api/src/http/routes/dataset/`; CLI entries in `apps/api/src/cli/`. |

## 3. Data model

All ids are `uuid` with `default uuidv7()`; timestamps are `timestamptz`. `created_by` references `users(id)` and is null for import-created rows (the batch records who ran it). Every catalog foreign key is `ON DELETE RESTRICT`. Drizzle schema files live in `apps/api/src/db/schema/`, one per table group (`taxa.ts`, `references.ts`, `dictionary.ts`, `records.ts`, `imports.ts`, `curation.ts`).

### Taxonomy (RFC-60)

| Table | Columns | Constraints |
|---|---|---|
| `families` | `id`, `name text`, `created_at`, `created_by` | `unique(name)` |
| `genera` | `id`, `family_id null`, `name text`, `created_at`, `created_by` | `unique(name)`; `family_id` null = family unresolved |
| `species` | `id`, `genus_id null`, `canonical_name text`, `name_source text` (`wcvp`, `gbif`, `original`), `created_at`, `created_by` | `unique(canonical_name)`; check on `name_source`; GIN trigram index on `canonical_name` |
| `species_names` | `id`, `species_id`, `name text`, `source text` (`gbif`), `gbif_usage_key text null`, `created_at` | `unique(species_id, name)`; GIN trigram index on `name` |

Names are stored trimmed with internal whitespace collapsed. A species whose `name_source` is not `wcvp` is an *unresolved taxon*; a species without a genus or a genus without a family is *unresolved taxonomy*; both are visible flags for curators, never blockers for import.

### References (RFC-61)

| Table | Columns | Constraints |
|---|---|---|
| `bibliographic_references` (`references` is a reserved word in SQL; the API path stays `/api/references`) | `id`, `citation_key text`, `title null`, `authors null`, `year smallint null`, `journal null`, `doi null`, `url null`, `created_at`, `created_by` | `unique(citation_key)`; `unique(doi)` where not null; GIN trigram index on `citation_key` |

### Dictionary (RFC-62)

| Table | Columns | Constraints |
|---|---|---|
| `trait_categories` | `key text pk`, `label text`, `sort_order int` | |
| `traits` | `id`, `key text`, `category_key`, `value_type text` (`categorical`, `quantitative`), `unit text null`, `description text`, `active bool default true`, `created_at`, `created_by` | `unique(key)`; check on `value_type` |
| `trait_levels` | `id`, `trait_id`, `key text`, `sort_order int`, `active bool default true`, `created_at`, `created_by` | `unique (trait_id, lower(key))` |

`key` values are stored exactly as the dictionary spells them (including `whole plant`, `hea`, `grey` and `gray`); matching at import compares `lower(trim(value))` with `lower(key)`. Cleaning the vocabulary is curation work (plan 07): rename a level's key, deactivate it, or add a level; never delete. Categories are the dictionary's thirteen `broad_category` values plus their display order (`dispersal`, `pollination`, `reproduction`, `fruit`, `fruit_color`, `seed`, `flower`, `flower_color`, `plant_form`, `demography`, `root`, `metadata_or_context`, `structural`).

### Records (RFC-63)

`trait_records`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `species_id` | uuid → `species` | |
| `trait_id` | uuid → `traits` | |
| `level_id` | uuid → `trait_levels` null | set only when categorical and harmonised |
| `numeric_value` | numeric null | set only when quantitative and harmonised |
| `value_text` | text not null | the harmonised value as imported or as entered (trimmed); for manual categorical records it equals the level key, for manual quantitative ones the canonical string of the number |
| `harmonisation` | text | `harmonised`, `unknown_level`, `multi_value`, `not_numeric`, `empty` |
| `raw_value` | text null | `original_value_clean` |
| `original_trait_name` | text null | |
| `original_species_name` | text null | |
| `secondary_source_species_name` | text null | |
| `raw_category` | text null | the spreadsheet's `broad_category` |
| `primary_reference_id` | uuid → `bibliographic_references` null | |
| `secondary_reference_id` | uuid → `bibliographic_references` null | |
| `origin` | text | `import`, `manual` |
| `import_batch_id` | uuid → `import_batches` null | |
| `import_row_no` | bigint null | position in the file (1-based, header excluded) |
| `created_by` | uuid → `users` null | |
| `note` | text null | manual records only: where in the source the value is (page, table) |
| `created_at` | timestamptz | |

Constraints:

- `check (primary_reference_id is not null or secondary_reference_id is not null)`
- `check (origin = 'import' and import_batch_id is not null and import_row_no is not null and created_by is null or origin = 'manual' and created_by is not null and primary_reference_id is not null and import_batch_id is null)`
- `check (harmonisation <> 'harmonised' or level_id is not null or numeric_value is not null)` and `check (level_id is null or numeric_value is null)`
- `unique nulls not distinct (species_id, trait_id, value_text, raw_value, primary_reference_id, secondary_reference_id)` — the claim key
- Indexes: `(species_id, trait_id, id desc)`, `(trait_id)`, `(primary_reference_id, id desc)`, `(secondary_reference_id)`, `(import_batch_id)`, `(harmonisation) where harmonisation <> 'harmonised'`
- Immutability: trigger `trait_records_immutable` raises `insufficient_privilege` on `UPDATE`, `DELETE` and `TRUNCATE`; the migration also `REVOKE UPDATE, DELETE ON trait_records FROM treerepro_app` when the role exists (pattern of `0001_audit_log_append_only.sql`).

`import_batches`

| Column | Notes |
|---|---|
| `id`, `file_name text`, `file_sha256 text`, `run_by uuid null`, `started_at`, `finished_at null`, `status text` (`running`, `completed`, `failed`), `error text null` | index on `file_sha256`; a `completed` batch with the same hash blocks a new run unless `--force` |
| `rows_total`, `rows_inserted`, `rows_duplicate`, `rows_rejected`, `rows_pending` bigint | `rows_pending` = inserted rows whose `harmonisation <> 'harmonised'` |
| `unknown_levels jsonb not null default '[]'` | top 30 `{ trait, value, count }` for the report and the UI |

`import_rejects`: `id`, `batch_id`, `row_no bigint`, `reason text` (`no_species_name`, `unknown_trait`, `no_reference`), `raw_row jsonb`, `created_at`. Index `(batch_id, row_no)`.

### Curation (RFC-65, plan 07 — tables created by plan 06 so the read model is final)

| Table | Columns | Constraints |
|---|---|---|
| `record_annotations` | `id`, `record_id`, `actor_id`, `kind text` (`confirm`, `dispute`, `neutral`, `withdraw`), `note text null`, `created_at` | `note` required for `dispute` and `withdraw` (check); index `(record_id, id desc)`; append-only (trigger + revoke) |
| `accepted_values` | `id`, `species_id`, `trait_id`, `record_id null`, `decision text` (`accepted`, `cleared`), `actor_id`, `note text null`, `created_at` | `record_id` required when `accepted`, null when `cleared`; the record's species and trait must match (trigger); index `(species_id, trait_id, id desc)`; append-only |

Review status of a record, computed in SQL by `dataset/summary.ts` and returned by the API: `withdrawn` if any `withdraw` annotation exists; else `disputed` if any actor's latest annotation is `dispute`; else `confirmed` if any actor's latest annotation is `confirm`; else `unreviewed`. Current accepted value for species×trait: the latest `accepted_values` row; `null` when none or when the latest is `cleared`.

### Migrations (numbered after plan 04's `0007`)

| File | Content |
|---|---|
| `0008_permissions_dataset.sql` | insert `dataset.read`, `imports.read` (custom) |
| `0009_pg_trgm.sql` | `create extension if not exists pg_trgm` (custom; trusted extension, the migrator role has `CREATE` on the database) |
| `0010_dataset_catalogs.sql` | generated: families, genera, species, species_names, bibliographic_references, trait_categories, traits, trait_levels, indexes |
| `0011_dataset_records.sql` | generated: import_batches, import_rejects, trait_records (claim key `nulls not distinct`, checks, indexes), record_annotations, accepted_values |
| `0012_dataset_append_only.sql` | append-only triggers, accepted-record match trigger, revokes (custom) |

Drizzle generates the table DDL; triggers, revokes and the extension are hand-written custom migrations, as the audit migrations are.

## 4. Seed and import (RFC-62, RFC-64)

### `seed:traits`

`pnpm --filter @treerepro/api seed:traits` (`apps/api/src/cli/seed-traits.ts`). Reads `apps/api/src/db/seed/trait-dictionary.csv` — the dictionary file as delivered (`final_standard_trait, broad_category, trait_value_type, standard_unit, description, harmonised_levels`, levels separated by `;`). `COPY` into a temporary table, then `insert … on conflict do nothing` into categories, traits and levels. Never updates or deactivates anything; prints how many rows each table gained. Runs in the dev stack, in production and in the integration test setup (the tests need the dictionary).

### `import:records`

`pnpm --filter @treerepro/api import:records --file <path> [--run-by <email>] [--force]` (`apps/api/src/cli/import-records.ts`), executed inside the API container against the same Postgres, with the app role.

1. **Preconditions.** The dictionary is loaded (`traits` not empty); otherwise exit with a message naming `seed:traits`. The file exists and is readable. Its first line, parsed as one CSV record, equals exactly the fifteen expected column names in order: `primary_reference, secondary_reference, wcvp_species, wcvp_genus, wcvp_family, gbif_species, gbif_usage_key, original_species_name, secondary_source_species_name, original_trait_name, final_standard_trait, broad_category, original_value_clean, trait_value_type, harmonised_value`. Otherwise exit without creating a batch.
2. **Hash.** SHA-256 of the whole file, streamed. A `completed` batch with the same hash exists → print its id and counts and exit 1, unless `--force`.
3. **Batch.** Insert `import_batches` with `status = 'running'`, `file_name` (basename), hash, `run_by` (user found by email, or null).
4. **Staging.** `create temporary table import_staging (row_no bigserial, <15 text columns>)` — session-scoped, unlogged by nature, dropped at the end of the run; the app role needs no `CREATE` on the schema, only the database's default `TEMP` privilege. `copy import_staging (<15 columns>) from stdin with (format csv, header true, encoding 'UTF8')` fed by a Node readable stream piped into postgres.js's `.writable()`. The file is never held in memory; `row_no` follows file order because `COPY` inserts sequentially.
5. **Normalisation**, one transaction, set-based, in this order:
   - Trim and collapse whitespace on every name column into computed columns of the staging table (`update import_staging set …`, single statement).
   - Resolve the species name per row: `coalesce(nullif(wcvp_species,''), nullif(gbif_species,''), nullif(original_species_name,''), nullif(secondary_source_species_name,''))` with the matching `name_source`.
   - Insert missing families, genera (with their family when the row names one), species (canonical name and source), `species_names` (GBIF name and usage key when present and different from the canonical name), references (primary and secondary by `citation_key`); each with `on conflict do nothing`. Existing rows are never changed by the import (a later file that names a family for a genus that had none does not update it; that is curation).
   - Resolve `trait_id` by key. Harmonise the value: empty → `empty`; categorical: `lower(trim(value))` equals a level key of that trait → `harmonised` + `level_id`; contains `;` → `multi_value`; else `unknown_level`. Quantitative: matches `^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$` → `harmonised` + `numeric_value`; else `not_numeric` (a decimal comma is not a number; curators fix it).
   - Rejects: rows with no resolved species name (`no_species_name`), no trait row (`unknown_trait`), both reference columns empty (`no_reference`) → `import_rejects` with the raw row as JSON.
   - `insert into trait_records … select … from import_staging … order by row_no on conflict do nothing`; the statement's row count is `rows_inserted`; `rows_duplicate = rows_total − rows_rejected − rows_inserted`.
   - Aggregate `rows_pending` and `unknown_levels` from the rows inserted by this batch.
   - Any error → rollback, batch `status = 'failed'` with `error` (in a separate statement after the rollback), exit 1. Re-running after a fix is safe.
6. **Finish.** Update the batch (`completed`, `finished_at`, counts), drop the staging table, print the report: totals, counts per harmonisation status, top 30 unknown levels by trait, rejections by reason, elapsed time.

Performance target: the eight-million-row file completes in minutes on the production VPS; the claim index and the other indexes stay in place during the insert (simpler and safe; measured on the sample during the plan, revisited only if the full load is unacceptably slow).

### Validation with the real sample (manual step of plan 06)

Against the dev stack, after `seed:traits`: `import:records --file docs/exemplos/sample_data.csv`. Expected report, from the profile taken during design: 14,999 rows read; ≈466 duplicates; 0 rejected; ≈17 `empty`, ≈794 `unknown_level` + `multi_value`, ≈580 `not_numeric`; ≈10,300 species of which ≈104 unresolved taxa; 296 families; ≈1,840 references. A second run without `--force` is refused by hash; with `--force` it inserts 0 and counts everything as duplicate.

## 5. Modules (`apps/api/src`)

| Module | Responsibility |
|---|---|
| `dataset/taxa.ts` | `searchSpecies(db, { q?, familyId?, genusId?, unresolved?, cursor?, limit })` → `{ data, nextCursor }` (keyset on `(canonical_name, id)`); `getSpecies(db, id)` with genus, family, names, `recordCount`, `traitCount`; `listFamilies`, `listGenera(db, { familyId?, q?, cursor?, limit })`. |
| `dataset/references.ts` | `searchReferences(db, { q?, cursor?, limit })` ordered by usage with `primaryCount` / `secondaryCount` per item, `getReference(db, id)` adding `recordCount`. |
| `dataset/dictionary.ts` | `getDictionary(db)` → categories → traits → levels, dictionary order. |
| `dataset/records.ts` | `listRecords(db, { speciesId?, traitId?, referenceId?, cursor?, limit })` (requires `speciesId` + `traitId`, or `referenceId`); `getRecord(db, id)` with raw fields, batch, annotations and accepted history. |
| `dataset/summary.ts` | `speciesTraitSummary(db, speciesId)` → categories → traits → `{ recordCount, harmonisationCounts, summary, accepted }`; `reviewStatus` SQL fragment shared with `records.ts`. |
| `dataset/import.ts` | `importRecords(ctx, { filePath, runBy?, force? })` → batch with counts; `listBatches`, `getBatch`, `listRejects`. Pure functions for header validation and number detection are exported for unit tests. |
| `dataset/seed.ts` | `seedDictionary(db, csvPath)`; used by the CLI and by the integration test setup. |
| `cli/seed-traits.ts`, `cli/import-records.ts` | Argument parsing, config, exit codes; thin over the modules. |
| `http/cursor.ts` | Gains `encodeCompositeCursor(parts: string[])` / `decodeCompositeCursor(token, arity)` (base64url of JSON array); the single-id functions stay. |
| `http/routes/dataset/index.ts` | Mounts `species.ts`, `traits.ts`, `references.ts`, `records.ts`, `imports.ts` under `/api`. |

## 6. Representations

`species` (list item): `{ id, canonicalName, nameSource, genus: { id, name } | null, family: { id, name } | null, matchedName: string | null }` — `matchedName` is the alternative name that matched when the canonical name did not.

`species` (detail): list item plus `names: [{ name, source, gbifUsageKey }]`, `recordCount`, `traitCount`, `unresolvedTaxon: boolean`.

`traitSummary`: `{ trait: { id, key, valueType, unit }, recordCount, harmonisationCounts: { harmonised, unknownLevel, multiValue, notNumeric, empty }, levels: [{ levelId, key, count }] | null, numeric: { min, median, max, count } | null, accepted: { recordId, valueText, decidedAt } | null }` (`levels` for categorical traits, `numeric` for quantitative ones); grouped as `{ category: { key, label }, traits: [traitSummary] }[]`.

`record` (list item): `{ id, speciesId, species: { id, canonicalName }, trait: { id, key, valueType, unit }, valueText, level: { id, key } | null, numericValue, harmonisation, review, primaryReference: { id, citationKey } | null, secondaryReference, origin, createdAt, createdBy: { id, name } | null }`.

`record` (detail): list item plus `rawValue, originalTraitName, originalSpeciesName, secondarySourceSpeciesName, rawCategory, note, importBatch: { id, fileName, startedAt } | null, importRowNo, annotations: [{ id, kind, note, actor: { id, name }, createdAt }], acceptedHistory: [{ id, decision, recordId, actor, note, createdAt }]`.

`reference`: `{ id, citationKey, title, authors, year, journal, doi, url, createdAt, primaryCount, secondaryCount }` (records naming it as primary / as secondary; the same record counts once in each role it fills); detail adds `recordCount` (either role, counted once).

`dictionary`: `[{ key, label, traits: [{ id, key, valueType, unit, description, active, levels: [{ id, key, active }] }] }]`.

`importBatch`: `{ id, fileName, fileSha256, status, runBy: { id, name } | null, startedAt, finishedAt, rowsTotal, rowsInserted, rowsDuplicate, rowsRejected, rowsPending, unknownLevels, error }`; `importReject`: `{ id, rowNo, reason, rawRow }`.

Names of users (`createdBy`, `actor`, `runBy`) are decrypted server-side (RFC-40) and are the only PII in these payloads; `dataset.read` is the permission that grants seeing them, exactly as `audit.read` does for audit entries.

## 7. Routes (plan 06)

All permission-guarded with `dataset.read` unless stated; envelopes and pagination per RFC-11.

| Route | Behaviour |
|---|---|
| `GET /api/species?q=&familyId=&genusId=&unresolved=&cursor=&limit=` | `q` optional, 2–100 characters, `ILIKE '%q%'` over `canonical_name` and `species_names.name` (trigram indexes); order by canonical name then id; composite cursor. |
| `GET /api/species/:id` | 404 `SPECIES_NOT_FOUND`. |
| `GET /api/species/:id/traits` | Summary per category and trait; categories with no records omitted; `accepted` is `null` until plan 07 writes it. |
| `GET /api/records?speciesId=&traitId=&referenceId=&cursor=&limit=` | Requires `speciesId` and `traitId` together, or `referenceId`; other combinations 400 `VALIDATION_FAILED`. Keyset by `id` descending. |
| `GET /api/records/:id` | 404 `RECORD_NOT_FOUND`. |
| `GET /api/traits` | Whole dictionary; `Cache-Control: private, max-age=300`. |
| `GET /api/references?q=&cursor=&limit=` | `q` over `citation_key` and `title`; order by usage (`primaryCount + secondaryCount` desc, then id desc); composite cursor `[total, id]`; the counts come from an on-demand aggregate over `trait_records` (no dedicated index — tens of thousands of references at most). |
| `GET /api/references/:id` | 404 `REFERENCE_NOT_FOUND`. |
| `GET /api/families?cursor=&limit=` | Order by name. |
| `GET /api/genera?familyId=&q=&cursor=&limit=` | Order by name; `q` prefix match. |
| `GET /api/imports?cursor=&limit=` | `imports.read`; keyset by id descending. |
| `GET /api/imports/:id` | `imports.read`; 404 `IMPORT_NOT_FOUND`. |
| `GET /api/imports/:id/rejects?cursor=&limit=` | `imports.read`; keyset by `(row_no, id)`. |

RFC-32 R5 keeps its three classes; its wording changes from "every route whose path starts with `/api/admin/` is permission-guarded" to "every route that is neither public nor in the self-service list is permission-guarded", which is what the meta-test already checks (it inspects the guard, not the path).

Write routes (plan 07, RFC-65): `POST /api/records`, `POST /api/records/:id/annotations`, `PUT /api/species/:id/traits/:traitId/accepted`, and create/update routes for families, genera, species, species names, references, traits and levels — designed in plan 07's spec over this model.

## 8. Web (`apps/web`)

Plan 05 (`feat/ui-05`, issue #20) owns the authenticated `/app` layout (session guard over `GET /api/auth/me`, top bar, user menu, permission-filtered navigation), the `/invite/$token`, `/forgot-password` and `/reset-password/$token` screens and the admin pages. Plan 06 adds dataset pages inside that layout and two navigation entries (Species, Traits, References always; Imports when `imports.read`). If plan 05 has not merged when the web tasks of plan 06 begin, they wait; the backend tasks never depend on it.

| Route | Access | Screen |
|---|---|---|
| `/app/species` | `dataset.read` | Search box (debounced, min 2 chars), family select, genus combobox (`/api/genera?familyId=&q=`), "unresolved taxa" toggle; the first page lists at once and every list pages explicitly by cursor (Previous / Next, "Page N", rows per page 25 / 50 / 100 remembered in `localStorage`; UX-01); row: italic canonical name, family, "matched: <alternative name>" when relevant. |
| `/app/species/$id` | `dataset.read` | Header: family › genus › *species*, badge (WCVP / unresolved taxon), alternative names. Sections per category in dictionary order; trait cards: key, unit, record count, summary (level bars or min–median–max), pending badge. Card click opens the trait panel: paginated record table (value, references, origin, harmonisation and review chips, date); row click opens the record drawer (raw fields, batch, annotations and accepted history when present). Explicit empty states. |
| `/app/traits` | `dataset.read` | Dictionary browser: categories → traits (type, unit, description, active) → levels. Read-only in plan 06. |
| `/app/references`, `/app/references/$id` | `dataset.read` | Search list; detail with metadata and that reference's records (`/api/records?referenceId=`) with the species (linked) and trait of each row. |
| `/app/imports`, `/app/imports/$id` | `imports.read` | Batch list with counts and status; batch detail with unknown levels and paginated rejects (reason, raw row). |

Rules: no business logic in the web (RFC-02) — statuses arrive computed; navigation filtering by `permissions` is cosmetic, the API decides. Identity tokens and fonts of `docs/specs/2026-09-12-visual-identity.md`; no motion outside the landing. Components in `apps/web/src/components/dataset/`, pages in `pages/dataset/`, typed API calls in `api/dataset.ts` validated with the shared Zod schemas. Layout primitives (page header, table, drawer, chips) come from plan 05 when they exist there; otherwise plan 06 adds them in `components/ui/` for plan 05 to reuse.

## 9. Contracts and error codes

`packages/contracts` gains `dataset.ts` (query and response schemas for sections 6–7) and constants `HARMONISATION_STATUSES`, `REVIEW_STATUSES`, `NAME_SOURCES`, `RECORD_ORIGINS`, `TRAIT_VALUE_TYPES`, `ANNOTATION_KINDS`, `ACCEPTED_DECISIONS`, `IMPORT_BATCH_STATUSES`, `IMPORT_REJECT_REASONS`; `PERMISSIONS` gains the plan 06 keys.

New RFC-12 codes, all 404: `SPECIES_NOT_FOUND`, `TRAIT_NOT_FOUND`, `REFERENCE_NOT_FOUND`, `RECORD_NOT_FOUND`, `IMPORT_NOT_FOUND`.

## 10. RFCs

| RFC | Title | Content |
|---|---|---|
| RFC-60 | Taxonomy catalog | Tables, canonical name and sources, alternative names, unresolved flags, normalisation of names, restrict-on-use, what the import may and may not change. |
| RFC-61 | Bibliographic references | `citation_key` identity, optional metadata, DOI uniqueness, primary/secondary roles on records. |
| RFC-62 | Trait dictionary | Categories, traits, levels, the seed file as source, idempotent seeding, matching rule, never delete / deactivate only. |
| RFC-63 | Trait records and provenance | Immutability (trigger and privileges), claim uniqueness, harmonisation axis, review axis definition, raw columns, origin rules, representations. |
| RFC-64 | Bulk import | Header, hash, batch lifecycle, staging, resolution and harmonisation rules, rejections, counts, report, idempotency. |
| RFC-65 | Curation | Plan 07. |

Amendments: RFC-30 (catalog gains `dataset.read`, `imports.read`); RFC-12 (five codes); RFC-32 R5 (wording); RFC-10 (commands `seed:traits`, `import:records`; `pg_trgm`). Index in `docs/rfc/README.md` gains the `60–69 dataset` range.

Documentation: `docs/gotchas/import.md` (streaming `COPY` with postgres.js, temporary staging with the app role, `on conflict do nothing` as the duplicate counter, `nulls not distinct`, `pg_trgm`); `docs/gotchas/web.md` additions (authenticated layout, cursor lists); README commands and layout.

## 11. Testing

- Unit (`api:unit`): header validation, number detection, name normalisation, composite cursor, review-status reducer against fixed annotation sequences, contracts catalogs (permissions and error codes mirror the RFC tables).
- Integration (`api:integration`, real Postgres 18 and Redis 8): dictionary seed idempotency; import of the versioned fixture `apps/api/test/fixtures/import/records-small.csv` (about fifty rows covering: valid categorical, valid numeric, unknown level, `a;b`, text in a quantitative trait, empty value, no WCVP with GBIF, no WCVP nor GBIF, unknown trait, no reference, primary ≠ secondary, exact duplicate inside the file, two GBIF names for one WCVP species, whitespace to normalise) asserting batch counts, specific records, rejects and unknown levels; second run refused by hash; `--force` run inserts zero; privileges: the app role cannot `UPDATE`, `DELETE` or `TRUNCATE` `trait_records`, `record_annotations`, `accepted_values`; summary aggregation on seeded records; every route (status codes, envelopes, cursors, 404s); the existing route-guard meta-test covers the new routes automatically.
- Web (Vitest + testing-library, mocked fetch): species search with cursor, species page sections and summaries, trait panel and record drawer, references and imports pages, permission-dependent navigation entries.
- Manual: the sample validation of section 4, recorded as a checklist in the plan with the expected numbers.
- End-to-end: plan 05 sets Playwright up (issue #20); plan 06 adds one smoke (sign in → search → species page) if that setup has merged, otherwise plan 07 does.

## 12. Out of scope (later plans)

- Plan 05 (parallel, other branch) — `/app` shell, auth screens, admin UI, Playwright setup (issue #20).
- Plan 07 — curation (RFC-65): create records, annotate, accepted values, catalog editing with `taxa.manage` / `references.manage` / `traits.manage`, pending-harmonisation and unresolved-taxa queues, audit entries for catalog changes, dataset export of the accepted values.
- Later — species merges and reference merges (renames with history), WCVP/GBIF lookups when creating species, decimal-comma tolerance in the importer, resource-level permissions (RFC-32 R7).
