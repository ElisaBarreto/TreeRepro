# TreeRepro — Curation Design (plan 07)

**Date:** 2026-09-13
**Status:** approved design; plan 07a implements the API, plan 07b the curation pages, plan 07c the catalog editors
**Scope:** the write side of the scientific dataset — manual trait records, confirm / dispute / withdraw annotations, the accepted value per species and trait, the harmonisation queue with bulk mapping, the disputed queue, catalog editing (taxa, references, traits and levels), and the CSV export of accepted values. RFC-65 (curation), RFC-66 (export) and the amendments they force on RFC-30, RFC-12, RFC-41, RFC-60–64. Builds on `docs/specs/2026-09-13-dataset-design.md` (plan 06), which already fixed the data model this plan writes to. Issue #45.

## 1. Context

Plan 06 loaded the dataset and made it browsable: catalogs, eight million immutable records with provenance, the import CLI, the read API and the dataset pages. The curation tables (`record_annotations`, `accepted_values`) exist with their append-only triggers but nothing writes to them, and no route creates or edits anything scientific.

Specialist scientists now need to do the work the platform exists for: add trait values with their bibliographic reference, confirm or dispute existing claims, decide the accepted value per species and trait, clean the pending rows the import could not harmonise, and keep the vocabularies and catalogs correct.

The owner's non-negotiables carry over unchanged: records are immutable (a correction is a new record, never an edit); every step is traceable with actor and time, including intermediate states; no free text where a filter will later be needed; a trait or level in use is never deleted.

Constraints inherited: backend is the only authority (RFC-02); RFC → failing test → code (RFC-01); every route belongs to exactly one guard class (RFC-32 R5); API conventions (RFC-11); error codes (RFC-12); English everywhere.

## 2. Decisions summary

| Topic | Decision |
|---|---|
| Delivery | One spec, three plans and three PRs: **07a** API (RFC-65, RFC-66, all write routes, queues, export, audit, migrations 0013–0014); **07b** web curation (species page actions, queues, export button, the form primitives); **07c** web catalog editors. 07b depends on 07a; 07c depends on 07b (form primitives). Mirrors plan 06 (#43 backend, #44 web). |
| Manual values | Always harmonised. A categorical value is an active level of the trait (a scientist with `traits.manage` may create the level first); a quantitative value is a number in the trait's unit. No free text: `value: { levelId } \| { numeric }`. The optional `rawValue` keeps the source's wording (`Within 1 year`, `Aug`) for provenance; it never drives filters. Pending rows come only from the import. |
| Harmonisation mapping | A harmonised record may name the pending record it replaces through a new column `trait_records.supersedes_record_id`. The pending queue lists pending records with no superseding record; the original keeps its review status untouched (nobody "disputes" that the source said `reds`). Mapping is done per group (trait × `value_text`) in one set-based transaction: N pending rows become N harmonised records (× the number of levels chosen, which resolves `a;b`). |
| Disputes | A dispute is one actor's stance; only that actor changes it (a later `neutral` or `confirm`, RFC-63 R6). Nobody neutralises another person's stance. `accepted.manage` does not close disputes; it decides the accepted value. The disputed queue lists records whose review is `disputed` and whose species × trait has no accepted decision newer than the latest dispute — the queue empties when the disputer steps back or a curator decides. |
| Withdrawal | `withdraw` applies to manual records only, by the record's author or by anyone holding `records.withdraw`; note required. A record that is the current accepted value cannot be withdrawn (change the accepted value first). A withdrawn record accepts no further annotation. |
| Accepted value | Points at a record that is `harmonised` and not `withdrawn`, belongs to the species × trait, and history is kept. The route is idempotent: a request that matches the current state inserts nothing. |
| Audit | Record, annotation and accepted writes emit no `audit_log` row — the append-only tables already carry actor and time immutably, and bulk mapping would multiply rows for nothing. Catalog writes (mutable tables, `PATCH`) and the export emit RFC-41 entries with ids and field names only, in the same transaction. |
| Catalog editing | Trait `key`, `valueType`, `unit` immutable after creation (the import matches by key; a unit change would silently change the meaning of stored numbers). Editable: trait `categoryKey`, `description`, `active`; level `key`, `sortOrder`, `active`; species `canonicalName`, `nameSource`, `genusId` (+ add alternative names); genus `name`, `familyId`; family `name`; reference everything including `citationKey`. Nothing deletes. |
| Export | `GET /api/export/accepted.csv`, permission `dataset.export` (downloading the dataset is a larger grant than browsing it), one row per species × trait with a current accepted value, streamed, no personal data, audited as `dataset.exported`. No "best available" rows: that would fix a scientific rule the owner has not stated. |
| Dictionary cache | `GET /api/traits` drops `Cache-Control: max-age=300` (RFC-62 R5): the dictionary is now editable and a five-minute HTTP cache would hide the rename the user just made. |
| Carried-over follow-ups landing here | Converse CHECK (`level_id` / `numeric_value` set ⇒ `harmonised`); exponent and magnitude bound in the RFC-64 R6 number rule; `unresolvedTaxon` on the species list item (RFC-60 R6); shared `pageOf` helper; `Drawer` focus trap and `inert`. The rest becomes issues (section 14). |
| Later plans | Species and reference merges; WCVP/GBIF lookups when creating species; resource-level permissions. |

## 3. Data model changes

Two migrations:

1. `0013_permissions_curation.sql` (custom, hand-written like `0008`): insert `records.create`, `records.annotate`, `records.withdraw`, `accepted.manage`, `taxa.manage`, `references.manage`, `traits.manage`, `dataset.export` (RFC-30 R3).
2. `0014_records_supersedes.sql` (generated by `db:generate` from the Drizzle schema, so the snapshot stays in step):
   - `trait_records.supersedes_record_id uuid null references trait_records(id) on delete restrict` (self-reference through `AnyPgColumn`); partial index `trait_records_supersedes_idx (supersedes_record_id) where supersedes_record_id is not null`. RFC-63 R1 amended.
   - Converse CHECK `trait_records_value_requires_harmonised_check`: `(level_id is null and numeric_value is null) or harmonisation = 'harmonised'`. The summary trusts it, the importer honours it, manual writes must too (RFC-63 R2 amended). Existing rows already satisfy it (the importer sets a value only when harmonised).
   - `trait_records_origin_check` re-created: an import record has no `supersedes_record_id`; a manual record has `created_by`, no batch, no row number, and **either** a `primary_reference_id` **or** a `supersedes_record_id` — a mapped record inherits the pending record's references, which may be a secondary reference alone (RFC-63 R2 amended).

The append-only triggers and revokes of `0012` are untouched: every write in this plan is an `INSERT` into `trait_records`, `record_annotations` or `accepted_values`, or an `UPDATE` of a catalog table.

**Number rule** (RFC-64 R6 amended, shared by the importer and the manual routes): the trimmed value is at most 64 characters, matches `^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]{1,3})?$` (at most three exponent digits; with the length cap the cast to `numeric` cannot fail) and its magnitude satisfies `abs(value) < 1e308` (so the value fits `double precision` in the summary's `percentile_cont`). A value failing any of the three is `not_numeric` in the import and `VALIDATION_FAILED` (path `value.numeric`) on manual entry. `import.ts` exports `isHarmonisableNumber(text)`; the SQL side applies the length cap, the pattern and `abs(value::numeric) < 1e308` in the same `case`.

## 4. Curation API (RFC-65)

All routes are permission-guarded (RFC-32 R5), validated with the shared Zod schemas, and answer RFC-11 envelopes. `actor` is the session user.

### 4.1 Create a record

`POST /api/records` (`records.create`)

Body: `{ speciesId, traitId, value: { levelId } | { numeric }, primaryReferenceId, secondaryReferenceId?, rawValue?, note? }`. `rawValue` and `note` are 1–2,000 characters when present, trimmed.

Rules, in order:

- Species exists (404 `SPECIES_NOT_FOUND`); trait exists (404 `TRAIT_NOT_FOUND`) and is active (400 `VALIDATION_FAILED`, path `traitId`, "Trait is inactive"); references exist (404 `REFERENCE_NOT_FOUND`, detail path names which).
- `value` shape matches `valueType`: `levelId` for categorical, `numeric` for quantitative (400, path `value`).
- Categorical: the level belongs to the trait and is active (400, path `value.levelId`). Quantitative: the number rule of section 3 (400, path `value.numeric`).
- Insert (one statement, no transaction needed) with `origin = 'manual'`, `harmonisation = 'harmonised'`, `created_by = actor`, `level_id` or `numeric_value`, `value_text` = the level key or the canonical text of the number as Postgres prints `numeric` (computed in SQL: `($1::numeric)::text`, so `1e3` is stored as `1000`; the request carries a JSON number, so `1.50` arrives as `1.5`), `raw_value`, `note`, both reference ids, `supersedes_record_id = null`.
- Claim-key collision → 409 `RECORD_DUPLICATE`, message "This claim already exists; confirm it instead", `details: [{ path: 'recordId', message: <existing id> }]`. The existing id comes from a `select` on the claim key run after the unique violation (the insert is a single statement, so nothing is left aborted).
- 201 with the record detail.

### 4.2 Annotate a record

`POST /api/records/:id/annotations` (`records.annotate`)

Body: `{ kind: 'confirm' | 'dispute' | 'neutral' | 'withdraw', note? }`; `note` 1–2,000 characters, required for `dispute` and `withdraw` (400, path `note`).

- Record exists (404 `RECORD_NOT_FOUND`).
- Record already `withdrawn` → 409 `RECORD_WITHDRAWN` for every kind.
- `withdraw`: `origin` must be `manual` (409 `RECORD_NOT_WITHDRAWABLE`); the actor is the record's `created_by` or holds `records.withdraw` (403 `PERMISSION_DENIED` — the handler passes `canWithdrawAny = currentPermissions(c).has('records.withdraw')` to the service); the record is not the current accepted value of its species × trait (409 `RECORD_IS_ACCEPTED`).
- Insert the annotation; 201 with the record detail (review recomputed).

### 4.3 Accepted value

`PUT /api/species/:id/traits/:traitId/accepted` (`accepted.manage`)

Body: `{ decision: 'accepted', recordId, note? }` or `{ decision: 'cleared', note }` (a discriminated union on `decision`; `note` required when clearing — a cleared value needs a reason — optional when accepting).

- Species and trait exist (404s). Accepting: record exists (404 `RECORD_NOT_FOUND`), belongs to the species and trait (400 `VALIDATION_FAILED`, path `recordId`), is `harmonised` (409 `RECORD_NOT_HARMONISED`), is not `withdrawn` (409 `RECORD_WITHDRAWN`).
- Idempotent: when the current state already equals the request (same `recordId` accepted, or already cleared / never decided), nothing is inserted and the response is the current state.
- Otherwise insert the decision with `actor_id`; 200 with `{ current, history }` (section 7).

`GET /api/species/:id/traits/:traitId/accepted` (`dataset.read`) → `{ current, history }`; 404s for unknown species or trait.

### 4.4 Harmonisation queue and mapping

A record is **pending** when `harmonisation in ('unknown_level', 'multi_value', 'not_numeric')` and no record has `supersedes_record_id = its id`. `empty` records are not pending: there is nothing to map.

`GET /api/records/pending/traits` (`dataset.read`) → `{ data: [{ trait: { id, key, valueType, unit }, count }] }`, count descending then key; only traits with at least one pending record; no pagination (the dictionary has about one hundred traits).

`GET /api/records/pending?traitId=&cursor=&limit=` (`dataset.read`) → groups `{ valueText, harmonisation, count, sampleRecordId }` of that trait's pending records, ordered by `count` descending then `valueText` ascending; composite cursor `[count, sampleRecordId]` (RFC-11 R6; `sampleRecordId` is a fixed-size uuid, so the cursor stays short even though `valueText` may run to 4000 characters). `traitId` required; unknown trait → 404 `TRAIT_NOT_FOUND`. `sampleRecordId` is the newest pending record of the group, so the UI can open one example.

`POST /api/records/pending/map` (`records.create`)

Body: `{ traitId, valueText, value: { levelIds: [uuid, …] } | { numeric }, note? }`; `levelIds` 1–20 distinct ids.

- Trait exists and is active; `value` matches `valueType`; every level belongs to the trait and is active; number rule of section 3.
- One transaction, set-based: for every pending record `p` of the group (`trait_id`, `value_text` equal, not superseded), and for every chosen level (or the one number), insert a record with `species_id`, `primary_reference_id`, `secondary_reference_id` copied from `p`; `origin = 'manual'`, `harmonisation = 'harmonised'`, `created_by = actor`, `level_id` / `numeric_value`, `value_text` as in 4.1, `raw_value = coalesce(p.raw_value, p.value_text)`, `note`, `supersedes_record_id = p.id`. `insert … select … on conflict on constraint trait_records_claim_key do nothing`. The inherited references may be a secondary reference alone — the relaxed origin check of section 3 allows it because the row supersedes a record.
- Response 200 `{ data: { created, skipped } }` where `created` is the insert's row count and `skipped = expected − created` (a skipped row is a claim that already existed, typically a row the spreadsheet had already harmonised; its pending original stays pending and is visible in the queue for a manual decision). An empty group answers `{ created: 0, skipped: 0 }`.

### 4.5 Disputed queue

`GET /api/records/disputed?cursor=&limit=` (`dataset.read`) → record items plus `latestDispute: { id, actor: { id, name }, note, createdAt }`, for records whose review is `disputed` (RFC-63 R6) and whose species × trait has no `accepted_values` row newer than that latest dispute. Ordered by the latest dispute's annotation id descending; keyset cursor on that id. The query starts from `record_annotations` (small) and joins records; it never scans `trait_records`.

### 4.6 Unresolved taxa

No new endpoint: `GET /api/species?unresolved=true` (RFC-60 R6) is the queue. The species list item gains `unresolvedTaxon: boolean` (either kind, as the detail already has) so the badge covers unresolved taxonomy, not only `nameSource`.

## 5. Export (RFC-66)

`GET /api/export/accepted.csv` (`dataset.export`)

- One row per species × trait whose current accepted decision is `accepted`. Columns, in order: `family, genus, species, name_source, category, trait, value, unit, level, numeric_value, primary_reference, secondary_reference, decided_at, record_id`. `value` is the record's `value_text`; `level` the level key or empty; `numeric_value` the number or empty; references are citation keys; `decided_at` ISO 8601. No person's name (RFC-40).
- Order: `family, genus, species, trait` (nulls last), then trait key.
- Streaming: the service runs one query through `db.$client` with postgres.js `.cursor(500)` and yields CSV chunks into a `ReadableStream` that the route returns with `c.body()`. The file is never held in memory. Headers: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="treerepro-accepted-<YYYY-MM-DD>.csv"`, `Cache-Control: no-store`. RFC 4180: fields containing `"`, `,`, CR or LF are quoted with `"` doubled; CRLF row ends; a UTF-8 BOM opens the file so Excel reads the encoding. A field starting with `=`, `+`, `-`, `@`, tab or carriage return that is not a plain number is prefixed with `'` so spreadsheet software never evaluates it as a formula.
- The audit entry `dataset.exported` (`metadata: { format: 'csv', scope: 'accepted' }`) is written before the stream starts, in its own transaction; a stream that breaks mid-way still counts as an export.
- RFC-11 gains a note: file responses are the documented exception to the JSON envelope; errors before the stream starts (401, 403) keep the envelope.
- The web offers the file as a plain link with `download`; the session cookie authenticates it.

## 6. Catalog writes and audit

All catalog routes: `validate('json')`, names normalised (trim, internal whitespace collapsed to one space — RFC-60 R2 — the same `normaliseName` the importer uses), 201 on create, 200 on update, response = the existing representation (species item / detail, reference item, dictionary trait or level). No delete route anywhere.

| Route | Permission | Body | Rules / codes |
|---|---|---|---|
| `POST /api/families` | `taxa.manage` | `{ name }` | 409 `FAMILY_NAME_TAKEN` |
| `PATCH /api/families/:id` | `taxa.manage` | `{ name }` | 404 `FAMILY_NOT_FOUND`; 409 `FAMILY_NAME_TAKEN` |
| `POST /api/genera` | `taxa.manage` | `{ name, familyId? }` | 409 `GENUS_NAME_TAKEN`; 404 `FAMILY_NOT_FOUND` |
| `PATCH /api/genera/:id` | `taxa.manage` | `{ name?, familyId? }` (`familyId: null` detaches) | 404 `GENUS_NOT_FOUND`; as above |
| `POST /api/species` | `taxa.manage` | `{ canonicalName, nameSource, genusId? }` | 409 `SPECIES_NAME_TAKEN`; 404 `GENUS_NOT_FOUND` |
| `PATCH /api/species/:id` | `taxa.manage` | `{ canonicalName?, nameSource?, genusId? }` (`genusId: null` detaches) | 404 `SPECIES_NOT_FOUND`; as above |
| `POST /api/species/:id/names` | `taxa.manage` | `{ name, gbifUsageKey? }` | 409 `SPECIES_NAME_TAKEN` when the name is already this species' canonical or alternative name; `source = 'gbif'` |
| `POST /api/references` | `references.manage` | `{ citationKey, title?, authors?, year?, journal?, doi?, url? }` | 409 `REFERENCE_KEY_TAKEN`, `REFERENCE_DOI_TAKEN` |
| `PATCH /api/references/:id` | `references.manage` | same fields, all optional; `null` clears a metadata field (never `citationKey`) | 404 `REFERENCE_NOT_FOUND`; as above |
| `POST /api/traits` | `traits.manage` | `{ key, categoryKey, valueType, unit?, description? }` | 409 `TRAIT_KEY_TAKEN`; unknown category → 400 `VALIDATION_FAILED` (path `categoryKey`) |
| `PATCH /api/traits/:id` | `traits.manage` | `{ categoryKey?, description?, active? }` | 404 `TRAIT_NOT_FOUND` |
| `POST /api/traits/:id/levels` | `traits.manage` | `{ key, sortOrder? }` (default `max(sort_order) + 1`) | 409 `LEVEL_KEY_TAKEN` (`lower(key)` per trait); answers the parent trait |
| `PATCH /api/traits/:id/levels/:levelId` | `traits.manage` | `{ key?, sortOrder?, active? }` | 404 `LEVEL_NOT_FOUND` (a level of another trait is not found); 409 `LEVEL_KEY_TAKEN`; answers the parent trait |

`GET /api/traits` drops `Cache-Control: max-age=300` (RFC-62 R5 amendment): the dictionary is now editable and a five-minute HTTP cache would hide the rename the user just made. The dictionary level gains `sortOrder` (`{ id, key, sortOrder, active }`), which the reorder UI needs to move a level past its neighbour.

Field limits: names and keys 1–200 characters; `citationKey` 1–2,000; `title`, `authors`, `journal` up to 1,000; `year` 1500–2100; `doi` and `url` up to 500; `description` up to 2,000; `unit` up to 32; `gbifUsageKey` up to 64. `nameSource` in `NAME_SOURCES`, `valueType` in `TRAIT_VALUE_TYPES`.

A `PATCH` with no changed field is a no-op: 200, no audit row.

**Audit** (RFC-41 amended; `recordAudit` in the same transaction; metadata carries ids and field names only — never a name, which R7 would reject anyway):

| Action | `target_type` / `target_id` | Metadata |
|---|---|---|
| `taxa.created` | `families` / `genera` / `species` / `species_names` and the row id | `{ kind }` (`family`, `genus`, `species`, `species_name`), plus `{ speciesId }` for a name |
| `taxa.updated` | same | `{ kind, fields: [...] }` |
| `references.created` / `references.updated` | `bibliographic_references` / id | `{ fields }` on update |
| `traits.created` / `traits.updated` | `traits` / trait id | `{ fields }`; a level create is `traits.updated` with `{ levelId, fields: ['levels'] }`; a level change is `traits.updated` with `{ levelId, fields }` |
| `dataset.exported` | — | `{ format: 'csv', scope: 'accepted' }` |

**Gotcha** (`docs/gotchas/dataset.md`): `seed:traits` re-inserts any level whose key was renamed, because the CSV in the repository is the source of the vocabulary — a rename done in the UI must also be made in `apps/api/seed/trait-dictionary.csv`. The level editor shows a one-line warning.

## 7. Representations and contracts

`packages/contracts/src/curation.ts` (new): body schemas (`createRecordBodySchema`, `annotateRecordBodySchema`, `setAcceptedBodySchema`, `mapPendingBodySchema`, the catalog bodies), query schemas (`pendingGroupsQuerySchema`, `disputedQuerySchema`) and response schemas below. `dataset.ts` amended: record detail gains `supersedes` and `supersededBy`; species list item gains `unresolvedTaxon`.

- `acceptedState`: `{ current: { id, recordId, valueText, actor: { id, name }, note, decidedAt } | null, history: [{ id, decision, recordId, valueText | null, actor, note, createdAt }] }` (newest first). `current` is `null` when never decided or when the newest decision is `cleared`.
- `record` detail adds `supersedes: { id } | null` and `supersededBy: [{ id }]` (records naming this one; empty array when none).
- `pendingTrait`: `{ trait: { id, key, valueType, unit }, count }`.
- `pendingGroup`: `{ valueText, harmonisation, count, sampleRecordId }`.
- `mapResult`: `{ created, skipped }`.
- `disputedRecord`: record item plus `latestDispute: { id, actor: { id, name }, note, createdAt }`.
- `species` list item: `+ unresolvedTaxon: boolean`.
- `dictionary` level: `+ sortOrder: number`.

Constants: `PERMISSIONS` gains the eight keys of section 3; `ERROR_CODES` gains the codes of section 8; `AUDIT_ACTIONS` (`apps/api/src/audit/actions.ts`) gains the seven actions of section 6.

## 8. Error codes (RFC-12 amendments)

| Code | Status | Meaning |
|---|---|---|
| `RECORD_DUPLICATE` | 409 | The claim already exists; `details[0].message` is the existing record id (RFC-65). |
| `RECORD_WITHDRAWN` | 409 | The record is withdrawn: no annotation, no acceptance (RFC-65). |
| `RECORD_NOT_WITHDRAWABLE` | 409 | Only manual records can be withdrawn (RFC-65). |
| `RECORD_IS_ACCEPTED` | 409 | The record is the current accepted value; change it first (RFC-65). |
| `RECORD_NOT_HARMONISED` | 409 | Only a harmonised record can be the accepted value (RFC-65). |
| `FAMILY_NOT_FOUND`, `GENUS_NOT_FOUND`, `LEVEL_NOT_FOUND` | 404 | Unknown id (RFC-60, RFC-62). |
| `FAMILY_NAME_TAKEN`, `GENUS_NAME_TAKEN`, `SPECIES_NAME_TAKEN`, `TRAIT_KEY_TAKEN`, `LEVEL_KEY_TAKEN`, `REFERENCE_KEY_TAKEN`, `REFERENCE_DOI_TAKEN` | 409 | Unique constraint of the catalog (RFC-60–62). |

`PERMISSION_DENIED` (existing) covers a withdrawal by someone who is neither the author nor a holder of `records.withdraw`.

## 9. Modules (`apps/api/src`)

| Module | Responsibility |
|---|---|
| `dataset/curation.ts` | `createRecord(ctx, input)`, `annotateRecord(ctx, input)`, `setAccepted(ctx, input)`, `getAccepted(db, speciesId, traitId)`. Value validation shared with mapping: `resolveValue(db, trait, value)` → `{ levelId } | { numericValue }` or `AppError`. |
| `dataset/queues.ts` | `pendingTraits(db)`, `pendingGroups(db, { traitId, cursor, limit })`, `mapPending(ctx, input)`, `listDisputed(db, { cursor, limit })`. `listDisputed` runs in two steps: the standing-dispute rows (record id, annotation id, actor id, note, timestamp) come from one SQL query, then the record items go through `itemQuery` and the actor names through a plain `db.select({ name: users.name })` — `users.name` is an `encryptedText` column, so a raw `db.execute` join would return ciphertext (see `docs/gotchas/dataset.md`). |
| `dataset/export.ts` | `acceptedCsv(db)` → `ReadableStream<Uint8Array>`; pure `csvRow(fields)` exported for unit tests. |
| `dataset/catalog.ts` (new) | Every catalog write: `createFamily`/`updateFamily`, `createGenus`/`updateGenus`, `createSpecies`/`updateSpecies`/`addSpeciesName`, `createReference`/`updateReference`, `createTrait`/`updateTrait`, `createLevel`/`updateLevel` — each wrapped in `db.transaction` with `recordAudit` in the same transaction (RFC-41 R5). `dataset/taxa.ts`, `references.ts`, `dictionary.ts` are unchanged read modules; they only gained the getters the writes need to build their response (`getFamily`, `getGenus` in `taxa.ts`; `getTrait` in `dictionary.ts`). `dataset/names.ts` (new) exports `normaliseName(text)` — the TypeScript twin of the importer's SQL `trim(regexp_replace(x, '\s+', ' ', 'g'))` (RFC-60 R2) — with a unit test pinning both to the same cases. |
| `dataset/records.ts` | Detail gains `supersedes` / `supersededBy`; `reviewStatusSql` reused by the queues (and by `curation.ts`). A bare `Column` argument only qualifies correctly inside a multi-table select such as `itemQuery`'s joined query; a caller selecting from `trait_records` alone (`curation.ts`'s `annotateRecord`, `setAccepted`) can still pass a bare column — handled inside the helper (wraps the column in `sql` so a single-table select keeps it qualified; `docs/gotchas/dataset.md`). |
| `http/cursor.ts` | `pageOf(rows, limit, cursorOf)` — the limit + 1 tail shared by every paginated list (the six existing lists migrate). |
| `http/routes/dataset/records.ts` | `POST /`, `POST /:id/annotations`, `GET /pending/traits`, `GET /pending`, `POST /pending/map`, `GET /disputed` — literal paths registered before `/:id`. |
| `http/routes/dataset/species.ts` | `POST /`, `PATCH /:id`, `POST /:id/names`, `GET` and `PUT /:id/traits/:traitId/accepted`. |
| `http/routes/dataset/taxa.ts`, `references.ts`, `traits.ts` | The catalog writes. |
| `http/routes/dataset/export.ts` | `GET /export/accepted.csv`, mounted in `dataset/index.ts`. |

Services take `ctx` (`AuthContext`: `db`, `now`) and the actor id, run in `ctx.db.transaction`, and throw `AppError`s; routes stay thin, as `admin/roles.ts` does.

## 10. Web (`apps/web`)

Rules: no business logic (RFC-02) — statuses, permissions and validation outcomes come from the API; buttons render only with the permission (`hasPermission(me, …)`), the API decides. Identity tokens and fonts of `docs/specs/2026-09-12-visual-identity.md`; no motion. Forms live in `Dialog`; an API error shows inline (`Alert`, `details` mapped to fields where a path matches); success closes the dialog and invalidates the queries it affects. Typed calls in `api/curation.ts`, components in `components/curation/` and `components/catalog/`, pages in `pages/curation/` and `pages/catalog/`.

### 10.1 Form primitives (07b, `components/ui/`)

- `Select` (native `<select>` styled), `Textarea`.
- `Combobox`: text input + listbox (`role="combobox"`, `aria-expanded`, `aria-activedescendant`, arrow keys, Enter, Escape, click outside), asynchronous options through a `search(q)` callback (debounced), controlled `value: { id, label } | null`, optional trailing "Create '<text>'" option when the caller passes `onCreate`. Used for traits, references, genera, species.
- `Drawer` gains a focus trap and marks the background `inert` while open (carried-over follow-up; forms now live in drawers).

### 10.2 Species page actions (07b, `/app/species/$id`)

- Header button **Add value** (`records.create`) opens the add-value dialog: trait combobox over the dictionary (active traits only) → the value control follows `valueType` (level `Select` of active levels, or number `Input` with the unit as suffix) → primary reference combobox (`/api/references?q=`, with inline create when `references.manage`) → optional secondary reference → optional "As written in the source" (`rawValue`) → optional note. Each trait card carries the same button with the trait preselected. On 409 `RECORD_DUPLICATE` the dialog shows the message with an "Open existing record" link that opens the record drawer. Success invalidates the species summary, the trait's record list and the record detail.
- `TraitPanel` shows the current accepted value from `summary.accepted` with **Clear** (`accepted.manage`, note required) and **History** (`GET …/accepted`, list of decisions); the accepted record's row in the table carries an "accepted" badge.
- `RecordDrawer` gains an **Actions** section: Confirm / Neutral / Dispute (note) with `records.annotate`; Withdraw (note) when `origin = 'manual'` and (`createdBy.id === me.id` or `records.withdraw`); **Set as accepted** with `accepted.manage` when `harmonisation = 'harmonised'` and `review ≠ 'withdrawn'`. A **Harmonisation** section links "Harmonises record X" / "Harmonised as record Y" when `supersedes` / `supersededBy` are set.

### 10.3 Queues and export (07b)

Navigation gains a **Curation** group: Pending (`/app/curation/pending`), Disputed (`/app/curation/disputed`), Unresolved taxa (`/app/species?unresolved=true` — the species route gains `validateSearch` for `unresolved`, and the page reads its initial toggle state from it). All three visible with `dataset.read`.

- **Pending**: left column lists the traits with pending counts (`/api/records/pending/traits`); the selected trait's groups on the right (value, pending kind badge, count, "View sample" opening the record drawer). **Map** (`records.create`) opens a dialog: for a categorical trait a multi-select of active levels (checkbox list; one or several), for a quantitative trait a number input; optional note. The result (`created`, `skipped`) shows inline; the group disappears from the list when nothing is left. A trait with `traits.manage` shows a "Manage levels" link to `/app/traits` (07c) for the case where the right level does not exist yet.
- **Disputed**: paginated table of disputed records (species, trait, value, disputer, note, date); a row opens the record drawer, whose actions resolve the dispute (a curator sets or clears the accepted value; the disputer changes their stance).
- **Export**: button "Export accepted values (CSV)" in the `/app/species` page header, visible with `dataset.export`, rendered as `<a href="/api/export/accepted.csv" download>`.

### As delivered (plan 07b)

Sections 10.1–10.3 above are the design; the implementation differs in a few small ways, kept here rather than edited into the design text above:

- `Combobox`'s keyboard model is roving focus among the option `<button>`s, not `aria-activedescendant` — the options are real focusable buttons, and jsdom does not implement `aria-activedescendant` either (`docs/gotchas/web.md`).
- `AddValueDialog` and `MapDialog` are mounted only while open (no `open` prop) rather than always rendered and toggled — their initial state depends on what opened them (the preselected trait, the pending group), so a fresh mount is simpler than resetting state on every open (`docs/gotchas/web.md`).
- The accepted-row badge in `RecordTable` reads `acceptedRecordId` from the trait summary's `summary.accepted.recordId` (already fetched for the trait panel) rather than issuing a second query.
- The unresolved-taxa navigation entry is a plain `Link` with `search={{ unresolved: true }}` to `/app/species`, not a separate route.
- The pages adopt the workspace UI kit of `docs/specs/2026-09-13-workspace-ui-pattern.md`, merged onto `main` mid-plan (PR #52): the kit's type scale (`text-title`/`text-section`/`text-card`/`text-body`/`text-cell`/`text-meta`/`text-label`, never `text-xs`/`text-sm`/`text-lg`/`text-2xl`/`text-base`), `Button size="sm"` for row and inline-form actions, and the navigation gains a `curation` section alongside `data`/`admin`/`account`.
- `AddValueDialog` runs explicit required-field checks before handing the form to the shared `createRecordBodySchema` — Zod's `value` union collapses an empty number input to the single path `value`, which cannot address the two distinct fields (`value.levelId`, `value.numeric`) the field errors need to target.
- `AcceptedSection` fetches `GET /api/species/:id/traits/:traitId/accepted` once for both the current decision and the history (the response carries both); "Show history" only reveals what that one request already returned.
- Withdraw in the drawer also requires `records.annotate`: the route `POST /api/records/:id/annotations` is guarded by that permission for every kind, so the author-or-`records.withdraw` rule of RFC-65 R4 applies on top of it, and the button is offered only to a `records.annotate` holder.

### 10.4 Catalog editors (07c)

- `/app/traits` with `traits.manage`: **New trait** dialog (key, category, value type, unit, description); per trait **Edit** (category, description, active); levels: **Add level**, rename, move up / down (`PATCH sortOrder` swapping with the neighbour), activate / deactivate; the rename dialog carries the seed warning of section 6. The dictionary query is invalidated after every write.
- `/app/references` gains **New reference**; `/app/references/$id` gains **Edit** (all metadata and the citation key), both with `references.manage`.
- `/app/species/$id` with `taxa.manage`: **Edit species** (canonical name, name source, genus combobox with inline "Create genus" → family `Select` with inline "Create family"); **Add alternative name** (name, GBIF usage key).
- `/app/taxa` (navigation entry **Taxa**, `taxa.manage`): families list with rename and create; selecting a family lists its genera with rename, move to another family and create. Small page: the one place where a family or a genus can be renamed.

### As delivered (plan 07c)

- **New species** on `/app/species` (header, `taxa.manage`) opens the species dialog in create mode — section 10.4 only listed the edit; `POST /api/species` existed (section 6) and a species missing from the catalog has no other way in but an import.
- Family and genus are created inline from the species dialog (a "New family" input beside the family `Select`; the genus `Combobox`'s create option under the chosen family); `/app/taxa` is where they are renamed and moved.
- Edit dialogs send only the changed fields (`null` to clear an optional one) and close without a request when nothing changed — the `PATCH` bodies are `nonEmpty` (`docs/gotchas/web.md`).
- A level move is two `PATCH`es (moved level first) swapping the `sortOrder`s (`docs/gotchas/web.md`).
- The trait key, value type and unit are shown as text in the edit dialog with a hint that they are immutable (RFC-62 R6).
- The kit gained `ButtonLink` / `buttonClassName` (navigation dressed as a button) and `api/query.ts` holds the one `withQuery`.
- Both trait dialogs gate their `Alert` with `!isValidationError(error)` (`lib/errors.ts`) rather than the plan's single-field sample, so it never shows beside a field-level `VALIDATION_FAILED` message — the codebase's existing convention for that trade-off.
- `LevelsEditor`'s move invalidates the dictionary in `onSettled`, not only on success, so a failed second `PATCH` still refetches and the tie between the two levels is visible.

## 11. RFCs and amendments

| RFC | Change |
|---|---|
| RFC-65 Curation (new) | Manual records (4.1), annotations and withdrawal (4.2), accepted value (4.3), pending definition, queue and mapping (4.4), disputed queue (4.5), representations (7), codes (8). |
| RFC-66 Export (new) | Route, permission, columns, order, streaming, CSV format, audit (5). |
| RFC-30 | Eight permissions (3). |
| RFC-12 | Codes of section 8. |
| RFC-41 | Actions of section 6. |
| RFC-60 | R6 item gains `unresolvedTaxon`; new R9 write routes for families, genera, species and names (6). R5 wording: "no route deletes, merges or renames taxa" → "no route deletes or merges taxa; renames are R9". |
| RFC-61 | New R6 write routes; R5 wording: "no route deletes references; edits are R6". |
| RFC-62 | R5 drops the `Cache-Control` sentence and adds `sortOrder` to the level shape; new R6 write routes for traits and levels, immutability of key / value type / unit, the seed gotcha. |
| RFC-63 | R1 `supersedes_record_id`; R2 converse check and the relaxed manual-reference rule; R8 detail gains `supersedes` / `supersededBy`. |
| RFC-64 | R6 exponent and magnitude bound. |
| RFC-11 | Note on file responses (5). |
| RFC-13 | New R10: dialogs and drawers trap focus and mark the background `inert` while open. |

Index in `docs/rfc/README.md` gains RFC-65 and RFC-66. Every new rule gets its `@rfc` tag; `pnpm rfc:check` enforces.

## 12. Testing

- **Unit** (`api:unit`): value resolution per `valueType`; number rule (`1e200000`, `1e400`, `1e99`, `.5`, `1,5`, `+3`, `-0`); `normaliseName`; `pageOf`; composite cursor with a 2,000-character text part; `csvRow` quoting (comma, quote, CR, LF, BOM); contracts catalogs (permissions and codes mirror RFC-30 and RFC-12); `AUDIT_ACTIONS` mirrors RFC-41.
- **Integration** (`api:integration`, Postgres 18 + Redis 8): every route — status, envelope, 404s, 409s; the route-guard meta-test covers the new routes automatically. `POST /api/records`: manual categorical, manual quantitative, inactive level / trait, wrong value shape, duplicate answering the existing id, `value_text` canonical form. Annotations: confirm / dispute / neutral change the review as RFC-63 R6 says; withdraw by author, by a `records.withdraw` holder, by a third party (403), on an import record (409), on the accepted record (409); anything on a withdrawn record (409). Accepted: set, replace, clear, idempotent repeat inserts nothing, non-harmonised and withdrawn refused, wrong species × trait refused, history order. Pending: traits and groups reflect the fixture; mapping a categorical group, a `multi_value` group with two levels (two records per pending row), a `not_numeric` group with a number; a claim collision counts as `skipped`; the group leaves the queue; `supersedes` / `supersededBy` on the details. Disputed: appears after a dispute, leaves after an accepted decision or a later `neutral` by the disputer. Export: columns, quoting, BOM, order, one row per species × trait, audit row. Catalog: every 409; a level rename keeps the records' `level_id` and `value_text`; `active = false` removes the level from manual entry and keeps the records; immutable trait fields are not in the schema; no-op `PATCH` writes no audit row; audit metadata carries ids and fields only. Migration: converse CHECK rejects an inconsistent insert; the append-only privileges of `0012` still hold.
- **Web** (Vitest + testing-library, mocked fetch): `Combobox` keyboard navigation and inline create; add-value dialog switching controls by value type and mapping `RECORD_DUPLICATE` to the link; drawer actions rendered by permission and authorship; pending page (select trait, map a group, group disappears); disputed page; catalog editors (rename, reorder, 409 inline); species route search param `unresolved`.
- **Manual** (dev stack with the sample): map `reds` → `red` on a categorical trait, dispute and accept on one species, export and open the file in a spreadsheet, `pnpm rfc:check` green.

## 13. Delivery

| Plan | Branch | Content |
|---|---|---|
| 07a `docs/plans/2026-09-13-curation-07a-api.md` | `feat/curation-07a` | RFC-65, RFC-66, amendments, migrations 0013–0014, contracts, services, routes, export, `pageOf`, number rule, `unresolvedTaxon`, gotchas, README. |
| 07b `docs/plans/2026-09-13-curation-07b-web.md` | `feat/curation-07b` | Form primitives, species page actions, queues, export button, `Drawer` focus trap, species route search param. |
| 07c `docs/plans/2026-09-13-curation-07c-catalog.md` | `feat/curation-07c` | Traits and levels editor, reference editor, species editor and alternative names, `/app/taxa`. |

Each plan runs through subagent-driven development, one CodeRabbit run per PR, and merges to `main` before the next branch starts.

## 14. Out of scope and issues to file

Issues (label `tech-debt`) for the carried-over items that do not land here: `seed.ts` COPY without the idle guard (and the postgres.js 3.4.9 upstream report); imports layout route for the permission gate; consolidating the two 403 mappers; mapping `VALIDATION_FAILED` on detail routes to the not-found sentence. The secondary-reference index is covered by #47; the Playwright smoke belongs to plan 05c (#20).

Later plans: species and reference merges (renames with history across duplicates); WCVP / GBIF lookups when creating a species; free-text values; "best available" rows in the export; resource-level permissions (RFC-32 R7).
