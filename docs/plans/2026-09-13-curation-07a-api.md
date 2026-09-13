# Curation 07a — API: Manual Records, Annotations, Accepted Values, Queues, Catalog Writes, Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`).

**Goal:** The write side of the scientific dataset as an API: manual trait records, confirm / dispute / neutral / withdraw annotations, the accepted value per species and trait, the harmonisation queue with bulk mapping, the disputed queue, create/edit routes for taxa, references, traits and levels with audit entries, and the streamed CSV export of accepted values — RFC-65, RFC-66 and the amendments they force.

**Architecture:** New services `apps/api/src/dataset/curation.ts` (records, annotations, accepted values), `queues.ts` (pending traits and groups, bulk mapping, disputed list), `catalog.ts` (every catalog write, each in a transaction with its `recordAudit`), `export.ts` (accepted CSV as a `ReadableStream` over a postgres.js cursor) and `names.ts` (name normalisation); routes added to the existing files under `apps/api/src/http/routes/dataset/` plus `export.ts`, every one behind `requirePermission`. Every curation write is an `INSERT` into an append-only table (`trait_records`, `record_annotations`, `accepted_values`); a harmonised record may name the pending record it replaces through the new column `trait_records.supersedes_record_id`. Catalog writes are `UPDATE`s of mutable catalog tables and are the only writes that emit RFC-41 entries (plus the export).

**Tech Stack:** unchanged from plan 06 (Node 24.21, TypeScript 7.0, Hono 4.13, Zod 4.6, Drizzle 0.45.2 + drizzle-kit 0.31.10 + postgres.js 3.4, Vitest 5.0 + testcontainers 12.1, Biome 2.5). No new dependencies.

**Spec:** `docs/specs/2026-09-13-curation-design.md` (committed on this branch: `7363c5b`, `c5681f6`). Epic: issue #45. Plans 07b (web curation) and 07c (web catalog editors) follow this one and read the same spec.

## Global Constraints

- All artifacts in English: code, comments, docs, RFCs, commit messages. Conversation with the owner in Portuguese.
- Exact versions in `package.json`; no new dependencies in this plan. Prefix every command with `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH` on the development machine.
- RFC first (RFC-00 R6): write or amend the RFC, then the failing test, then the code. RFC-65 and RFC-66 start as `draft` and become `accepted` in the last task; amendments to accepted RFCs get a changelog line dated 2026-09-13.
- Every exported symbol under `apps/*/src` and `packages/*/src` carries a JSDoc `@rfc RFC-NN [Rx…]` tag (type-only exports and re-exports exempt). `pnpm rfc:check` fails otherwise. Files under `apps/api/test/` are exempt.
- TDD (RFC-01): failing test first, seen failing for the expected reason, then the minimum code. No database mocks; integration tests use real Postgres 18 and Redis 8 via testcontainers (Docker running). Tests name the rule they verify.
- Unit tests: `src/**/*.test.ts` (project `api:unit`, no containers); Postgres/Redis: `src/**/*.integration.test.ts` (project `api:integration`; the trait dictionary is seeded by `test/global-setup.ts`).
- Integration test files share one database and run in parallel (`docs/gotchas/testing.md`): every test creates its own species, references, traits and records with random names through `test/helpers/dataset.ts` and asserts only on them. Never rename, deactivate or add levels to a seeded dictionary trait in a test — create a trait with `createTrait` and work on that one. Queue endpoints are global: assert that your own rows are present or absent, never on the whole list.
- Services throw `AppError` with an RFC-12 code; routes do not translate errors. Catalog writes run inside `db.transaction` and call `recordAudit` in the same transaction (RFC-41 R5). Audit metadata carries ids and field names only (RFC-41 R7).
- Raw SQL only through the `sql` template tag (Drizzle's or postgres.js's); never string concatenation (RFC-10 R6).
- Relative imports use explicit `.ts` extensions. Only erasable TypeScript syntax.
- Run `pnpm lint:fix`, `pnpm typecheck`, `pnpm rfc:check` and the relevant tests before every commit; conventional commit messages; one commit per task unless the task says otherwise. Commit messages end with the attribution lines the session reminder gives.
- Branch: `feat/curation-07a` from `main`, checked out in `/Users/rafael/Documents/Aplicativos/Elisa` (no worktree). The spec is already committed there.
- The route-guard meta-test `apps/api/src/routes-guarded.integration.test.ts` lists every route exactly; each task that adds routes appends them to that list (and to `withBody` when the route takes a JSON body) in the same commit, or the suite fails.
- Run integration tests for one file with `pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration <path>`; unit tests with `--project api:unit`; contracts tests with `pnpm --filter @treerepro/contracts exec vitest run <path>`; web tests with `pnpm --filter @treerepro/web test`.
- The web package validates API payloads with the shared Zod schemas, so a schema change here breaks web fixtures: Tasks 3, 6 and 13 update `apps/web/src/test/dataset-fixtures.ts` (and the two inline fixtures named there) and run the web tests before committing.

## Setup (before Task 1)

```bash
cd /Users/rafael/Documents/Aplicativos/Elisa
git status --short   # clean, on feat/curation-07a
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm install
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts build
docker info > /dev/null   # testcontainers needs the daemon
```

## File structure (end state of this plan)

```
docs/rfc/60-dataset/65-curation.md                           # new (Task 1)
docs/rfc/60-dataset/66-dataset-export.md                     # new (Task 1)
docs/rfc/10-platform/11-api-conventions.md                   # R2 exception for file downloads
docs/rfc/10-platform/12-error-codes.md                       # + 15 codes
docs/rfc/30-access/30-permission-catalog.md                  # + 8 permissions
docs/rfc/40-data-protection/41-audit-log.md                  # + 7 actions
docs/rfc/60-dataset/60-taxonomy-catalog.md                   # R5, R6, R7 amended; R9, R10 new
docs/rfc/60-dataset/61-bibliographic-references.md           # R5 amended; R6 new
docs/rfc/60-dataset/62-trait-dictionary.md                   # R5 amended; R6 new
docs/rfc/60-dataset/63-trait-records.md                      # R1, R2, R8 amended
docs/rfc/60-dataset/64-bulk-import.md                        # R6 amended
docs/rfc/README.md                                           # index rows for RFC-65, RFC-66
docs/gotchas/dataset.md                                      # new: seed re-inserts renamed levels; CASE-guarded numeric cast; array_agg sample id
apps/api/drizzle/0013_permissions_curation.sql               # custom: 8 permission rows
apps/api/drizzle/0014_records_supersedes.sql                 # generated: column, index, checks
apps/api/src/db/schema/records.ts                            # supersedesRecordId, checks
apps/api/src/db/schema/dataset.integration.test.ts           # new constraints
apps/api/src/db/errors.ts                                    # violatedConstraint
apps/api/src/audit/actions.ts                                # + 7 actions
apps/api/src/http/cursor.ts (+ .test.ts)                     # pageOf
apps/api/src/dataset/names.ts (+ .test.ts)                   # normaliseName
apps/api/src/dataset/import.ts (+ .test.ts)                  # number rule: length, exponent, magnitude
apps/api/src/dataset/taxa.ts                                 # pageOf, unresolvedTaxon on items, getFamily, getGenus
apps/api/src/dataset/references.ts                           # pageOf
apps/api/src/dataset/dictionary.ts                           # level sortOrder, getTrait
apps/api/src/dataset/records.ts                              # pageOf; itemQuery/toItem exported; supersedes fields
apps/api/src/dataset/curation.ts (+ .integration.test.ts)    # createRecord, annotateRecord, setAccepted, getAccepted, resolveValue
apps/api/src/dataset/queues.ts (+ .integration.test.ts)      # pendingTraits, pendingGroups, mapPending, listDisputed
apps/api/src/dataset/catalog.ts (+ .integration.test.ts)     # every catalog write + audit
apps/api/src/dataset/export.ts (+ .test.ts, .integration.test.ts)  # acceptedCsv, csvRow
apps/api/src/http/routes/dataset/records.ts (+ .integration.test.ts)   # POST /, /:id/annotations, /pending*, /disputed
apps/api/src/http/routes/dataset/species.ts (+ .integration.test.ts)   # POST /, PATCH /:id, POST /:id/names, GET+PUT accepted
apps/api/src/http/routes/dataset/taxa.ts (+ .integration.test.ts)      # POST/PATCH families, genera
apps/api/src/http/routes/dataset/references.ts (+ .integration.test.ts) # POST /, PATCH /:id
apps/api/src/http/routes/dataset/traits.ts (+ .integration.test.ts)    # POST /, PATCH /:id, levels; no Cache-Control
apps/api/src/http/routes/dataset/export.ts (+ .integration.test.ts)    # GET /export/accepted.csv
apps/api/src/http/routes/dataset/index.ts                    # mounts export
apps/api/src/routes-guarded.integration.test.ts              # 22 more routes
apps/api/test/helpers/dataset.ts                             # createTrait, createAnnotation, createAcceptedValue, supersedesRecordId
packages/contracts/src/curation.ts (+ .test.ts)              # bodies, queries, responses
packages/contracts/src/dataset.ts                            # unresolvedTaxon on items; level sortOrder; detail supersedes
packages/contracts/src/permissions.ts                        # + 8 keys
packages/contracts/src/error-codes.ts                        # + 15 codes
packages/contracts/src/index.ts                              # exports curation
apps/web/src/test/dataset-fixtures.ts                        # fixtures follow the schemas
apps/web/src/api/dataset.test.ts, apps/web/src/pages/dataset/SpeciesSearchPage.test.tsx  # inline species fixtures
README.md                                                    # layout and commands
```

## Shared interfaces (defined once, used by every task)

```ts
// packages/contracts/src/curation.ts (Task 5)
export const recordValueSchema;            // { levelId: uuid } | { numeric: finite number, |n| < 1e308 }
export const createRecordBodySchema;       // { speciesId, traitId, value, primaryReferenceId, secondaryReferenceId?, rawValue?, note? }
export const annotateRecordBodySchema;     // { kind, note? } — note required for dispute/withdraw
export const setAcceptedBodySchema;        // { decision: 'accepted', recordId, note? } | { decision: 'cleared', note }
export const speciesTraitParamSchema;      // { id: uuid, traitId: uuid }
export const traitLevelParamSchema;        // { id: uuid, levelId: uuid }
export const pendingGroupsQuerySchema;     // cursorQuerySchema + { traitId: uuid }
export const mapPendingBodySchema;         // { traitId, valueText, value: { levelIds: uuid[1..20] } | { numeric }, note? }
export const acceptedStateSchema;          // { current, history }
export const pendingTraitSchema, pendingGroupSchema, mapResultSchema, disputedRecordSchema;
export const familyBodySchema, createGenusBodySchema, updateGenusBodySchema, createSpeciesBodySchema,
  updateSpeciesBodySchema, speciesNameBodySchema, createReferenceBodySchema, updateReferenceBodySchema,
  createTraitBodySchema, updateTraitBodySchema, createLevelBodySchema, updateLevelBodySchema;
export type RecordValue, CreateRecordBody, AnnotateRecordBody, SetAcceptedBody, AcceptedState, AcceptedCurrent,
  AcceptedHistoryEntry, PendingTrait, PendingGroup, MapPendingBody, MapResult, DisputedRecord, …Body types.

// apps/api/src/http/cursor.ts (Task 3)
export function pageOf<Row>(rows: Row[], limit: number, cursorOf: (last: Row) => string): { page: Row[]; nextCursor: string | null };

// apps/api/src/dataset/names.ts (Task 4)
export function normaliseName(text: string): string;   // trim + collapse internal whitespace to one space

// apps/api/src/dataset/import.ts (Task 4)
export const NUMBER_PATTERN: RegExp;                    // exponent limited to 1–3 digits
export const NUMBER_MAX_LENGTH = 64;
export function isHarmonisableNumber(text: string): boolean;

// apps/api/src/db/errors.ts (Task 2)
export function violatedConstraint(err: unknown): string | undefined;

// apps/api/src/dataset/records.ts (Task 6)
export function itemQuery(db: DbExecutor);              // the joined select behind record items (exported)
export function toItem(row: ItemRow): RecordItem;       // exported
export type ItemRow;

// apps/api/src/dataset/curation.ts (Tasks 6–8)
export type ResolvedValue = { levelId: string; levelKey: string; numericValue: null } | { levelId: null; levelKey: null; numericValue: number };
export async function resolveValue(db, trait: { id: string; valueType: TraitValueType }, value: RecordValue, path?: string): Promise<ResolvedValue>;
export async function requireTrait(db, traitId): Promise<{ id; key; valueType; unit; active }>;   // 404 TRAIT_NOT_FOUND
export async function requireSpecies(db, speciesId): Promise<{ id }>;                             // 404 SPECIES_NOT_FOUND
export async function currentAccepted(db, speciesId, traitId): Promise<{ decision; recordId: string | null } | null>;
export async function createRecord(db, input: { actorId; speciesId; traitId; value: RecordValue; primaryReferenceId; secondaryReferenceId?; rawValue?; note? }): Promise<RecordDetail>;
export async function annotateRecord(db, input: { recordId; actorId; kind: AnnotationKind; note?; canWithdrawAny: boolean }): Promise<RecordDetail>;
export async function getAccepted(db, speciesId, traitId): Promise<AcceptedState>;
export async function setAccepted(db, input: { speciesId; traitId; actorId; decision; recordId?; note? }): Promise<AcceptedState>;

// apps/api/src/dataset/queues.ts (Tasks 9–10)
export async function pendingTraits(db): Promise<PendingTrait[]>;
export async function pendingGroups(db, input: { traitId; cursor?; limit }): Promise<{ data: PendingGroup[]; nextCursor: string | null }>;
export async function mapPending(db, input: { actorId; traitId; valueText; value: MapPendingBody['value']; note? }): Promise<MapResult>;
export async function listDisputed(db, input: { cursor?; limit }): Promise<{ data: DisputedRecord[]; nextCursor: string | null }>;

// apps/api/src/dataset/export.ts (Task 11)
export const EXPORT_COLUMNS: readonly string[];
export function csvRow(fields: ReadonlyArray<string | number | null>): string;   // RFC 4180 line with CRLF
export function acceptedCsv(db: Db): ReadableStream<Uint8Array>;

// apps/api/src/dataset/catalog.ts (Tasks 12–13) — every function: db.transaction + recordAudit
export async function createFamily(db, { name, actorId }): Promise<TaxonRef>;
export async function updateFamily(db, { id, name, actorId }): Promise<TaxonRef>;
export async function createGenus(db, { name, familyId?, actorId }): Promise<Genus>;
export async function updateGenus(db, { id, name?, familyId?: string | null, actorId }): Promise<Genus>;
export async function createSpecies(db, { canonicalName, nameSource, genusId?, actorId }): Promise<Species>;
export async function updateSpecies(db, { id, canonicalName?, nameSource?, genusId?: string | null, actorId }): Promise<Species>;
export async function addSpeciesName(db, { speciesId, name, gbifUsageKey?, actorId }): Promise<Species>;
export async function createReference(db, { citationKey, title?, authors?, year?, journal?, doi?, url?, actorId }): Promise<ReferenceDetail>;
export async function updateReference(db, { id, …same fields nullable, actorId }): Promise<ReferenceDetail>;
export async function createTrait(db, { key, categoryKey, valueType, unit?, description?, actorId }): Promise<Trait>;
export async function updateTrait(db, { id, categoryKey?, description?, active?, actorId }): Promise<Trait>;
export async function createLevel(db, { traitId, key, sortOrder?, actorId }): Promise<Trait>;
export async function updateLevel(db, { traitId, levelId, key?, sortOrder?, active?, actorId }): Promise<Trait>;

// apps/api/src/dataset/taxa.ts, dictionary.ts (Tasks 3, 12, 13)
export async function getFamily(db, id): Promise<TaxonRef | null>;
export async function getGenus(db, id): Promise<Genus | null>;
export async function getTrait(db, id): Promise<Trait | null>;

// apps/api/test/helpers/dataset.ts (Task 2)
createRecord(db, { …, supersedesRecordId?: string })
createTrait(db, { key?, valueType?: 'categorical' | 'quantitative', unit?, categoryKey?, levels?: string[] }) → { id, key, valueType, unit, levels: { id, key }[] }
createAnnotation(db, { recordId, actorId, kind, note? }) → { id }
createAcceptedValue(db, { speciesId, traitId, actorId, recordId?: string | null, decision?, note? }) → { id }
```

---

### Task 1: RFC-65 and RFC-66 drafts; amendments to RFC-11, 12, 30, 41, 60–64 and the index; catalogs; migration 0013

**Files:**
- Create: `docs/rfc/60-dataset/65-curation.md`, `docs/rfc/60-dataset/66-dataset-export.md`
- Modify: `docs/rfc/10-platform/11-api-conventions.md`, `docs/rfc/10-platform/12-error-codes.md`, `docs/rfc/30-access/30-permission-catalog.md`, `docs/rfc/40-data-protection/41-audit-log.md`, `docs/rfc/60-dataset/60-taxonomy-catalog.md`, `docs/rfc/60-dataset/61-bibliographic-references.md`, `docs/rfc/60-dataset/62-trait-dictionary.md`, `docs/rfc/60-dataset/63-trait-records.md`, `docs/rfc/60-dataset/64-bulk-import.md`, `docs/rfc/README.md`
- Modify: `packages/contracts/src/permissions.ts`, `packages/contracts/src/error-codes.ts`, `apps/api/src/audit/actions.ts`
- Create: `apps/api/drizzle/0013_permissions_curation.sql` (via `db:generate --custom`)
- Test: `packages/contracts/src/permissions.test.ts`, `packages/contracts/src/error-codes.test.ts`, `apps/api/src/audit/actions.test.ts`, `apps/api/src/db/schema/access.integration.test.ts` (all existing; they compare code with the RFC tables and the `permissions` rows)

**Interfaces:**
- Produces: the eight `PermissionKey`s, the fifteen `ErrorCode`s and the seven `AuditAction`s every later task uses.

- [ ] **Step 1: Write RFC-65**

Create `docs/rfc/60-dataset/65-curation.md`:

````markdown
# RFC-65 — Curation

| Field | Value |
|---|---|
| Status | draft |
| Category | dataset |
| Supersedes | — |

## Context

Specialist scientists add trait values with their bibliographic reference, confirm or dispute existing claims, decide the accepted value per species and trait, and harmonise the rows the import could not. Records stay immutable (RFC-63 R4): every step here is an insert into `trait_records`, `record_annotations` or `accepted_values`, each row carrying its actor and time. No free text enters a value: a manual value is an active level of the trait or a number in the trait's unit; the source's wording is kept apart as `raw_value`.

## Rules

- **R1** `POST /api/records` (`records.create`) creates a manual record from `{ speciesId, traitId, value, primaryReferenceId, secondaryReferenceId?, rawValue?, note? }`, where `value` is `{ levelId }` for a categorical trait or `{ numeric }` for a quantitative one; `rawValue` and `note` are 1–2,000 characters, trimmed. Checks, in order: species (404 `SPECIES_NOT_FOUND`), trait (404 `TRAIT_NOT_FOUND`; inactive → 400 `VALIDATION_FAILED`, path `traitId`), references (404 `REFERENCE_NOT_FOUND`, the detail path naming `primaryReferenceId` or `secondaryReferenceId`), the shape of `value` against `value_type` (400, path `value`), the level belonging to the trait and active (400, path `value.levelId`), the number per RFC-64 R6 (400, path `value.numeric`). The row is stored with `origin = 'manual'`, `harmonisation = 'harmonised'`, `created_by` = the actor, `level_id` or `numeric_value`, and `value_text` = the level key or the number as PostgreSQL prints `numeric` (`(value::numeric)::text`, so `1e3` is stored as `1000`). Answers 201 with the record detail (RFC-63 R8).
- **R2** A claim that already exists (RFC-63 R3) answers 409 `RECORD_DUPLICATE` with `details: [{ path: 'recordId', message: <existing record id> }]`: the client is told to confirm the existing record instead of adding it again.
- **R3** `POST /api/records/:id/annotations` (`records.annotate`) appends `{ kind, note? }` with `kind` one of `confirm`, `dispute`, `neutral`, `withdraw`; `note` is 1–2,000 characters and required for `dispute` and `withdraw` (400, path `note`). Unknown record → 404 `RECORD_NOT_FOUND`. A record whose review is `withdrawn` accepts no annotation of any kind: 409 `RECORD_WITHDRAWN`. Answers 201 with the record detail, its review recomputed.
- **R4** `withdraw` is allowed only on `origin = 'manual'` records (409 `RECORD_NOT_WITHDRAWABLE`), only by the record's `created_by` or by a holder of `records.withdraw` (403 `PERMISSION_DENIED`), and never on the record that is the current accepted value of its species and trait (409 `RECORD_IS_ACCEPTED`; change the accepted value first).
- **R5** A dispute is one actor's stance and only that actor changes it, by a later `neutral` or `confirm` (RFC-63 R6). No route neutralises another actor's stance. `accepted.manage` decides the accepted value; it does not close disputes.
- **R6** `PUT /api/species/:id/traits/:traitId/accepted` (`accepted.manage`) takes `{ decision: 'accepted', recordId, note? }` or `{ decision: 'cleared', note }` (`note` 1–2,000 characters). Unknown species or trait → 404 `SPECIES_NOT_FOUND` / `TRAIT_NOT_FOUND`. Accepting requires the record to exist (404 `RECORD_NOT_FOUND`), to belong to the species and trait (400 `VALIDATION_FAILED`, path `recordId`), to be `harmonised` (409 `RECORD_NOT_HARMONISED`) and not `withdrawn` (409 `RECORD_WITHDRAWN`). When the request equals the current state — the same record already accepted, or `cleared` while nothing is accepted — nothing is inserted. Answers 200 with the accepted state (R11). `GET /api/species/:id/traits/:traitId/accepted` (`dataset.read`) answers the same state.
- **R7** A record is *pending* when its `harmonisation` is `unknown_level`, `multi_value` or `not_numeric` and no record names it in `supersedes_record_id` (RFC-63 R1). `empty` records are never pending: there is nothing to map. A record that supersedes another is its harmonised reading: same species, same primary and secondary references, `raw_value` = the superseded record's `raw_value` or, when that is null, its `value_text`. The superseded record keeps its own review axis untouched.
- **R8** `GET /api/records/pending/traits` (`dataset.read`) answers `[{ trait: { id, key, valueType, unit }, count }]` for every trait with at least one pending record, `count` descending then key ascending, unpaginated. `GET /api/records/pending?traitId=&cursor=&limit=` (`dataset.read`; `traitId` required, unknown → 404 `TRAIT_NOT_FOUND`) answers that trait's pending groups `{ valueText, harmonisation, count, sampleRecordId }` — one per distinct `value_text`, `count` descending then `valueText` ascending, composite cursor `[count, valueText]` (RFC-11 R6); `sampleRecordId` is the newest pending record of the group.
- **R9** `POST /api/records/pending/map` (`records.create`) takes `{ traitId, valueText, value, note? }` where `value` is `{ levelIds }` (1–20 distinct ids) for a categorical trait or `{ numeric }` for a quantitative one, validated as in R1 (inactive trait, foreign or inactive level, number rule). In one statement it inserts, for every pending record of the group (same `trait_id`, same `value_text`) and every chosen level (or the one number), a manual record per R7 with `supersedes_record_id` set and `note` copied, `ON CONFLICT ON CONSTRAINT trait_records_claim_key DO NOTHING`. Answers 200 `{ created, skipped }`: `created` the rows inserted, `skipped` = pending × chosen − created (claims that already existed; their pending originals stay in the queue for a manual decision). An empty group answers `{ created: 0, skipped: 0 }`.
- **R10** `GET /api/records/disputed?cursor=&limit=` (`dataset.read`) lists the records whose review is `disputed` (RFC-63 R6) and whose species and trait have no `accepted_values` row created after the *standing dispute* — the newest annotation among the actors whose latest stance is `dispute`. Item: the record item (RFC-63 R8) plus `latestDispute: { id, actor: { id, name }, note, createdAt }`. Order: standing dispute newest first; keyset cursor on its annotation id.
- **R11** Representations. Accepted state: `{ current: { id, recordId, valueText, actor: { id, name }, note, decidedAt } | null, history: [{ id, decision, recordId, valueText, actor, note, createdAt }] }` — history newest first; `current` is null when never decided or when the newest decision is `cleared`; `valueText` is null on a `cleared` entry. The record detail (RFC-63 R8) adds `supersedes: { id } | null` and `supersededBy: [{ id }]`. Map result: `{ created, skipped }`. Pending trait and pending group: as in R8. Nullable fields are `null`, never omitted.
- **R12** Record, annotation and accepted-value writes emit no audit-log entry (RFC-41): the append-only rows carry actor and time and are the provenance.

## Open questions

None.

## Changelog

- 2026-09-13 — created.
````

- [ ] **Step 2: Write RFC-66**

Create `docs/rfc/60-dataset/66-dataset-export.md`:

````markdown
# RFC-66 — Dataset export

| Field | Value |
|---|---|
| Status | draft |
| Category | dataset |
| Supersedes | — |

## Context

Curators need the current accepted values as a file for analysis and publication. Handing over the whole curated dataset is a larger grant than browsing it, so the export has its own permission and every download is audited.

## Rules

- **R1** `GET /api/export/accepted.csv` requires `dataset.export`.
- **R2** One row per species and trait whose newest `accepted_values` decision is `accepted`. Columns, in order: `family, genus, species, name_source, category, trait, value, unit, level, numeric_value, primary_reference, secondary_reference, decided_at, record_id`. `value` is the record's `value_text`; `level` the level key or empty; `numeric_value` the number or empty; `primary_reference` and `secondary_reference` are citation keys (empty when absent); `decided_at` is ISO 8601 UTC. No column names a person (RFC-40).
- **R3** Rows are ordered by `family` and `genus` (nulls last), then `species`, then trait key.
- **R4** The body is RFC 4180 CSV: UTF-8 with a leading byte-order mark, CRLF row terminators, a header row, and a field quoted with `"` (inner quotes doubled) when it contains `"`, `,`, CR or LF. Headers: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="treerepro-accepted-<YYYY-MM-DD>.csv"`, `Cache-Control: no-store`.
- **R5** The response streams: rows are read through a server-side cursor in batches and written as they arrive; the file is never held in memory.
- **R6** An audit entry `dataset.exported` with `metadata: { format: 'csv', scope: 'accepted' }` is recorded before the first byte is sent; an interrupted download still counts as an export.
- **R7** Errors raised before the stream starts (401, 403) use the RFC-11 error envelope. The CSV body is the documented exception to RFC-11 R2.

## Open questions

None.

## Changelog

- 2026-09-13 — created.
````

- [ ] **Step 3: Amend RFC-30, RFC-12, RFC-41**

`docs/rfc/30-access/30-permission-catalog.md` — append to the Catalog table, after the `imports.read` row:

```markdown
| `records.create` | Add trait records and map pending values |
| `records.annotate` | Confirm, dispute and comment on records |
| `records.withdraw` | Withdraw any manual record |
| `accepted.manage` | Set and clear the accepted value per species and trait |
| `taxa.manage` | Create and edit families, genera, species and names |
| `references.manage` | Create and edit bibliographic references |
| `traits.manage` | Create and edit traits and levels |
| `dataset.export` | Download the accepted values |
```

and to the Changelog: `- 2026-09-13 — curation permissions (RFC-65, RFC-66, plan 07).`

`docs/rfc/10-platform/12-error-codes.md` — replace the `TRAIT_NOT_FOUND` row's meaning with `Trait id does not exist (RFC-65 R1, R6, R8; RFC-62 R6).` and append after the `IMPORT_NOT_FOUND` row:

```markdown
| `RECORD_DUPLICATE` | 409 | The claim already exists; `details[0].message` is the existing record id (RFC-65 R2). |
| `RECORD_WITHDRAWN` | 409 | The record is withdrawn: no annotation, no acceptance (RFC-65 R3, R6). |
| `RECORD_NOT_WITHDRAWABLE` | 409 | Only manual records can be withdrawn (RFC-65 R4). |
| `RECORD_IS_ACCEPTED` | 409 | The record is the current accepted value; change it first (RFC-65 R4). |
| `RECORD_NOT_HARMONISED` | 409 | Only a harmonised record can be the accepted value (RFC-65 R6). |
| `FAMILY_NOT_FOUND` | 404 | Family id does not exist (RFC-60 R9). |
| `GENUS_NOT_FOUND` | 404 | Genus id does not exist (RFC-60 R9). |
| `LEVEL_NOT_FOUND` | 404 | Level id does not exist for this trait (RFC-62 R6). |
| `FAMILY_NAME_TAKEN` | 409 | Another family has this name (RFC-60 R9). |
| `GENUS_NAME_TAKEN` | 409 | Another genus has this name (RFC-60 R9). |
| `SPECIES_NAME_TAKEN` | 409 | Another species has this canonical name, or the species already carries this name (RFC-60 R9). |
| `TRAIT_KEY_TAKEN` | 409 | Another trait has this key (RFC-62 R6). |
| `LEVEL_KEY_TAKEN` | 409 | The trait already has this level, case-insensitively (RFC-62 R6). |
| `REFERENCE_KEY_TAKEN` | 409 | Another reference has this citation key (RFC-61 R6). |
| `REFERENCE_DOI_TAKEN` | 409 | Another reference has this DOI (RFC-61 R6). |
```

Changelog: `- 2026-09-13 — curation and catalog codes (RFC-60–62, RFC-65, plan 07).`

`docs/rfc/40-data-protection/41-audit-log.md` — append to the Actions table after `admin.accessed` (order matters: `AUDIT_ACTIONS` must list them in the same order):

```markdown
| `taxa.created` | Family, genus, species or alternative name created (RFC-60 R10). |
| `taxa.updated` | Family, genus or species changed (RFC-60 R10). |
| `references.created` | Bibliographic reference created (RFC-61 R6). |
| `references.updated` | Bibliographic reference changed (RFC-61 R6). |
| `traits.created` | Trait created (RFC-62 R6). |
| `traits.updated` | Trait or one of its levels changed, or a level added (RFC-62 R6). |
| `dataset.exported` | Accepted values downloaded as a file (RFC-66 R6). |
```

Changelog: `- 2026-09-13 — catalog and export actions (RFC-60–62, RFC-66, plan 07).`

- [ ] **Step 4: Amend RFC-60, RFC-61, RFC-62**

`docs/rfc/60-dataset/60-taxonomy-catalog.md`:

Replace R5 with:

```markdown
- **R5** A family, genus or species referenced by any other row cannot be deleted (foreign keys `restrict`). No route deletes or merges taxa; renames and reassignments are the writes of R9.
```

In R6, replace `Item: `{ id, canonicalName, nameSource, genus: { id, name } | null, family: { id, name } | null, matchedName }`, where `matchedName` is …` with:

```markdown
Item: `{ id, canonicalName, nameSource, genus: { id, name } | null, family: { id, name } | null, matchedName, unresolvedTaxon }`, where `matchedName` is the alternative name that matched when the canonical name did not, else `null`, and `unresolvedTaxon` is the R3 flag (either kind). No per-row counts.
```

In R7, replace the exact text `returns the item plus `names: [{ name, source, gbifUsageKey }]`, `recordCount`, `traitCount` (distinct traits with at least one record) and `unresolvedTaxon` (R3, either kind);` with `returns the item (R6) plus `names: [{ name, source, gbifUsageKey }]`, `recordCount` and `traitCount` (distinct traits with at least one record);`.

Append after R8:

```markdown
- **R9** Writes require `taxa.manage`; bodies are strict JSON; names are 1–200 characters normalised per R2; nothing is deleted. `POST /api/families` `{ name }` and `PATCH /api/families/:id` `{ name }` answer `{ id, name }` (409 `FAMILY_NAME_TAKEN`; 404 `FAMILY_NOT_FOUND`). `POST /api/genera` `{ name, familyId? }` and `PATCH /api/genera/:id` `{ name?, familyId? }` — `familyId: null` detaches the genus — answer the genus item of R8 (409 `GENUS_NAME_TAKEN`; 404 `GENUS_NOT_FOUND`, `FAMILY_NOT_FOUND`). `POST /api/species` `{ canonicalName, nameSource, genusId? }` and `PATCH /api/species/:id` `{ canonicalName?, nameSource?, genusId? }` — `genusId: null` detaches — answer the species detail of R7 (409 `SPECIES_NAME_TAKEN`; 404 `SPECIES_NOT_FOUND`, `GENUS_NOT_FOUND`). `POST /api/species/:id/names` `{ name, gbifUsageKey? }` (`gbifUsageKey` 1–64 characters) adds an alternative name with `source = 'gbif'` and answers the species detail; 409 `SPECIES_NAME_TAKEN` when the name equals the species' canonical name or one of its alternative names. Creates answer 201, updates 200. A `PATCH` whose fields all equal the stored values changes nothing and records nothing; a `PATCH` with no field answers 400 `VALIDATION_FAILED`.
- **R10** Every write of R9 records an audit entry in its transaction (RFC-41 R5): `taxa.created` or `taxa.updated`; `target_type` is the table (`families`, `genera`, `species`, `species_names`), `target_id` the row id; `metadata.kind` is `family`, `genus`, `species` or `species_name`; `metadata.fields` lists the changed fields on an update; `metadata.speciesId` accompanies a name. Names never enter the metadata.
```

Changelog: `- 2026-09-13 — R5–R7 amended, R9–R10 added: catalog writes and their audit (RFC-65, plan 07).`

`docs/rfc/60-dataset/61-bibliographic-references.md`:

Replace R5 with:

```markdown
- **R5** A reference named by any record cannot be deleted (foreign keys `restrict`). No route deletes or merges references; edits are the writes of R6.
- **R6** `POST /api/references` `{ citationKey, title?, authors?, year?, journal?, doi?, url? }` and `PATCH /api/references/:id` (the same fields, all optional; `null` clears a metadata field; `citationKey` is never null) require `references.manage`. Limits, all trimmed: `citationKey` 1–2,000 characters, `title`, `authors`, `journal` 1–1,000, `year` an integer 1500–2100, `doi` and `url` 1–500. Codes: 409 `REFERENCE_KEY_TAKEN`, 409 `REFERENCE_DOI_TAKEN`, 404 `REFERENCE_NOT_FOUND`. Both answer the detail of R4 (201 on create, 200 on update); a `PATCH` whose fields all equal the stored values changes nothing; one with no field answers 400 `VALIDATION_FAILED`. Each write records `references.created` or `references.updated` in its transaction (RFC-41 R5) with `target_type = 'bibliographic_references'`, `target_id` the row id and `metadata.fields` on update.
```

Changelog: `- 2026-09-13 — R5 amended, R6 added: reference writes and their audit (plan 07).`

`docs/rfc/60-dataset/62-trait-dictionary.md`:

Replace R5 with:

```markdown
- **R5** `GET /api/traits` (`dataset.read`) returns the whole dictionary: categories by `sort_order`, each with its traits by `key`, each with its levels by `sort_order` then `key`; inactive traits and levels are included with `active: false`. Shape: `[{ key, label, traits: [{ id, key, valueType, unit, description, active, levels: [{ id, key, sortOrder, active }] }] }]`. The response is not cacheable beyond the request (the dictionary is editable, R6).
- **R6** Writes require `traits.manage`, answer the trait entry of R5 (201 on create, 200 on update) and record `traits.created` or `traits.updated` in their transaction (RFC-41 R5) with `target_type = 'traits'`, `target_id` the trait id, `metadata.fields` on update and `metadata.levelId` when a level is concerned. `POST /api/traits` `{ key, categoryKey, valueType, unit?, description? }` (`key` 1–200 characters trimmed, `unit` 1–32, `description` up to 2,000; 409 `TRAIT_KEY_TAKEN`; an unknown category answers 400 `VALIDATION_FAILED` with path `categoryKey`). `PATCH /api/traits/:id` `{ categoryKey?, description?, active? }` (404 `TRAIT_NOT_FOUND`) — `key`, `valueType` and `unit` are immutable after creation: the import matches by key and a unit change would silently change the meaning of stored numbers. `POST /api/traits/:id/levels` `{ key, sortOrder? }` adds a level (default `sortOrder` = the trait's highest + 1; 409 `LEVEL_KEY_TAKEN` on `lower(key)` within the trait) and records `traits.updated` with `fields: ['levels']`. `PATCH /api/traits/:id/levels/:levelId` `{ key?, sortOrder?, active? }` (404 `LEVEL_NOT_FOUND`, also when the level belongs to another trait; 409 `LEVEL_KEY_TAKEN`). Renaming a level keeps every record's `level_id` and `value_text`. A `PATCH` with no field answers 400 `VALIDATION_FAILED`; one that changes nothing records nothing. `seed:traits` (R2) re-inserts a level whose key was renamed unless the repository CSV is changed too: a rename made in the UI is also made in `apps/api/seed/trait-dictionary.csv`.
```

Changelog: `- 2026-09-13 — R5 amended (level sortOrder, no HTTP cache), R6 added: dictionary writes and their audit (plan 07).`

- [ ] **Step 5: Amend RFC-63, RFC-64, RFC-11 and the index**

`docs/rfc/60-dataset/63-trait-records.md`:

In R1, after `note text null;` insert `supersedes_record_id uuid null references trait_records restrict (RFC-65 R7; partial index where not null);`.

Replace R2 with:

```markdown
- **R2** Check constraints: at least one of `primary_reference_id`, `secondary_reference_id` is not null; `origin = 'import'` implies `import_batch_id` and `import_row_no` not null and `created_by` and `supersedes_record_id` null; `origin = 'manual'` implies `created_by` not null, `import_batch_id` and `import_row_no` null, and `primary_reference_id` or `supersedes_record_id` not null (a record that harmonises a pending one inherits its references, which may be a secondary reference alone); `harmonisation = 'harmonised'` if and only if `level_id` or `numeric_value` is not null; `level_id` and `numeric_value` are never both set.
```

In R8, directly after the text `(newest first)` insert `, `supersedes: { id } | null`, `supersededBy: [{ id }]` (records naming this one in `supersedes_record_id`, empty when none; RFC-65 R7)`.

Changelog: `- 2026-09-13 — R1 supersedes_record_id, R2 converse check and the manual-reference rule for superseding records, R8 supersedes fields (RFC-65, plan 07).`

`docs/rfc/60-dataset/64-bulk-import.md` — replace R6 with:

```markdown
- **R6** Harmonisation per RFC-63 R5, with the level match of RFC-62 R4 and the number rule: the trimmed value has at most 64 characters, matches `^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]{1,3})?$` and its magnitude is below `1e308` (so the value casts to `numeric` and fits `double precision`); anything else is `not_numeric` (a decimal comma is not a number). Manual entry (RFC-65 R1) applies the same rule.
```

Changelog: `- 2026-09-13 — R6 length, exponent and magnitude bounds (plan 07).`

`docs/rfc/10-platform/11-api-conventions.md` — in R2 replace `The only exceptions are the health endpoints (RFC-10 R10).` with `The only exceptions are the health endpoints (RFC-10 R10) and file downloads (RFC-66 R7), whose errors still use the R3 envelope.`; Changelog: `- 2026-09-13 — R2: file downloads (RFC-66).`

`docs/rfc/README.md` — append two rows to the RFC table:

```markdown
| RFC-65 | Curation | draft |
| RFC-66 | Dataset export | draft |
```

- [ ] **Step 6: Run the catalog tests to see them fail**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts exec vitest run src/permissions.test.ts src/error-codes.test.ts
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:unit src/audit/actions.test.ts
```

Expected: FAIL — the three "matches the table" tests report the new rows missing from `PERMISSIONS`, `ERROR_CODES`, `AUDIT_ACTIONS`.

- [ ] **Step 7: Update the catalogs**

`packages/contracts/src/permissions.ts` — append inside `PERMISSIONS` after `'imports.read'`:

```ts
  'records.create': 'Add trait records and map pending values',
  'records.annotate': 'Confirm, dispute and comment on records',
  'records.withdraw': 'Withdraw any manual record',
  'accepted.manage': 'Set and clear the accepted value per species and trait',
  'taxa.manage': 'Create and edit families, genera, species and names',
  'references.manage': 'Create and edit bibliographic references',
  'traits.manage': 'Create and edit traits and levels',
  'dataset.export': 'Download the accepted values',
```

`packages/contracts/src/error-codes.ts` — append inside `ERROR_CODES` after `IMPORT_NOT_FOUND: 404,`:

```ts
  RECORD_DUPLICATE: 409,
  RECORD_WITHDRAWN: 409,
  RECORD_NOT_WITHDRAWABLE: 409,
  RECORD_IS_ACCEPTED: 409,
  RECORD_NOT_HARMONISED: 409,
  FAMILY_NOT_FOUND: 404,
  GENUS_NOT_FOUND: 404,
  LEVEL_NOT_FOUND: 404,
  FAMILY_NAME_TAKEN: 409,
  GENUS_NAME_TAKEN: 409,
  SPECIES_NAME_TAKEN: 409,
  TRAIT_KEY_TAKEN: 409,
  LEVEL_KEY_TAKEN: 409,
  REFERENCE_KEY_TAKEN: 409,
  REFERENCE_DOI_TAKEN: 409,
```

`apps/api/src/audit/actions.ts` — append inside `AUDIT_ACTIONS` after `'admin.accessed',`:

```ts
  'taxa.created',
  'taxa.updated',
  'references.created',
  'references.updated',
  'traits.created',
  'traits.updated',
  'dataset.exported',
```

- [ ] **Step 8: Migration 0013 (permission rows)**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api db:generate --custom --name permissions_curation
```

Write `apps/api/drizzle/0013_permissions_curation.sql`:

```sql
-- RFC-30 R3: the catalog rows for plan 07 (RFC-65, RFC-66).
INSERT INTO permissions (key, description) VALUES
  ('records.create', 'Add trait records and map pending values'),
  ('records.annotate', 'Confirm, dispute and comment on records'),
  ('records.withdraw', 'Withdraw any manual record'),
  ('accepted.manage', 'Set and clear the accepted value per species and trait'),
  ('taxa.manage', 'Create and edit families, genera, species and names'),
  ('references.manage', 'Create and edit bibliographic references'),
  ('traits.manage', 'Create and edit traits and levels'),
  ('dataset.export', 'Download the accepted values')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 9: Run the catalog tests and the permission-rows test**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts build
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts exec vitest run src/permissions.test.ts src/error-codes.test.ts
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:unit src/audit/actions.test.ts
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/db/schema/access.integration.test.ts
```

Expected: PASS (the rows test compares `permissions` rows with `PERMISSIONS`; migration 0013 adds the eight rows).

- [ ] **Step 10: Commit**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint:fix && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm typecheck && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check
git add docs/rfc packages/contracts/src/permissions.ts packages/contracts/src/error-codes.ts apps/api/src/audit/actions.ts apps/api/drizzle
git commit -m "docs(rfc): RFC-65 curation and RFC-66 export drafts; catalog write rules in RFC-60–62; curation permissions, codes and audit actions"
```

---

### Task 2: Schema — `supersedes_record_id`, converse check, relaxed origin check; migration 0014; `violatedConstraint`; test helpers

**Files:**
- Modify: `apps/api/src/db/schema/records.ts`
- Create: `apps/api/drizzle/0014_records_supersedes.sql` (generated)
- Modify: `apps/api/src/db/errors.ts`
- Modify: `apps/api/test/helpers/dataset.ts`
- Test: `apps/api/src/db/schema/dataset.integration.test.ts`

**Interfaces:**
- Produces: `traitRecords.supersedesRecordId`; `violatedConstraint(err)`; helpers `createTrait`, `createAnnotation`, `createAcceptedValue`; `createRecord` accepts `supersedesRecordId`.

- [ ] **Step 1: Write the failing schema tests**

Append to `apps/api/src/db/schema/dataset.integration.test.ts`, inside `describe('RFC-63 R1-R3 trait_records constraints', …)` after the R3 test:

```ts
  it('R1, R2 supersedes_record_id: a manual record may inherit references from the pending record it supersedes; imports never supersede', async () => {
    await withRollback(t.db, async (tx) => {
      const sp1 = await createSpecies(tx);
      const trait = await traitByKey(tx, 'flower_color');
      const level = await levelByKey(tx, trait.id, 'blue');
      const ref = await createReference(tx);
      const batch = await createImportBatch(tx);
      const { user } = await createUser(tx);
      // an import row with only a secondary reference, unharmonised
      const pending = await createRecord(tx, {
        speciesId: sp1.id,
        traitId: trait.id,
        valueText: 'blues',
        secondaryReferenceId: ref.id,
        importBatchId: batch.id,
      });
      // a manual row with no primary reference is refused unless it supersedes a record
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values({
              speciesId: sp1.id,
              traitId: trait.id,
              valueText: 'blue',
              levelId: level.id,
              harmonisation: 'harmonised',
              secondaryReferenceId: ref.id,
              origin: 'manual',
              createdBy: user.id,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      const [mapped] = await tx
        .insert(traitRecords)
        .values({
          speciesId: sp1.id,
          traitId: trait.id,
          valueText: 'blue',
          levelId: level.id,
          harmonisation: 'harmonised',
          secondaryReferenceId: ref.id,
          origin: 'manual',
          createdBy: user.id,
          supersedesRecordId: pending.id,
        })
        .returning();
      expect(mapped?.supersedesRecordId).toBe(pending.id);
      // an import row never supersedes
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values({
              speciesId: sp1.id,
              traitId: trait.id,
              valueText: 'x',
              harmonisation: 'unknown_level',
              primaryReferenceId: ref.id,
              origin: 'import',
              importBatchId: batch.id,
              importRowNo: 99,
              supersedesRecordId: pending.id,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      // the foreign key holds
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values({
              speciesId: sp1.id,
              traitId: trait.id,
              valueText: 'blue',
              levelId: level.id,
              harmonisation: 'harmonised',
              primaryReferenceId: ref.id,
              origin: 'manual',
              createdBy: user.id,
              supersedesRecordId: '00000000-0000-7000-8000-000000000000',
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });
  });

  it('R2 a level or a number implies harmonised (converse check)', async () => {
    await withRollback(t.db, async (tx) => {
      const sp1 = await createSpecies(tx);
      const trait = await traitByKey(tx, 'flower_color');
      const level = await levelByKey(tx, trait.id, 'blue');
      const ref = await createReference(tx);
      const batch = await createImportBatch(tx);
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values({
              speciesId: sp1.id,
              traitId: trait.id,
              valueText: 'blue',
              levelId: level.id,
              harmonisation: 'unknown_level',
              primaryReferenceId: ref.id,
              origin: 'import',
              importBatchId: batch.id,
              importRowNo: 1,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/db/schema/dataset.integration.test.ts
```

Expected: FAIL — typecheck/`supersedesRecordId` unknown on insert (first test) and the converse-check insert succeeds instead of rejecting (second test).

- [ ] **Step 3: Extend the Drizzle schema**

In `apps/api/src/db/schema/records.ts`:

Add `type AnyPgColumn` to the `drizzle-orm/pg-core` import. After the `note` column add:

```ts
    /** The pending record this row harmonises (RFC-65 R7); null for every other row. */
    supersedesRecordId: uuid('supersedes_record_id').references((): AnyPgColumn => traitRecords.id, {
      onDelete: 'restrict',
    }),
```

Replace the `trait_records_origin_check` check with:

```ts
    check(
      'trait_records_origin_check',
      sql`(${t.origin} = 'import' and ${t.importBatchId} is not null and ${t.importRowNo} is not null and ${t.createdBy} is null and ${t.supersedesRecordId} is null)
        or (${t.origin} = 'manual' and ${t.createdBy} is not null and ${t.importBatchId} is null and ${t.importRowNo} is null
            and (${t.primaryReferenceId} is not null or ${t.supersedesRecordId} is not null))`,
    ),
```

After `trait_records_one_value_check` add:

```ts
    check(
      'trait_records_value_requires_harmonised_check',
      sql`(${t.levelId} is null and ${t.numericValue} is null) or ${t.harmonisation} = 'harmonised'`,
    ),
```

After `trait_records_pending_idx` add:

```ts
    index('trait_records_supersedes_idx')
      .on(t.supersedesRecordId)
      .where(sql`${t.supersedesRecordId} is not null`),
```

Update the table's JSDoc to `@rfc RFC-63 R1-R3, R5` (unchanged tags; the column comment carries RFC-65).

- [ ] **Step 4: Generate migration 0014 and check its content**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api db:generate --name records_supersedes
cat apps/api/drizzle/0014_records_supersedes.sql
```

Expected statements (order may differ): `ALTER TABLE "trait_records" ADD COLUMN "supersedes_record_id" uuid;`, `ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_supersedes_record_id_trait_records_id_fk" FOREIGN KEY … ON DELETE restrict`, `CREATE INDEX "trait_records_supersedes_idx" ON "trait_records" USING btree ("supersedes_record_id") WHERE "trait_records"."supersedes_record_id" is not null;`, `ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_origin_check";`, `ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_origin_check" CHECK (…)`, `ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_value_requires_harmonised_check" CHECK (…)`. If drizzle-kit did not emit the `DROP CONSTRAINT` + re-`ADD` for the changed origin check, add both statements by hand (separated by `--> statement-breakpoint`), keeping the generated snapshot as is. Prepend a comment line: `-- RFC-63 R1, R2 (plan 07): supersedes_record_id, the converse harmonised check, manual records may inherit references through supersession.`

- [ ] **Step 5: `violatedConstraint` in `db/errors.ts`**

Append to `apps/api/src/db/errors.ts`:

```ts
/**
 * The constraint a 23505 / 23503 / 23514 error names (postgres.js sets
 * `constraint_name`), walking wrapper causes like {@link isUniqueViolation}.
 * @rfc RFC-61 R6
 */
export function violatedConstraint(err: unknown): string | undefined {
  let cur: unknown = err;
  while (cur instanceof Error) {
    const name = (cur as { constraint_name?: unknown }).constraint_name;
    if (typeof name === 'string') return name;
    cur = cur.cause;
  }
  return undefined;
}
```

- [ ] **Step 6: Test helpers**

In `apps/api/test/helpers/dataset.ts`:

Add `supersedesRecordId?: string;` to `RecordBase`, and `supersedesRecordId: input.supersedesRecordId ?? null,` to the `createRecord` insert values (before the origin spread). Add imports `acceptedValues, recordAnnotations` from `'../../src/db/schema/curation.ts'`, `traitCategories` from the dictionary schema, and `AcceptedDecision, AnnotationKind` types from `@treerepro/contracts`. Append:

```ts
/**
 * A trait of its own for tests that edit the dictionary or read the global
 * queues: seeded traits are shared by every test file and must stay untouched.
 */
export async function createTrait(
  db: DbExecutor,
  options: {
    key?: string;
    valueType?: TraitValueType;
    unit?: string | null;
    categoryKey?: string;
    levels?: string[];
    active?: boolean;
  } = {},
): Promise<{
  id: string;
  key: string;
  valueType: TraitValueType;
  unit: string | null;
  levels: { id: string; key: string }[];
}> {
  const valueType = options.valueType ?? 'categorical';
  const categoryKey =
    options.categoryKey ??
    (await db.select({ key: traitCategories.key }).from(traitCategories).limit(1))[0]?.key;
  if (!categoryKey) throw new Error('createTrait: no trait category (is the dictionary seeded?)');
  const [trait] = await db
    .insert(traits)
    .values({
      key: options.key ?? `test_trait_${suffix()}`,
      categoryKey,
      valueType,
      unit: options.unit ?? (valueType === 'quantitative' ? 'mm' : null),
      active: options.active ?? true,
    })
    .returning({ id: traits.id, key: traits.key, valueType: traits.valueType, unit: traits.unit });
  if (!trait) throw new Error('createTrait: no row');
  const levelKeys = options.levels ?? (valueType === 'categorical' ? ['alpha', 'beta'] : []);
  const levels =
    levelKeys.length === 0
      ? []
      : await db
          .insert(traitLevels)
          .values(levelKeys.map((key, i) => ({ traitId: trait.id, key, sortOrder: i })))
          .returning({ id: traitLevels.id, key: traitLevels.key });
  return { ...trait, levels };
}

export async function createAnnotation(
  db: DbExecutor,
  input: { recordId: string; actorId: string; kind: AnnotationKind; note?: string },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(recordAnnotations)
    .values({
      recordId: input.recordId,
      actorId: input.actorId,
      kind: input.kind,
      note: input.note ?? (input.kind === 'dispute' || input.kind === 'withdraw' ? 'test' : null),
    })
    .returning({ id: recordAnnotations.id });
  if (!row) throw new Error('createAnnotation: no row');
  return row;
}

export async function createAcceptedValue(
  db: DbExecutor,
  input: {
    speciesId: string;
    traitId: string;
    actorId: string;
    recordId?: string | null;
    decision?: AcceptedDecision;
    note?: string;
  },
): Promise<{ id: string }> {
  const decision = input.decision ?? (input.recordId ? 'accepted' : 'cleared');
  const [row] = await db
    .insert(acceptedValues)
    .values({
      speciesId: input.speciesId,
      traitId: input.traitId,
      actorId: input.actorId,
      recordId: decision === 'accepted' ? (input.recordId ?? null) : null,
      decision,
      note: input.note ?? null,
    })
    .returning({ id: acceptedValues.id });
  if (!row) throw new Error('createAcceptedValue: no row');
  return row;
}
```

- [ ] **Step 7: Run the schema tests and the privilege tests**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/db/schema/dataset.integration.test.ts
```

Expected: PASS, including the existing "treerepro_app holds SELECT and INSERT but neither UPDATE, DELETE nor TRUNCATE" test (0014 changes no privilege).

- [ ] **Step 8: Commit**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint:fix && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm typecheck && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check
git add apps/api/src/db apps/api/drizzle apps/api/test/helpers/dataset.ts
git commit -m "feat(db): trait_records.supersedes_record_id, converse harmonised check, manual records may inherit references by supersession (RFC-63 R1, R2)"
```

---

### Task 3: `pageOf` helper; `unresolvedTaxon` on the species list item; `getFamily`, `getGenus`

**Files:**
- Modify: `apps/api/src/http/cursor.ts`, `apps/api/src/dataset/taxa.ts`, `apps/api/src/dataset/references.ts`, `apps/api/src/dataset/records.ts`, `apps/api/src/dataset/import.ts`
- Modify: `packages/contracts/src/dataset.ts`
- Modify: `apps/web/src/test/dataset-fixtures.ts`, `apps/web/src/api/dataset.test.ts`, `apps/web/src/pages/dataset/SpeciesSearchPage.test.tsx`
- Test: `apps/api/src/http/cursor.test.ts`, `apps/api/src/dataset/taxa.integration.test.ts`

**Interfaces:**
- Produces: `pageOf(rows, limit, cursorOf)`; `SpeciesListItem.unresolvedTaxon`; `getFamily(db, id)`, `getGenus(db, id)`.

- [ ] **Step 1: Failing unit test for `pageOf`**

Append to `apps/api/src/http/cursor.test.ts`:

```ts
describe('RFC-11 R6 pageOf', () => {
  it('returns the first limit rows and a cursor only when a row beyond the page exists', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(pageOf(rows, 2, (r) => `c:${r.id}`)).toEqual({
      page: [{ id: 'a' }, { id: 'b' }],
      nextCursor: 'c:b',
    });
    expect(pageOf(rows, 3, (r) => `c:${r.id}`)).toEqual({ page: rows, nextCursor: null });
    expect(pageOf([], 3, (r: { id: string }) => r.id)).toEqual({ page: [], nextCursor: null });
  });
});
```

Add `pageOf` to the import from `'./cursor.ts'`.

- [ ] **Step 2: Failing integration test for `unresolvedTaxon` on list items**

In `apps/api/src/dataset/taxa.integration.test.ts`, inside the `searchSpecies` describe, add:

```ts
  it('R6 every item carries unresolvedTaxon (R3: name source, missing genus or missing family)', async () => {
    const k = rand();
    const family = await createFamily(t.db);
    const genus = await createGenus(t.db, { familyId: family.id });
    const resolved = await createSpecies(t.db, { canonicalName: `Flagus resolved-${k}`, genusId: genus.id });
    const noGenus = await createSpecies(t.db, { canonicalName: `Flagus nogenus-${k}` });
    const gbif = await createSpecies(t.db, { canonicalName: `Flagus gbif-${k}`, nameSource: 'gbif', genusId: genus.id });
    const { data } = await searchSpecies(t.db, { q: `Flagus`, limit: 50 });
    const flag = (id: string) => data.find((s) => s.id === id)?.unresolvedTaxon;
    expect(flag(resolved.id)).toBe(false);
    expect(flag(noGenus.id)).toBe(true);
    expect(flag(gbif.id)).toBe(true);
  });
```

(`rand`, `createFamily`, `createGenus` are already imported there; add any that are missing.)

- [ ] **Step 3: Run both to see them fail**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:unit src/http/cursor.test.ts
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/dataset/taxa.integration.test.ts
```

Expected: FAIL — `pageOf` is not exported; `unresolvedTaxon` is `undefined` on list items.

- [ ] **Step 4: Implement `pageOf` and migrate the seven lists**

Append to `apps/api/src/http/cursor.ts`:

```ts
/**
 * The limit + 1 tail every keyset list shares: `rows` were fetched with
 * `limit + 1`; the page is the first `limit` of them and the cursor of the
 * page's last row is emitted only when a row beyond the page proved there
 * is more.
 * @rfc RFC-11 R6
 */
export function pageOf<Row>(
  rows: Row[],
  limit: number,
  cursorOf: (last: Row) => string,
): { page: Row[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { page, nextCursor: rows.length > limit && last ? cursorOf(last) : null };
}
```

Replace each `const page = rows.slice(0, input.limit); const last = …; return { data: …, nextCursor: … }` tail with `pageOf`:

`taxa.ts` `searchSpecies`:

```ts
  const { page, nextCursor } = pageOf(rows, input.limit, (r) =>
    encodeCompositeCursor([r.canonicalName, r.id]),
  );
  return { data: page.map(toListItem), nextCursor };
```

`taxa.ts` `listFamilies`: `const { page, nextCursor } = pageOf(rows, input.limit, (r) => encodeCompositeCursor([r.name, r.id])); return { data: page, nextCursor };`

`taxa.ts` `listGenera`: same `cursorOf` as families; `data: page.map((g) => ({ id: g.id, name: g.name, family: … }))`.

`references.ts` `searchReferences`: `pageOf(rows, input.limit, (r) => encodeCompositeCursor([String(r.total), r.reference.id]))`; `data: page.map((r) => toReference(r.reference, r))`.

`records.ts` `listRecords`: `pageOf(rows, input.limit, (r) => encodeCursor(r.record.id))`; `data: page.map(toItem)`.

`import.ts` `listImportBatches`: `pageOf(rows, input.limit, (r) => encodeCursor(r.batch.id))`; `data: page.map(fromJoined)`. `listImportRejects`: `pageOf(rows, input.limit, (r) => encodeCompositeCursor([String(r.rowNo), r.id]))`; keep its existing item mapping.

Import `pageOf` from `'../http/cursor.ts'` in each file.

- [ ] **Step 5: `unresolvedTaxon` on the list item; `getFamily`, `getGenus`**

`packages/contracts/src/dataset.ts`: add `unresolvedTaxon: z.boolean(),` to `speciesListItemSchema` (after `matchedName`) and remove the `unresolvedTaxon: z.boolean(),` line from `speciesSchema`'s extension (it inherits it). Update the JSDoc of `speciesListItemSchema` to `@rfc RFC-60 R3, R6`.

`apps/api/src/dataset/taxa.ts`: in `toListItem` add

```ts
    unresolvedTaxon: r.nameSource !== 'wcvp' || r.genusId === null || r.familyId === null,
```

and in `getSpecies` delete the explicit `unresolvedTaxon: …` line (the spread of `toListItem` now provides it). Append:

```ts
/** @rfc RFC-60 R9 */
export async function getFamily(db: DbExecutor, id: string): Promise<TaxonRef | null> {
  const [row] = await db
    .select({ id: families.id, name: families.name })
    .from(families)
    .where(eq(families.id, id))
    .limit(1);
  return row ?? null;
}

/** @rfc RFC-60 R9 */
export async function getGenus(db: DbExecutor, id: string): Promise<Genus | null> {
  const [row] = await db
    .select({ id: genera.id, name: genera.name, familyId: families.id, familyName: families.name })
    .from(genera)
    .leftJoin(families, eq(families.id, genera.familyId))
    .where(eq(genera.id, id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    family: row.familyId && row.familyName ? { id: row.familyId, name: row.familyName } : null,
  };
}
```

- [ ] **Step 6: Web fixtures**

`apps/web/src/test/dataset-fixtures.ts`: add `unresolvedTaxon: false,` to `SPECIES` and `unresolvedTaxon: true,` to `UNRESOLVED_SPECIES` (they already have the field if typed as `Species`; make sure the list-item shape used by `SpeciesSearchPage.test.tsx` and `api/dataset.test.ts` also carries it): in `apps/web/src/api/dataset.test.ts` line ~22 and `apps/web/src/pages/dataset/SpeciesSearchPage.test.tsx` lines ~40 and ~48 add `unresolvedTaxon: false,` next to `matchedName`.

- [ ] **Step 7: Run tests**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts build
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts exec vitest run src/dataset.test.ts
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:unit src/http/cursor.test.ts
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/dataset src/http/routes/dataset
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/web test
```

Expected: PASS everywhere (the existing list tests exercise every migrated tail; web tests validate the new field).

- [ ] **Step 8: Commit**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint:fix && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm typecheck && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check
git add apps/api/src packages/contracts/src apps/web/src
git commit -m "refactor(api): shared pageOf tail for keyset lists; species items carry unresolvedTaxon (RFC-60 R6); getFamily, getGenus"
```

---

### Task 4: Number rule — length, exponent and magnitude bounds; `normaliseName`

**Files:**
- Modify: `apps/api/src/dataset/import.ts`
- Create: `apps/api/src/dataset/names.ts`, `apps/api/src/dataset/names.test.ts`
- Test: `apps/api/src/dataset/import.test.ts`, `apps/api/src/dataset/import.integration.test.ts`, `apps/api/test/fixtures/import/records-small.csv`

**Interfaces:**
- Produces: `NUMBER_PATTERN` (bounded exponent), `NUMBER_MAX_LENGTH`, `isHarmonisableNumber(text)`, `normaliseName(text)`.

- [ ] **Step 1: Failing unit tests**

Replace the `RFC-64 R6 number pattern` describe in `apps/api/src/dataset/import.test.ts` with:

```ts
describe('RFC-64 R6 number rule', () => {
  it('pattern: integers, decimals, signs, exponents of 1–3 digits; not text, commas, blanks or longer exponents', () => {
    for (const ok of ['0', '12', '12.5', '-.5', '+3.', '1e2', '2.5E-3', '1e307', '1e999'])
      expect(NUMBER_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ['', ' 1', '1,5', 'Aug', '<10mm', '1/2', 'NaN', '1e', '.', '1e2000', '1e200000'])
      expect(NUMBER_PATTERN.test(bad), bad).toBe(false);
  });

  it('isHarmonisableNumber adds the 64-character cap and the magnitude bound', () => {
    for (const ok of ['0', '-0', '1e99', '1e307', '.5', '+3', '9'.repeat(64)])
      expect(isHarmonisableNumber(ok), ok).toBe(true);
    for (const bad of ['1e308', '1e400', '1e999', '-1e308', '1'.repeat(65), '1e200000', 'Aug'])
      expect(isHarmonisableNumber(bad), bad).toBe(false);
  });
});
```

(`'9'.repeat(64)` is 64 characters — at the cap — and below 1e308; `'1'.repeat(65)` is one over the cap.) Import `isHarmonisableNumber` next to `NUMBER_PATTERN`.

Create `apps/api/src/dataset/names.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normaliseName } from './names.ts';

describe('RFC-60 R2 normaliseName', () => {
  it('trims and collapses internal whitespace to one space, keeping case', () => {
    expect(normaliseName('  Adenanthera   pavonina ')).toBe('Adenanthera pavonina');
    expect(normaliseName('Fabaceae')).toBe('Fabaceae');
    expect(normaliseName('a\t\n b')).toBe('a b');
    expect(normaliseName('   ')).toBe('');
  });
});
```

- [ ] **Step 2: Failing integration case in the import fixture**

Append two rows to `apps/api/test/fixtures/import/records-small.csv` (same column order as the header; use a species and reference already in the fixture, and the quantitative trait the fixture uses for its `not_numeric` case — read the file first and copy that row's shape):

- one with `harmonised_value` = `1e200000` → expected `not_numeric`
- one with `harmonised_value` = `1e400` → expected `not_numeric`

In `apps/api/src/dataset/import.integration.test.ts`, find the assertions on `rowsPending` / `notNumeric` counts and raise them by 2; add an assertion that the two rows exist with `harmonisation: 'not_numeric'` and `numericValue: null` (select by `valueText` in `('1e200000', '1e400')` scoped to the batch id). Also raise `rowsTotal`/`rowsInserted` expectations by 2. If the fixture test currently pins the exact `unknownLevels` or other counts, keep them as they are — the new rows are quantitative.

- [ ] **Step 3: Run to see them fail**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:unit src/dataset/import.test.ts src/dataset/names.test.ts
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/dataset/import.integration.test.ts
```

Expected: FAIL — `1e2000` still matches; `isHarmonisableNumber` / `names.ts` missing; the import batch fails with `numeric field overflow` on `1e200000` (the whole batch aborts — the bug this task fixes).

- [ ] **Step 4: Implement**

`apps/api/src/dataset/import.ts` — replace the `NUMBER_PATTERN` and `NUMBER_PATTERN_SQL` definitions:

```ts
/** A number as the importer accepts it: at most three exponent digits (RFC-64 R6); the SQL below uses the same expression. @rfc RFC-64 R6 */
export const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d{1,3})?$/;
/** Longest text the number rule considers (RFC-64 R6). @rfc RFC-64 R6 */
export const NUMBER_MAX_LENGTH = 64;
/** Largest magnitude the summary's `double precision` arithmetic can hold (RFC-64 R6). */
const NUMBER_MAX_MAGNITUDE = 1e308;

/**
 * The RFC-64 R6 number rule in TypeScript: length cap, pattern and magnitude
 * bound. Manual entry (RFC-65 R1, R9) applies it to `String(number)`.
 * @rfc RFC-64 R6
 */
export function isHarmonisableNumber(text: string): boolean {
  if (text.length > NUMBER_MAX_LENGTH || !NUMBER_PATTERN.test(text)) return false;
  return Math.abs(Number(text)) < NUMBER_MAX_MAGNITUDE;
}
const NUMBER_PATTERN_SQL = '^[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]{1,3})?$';
```

In the `resolved` CTE, replace the `numeric_value` expression with a nested `case` — `CASE` evaluates its branches in order, which a plain `and` does not guarantee, so the cast only runs on text that already passed the length cap and the pattern:

```sql
            case when t.value_type = 'quantitative' and length(s.value) <= ${NUMBER_MAX_LENGTH} and s.value ~ ${NUMBER_PATTERN_SQL}
                 then (case when abs(s.value::numeric) < 1e308 then s.value::numeric end) end as numeric_value
```

Create `apps/api/src/dataset/names.ts`:

```ts
/**
 * Names are stored trimmed with internal whitespace collapsed to one space,
 * case preserved — the TypeScript twin of the importer's
 * `trim(regexp_replace(x, '\s+', ' ', 'g'))`.
 * @rfc RFC-60 R2
 */
export function normaliseName(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 5: Run tests**

Same commands as Step 3. Expected: PASS; the fixture import completes with the two new rows `not_numeric`.

- [ ] **Step 6: Commit**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint:fix && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm typecheck && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check
git add apps/api/src/dataset apps/api/test/fixtures
git commit -m "fix(import): bound the number rule — 64 characters, 1–3 exponent digits, magnitude below 1e308 (RFC-64 R6); normaliseName"
```

---

### Task 5: Contracts — curation bodies, queries and responses

**Files:**
- Create: `packages/contracts/src/curation.ts`, `packages/contracts/src/curation.test.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/pagination.ts`

**Interfaces:**
- Produces: every schema and type listed under "Shared interfaces" for `curation.ts`; `cursorQuerySchema` accepts cursors up to 4,096 characters (a pending-group cursor carries a `value_text`).

- [ ] **Step 1: Failing tests**

Create `packages/contracts/src/curation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  annotateRecordBodySchema,
  createRecordBodySchema,
  createReferenceBodySchema,
  mapPendingBodySchema,
  pendingGroupsQuerySchema,
  setAcceptedBodySchema,
  updateGenusBodySchema,
  updateReferenceBodySchema,
  updateTraitBodySchema,
} from './curation.ts';
import { cursorQuerySchema } from './pagination.ts';

const uuid = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e';
const other = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9f';

describe('RFC-65 R1 createRecordBodySchema', () => {
  const base = { speciesId: uuid, traitId: uuid, primaryReferenceId: uuid };
  it('accepts a level or a finite number below 1e308; trims rawValue and note', () => {
    expect(createRecordBodySchema.parse({ ...base, value: { levelId: uuid }, rawValue: ' Aug ' })).toMatchObject({
      value: { levelId: uuid },
      rawValue: 'Aug',
    });
    expect(createRecordBodySchema.safeParse({ ...base, value: { numeric: 12.5 } }).success).toBe(true);
    expect(createRecordBodySchema.safeParse({ ...base, value: { numeric: 1e308 } }).success).toBe(false);
    expect(createRecordBodySchema.safeParse({ ...base, value: { numeric: Number.NaN } }).success).toBe(false);
    expect(createRecordBodySchema.safeParse({ ...base, value: { text: 'red' } }).success).toBe(false);
    expect(createRecordBodySchema.safeParse({ ...base, value: { levelId: uuid, numeric: 1 } }).success).toBe(false);
    expect(createRecordBodySchema.safeParse({ ...base, value: { levelId: uuid }, note: 'x'.repeat(2001) }).success).toBe(false);
    expect(createRecordBodySchema.safeParse({ ...base, value: { levelId: uuid }, extra: 1 }).success).toBe(false);
  });
});

describe('RFC-65 R3 annotateRecordBodySchema', () => {
  it('requires a note for dispute and withdraw only', () => {
    expect(annotateRecordBodySchema.safeParse({ kind: 'confirm' }).success).toBe(true);
    expect(annotateRecordBodySchema.safeParse({ kind: 'neutral' }).success).toBe(true);
    expect(annotateRecordBodySchema.safeParse({ kind: 'dispute' }).success).toBe(false);
    expect(annotateRecordBodySchema.safeParse({ kind: 'withdraw', note: '  ' }).success).toBe(false);
    expect(annotateRecordBodySchema.safeParse({ kind: 'dispute', note: 'Table 2 says otherwise' }).success).toBe(true);
    const missing = annotateRecordBodySchema.safeParse({ kind: 'dispute' });
    expect(missing.success ? [] : missing.error.issues.map((i) => i.path.join('.'))).toContain('note');
  });
});

describe('RFC-65 R6 setAcceptedBodySchema', () => {
  it('accepts a record or a cleared decision with a note', () => {
    expect(setAcceptedBodySchema.safeParse({ decision: 'accepted', recordId: uuid }).success).toBe(true);
    expect(setAcceptedBodySchema.safeParse({ decision: 'cleared', note: 'Sources disagree' }).success).toBe(true);
    expect(setAcceptedBodySchema.safeParse({ decision: 'cleared' }).success).toBe(false);
    expect(setAcceptedBodySchema.safeParse({ decision: 'accepted' }).success).toBe(false);
    expect(setAcceptedBodySchema.safeParse({ recordId: uuid }).success).toBe(false);
  });
});

describe('RFC-65 R8, R9 pending queue', () => {
  it('pendingGroupsQuerySchema requires traitId; cursors may be long', () => {
    expect(pendingGroupsQuerySchema.safeParse({}).success).toBe(false);
    expect(pendingGroupsQuerySchema.parse({ traitId: uuid, limit: '5' })).toEqual({ traitId: uuid, limit: 5 });
    expect(cursorQuerySchema.safeParse({ cursor: 'a'.repeat(3000) }).success).toBe(true);
    expect(cursorQuerySchema.safeParse({ cursor: 'a'.repeat(5000) }).success).toBe(false);
  });

  it('mapPendingBodySchema takes 1–20 distinct levels or one number', () => {
    const base = { traitId: uuid, valueText: 'reds' };
    expect(mapPendingBodySchema.safeParse({ ...base, value: { levelIds: [uuid] } }).success).toBe(true);
    expect(mapPendingBodySchema.safeParse({ ...base, value: { levelIds: [uuid, other] } }).success).toBe(true);
    expect(mapPendingBodySchema.safeParse({ ...base, value: { levelIds: [] } }).success).toBe(false);
    expect(mapPendingBodySchema.safeParse({ ...base, value: { levelIds: [uuid, uuid] } }).success).toBe(false);
    expect(mapPendingBodySchema.safeParse({ ...base, value: { levelIds: Array(21).fill(uuid).map((u, i) => u.slice(0, -2) + String(i).padStart(2, '0')) } }).success).toBe(false);
    expect(mapPendingBodySchema.safeParse({ ...base, value: { numeric: 3 } }).success).toBe(true);
    expect(mapPendingBodySchema.safeParse({ traitId: uuid, valueText: '', value: { numeric: 3 } }).success).toBe(false);
  });
});

describe('RFC-60 R9, RFC-61 R6, RFC-62 R6 catalog bodies', () => {
  it('updates need at least one field; null clears reference metadata but never the citation key', () => {
    expect(updateGenusBodySchema.safeParse({}).success).toBe(false);
    expect(updateGenusBodySchema.safeParse({ familyId: null }).success).toBe(true);
    expect(updateTraitBodySchema.safeParse({ active: false }).success).toBe(true);
    expect(updateTraitBodySchema.safeParse({ key: 'renamed' }).success).toBe(false);
    expect(updateReferenceBodySchema.safeParse({ doi: null }).success).toBe(true);
    expect(updateReferenceBodySchema.safeParse({ citationKey: null }).success).toBe(false);
    expect(createReferenceBodySchema.safeParse({ citationKey: 'K', year: 1200 }).success).toBe(false);
    expect(createReferenceBodySchema.parse({ citationKey: ' Key_2020 ' })).toEqual({ citationKey: 'Key_2020' });
  });
});
```

- [ ] **Step 2: Run to see it fail**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts exec vitest run src/curation.test.ts
```

Expected: FAIL — `./curation.ts` does not exist.

- [ ] **Step 3: Implement**

In `packages/contracts/src/pagination.ts` change the cursor line to `cursor: z.string().min(1).max(4096).optional(),` with the comment `// Composite cursors may carry a text sort key (RFC-65 R8), hence the room.`

Create `packages/contracts/src/curation.ts`:

```ts
import { z } from 'zod';
import {
  ACCEPTED_DECISIONS,
  ANNOTATION_KINDS,
  acceptedDecisionSchema,
  HARMONISATION_STATUSES,
  NAME_SOURCES,
  recordSchema,
  TRAIT_VALUE_TYPES,
  traitRefSchema,
  userRefSchema,
} from './dataset.ts';
import { cursorQuerySchema } from './pagination.ts';

/** Free text attached to a write: 1–2,000 characters, trimmed. @rfc RFC-65 R1 */
export const curationNoteSchema = z.string().trim().min(1).max(2000);

/** A catalog name or key: 1–200 characters, trimmed. @rfc RFC-60 R9 */
export const catalogNameSchema = z.string().trim().min(1).max(200);

/** Largest magnitude a manual number may have (RFC-64 R6). @rfc RFC-64 R6 */
export const NUMERIC_VALUE_LIMIT = 1e308;

/** @rfc RFC-65 R1 */
export const numericValueSchema = z
  .number()
  .finite()
  .refine((n) => Math.abs(n) < NUMERIC_VALUE_LIMIT, { message: 'Number is out of range' });

/** A level for a categorical trait, or a number for a quantitative one. @rfc RFC-65 R1 */
export const recordValueSchema = z.union([
  z.strictObject({ levelId: z.uuid() }),
  z.strictObject({ numeric: numericValueSchema }),
]);

/** @rfc RFC-65 R1 */
export const createRecordBodySchema = z.strictObject({
  speciesId: z.uuid(),
  traitId: z.uuid(),
  value: recordValueSchema,
  primaryReferenceId: z.uuid(),
  secondaryReferenceId: z.uuid().optional(),
  rawValue: curationNoteSchema.optional(),
  note: curationNoteSchema.optional(),
});

/** @rfc RFC-65 R3 */
export const annotateRecordBodySchema = z
  .strictObject({ kind: z.enum(ANNOTATION_KINDS), note: curationNoteSchema.optional() })
  .refine((b) => b.note !== undefined || (b.kind !== 'dispute' && b.kind !== 'withdraw'), {
    message: 'A note is required to dispute or withdraw',
    path: ['note'],
  });

/** @rfc RFC-65 R6 */
export const setAcceptedBodySchema = z.discriminatedUnion('decision', [
  z.strictObject({
    decision: z.literal('accepted'),
    recordId: z.uuid(),
    note: curationNoteSchema.optional(),
  }),
  z.strictObject({ decision: z.literal('cleared'), note: curationNoteSchema }),
]);

/** @rfc RFC-65 R6 */
export const speciesTraitParamSchema = z.strictObject({ id: z.uuid(), traitId: z.uuid() });

/** @rfc RFC-62 R6 */
export const traitLevelParamSchema = z.strictObject({ id: z.uuid(), levelId: z.uuid() });

/** @rfc RFC-65 R11 */
export const acceptedCurrentSchema = z.strictObject({
  id: z.uuid(),
  recordId: z.uuid(),
  valueText: z.string(),
  actor: userRefSchema,
  note: z.string().nullable(),
  decidedAt: z.iso.datetime(),
});

/** @rfc RFC-65 R11 */
export const acceptedHistoryEntrySchema = acceptedDecisionSchema.extend({
  valueText: z.string().nullable(),
});

/** @rfc RFC-65 R11 */
export const acceptedStateSchema = z.strictObject({
  current: acceptedCurrentSchema.nullable(),
  history: z.array(acceptedHistoryEntrySchema),
});

/** @rfc RFC-65 R8 */
export const pendingTraitSchema = z.strictObject({
  trait: traitRefSchema,
  count: z.number().int().nonnegative(),
});

/** @rfc RFC-65 R8 */
export const pendingGroupsQuerySchema = cursorQuerySchema.extend({ traitId: z.uuid() });

/** @rfc RFC-65 R8 */
export const pendingGroupSchema = z.strictObject({
  valueText: z.string(),
  harmonisation: z.enum(HARMONISATION_STATUSES),
  count: z.number().int().nonnegative(),
  sampleRecordId: z.uuid(),
});

/** @rfc RFC-65 R9 */
export const mapPendingBodySchema = z.strictObject({
  traitId: z.uuid(),
  valueText: z.string().min(1).max(4000),
  value: z.union([
    z.strictObject({
      levelIds: z
        .array(z.uuid())
        .min(1)
        .max(20)
        .refine((ids) => new Set(ids).size === ids.length, { message: 'Levels must be distinct' }),
    }),
    z.strictObject({ numeric: numericValueSchema }),
  ]),
  note: curationNoteSchema.optional(),
});

/** @rfc RFC-65 R9 */
export const mapResultSchema = z.strictObject({
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

/** @rfc RFC-65 R10 */
export const disputedRecordSchema = recordSchema.extend({
  latestDispute: z.strictObject({
    id: z.uuid(),
    actor: userRefSchema,
    note: z.string().nullable(),
    createdAt: z.iso.datetime(),
  }),
});

const nonEmpty = <T extends z.ZodRawShape>(shape: T, first: keyof T & string) =>
  z.strictObject(shape).refine((b) => Object.keys(b).length > 0, {
    message: 'Nothing to change',
    path: [first],
  });

/** @rfc RFC-60 R9 */
export const familyBodySchema = z.strictObject({ name: catalogNameSchema });
/** @rfc RFC-60 R9 */
export const createGenusBodySchema = z.strictObject({
  name: catalogNameSchema,
  familyId: z.uuid().optional(),
});
/** @rfc RFC-60 R9 */
export const updateGenusBodySchema = nonEmpty(
  { name: catalogNameSchema.optional(), familyId: z.uuid().nullable().optional() },
  'name',
);
/** @rfc RFC-60 R9 */
export const createSpeciesBodySchema = z.strictObject({
  canonicalName: catalogNameSchema,
  nameSource: z.enum(NAME_SOURCES),
  genusId: z.uuid().optional(),
});
/** @rfc RFC-60 R9 */
export const updateSpeciesBodySchema = nonEmpty(
  {
    canonicalName: catalogNameSchema.optional(),
    nameSource: z.enum(NAME_SOURCES).optional(),
    genusId: z.uuid().nullable().optional(),
  },
  'canonicalName',
);
/** @rfc RFC-60 R9 */
export const speciesNameBodySchema = z.strictObject({
  name: catalogNameSchema,
  gbifUsageKey: z.string().trim().min(1).max(64).optional(),
});

const text = (max: number) => z.string().trim().min(1).max(max);

/** @rfc RFC-61 R6 */
export const createReferenceBodySchema = z.strictObject({
  citationKey: text(2000),
  title: text(1000).optional(),
  authors: text(1000).optional(),
  year: z.number().int().min(1500).max(2100).optional(),
  journal: text(1000).optional(),
  doi: text(500).optional(),
  url: text(500).optional(),
});
/** @rfc RFC-61 R6 */
export const updateReferenceBodySchema = nonEmpty(
  {
    citationKey: text(2000).optional(),
    title: text(1000).nullable().optional(),
    authors: text(1000).nullable().optional(),
    year: z.number().int().min(1500).max(2100).nullable().optional(),
    journal: text(1000).nullable().optional(),
    doi: text(500).nullable().optional(),
    url: text(500).nullable().optional(),
  },
  'citationKey',
);

/** @rfc RFC-62 R6 */
export const createTraitBodySchema = z.strictObject({
  key: catalogNameSchema,
  categoryKey: text(100),
  valueType: z.enum(TRAIT_VALUE_TYPES),
  unit: text(32).optional(),
  description: z.string().trim().max(2000).optional(),
});
/** @rfc RFC-62 R6 */
export const updateTraitBodySchema = nonEmpty(
  {
    categoryKey: text(100).optional(),
    description: z.string().trim().max(2000).optional(),
    active: z.boolean().optional(),
  },
  'categoryKey',
);
/** @rfc RFC-62 R6 */
export const createLevelBodySchema = z.strictObject({
  key: catalogNameSchema,
  sortOrder: z.number().int().optional(),
});
/** @rfc RFC-62 R6 */
export const updateLevelBodySchema = nonEmpty(
  { key: catalogNameSchema.optional(), sortOrder: z.number().int().optional(), active: z.boolean().optional() },
  'key',
);

export type RecordValue = z.infer<typeof recordValueSchema>;
export type CreateRecordBody = z.infer<typeof createRecordBodySchema>;
export type AnnotateRecordBody = z.infer<typeof annotateRecordBodySchema>;
export type SetAcceptedBody = z.infer<typeof setAcceptedBodySchema>;
export type AcceptedCurrent = z.infer<typeof acceptedCurrentSchema>;
export type AcceptedHistoryEntry = z.infer<typeof acceptedHistoryEntrySchema>;
export type AcceptedState = z.infer<typeof acceptedStateSchema>;
export type PendingTrait = z.infer<typeof pendingTraitSchema>;
export type PendingGroupsQuery = z.infer<typeof pendingGroupsQuerySchema>;
export type PendingGroup = z.infer<typeof pendingGroupSchema>;
export type MapPendingBody = z.infer<typeof mapPendingBodySchema>;
export type MapResult = z.infer<typeof mapResultSchema>;
export type DisputedRecord = z.infer<typeof disputedRecordSchema>;
export type FamilyBody = z.infer<typeof familyBodySchema>;
export type CreateGenusBody = z.infer<typeof createGenusBodySchema>;
export type UpdateGenusBody = z.infer<typeof updateGenusBodySchema>;
export type CreateSpeciesBody = z.infer<typeof createSpeciesBodySchema>;
export type UpdateSpeciesBody = z.infer<typeof updateSpeciesBodySchema>;
export type SpeciesNameBody = z.infer<typeof speciesNameBodySchema>;
export type CreateReferenceBody = z.infer<typeof createReferenceBodySchema>;
export type UpdateReferenceBody = z.infer<typeof updateReferenceBodySchema>;
export type CreateTraitBody = z.infer<typeof createTraitBodySchema>;
export type UpdateTraitBody = z.infer<typeof updateTraitBodySchema>;
export type CreateLevelBody = z.infer<typeof createLevelBodySchema>;
export type UpdateLevelBody = z.infer<typeof updateLevelBodySchema>;
```

`ACCEPTED_DECISIONS` is imported for the type of `AcceptedHistoryEntry.decision` through `acceptedDecisionSchema`; drop the import if Biome flags it unused.

Add `export * from './curation.ts';` to `packages/contracts/src/index.ts` (alphabetical: after `./auth.ts`).

- [ ] **Step 4: Run the tests**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts exec vitest run
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint:fix && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm typecheck && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check
git add packages/contracts/src
git commit -m "feat(contracts): curation bodies, queries and responses (RFC-65, RFC-60–62 writes); longer cursors"
```

---

### Task 6: Manual records — `createRecord`, `POST /api/records`, `supersedes` on the record detail

**Files:**
- Create: `apps/api/src/dataset/curation.ts`
- Modify: `apps/api/src/dataset/records.ts`, `packages/contracts/src/dataset.ts`, `apps/api/src/http/routes/dataset/records.ts`, `apps/api/src/routes-guarded.integration.test.ts`
- Modify: `apps/web/src/test/dataset-fixtures.ts`
- Test: `apps/api/src/http/routes/dataset/records.integration.test.ts`

**Interfaces:**
- Consumes: `isHarmonisableNumber` (Task 4), `createRecordBodySchema`, `RecordValue` (Task 5), helpers (Task 2).
- Produces: `requireTrait`, `requireSpecies`, `resolveValue`, `numericText`, `createRecord`; `itemQuery`, `toItem`, `ItemRow` exported from `records.ts`; `RecordDetail.supersedes`, `RecordDetail.supersededBy`.

- [ ] **Step 1: Failing route tests**

Append to `apps/api/src/http/routes/dataset/records.integration.test.ts` (extend the imports: `createTrait`, `createAcceptedValue`, `createAnnotation` from the dataset helpers; `type TestApp` from `'../../../../test/helpers/app.ts'`; `traitLevels` from `'../../../db/schema/dictionary.ts'`; `eq` from `drizzle-orm`; `type PermissionKey` from `@treerepro/contracts`). The `scientist` helper sits at module scope so the describes of Tasks 7, 9 and 10 reuse it:

```ts
/** A signed-in user holding exactly these permissions. */
async function scientist(t: TestApp, permissions: PermissionKey[] = ['records.create', 'dataset.read']) {
  const role = await createRole(t.db, { permissions });
  const { user } = await createUser(t.db, { roles: [role.id] });
  const { cookie } = await loginAs(t, user);
  return { user, cookie };
}

describe('RFC-65 R1, R2 POST /api/records', () => {
  const t = useTestApp();

  it('creates a categorical record with the level key as value_text and answers the detail', async () => {
    const { user, cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['red', 'blue'] });
    const ref = await createReference(t.db);
    const res = await call(t.app, 'POST', '/api/records', {
      cookie,
      body: {
        speciesId: sp1.id,
        traitId: trait.id,
        value: { levelId: trait.levels[0]?.id },
        primaryReferenceId: ref.id,
        rawValue: 'Reds',
        note: 'Table 2',
      },
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({
      speciesId: sp1.id,
      trait: { id: trait.id },
      valueText: 'red',
      level: { id: trait.levels[0]?.id, key: 'red' },
      numericValue: null,
      harmonisation: 'harmonised',
      review: 'unreviewed',
      origin: 'manual',
      createdBy: { id: user.id, name: 'Test User' },
      primaryReference: { id: ref.id },
      secondaryReference: null,
      rawValue: 'Reds',
      note: 'Table 2',
      importBatch: null,
      supersedes: null,
      supersededBy: [],
    });
  });

  it('creates a quantitative record with the canonical number as value_text', async () => {
    const { cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { valueType: 'quantitative', unit: 'mm' });
    const ref = await createReference(t.db);
    const res = await call(t.app, 'POST', '/api/records', {
      cookie,
      body: { speciesId: sp1.id, traitId: trait.id, value: { numeric: 1e3 }, primaryReferenceId: ref.id },
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ valueText: '1000', numericValue: 1000, level: null });
  });

  it('validates the value against the trait: shape, foreign level, inactive level, inactive trait', async () => {
    const { cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const cat = await createTrait(t.db, { levels: ['a'] });
    const other = await createTrait(t.db, { levels: ['b'] });
    const quant = await createTrait(t.db, { valueType: 'quantitative' });
    const inactiveTrait = await createTrait(t.db, { active: false, levels: ['c'] });
    const ref = await createReference(t.db);
    await t.db.update(traitLevels).set({ active: false }).where(eq(traitLevels.id, other.levels[0]?.id ?? ''));
    const post = (body: Record<string, unknown>) =>
      call(t.app, 'POST', '/api/records', { cookie, body: { speciesId: sp1.id, primaryReferenceId: ref.id, ...body } });
    const cases: [Record<string, unknown>, string][] = [
      [{ traitId: cat.id, value: { numeric: 1 } }, 'value'],
      [{ traitId: quant.id, value: { levelId: cat.levels[0]?.id } }, 'value'],
      [{ traitId: cat.id, value: { levelId: other.levels[0]?.id } }, 'value.levelId'],
      [{ traitId: other.id, value: { levelId: other.levels[0]?.id } }, 'value.levelId'],
      [{ traitId: inactiveTrait.id, value: { levelId: inactiveTrait.levels[0]?.id } }, 'traitId'],
    ];
    for (const [body, path] of cases) {
      const res = await post(body);
      expect(res.status, path).toBe(400);
      const err = (await res.json()).error;
      expect(err.code, path).toBe('VALIDATION_FAILED');
      expect(err.details[0].path, path).toBe(path);
    }
  });

  it('answers 404 for an unknown species, trait or reference', async () => {
    const { cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const ref = await createReference(t.db);
    const zero = '00000000-0000-7000-8000-000000000000';
    const base = { speciesId: sp1.id, traitId: trait.id, value: { levelId: trait.levels[0]?.id }, primaryReferenceId: ref.id };
    for (const [body, code] of [
      [{ ...base, speciesId: zero }, 'SPECIES_NOT_FOUND'],
      [{ ...base, traitId: zero }, 'TRAIT_NOT_FOUND'],
      [{ ...base, primaryReferenceId: zero }, 'REFERENCE_NOT_FOUND'],
      [{ ...base, secondaryReferenceId: zero }, 'REFERENCE_NOT_FOUND'],
    ] as const) {
      const res = await call(t.app, 'POST', '/api/records', { cookie, body });
      expect(res.status, code).toBe(404);
      expect((await res.json()).error.code, code).toBe(code);
    }
  });

  it('R2 an identical claim answers 409 RECORD_DUPLICATE naming the existing record', async () => {
    const { cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const ref = await createReference(t.db);
    const body = { speciesId: sp1.id, traitId: trait.id, value: { levelId: trait.levels[0]?.id }, primaryReferenceId: ref.id, rawValue: 'A' };
    const first = await call(t.app, 'POST', '/api/records', { cookie, body });
    expect(first.status).toBe(201);
    const firstId = (await first.json()).data.id;
    const again = await call(t.app, 'POST', '/api/records', { cookie, body });
    expect(again.status).toBe(409);
    const err = (await again.json()).error;
    expect(err.code).toBe('RECORD_DUPLICATE');
    expect(err.details).toEqual([{ path: 'recordId', message: firstId }]);
    // a different raw value is a different claim
    const other = await call(t.app, 'POST', '/api/records', { cookie, body: { ...body, rawValue: 'a.' } });
    expect(other.status).toBe(201);
  });

  it('RFC-63 R8 the detail shows supersedes and supersededBy', async () => {
    const { user, cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const ref = await createReference(t.db);
    const batch = await createImportBatch(t.db);
    const pending = await createRecord(t.db, { speciesId: sp1.id, traitId: trait.id, valueText: 'aa', primaryReferenceId: ref.id, importBatchId: batch.id });
    const mapped = await createRecord(t.db, {
      speciesId: sp1.id, traitId: trait.id, valueText: 'a', levelId: trait.levels[0]?.id,
      primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id, supersedesRecordId: pending.id,
    });
    const original = await call(t.app, 'GET', `/api/records/${pending.id}`, { cookie });
    expect((await original.json()).data).toMatchObject({ supersedes: null, supersededBy: [{ id: mapped.id }] });
    const reading = await call(t.app, 'GET', `/api/records/${mapped.id}`, { cookie });
    expect((await reading.json()).data).toMatchObject({ supersedes: { id: pending.id }, supersededBy: [] });
  });
});
```

In `apps/api/src/routes-guarded.integration.test.ts` add `'POST /api/records',` to the exact route list and to `withBody`.

- [ ] **Step 2: Run to see them fail**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/http/routes/dataset/records.integration.test.ts
```

Expected: FAIL — `POST /api/records` answers 404 `NOT_FOUND`; the detail lacks `supersedes`.

- [ ] **Step 3: Contracts — the detail fields**

In `packages/contracts/src/dataset.ts`, add to `recordDetailSchema` after `acceptedHistory`:

```ts
  supersedes: z.strictObject({ id: z.uuid() }).nullable(),
  supersededBy: z.array(z.strictObject({ id: z.uuid() })),
```

Rebuild contracts. In `apps/web/src/test/dataset-fixtures.ts` add `supersedes: null, supersededBy: [],` to `RECORD_DETAIL` and `CURATED_RECORD_DETAIL`; run `pnpm --filter @treerepro/web test` and fix any other `RecordDetail` literal the type checker names.

- [ ] **Step 4: `records.ts` — export the item query, add the supersedes fields**

In `apps/api/src/dataset/records.ts`: change `type ItemRow` to `export type ItemRow`, `function toItem` to `export function toItem` (JSDoc `/** @rfc RFC-63 R8 */`), `function itemQuery` to `export function itemQuery` (JSDoc `/** The joined select behind every record item; the queues reuse it. @rfc RFC-63 R8 */`).

In `getRecord`, add a fourth parallel query and the two fields:

```ts
    db
      .select({ id: traitRecords.id })
      .from(traitRecords)
      .where(eq(traitRecords.supersedesRecordId, id))
      .orderBy(desc(traitRecords.id)),
```

(destructure it as `supersededBy`) and in the returned object, after `acceptedHistory`:

```ts
    supersedes: rec.supersedesRecordId ? { id: rec.supersedesRecordId } : null,
    supersededBy: supersededBy.map((r) => ({ id: r.id })),
```

- [ ] **Step 5: `curation.ts` — `createRecord`**

Create `apps/api/src/dataset/curation.ts`:

```ts
import type { RecordDetail, RecordValue, TraitValueType } from '@treerepro/contracts';
import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { species } from '../db/schema/taxa.ts';
import { AppError } from '../http/errors.ts';
import { isHarmonisableNumber } from './import.ts';
import { getRecord } from './records.ts';

const validation = (path: string, message: string) =>
  new AppError('VALIDATION_FAILED', 'Request validation failed', [{ path, message }]);

export interface TraitBrief {
  id: string;
  key: string;
  valueType: TraitValueType;
  unit: string | null;
  active: boolean;
}

/** @rfc RFC-65 R1 */
export async function requireTrait(db: DbExecutor, traitId: string): Promise<TraitBrief> {
  const [row] = await db
    .select({
      id: traits.id,
      key: traits.key,
      valueType: traits.valueType,
      unit: traits.unit,
      active: traits.active,
    })
    .from(traits)
    .where(eq(traits.id, traitId))
    .limit(1);
  if (!row) throw new AppError('TRAIT_NOT_FOUND', 'Trait not found');
  return row;
}

/** @rfc RFC-65 R1 */
export async function requireSpecies(db: DbExecutor, speciesId: string): Promise<{ id: string }> {
  const [row] = await db
    .select({ id: species.id })
    .from(species)
    .where(eq(species.id, speciesId))
    .limit(1);
  if (!row) throw new AppError('SPECIES_NOT_FOUND', 'Species not found');
  return row;
}

async function requireReference(db: DbExecutor, id: string, path: string): Promise<void> {
  const [row] = await db
    .select({ id: bibliographicReferences.id })
    .from(bibliographicReferences)
    .where(eq(bibliographicReferences.id, id))
    .limit(1);
  if (!row)
    throw new AppError('REFERENCE_NOT_FOUND', 'Reference not found', [
      { path, message: 'Reference not found' },
    ]);
}

export type ResolvedValue =
  | { levelId: string; levelKey: string; numericValue: null }
  | { levelId: null; levelKey: null; numericValue: number };

/**
 * A manual value against its trait: the level must belong to the trait and be
 * active; the number must pass the RFC-64 R6 rule. `path` prefixes the detail
 * paths (`value` for a record, `value` for a mapping).
 * @rfc RFC-65 R1, R9
 */
export async function resolveValue(
  db: DbExecutor,
  trait: Pick<TraitBrief, 'id' | 'valueType'>,
  value: RecordValue,
  path = 'value',
): Promise<ResolvedValue> {
  if ('levelId' in value) {
    if (trait.valueType !== 'categorical')
      throw validation(path, 'A quantitative trait takes a number');
    const [level] = await db
      .select({ id: traitLevels.id, key: traitLevels.key, active: traitLevels.active })
      .from(traitLevels)
      .where(and(eq(traitLevels.id, value.levelId), eq(traitLevels.traitId, trait.id)))
      .limit(1);
    if (!level) throw validation(`${path}.levelId`, 'Level does not belong to this trait');
    if (!level.active) throw validation(`${path}.levelId`, 'Level is inactive');
    return { levelId: level.id, levelKey: level.key, numericValue: null };
  }
  if (trait.valueType !== 'quantitative')
    throw validation(path, 'A categorical trait takes a level');
  if (!isHarmonisableNumber(String(value.numeric)))
    throw validation(`${path}.numeric`, 'Number is out of range');
  return { levelId: null, levelKey: null, numericValue: value.numeric };
}

/** The canonical text of a number, as PostgreSQL prints `numeric` (`1e3` → `1000`). @rfc RFC-65 R1 */
export function numericText(n: number): SQL<string> {
  return sql<string>`(${String(n)}::numeric)::text`;
}

export interface CreateRecordInput {
  actorId: string;
  speciesId: string;
  traitId: string;
  value: RecordValue;
  primaryReferenceId: string;
  secondaryReferenceId?: string;
  rawValue?: string;
  note?: string;
}

/**
 * One manual, harmonised claim. A single INSERT: on a claim-key collision the
 * existing record is looked up afterwards (nothing is left aborted) and named
 * in the 409.
 * @rfc RFC-65 R1, R2
 */
export async function createRecord(db: DbExecutor, input: CreateRecordInput): Promise<RecordDetail> {
  await requireSpecies(db, input.speciesId);
  const trait = await requireTrait(db, input.traitId);
  if (!trait.active) throw validation('traitId', 'Trait is inactive');
  await requireReference(db, input.primaryReferenceId, 'primaryReferenceId');
  if (input.secondaryReferenceId !== undefined)
    await requireReference(db, input.secondaryReferenceId, 'secondaryReferenceId');
  const value = await resolveValue(db, trait, input.value);
  const valueText: string | SQL<string> =
    value.levelKey !== null ? value.levelKey : numericText(value.numericValue);
  const claim = {
    speciesId: input.speciesId,
    traitId: input.traitId,
    rawValue: input.rawValue ?? null,
    primaryReferenceId: input.primaryReferenceId,
    secondaryReferenceId: input.secondaryReferenceId ?? null,
  };
  let inserted: { id: string } | undefined;
  try {
    [inserted] = await db
      .insert(traitRecords)
      .values({
        ...claim,
        levelId: value.levelId,
        numericValue: value.numericValue,
        valueText,
        harmonisation: 'harmonised',
        origin: 'manual',
        createdBy: input.actorId,
        note: input.note ?? null,
      })
      .returning({ id: traitRecords.id });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const [existing] = await db
      .select({ id: traitRecords.id })
      .from(traitRecords)
      .where(
        and(
          eq(traitRecords.speciesId, claim.speciesId),
          eq(traitRecords.traitId, claim.traitId),
          eq(traitRecords.valueText, valueText),
          claim.rawValue === null
            ? isNull(traitRecords.rawValue)
            : eq(traitRecords.rawValue, claim.rawValue),
          eq(traitRecords.primaryReferenceId, claim.primaryReferenceId),
          claim.secondaryReferenceId === null
            ? isNull(traitRecords.secondaryReferenceId)
            : eq(traitRecords.secondaryReferenceId, claim.secondaryReferenceId),
        ),
      )
      .limit(1);
    throw new AppError(
      'RECORD_DUPLICATE',
      'This claim already exists; confirm it instead',
      existing ? [{ path: 'recordId', message: existing.id }] : undefined,
    );
  }
  if (!inserted) throw new Error('createRecord: insert returned no row');
  const detail = await getRecord(db, inserted.id);
  if (!detail) throw new Error('createRecord: record vanished');
  return detail;
}
```

- [ ] **Step 6: Route**

In `apps/api/src/http/routes/dataset/records.ts` add the imports `createRecordBodySchema` (contracts), `createRecord` from `'../../../dataset/curation.ts'`, `currentUser` from `'../../middleware/session.ts'`, and register before the `GET /` handler:

```ts
    .post(
      '/',
      requirePermission(ctx, 'records.create'),
      validate('json', createRecordBodySchema),
      async (c) => {
        const record = await createRecord(ctx.db, {
          ...c.req.valid('json'),
          actorId: currentUser(c).id,
        });
        return c.json({ data: record }, 201);
      },
    )
```

Update the function's JSDoc to `@rfc RFC-63 R8, R9` + `@rfc RFC-65 R1, R2`.

- [ ] **Step 7: Run tests**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts build
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/http/routes/dataset/records.integration.test.ts src/routes-guarded.integration.test.ts src/dataset/records.integration.test.ts
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/web test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint:fix && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm typecheck && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check
git add apps/api/src packages/contracts/src apps/web/src
git commit -m "feat(api): manual trait records — POST /api/records with duplicate detection (RFC-65 R1, R2); supersedes on the record detail (RFC-63 R8)"
```

---

### Task 7: Annotations — `annotateRecord`, `POST /api/records/:id/annotations`

**Files:**
- Modify: `apps/api/src/dataset/curation.ts`, `apps/api/src/http/routes/dataset/records.ts`, `apps/api/src/routes-guarded.integration.test.ts`
- Test: `apps/api/src/http/routes/dataset/records.integration.test.ts`

**Interfaces:**
- Consumes: `reviewStatusSql`, `getRecord` (records.ts), `currentPermissions` (require-permission.ts), helpers `createAcceptedValue`, `createAnnotation`.
- Produces: `currentAccepted(db, speciesId, traitId)`, `annotateRecord(db, input)`.

- [ ] **Step 1: Failing route tests**

Append to `apps/api/src/http/routes/dataset/records.integration.test.ts` (the module-scope `scientist(t, permissions)` helper of Task 6 serves every describe):

```ts
describe('RFC-65 R3, R4 POST /api/records/:id/annotations', () => {
  const t = useTestApp();

  async function manualRecord(authorId: string) {
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const ref = await createReference(t.db);
    const rec = await createRecord(t.db, {
      speciesId: sp1.id, traitId: trait.id, valueText: 'a', levelId: trait.levels[0]?.id,
      primaryReferenceId: ref.id, origin: 'manual', createdBy: authorId,
    });
    return { sp1, trait, ref, rec };
  }
  const annotate = (cookie: string, id: string, body: Record<string, unknown>) =>
    call(t.app, 'POST', `/api/records/${id}/annotations`, { cookie, body });

  it('R3 stances drive the review axis of RFC-63 R6 and answer the detail', async () => {
    const a = await scientist(t, ['records.annotate', 'dataset.read']);
    const b = await scientist(t, ['records.annotate', 'dataset.read']);
    const { rec } = await manualRecord(a.user.id);
    const confirmed = await annotate(a.cookie, rec.id, { kind: 'confirm' });
    expect(confirmed.status).toBe(201);
    expect((await confirmed.json()).data).toMatchObject({ id: rec.id, review: 'confirmed' });
    const disputed = await annotate(b.cookie, rec.id, { kind: 'dispute', note: 'Figure 3 says otherwise' });
    expect((await disputed.json()).data).toMatchObject({ review: 'disputed' });
    const stepped = await annotate(b.cookie, rec.id, { kind: 'neutral' });
    expect((await stepped.json()).data).toMatchObject({ review: 'confirmed' });
    const body = (await stepped.json()).data;
    expect(body.annotations.map((x: { kind: string }) => x.kind)).toEqual(['neutral', 'dispute', 'confirm']);
    expect(body.annotations[1]).toMatchObject({ actor: { id: b.user.id, name: 'Test User' }, note: 'Figure 3 says otherwise' });
  });

  it('R3 a dispute needs a note; an unknown record answers 404', async () => {
    const a = await scientist(t, ['records.annotate']);
    const { rec } = await manualRecord(a.user.id);
    const noNote = await annotate(a.cookie, rec.id, { kind: 'dispute' });
    expect(noNote.status).toBe(400);
    expect((await noNote.json()).error.details[0].path).toBe('note');
    const missing = await annotate(a.cookie, '00000000-0000-7000-8000-000000000000', { kind: 'confirm' });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('RECORD_NOT_FOUND');
  });

  it('R4 the author withdraws a manual record; nothing more can be annotated afterwards', async () => {
    const a = await scientist(t, ['records.annotate']);
    const { rec } = await manualRecord(a.user.id);
    const withdrawn = await annotate(a.cookie, rec.id, { kind: 'withdraw', note: 'Wrong species' });
    expect(withdrawn.status).toBe(201);
    expect((await withdrawn.json()).data.review).toBe('withdrawn');
    const after = await annotate(a.cookie, rec.id, { kind: 'confirm' });
    expect(after.status).toBe(409);
    expect((await after.json()).error.code).toBe('RECORD_WITHDRAWN');
  });

  it('R4 a third party needs records.withdraw', async () => {
    const author = await scientist(t, ['records.annotate']);
    const other = await scientist(t, ['records.annotate']);
    const curator = await scientist(t, ['records.annotate', 'records.withdraw']);
    const { rec } = await manualRecord(author.user.id);
    const denied = await annotate(other.cookie, rec.id, { kind: 'withdraw', note: 'Not mine' });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('PERMISSION_DENIED');
    const allowed = await annotate(curator.cookie, rec.id, { kind: 'withdraw', note: 'Retracted by the author by email' });
    expect(allowed.status).toBe(201);
  });

  it('R4 import records are never withdrawn; the accepted record is not withdrawn', async () => {
    const a = await scientist(t, ['records.annotate']);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const ref = await createReference(t.db);
    const batch = await createImportBatch(t.db);
    const imported = await createRecord(t.db, { speciesId: sp1.id, traitId: trait.id, valueText: 'a', levelId: trait.levels[0]?.id, primaryReferenceId: ref.id, importBatchId: batch.id });
    const res = await annotate(a.cookie, imported.id, { kind: 'withdraw', note: 'x' });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('RECORD_NOT_WITHDRAWABLE');
    const { rec, sp1: sp2, trait: trait2 } = await manualRecord(a.user.id);
    await createAcceptedValue(t.db, { speciesId: sp2.id, traitId: trait2.id, recordId: rec.id, actorId: a.user.id });
    const accepted = await annotate(a.cookie, rec.id, { kind: 'withdraw', note: 'x' });
    expect(accepted.status).toBe(409);
    expect((await accepted.json()).error.code).toBe('RECORD_IS_ACCEPTED');
  });
});
```

Add `'POST /api/records/:id/annotations',` to the guard meta-test's route list and `withBody`.

- [ ] **Step 2: Run to see them fail**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/http/routes/dataset/records.integration.test.ts
```

Expected: FAIL — 404 `NOT_FOUND` on the annotations route.

- [ ] **Step 3: Implement**

Append to `apps/api/src/dataset/curation.ts` (add imports: `AcceptedDecision`, `AnnotationKind` types; `desc` from drizzle-orm; `acceptedValues`, `recordAnnotations` from the curation schema; `reviewStatusSql` from records.ts):

```ts
/** The newest accepted-value decision of a species and trait, or null. @rfc RFC-65 R4, R6 */
export async function currentAccepted(
  db: DbExecutor,
  speciesId: string,
  traitId: string,
): Promise<{ decision: AcceptedDecision; recordId: string | null } | null> {
  const [row] = await db
    .select({ decision: acceptedValues.decision, recordId: acceptedValues.recordId })
    .from(acceptedValues)
    .where(and(eq(acceptedValues.speciesId, speciesId), eq(acceptedValues.traitId, traitId)))
    .orderBy(desc(acceptedValues.id))
    .limit(1);
  return row ?? null;
}

export interface AnnotateRecordInput {
  recordId: string;
  actorId: string;
  kind: AnnotationKind;
  note?: string;
  /** The actor holds `records.withdraw` (RFC-65 R4). */
  canWithdrawAny: boolean;
}

/** @rfc RFC-65 R3, R4 */
export async function annotateRecord(
  db: DbExecutor,
  input: AnnotateRecordInput,
): Promise<RecordDetail> {
  const [rec] = await db
    .select({
      id: traitRecords.id,
      origin: traitRecords.origin,
      createdBy: traitRecords.createdBy,
      speciesId: traitRecords.speciesId,
      traitId: traitRecords.traitId,
      review: reviewStatusSql(traitRecords.id).as('review'),
    })
    .from(traitRecords)
    .where(eq(traitRecords.id, input.recordId))
    .limit(1);
  if (!rec) throw new AppError('RECORD_NOT_FOUND', 'Record not found');
  if (rec.review === 'withdrawn')
    throw new AppError('RECORD_WITHDRAWN', 'This record is withdrawn');
  if (input.kind === 'withdraw') {
    if (rec.origin !== 'manual')
      throw new AppError('RECORD_NOT_WITHDRAWABLE', 'Only manual records can be withdrawn');
    if (rec.createdBy !== input.actorId && !input.canWithdrawAny)
      throw new AppError('PERMISSION_DENIED', 'Only the author may withdraw this record');
    const current = await currentAccepted(db, rec.speciesId, rec.traitId);
    if (current?.decision === 'accepted' && current.recordId === rec.id)
      throw new AppError(
        'RECORD_IS_ACCEPTED',
        'This record is the accepted value; change the accepted value first',
      );
  }
  await db.insert(recordAnnotations).values({
    recordId: rec.id,
    actorId: input.actorId,
    kind: input.kind,
    note: input.note ?? null,
  });
  const detail = await getRecord(db, rec.id);
  if (!detail) throw new Error('annotateRecord: record vanished');
  return detail;
}
```

Route, in `records.ts` after the `POST /`:

```ts
    .post(
      '/:id/annotations',
      requirePermission(ctx, 'records.annotate'),
      validate('param', idParamSchema),
      validate('json', annotateRecordBodySchema),
      async (c) => {
        const record = await annotateRecord(ctx.db, {
          recordId: c.req.valid('param').id,
          ...c.req.valid('json'),
          actorId: currentUser(c).id,
          canWithdrawAny: currentPermissions(c).has('records.withdraw'),
        });
        return c.json({ data: record }, 201);
      },
    )
```

Import `annotateRecordBodySchema`, `annotateRecord`, `currentPermissions`. JSDoc gains `@rfc RFC-65 R3, R4`.

- [ ] **Step 4: Run tests**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/http/routes/dataset/records.integration.test.ts src/routes-guarded.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint:fix && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm typecheck && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check
git add apps/api/src
git commit -m "feat(api): confirm, dispute, neutral and withdraw annotations (RFC-65 R3, R4)"
```

---

### Task 8: Accepted value — `getAccepted`, `setAccepted`, `GET`/`PUT /api/species/:id/traits/:traitId/accepted`

**Files:**
- Modify: `apps/api/src/dataset/curation.ts`, `apps/api/src/http/routes/dataset/species.ts`, `apps/api/src/routes-guarded.integration.test.ts`
- Test: `apps/api/src/http/routes/dataset/species.integration.test.ts`

**Interfaces:**
- Consumes: `setAcceptedBodySchema`, `speciesTraitParamSchema`, `AcceptedState` (Task 5); `currentAccepted`, `requireSpecies`, `requireTrait` (Tasks 6–7).
- Produces: `getAccepted(db, speciesId, traitId)`, `setAccepted(db, input)`.

- [ ] **Step 1: Failing route tests**

Append to `apps/api/src/http/routes/dataset/species.integration.test.ts` (imports: `createTrait`, `createRecord`, `createReference`, `createSpecies`, `createImportBatch`, `createAnnotation` from the dataset helpers; `createRole`, `createUser`, `loginAs`):

```ts
describe('RFC-65 R6 accepted value per species and trait', () => {
  const t = useTestApp();

  async function curator() {
    const role = await createRole(t.db, { permissions: ['accepted.manage', 'dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }
  async function fixture(authorId: string) {
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const ref = await createReference(t.db);
    const mk = (levelIndex: number, valueText: string) =>
      createRecord(t.db, { speciesId: sp1.id, traitId: trait.id, valueText, levelId: trait.levels[levelIndex]?.id, primaryReferenceId: ref.id, origin: 'manual', createdBy: authorId });
    return { sp1, trait, ref, recA: await mk(0, 'a'), recB: await mk(1, 'b') };
  }
  const put = (cookie: string, speciesId: string, traitId: string, body: Record<string, unknown>) =>
    call(t.app, 'PUT', `/api/species/${speciesId}/traits/${traitId}/accepted`, { cookie, body });

  it('accepts, replaces, clears; repeats insert nothing; the summary and the GET agree', async () => {
    const { user, cookie } = await curator();
    const { sp1, trait, recA, recB } = await fixture(user.id);
    const first = await put(cookie, sp1.id, trait.id, { decision: 'accepted', recordId: recA.id, note: 'Best sampled' });
    expect(first.status).toBe(200);
    expect((await first.json()).data).toMatchObject({
      current: { recordId: recA.id, valueText: 'a', actor: { id: user.id, name: 'Test User' }, note: 'Best sampled' },
      history: [{ decision: 'accepted', recordId: recA.id, valueText: 'a' }],
    });
    const summary = await call(t.app, 'GET', `/api/species/${sp1.id}/traits`, { cookie });
    expect((await summary.json()).data[0].traits[0].accepted).toMatchObject({ recordId: recA.id, valueText: 'a' });
    const same = await put(cookie, sp1.id, trait.id, { decision: 'accepted', recordId: recA.id });
    expect((await same.json()).data.history).toHaveLength(1);
    const replaced = await put(cookie, sp1.id, trait.id, { decision: 'accepted', recordId: recB.id });
    expect((await replaced.json()).data).toMatchObject({ current: { recordId: recB.id }, history: [{ recordId: recB.id }, { recordId: recA.id }] });
    const cleared = await put(cookie, sp1.id, trait.id, { decision: 'cleared', note: 'Sources disagree' });
    expect((await cleared.json()).data).toMatchObject({ current: null, history: [{ decision: 'cleared', recordId: null, valueText: null, note: 'Sources disagree' }, {}, {}] });
    const clearedAgain = await put(cookie, sp1.id, trait.id, { decision: 'cleared', note: 'still' });
    expect((await clearedAgain.json()).data.history).toHaveLength(3);
    const got = await call(t.app, 'GET', `/api/species/${sp1.id}/traits/${trait.id}/accepted`, { cookie });
    expect(got.status).toBe(200);
    expect((await got.json()).data).toEqual((await clearedAgain.json()).data);
  });

  it('refuses a record of another species or trait, a pending record and a withdrawn one; 404s', async () => {
    const { user, cookie } = await curator();
    const { sp1, trait, ref, recA } = await fixture(user.id);
    const otherSpecies = await createSpecies(t.db);
    const batch = await createImportBatch(t.db);
    const pending = await createRecord(t.db, { speciesId: sp1.id, traitId: trait.id, valueText: 'zz', primaryReferenceId: ref.id, importBatchId: batch.id });
    await createAnnotation(t.db, { recordId: recA.id, actorId: user.id, kind: 'withdraw', note: 'gone' });
    const zero = '00000000-0000-7000-8000-000000000000';
    const wrong = await put(cookie, otherSpecies.id, trait.id, { decision: 'accepted', recordId: recA.id });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.details[0].path).toBe('recordId');
    const notHarmonised = await put(cookie, sp1.id, trait.id, { decision: 'accepted', recordId: pending.id });
    expect((await notHarmonised.json()).error.code).toBe('RECORD_NOT_HARMONISED');
    const withdrawn = await put(cookie, sp1.id, trait.id, { decision: 'accepted', recordId: recA.id });
    expect((await withdrawn.json()).error.code).toBe('RECORD_WITHDRAWN');
    for (const [s, tr, r, code] of [
      [zero, trait.id, recA.id, 'SPECIES_NOT_FOUND'],
      [sp1.id, zero, recA.id, 'TRAIT_NOT_FOUND'],
      [sp1.id, trait.id, zero, 'RECORD_NOT_FOUND'],
    ] as const) {
      const res = await put(cookie, s, tr, { decision: 'accepted', recordId: r });
      expect(res.status, code).toBe(404);
      expect((await res.json()).error.code, code).toBe(code);
    }
    const getMissing = await call(t.app, 'GET', `/api/species/${sp1.id}/traits/${zero}/accepted`, { cookie });
    expect(getMissing.status).toBe(404);
  });
});
```

Add `'GET /api/species/:id/traits/:traitId/accepted'` and `'PUT /api/species/:id/traits/:traitId/accepted'` to the guard list; the `PUT` to `withBody`.

- [ ] **Step 2: Run to see them fail**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/http/routes/dataset/species.integration.test.ts
```

Expected: FAIL — 404 `NOT_FOUND` on the accepted routes.

- [ ] **Step 3: Implement the services**

Append to `apps/api/src/dataset/curation.ts` (import `AcceptedState` type; `users` schema):

```ts
/** @rfc RFC-65 R6, R11 */
export async function getAccepted(
  db: DbExecutor,
  speciesId: string,
  traitId: string,
): Promise<AcceptedState> {
  const rows = await db
    .select({
      id: acceptedValues.id,
      decision: acceptedValues.decision,
      recordId: acceptedValues.recordId,
      note: acceptedValues.note,
      createdAt: acceptedValues.createdAt,
      actorId: users.id,
      actorName: users.name,
      valueText: traitRecords.valueText,
    })
    .from(acceptedValues)
    .innerJoin(users, eq(users.id, acceptedValues.actorId))
    .leftJoin(traitRecords, eq(traitRecords.id, acceptedValues.recordId))
    .where(and(eq(acceptedValues.speciesId, speciesId), eq(acceptedValues.traitId, traitId)))
    .orderBy(desc(acceptedValues.id));
  const history = rows.map((r) => ({
    id: r.id,
    decision: r.decision,
    recordId: r.recordId,
    valueText: r.valueText ?? null,
    actor: { id: r.actorId, name: r.actorName },
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));
  const newest = rows[0];
  const current =
    newest && newest.decision === 'accepted' && newest.recordId && newest.valueText !== null
      ? {
          id: newest.id,
          recordId: newest.recordId,
          valueText: newest.valueText,
          actor: { id: newest.actorId, name: newest.actorName },
          note: newest.note,
          decidedAt: newest.createdAt.toISOString(),
        }
      : null;
  return { current, history };
}

export interface SetAcceptedInput {
  speciesId: string;
  traitId: string;
  actorId: string;
  decision: AcceptedDecision;
  recordId?: string;
  note?: string;
}

/** Idempotent: a request equal to the current state inserts nothing. @rfc RFC-65 R6 */
export async function setAccepted(db: DbExecutor, input: SetAcceptedInput): Promise<AcceptedState> {
  await requireSpecies(db, input.speciesId);
  await requireTrait(db, input.traitId);
  const current = await currentAccepted(db, input.speciesId, input.traitId);
  if (input.decision === 'accepted') {
    const recordId = input.recordId;
    if (!recordId) throw validation('recordId', 'Required');
    const [rec] = await db
      .select({
        id: traitRecords.id,
        speciesId: traitRecords.speciesId,
        traitId: traitRecords.traitId,
        harmonisation: traitRecords.harmonisation,
        review: reviewStatusSql(traitRecords.id).as('review'),
      })
      .from(traitRecords)
      .where(eq(traitRecords.id, recordId))
      .limit(1);
    if (!rec) throw new AppError('RECORD_NOT_FOUND', 'Record not found');
    if (rec.speciesId !== input.speciesId || rec.traitId !== input.traitId)
      throw validation('recordId', 'Record belongs to another species or trait');
    if (rec.harmonisation !== 'harmonised')
      throw new AppError('RECORD_NOT_HARMONISED', 'Only a harmonised record can be accepted');
    if (rec.review === 'withdrawn')
      throw new AppError('RECORD_WITHDRAWN', 'This record is withdrawn');
    if (!(current?.decision === 'accepted' && current.recordId === recordId)) {
      await db.insert(acceptedValues).values({
        speciesId: input.speciesId,
        traitId: input.traitId,
        recordId,
        decision: 'accepted',
        actorId: input.actorId,
        note: input.note ?? null,
      });
    }
  } else if (current && current.decision === 'accepted') {
    await db.insert(acceptedValues).values({
      speciesId: input.speciesId,
      traitId: input.traitId,
      recordId: null,
      decision: 'cleared',
      actorId: input.actorId,
      note: input.note ?? null,
    });
  }
  return getAccepted(db, input.speciesId, input.traitId);
}
```

- [ ] **Step 4: Routes**

In `apps/api/src/http/routes/dataset/species.ts` import `setAcceptedBodySchema`, `speciesTraitParamSchema`; `getAccepted`, `requireSpecies`, `requireTrait`, `setAccepted` from `'../../../dataset/curation.ts'`; `currentUser`. Append two routes:

```ts
    .get(
      '/:id/traits/:traitId/accepted',
      requirePermission(ctx, 'dataset.read'),
      validate('param', speciesTraitParamSchema),
      async (c) => {
        const { id, traitId } = c.req.valid('param');
        await requireSpecies(ctx.db, id);
        await requireTrait(ctx.db, traitId);
        return c.json({ data: await getAccepted(ctx.db, id, traitId) });
      },
    )
    .put(
      '/:id/traits/:traitId/accepted',
      requirePermission(ctx, 'accepted.manage'),
      validate('param', speciesTraitParamSchema),
      validate('json', setAcceptedBodySchema),
      async (c) => {
        const { id, traitId } = c.req.valid('param');
        const body = c.req.valid('json');
        const state = await setAccepted(ctx.db, {
          speciesId: id,
          traitId,
          actorId: currentUser(c).id,
          decision: body.decision,
          recordId: body.decision === 'accepted' ? body.recordId : undefined,
          note: body.note,
        });
        return c.json({ data: state });
      },
    )
```

JSDoc gains `@rfc RFC-65 R6`.

- [ ] **Step 5: Run tests**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/http/routes/dataset/species.integration.test.ts src/routes-guarded.integration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint:fix && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm typecheck && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check
git add apps/api/src
git commit -m "feat(api): accepted value per species and trait — GET/PUT with history (RFC-65 R6, R11)"
```

---

### Task 9: Harmonisation queue — `pendingTraits`, `pendingGroups`, `mapPending`; `GET /api/records/pending/traits`, `GET /api/records/pending`, `POST /api/records/pending/map`

**Files:**
- Create: `apps/api/src/dataset/queues.ts`
- Modify: `apps/api/src/http/routes/dataset/records.ts`, `apps/api/src/routes-guarded.integration.test.ts`
- Test: `apps/api/src/http/routes/dataset/records.integration.test.ts`

**Interfaces:**
- Consumes: `requireTrait`, `resolveValue` (Task 6); `pageOf`, `encodeCompositeCursor`, `decodeCompositeCursor`, `isDigits` (cursor.ts); `pendingGroupsQuerySchema`, `mapPendingBodySchema` (Task 5).
- Produces: `pendingTraits(db)`, `pendingGroups(db, { traitId, cursor?, limit })`, `mapPending(db, input)`.

- [ ] **Step 1: Failing route tests**

Append to `apps/api/src/http/routes/dataset/records.integration.test.ts`:

```ts
describe('RFC-65 R7–R9 harmonisation queue', () => {
  const t = useTestApp();

  /** Two species, one reference, a categorical trait (red, blue) and a quantitative one; pending import rows on both. */
  async function queueFixture() {
    const { user, cookie } = await scientist(t, ['records.create', 'dataset.read']);
    const s1 = await createSpecies(t.db);
    const s2 = await createSpecies(t.db);
    const ref = await createReference(t.db);
    const cat = await createTrait(t.db, { levels: ['red', 'blue'] });
    const quant = await createTrait(t.db, { valueType: 'quantitative', unit: 'mm' });
    const batch = await createImportBatch(t.db);
    const imp = (speciesId: string, traitId: string, valueText: string, extra: Record<string, unknown> = {}) =>
      createRecord(t.db, { speciesId, traitId, valueText, primaryReferenceId: ref.id, importBatchId: batch.id, harmonisation: 'unknown_level', ...extra });
    const reds1 = await imp(s1.id, cat.id, 'reds', { rawValue: 'Reds' });
    const reds2 = await imp(s2.id, cat.id, 'reds');
    const reds3 = await imp(s2.id, cat.id, 'reds', { rawValue: 'reds!' });
    const multi = await imp(s1.id, cat.id, 'red;blue', { harmonisation: 'multi_value' });
    await imp(s1.id, cat.id, '', { harmonisation: 'empty' });
    const approx = await imp(s1.id, quant.id, 'ca. 12', { harmonisation: 'not_numeric' });
    return { user, cookie, s1, s2, ref, cat, quant, reds1, reds2, reds3, multi, approx };
  }

  it('R7, R8 lists traits with pending counts and the groups of one trait; empty rows are not pending', async () => {
    const f = await queueFixture();
    const traitsRes = await call(t.app, 'GET', '/api/records/pending/traits', { cookie: f.cookie });
    expect(traitsRes.status).toBe(200);
    const traits = (await traitsRes.json()).data as { trait: { id: string; key: string }; count: number }[];
    expect(traits.find((x) => x.trait.id === f.cat.id)).toMatchObject({ trait: { key: f.cat.key, valueType: 'categorical' }, count: 4 });
    expect(traits.find((x) => x.trait.id === f.quant.id)).toMatchObject({ count: 1 });
    const groups = await call(t.app, 'GET', `/api/records/pending?traitId=${f.cat.id}`, { cookie: f.cookie });
    expect(groups.status).toBe(200);
    expect((await groups.json()).data).toEqual([
      { valueText: 'reds', harmonisation: 'unknown_level', count: 3, sampleRecordId: f.reds3.id },
      { valueText: 'red;blue', harmonisation: 'multi_value', count: 1, sampleRecordId: f.multi.id },
    ]);
    const page1 = await call(t.app, 'GET', `/api/records/pending?traitId=${f.cat.id}&limit=1`, { cookie: f.cookie });
    const body1 = await page1.json();
    expect(body1.data[0].valueText).toBe('reds');
    expect(body1.meta.nextCursor).not.toBeNull();
    const page2 = await call(t.app, 'GET', `/api/records/pending?traitId=${f.cat.id}&limit=1&cursor=${body1.meta.nextCursor}`, { cookie: f.cookie });
    const body2 = await page2.json();
    expect(body2.data[0].valueText).toBe('red;blue');
    expect(body2.meta.nextCursor).toBeNull();
    const bad = await call(t.app, 'GET', `/api/records/pending?traitId=${f.cat.id}&cursor=nope`, { cookie: f.cookie });
    expect(bad.status).toBe(400);
    const noTrait = await call(t.app, 'GET', '/api/records/pending', { cookie: f.cookie });
    expect(noTrait.status).toBe(400);
    const unknown = await call(t.app, 'GET', '/api/records/pending?traitId=00000000-0000-7000-8000-000000000000', { cookie: f.cookie });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe('TRAIT_NOT_FOUND');
  });

  it('R9 maps a group to one level: one harmonised record per pending row, inheriting references and raw value', async () => {
    const f = await queueFixture();
    const red = f.cat.levels[0]?.id ?? '';
    const res = await call(t.app, 'POST', '/api/records/pending/map', {
      cookie: f.cookie,
      body: { traitId: f.cat.id, valueText: 'reds', value: { levelIds: [red] }, note: 'Plural of red' },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ created: 3, skipped: 0 });
    const original = await call(t.app, 'GET', `/api/records/${f.reds1.id}`, { cookie: f.cookie });
    const detail = (await original.json()).data;
    expect(detail.supersededBy).toHaveLength(1);
    expect(detail.review).toBe('unreviewed');
    const mapped = await call(t.app, 'GET', `/api/records/${detail.supersededBy[0].id}`, { cookie: f.cookie });
    expect((await mapped.json()).data).toMatchObject({
      speciesId: f.s1.id,
      valueText: 'red',
      level: { id: red, key: 'red' },
      harmonisation: 'harmonised',
      origin: 'manual',
      createdBy: { id: f.user.id },
      primaryReference: { id: f.ref.id },
      rawValue: 'Reds',
      note: 'Plural of red',
      supersedes: { id: f.reds1.id },
    });
    const noRaw = await call(t.app, 'GET', `/api/records/${f.reds2.id}`, { cookie: f.cookie });
    const noRawMapped = await call(t.app, 'GET', `/api/records/${(await noRaw.json()).data.supersededBy[0].id}`, { cookie: f.cookie });
    expect((await noRawMapped.json()).data.rawValue).toBe('reds');
    const groups = await call(t.app, 'GET', `/api/records/pending?traitId=${f.cat.id}`, { cookie: f.cookie });
    expect((await groups.json()).data.map((g: { valueText: string }) => g.valueText)).toEqual(['red;blue']);
    const again = await call(t.app, 'POST', '/api/records/pending/map', {
      cookie: f.cookie,
      body: { traitId: f.cat.id, valueText: 'reds', value: { levelIds: [red] } },
    });
    expect((await again.json()).data).toEqual({ created: 0, skipped: 0 });
  });

  it('R9 a multi-value group maps to several levels; a numeric group maps to a number; existing claims are skipped', async () => {
    const f = await queueFixture();
    const [red, blue] = f.cat.levels.map((l) => l.id);
    const multi = await call(t.app, 'POST', '/api/records/pending/map', {
      cookie: f.cookie,
      body: { traitId: f.cat.id, valueText: 'red;blue', value: { levelIds: [red, blue] } },
    });
    expect((await multi.json()).data).toEqual({ created: 2, skipped: 0 });
    const original = await call(t.app, 'GET', `/api/records/${f.multi.id}`, { cookie: f.cookie });
    expect((await original.json()).data.supersededBy).toHaveLength(2);
    const numeric = await call(t.app, 'POST', '/api/records/pending/map', {
      cookie: f.cookie,
      body: { traitId: f.quant.id, valueText: 'ca. 12', value: { numeric: 12 } },
    });
    expect((await numeric.json()).data).toEqual({ created: 1, skipped: 0 });
    const approx = await call(t.app, 'GET', `/api/records/${f.approx.id}`, { cookie: f.cookie });
    const reading = await call(t.app, 'GET', `/api/records/${(await approx.json()).data.supersededBy[0].id}`, { cookie: f.cookie });
    expect((await reading.json()).data).toMatchObject({ valueText: '12', numericValue: 12, rawValue: 'ca. 12' });
    // a claim the spreadsheet had already harmonised: (s2, cat, 'red', raw 'reds!', ref) exists → the mapping skips it
    await createRecord(t.db, { speciesId: f.s2.id, traitId: f.cat.id, valueText: 'red', levelId: red, rawValue: 'reds!', primaryReferenceId: f.ref.id, importBatchId: (await createImportBatch(t.db)).id });
    const skipped = await call(t.app, 'POST', '/api/records/pending/map', {
      cookie: f.cookie,
      body: { traitId: f.cat.id, valueText: 'reds', value: { levelIds: [red] } },
    });
    expect((await skipped.json()).data).toEqual({ created: 2, skipped: 1 });
    const groups = await call(t.app, 'GET', `/api/records/pending?traitId=${f.cat.id}`, { cookie: f.cookie });
    expect((await groups.json()).data).toEqual([{ valueText: 'reds', harmonisation: 'unknown_level', count: 1, sampleRecordId: f.reds3.id }]);
  });

  it('R9 validates like a manual record: level of another trait, levels on a quantitative trait, unknown trait', async () => {
    const f = await queueFixture();
    const other = await createTrait(t.db, { levels: ['x'] });
    const post = (body: Record<string, unknown>) => call(t.app, 'POST', '/api/records/pending/map', { cookie: f.cookie, body });
    const foreign = await post({ traitId: f.cat.id, valueText: 'reds', value: { levelIds: [other.levels[0]?.id] } });
    expect(foreign.status).toBe(400);
    expect((await foreign.json()).error.details[0].path).toBe('value.levelId');
    const shape = await post({ traitId: f.quant.id, valueText: 'ca. 12', value: { levelIds: [f.cat.levels[0]?.id] } });
    expect(shape.status).toBe(400);
    expect((await shape.json()).error.details[0].path).toBe('value');
    const unknown = await post({ traitId: '00000000-0000-7000-8000-000000000000', valueText: 'reds', value: { numeric: 1 } });
    expect(unknown.status).toBe(404);
  });
});
```

Add `'GET /api/records/pending/traits'`, `'GET /api/records/pending'`, `'POST /api/records/pending/map'` to the guard list; the `POST` to `withBody`.

- [ ] **Step 2: Run to see them fail**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/http/routes/dataset/records.integration.test.ts
```

Expected: FAIL — `GET /api/records/pending/traits` reaches `GET /:id` and answers 400 (invalid uuid); the others 404.

- [ ] **Step 3: Implement `queues.ts`**

Create `apps/api/src/dataset/queues.ts`:

```ts
import type { MapPendingBody, MapResult, PendingGroup, PendingTrait } from '@treerepro/contracts';
import { type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import {
  decodeCompositeCursor,
  encodeCompositeCursor,
  isDigits,
  pageOf,
} from '../http/cursor.ts';
import { AppError } from '../http/errors.ts';
import { requireTrait, resolveValue } from './curation.ts';

/**
 * The RFC-65 R7 pending predicate over a `trait_records` alias `r`: an
 * unharmonisable import value that no record supersedes yet. The redundant
 * `<> 'harmonised'` lets the planner use the partial index.
 * @rfc RFC-65 R7
 */
const PENDING = sql`r.harmonisation <> 'harmonised'
  and r.harmonisation in ('unknown_level', 'multi_value', 'not_numeric')
  and not exists (select 1 from trait_records c where c.supersedes_record_id = r.id)`;

interface PendingTraitRow {
  trait_id: string;
  trait_key: string;
  value_type: PendingTrait['trait']['valueType'];
  unit: string | null;
  count: number;
}

/** @rfc RFC-65 R8 */
export async function pendingTraits(db: DbExecutor): Promise<PendingTrait[]> {
  const rows = (await db.execute(sql`
    select t.id as trait_id, t.key as trait_key, t.value_type, t.unit, count(*)::int as count
    from trait_records r join traits t on t.id = r.trait_id
    where ${PENDING}
    group by t.id, t.key, t.value_type, t.unit
    order by count desc, t.key`)) as unknown as PendingTraitRow[];
  return rows.map((r) => ({
    trait: { id: r.trait_id, key: r.trait_key, valueType: r.value_type, unit: r.unit },
    count: r.count,
  }));
}

interface GroupRow {
  value_text: string;
  harmonisation: PendingGroup['harmonisation'];
  count: number;
  sample_record_id: string;
}

const isCount = (part: string) => isDigits(part) && Number.isSafeInteger(Number(part));

/** Groups of one trait's pending records by value; composite cursor `[count, valueText]`. @rfc RFC-65 R8 */
export async function pendingGroups(
  db: DbExecutor,
  input: { traitId: string; cursor?: string; limit: number },
): Promise<{ data: PendingGroup[]; nextCursor: string | null }> {
  await requireTrait(db, input.traitId);
  let after: SQL = sql`true`;
  if (input.cursor) {
    const [count, valueText] = decodeCompositeCursor(input.cursor, 2, [isCount, () => true]) as [
      string,
      string,
    ];
    after = sql`(count(*) < ${Number(count)}::bigint
      or (count(*) = ${Number(count)}::bigint and r.value_text > ${valueText}))`;
  }
  // `max(uuid)` does not exist; the ordered array_agg picks the newest id.
  const rows = (await db.execute(sql`
    select r.value_text, r.harmonisation, count(*)::int as count,
      (array_agg(r.id order by r.id desc))[1] as sample_record_id
    from trait_records r
    where r.trait_id = ${input.traitId} and ${PENDING}
    group by r.value_text, r.harmonisation
    having ${after}
    order by count desc, r.value_text asc
    limit ${input.limit + 1}`)) as unknown as GroupRow[];
  const { page, nextCursor } = pageOf(rows, input.limit, (r) =>
    encodeCompositeCursor([String(r.count), r.value_text]),
  );
  return {
    data: page.map((r) => ({
      valueText: r.value_text,
      harmonisation: r.harmonisation,
      count: r.count,
      sampleRecordId: r.sample_record_id,
    })),
    nextCursor,
  };
}

export interface MapPendingInput {
  actorId: string;
  traitId: string;
  valueText: string;
  value: MapPendingBody['value'];
  note?: string;
}

/**
 * Bulk harmonisation of one group: every pending row of the group × every
 * chosen level (or the one number) becomes a manual record that supersedes
 * its original, in one INSERT … SELECT. Claims that already exist are left
 * alone and counted as skipped.
 * @rfc RFC-65 R7, R9
 */
export async function mapPending(db: DbExecutor, input: MapPendingInput): Promise<MapResult> {
  const trait = await requireTrait(db, input.traitId);
  if (!trait.active)
    throw new AppError('VALIDATION_FAILED', 'Request validation failed', [
      { path: 'traitId', message: 'Trait is inactive' },
    ]);
  const levels: { id: string; key: string }[] = [];
  let numeric: string | null = null;
  if ('levelIds' in input.value) {
    for (const levelId of input.value.levelIds) {
      const resolved = await resolveValue(db, trait, { levelId });
      if (resolved.levelId !== null) levels.push({ id: resolved.levelId, key: resolved.levelKey });
    }
  } else {
    const resolved = await resolveValue(db, trait, { numeric: input.value.numeric });
    numeric = String(resolved.numericValue);
  }
  const chosenCount = levels.length === 0 ? 1 : levels.length;
  const chosen =
    levels.length === 0
      ? sql`select null::uuid as level_id, null::text as level_key`
      : sql`select * from (values ${sql.join(
          levels.map((l) => sql`(${l.id}::uuid, ${l.key}::text)`),
          sql`, `,
        )}) as v(level_id, level_key)`;
  const group = sql`r.trait_id = ${input.traitId} and r.value_text = ${input.valueText} and ${PENDING}`;
  return db.transaction(async (tx) => {
    const [counted] = (await tx.execute(
      sql`select count(*)::int as pending from trait_records r where ${group}`,
    )) as unknown as [{ pending: number }];
    const inserted = (await tx.execute(sql`
      with pending as (
        select r.id, r.species_id, r.primary_reference_id, r.secondary_reference_id,
          coalesce(r.raw_value, r.value_text) as raw_value
        from trait_records r where ${group}),
      chosen as (${chosen})
      insert into trait_records (species_id, trait_id, level_id, numeric_value, value_text, harmonisation,
        raw_value, primary_reference_id, secondary_reference_id, origin, created_by, note, supersedes_record_id)
      select p.species_id, ${input.traitId}, c.level_id, ${numeric}::numeric,
        coalesce(c.level_key, (${numeric}::numeric)::text), 'harmonised', p.raw_value,
        p.primary_reference_id, p.secondary_reference_id, 'manual', ${input.actorId}, ${input.note ?? null}, p.id
      from pending p cross join chosen c
      on conflict on constraint trait_records_claim_key do nothing
      returning id`)) as unknown as { id: string }[];
    const created = inserted.length;
    return { created, skipped: (counted?.pending ?? 0) * chosenCount - created };
  });
}
```

- [ ] **Step 4: Routes**

In `records.ts`, register these three **before** `GET /:id` (Hono runs handlers in registration order; a literal path must not fall into the `:id` validator):

```ts
    .get('/pending/traits', requirePermission(ctx, 'dataset.read'), async (c) =>
      c.json({ data: await pendingTraits(ctx.db) }),
    )
    .get(
      '/pending',
      requirePermission(ctx, 'dataset.read'),
      validate('query', pendingGroupsQuerySchema),
      async (c) => {
        const q = c.req.valid('query');
        const { data, nextCursor } = await pendingGroups(ctx.db, {
          traitId: q.traitId,
          cursor: q.cursor,
          limit: q.limit,
        });
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .post(
      '/pending/map',
      requirePermission(ctx, 'records.create'),
      validate('json', mapPendingBodySchema),
      async (c) => {
        const result = await mapPending(ctx.db, {
          ...c.req.valid('json'),
          actorId: currentUser(c).id,
        });
        return c.json({ data: result });
      },
    )
```

Imports: `mapPendingBodySchema`, `pendingGroupsQuerySchema`; `mapPending`, `pendingGroups`, `pendingTraits` from `'../../../dataset/queues.ts'`. JSDoc gains `@rfc RFC-65 R7-R9`.

- [ ] **Step 5: Run tests**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/http/routes/dataset/records.integration.test.ts src/routes-guarded.integration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint:fix && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm typecheck && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check
git add apps/api/src
git commit -m "feat(api): harmonisation queue — pending traits and groups, bulk mapping with supersession (RFC-65 R7–R9)"
```

---

### Task 10: Disputed queue — `listDisputed`, `GET /api/records/disputed`

**Files:**
- Modify: `apps/api/src/dataset/queues.ts`, `apps/api/src/http/routes/dataset/records.ts`, `apps/api/src/routes-guarded.integration.test.ts`
- Test: `apps/api/src/http/routes/dataset/records.integration.test.ts`

**Interfaces:**
- Consumes: `itemQuery`, `toItem` (records.ts), `createAnnotation`, `createAcceptedValue` helpers, `cursorQuerySchema`.
- Produces: `listDisputed(db, { cursor?, limit })`.

- [ ] **Step 1: Failing route tests**

Append to `apps/api/src/http/routes/dataset/records.integration.test.ts`:

```ts
describe('RFC-65 R10 GET /api/records/disputed', () => {
  const t = useTestApp();

  const idsOf = async (cookie: string) => {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await call(t.app, 'GET', `/api/records/disputed?limit=200${cursor ? `&cursor=${cursor}` : ''}`, { cookie });
      expect(res.status).toBe(200);
      const body = await res.json();
      ids.push(...body.data.map((r: { id: string }) => r.id));
      cursor = body.meta.nextCursor;
    } while (cursor);
    return ids;
  };

  it('lists standing disputes newest first, drops them after a later accepted decision or a changed stance, never withdrawn records', async () => {
    const author = await scientist(t, ['records.annotate', 'dataset.read']);
    const b = await scientist(t, ['records.annotate']);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const ref = await createReference(t.db);
    const mk = (i: number) => createRecord(t.db, { speciesId: sp1.id, traitId: trait.id, valueText: ['a', 'b'][i] ?? 'a', levelId: trait.levels[i]?.id, primaryReferenceId: ref.id, origin: 'manual', createdBy: author.user.id });
    const older = await mk(0);
    const newer = await mk(1);
    await createAnnotation(t.db, { recordId: older.id, actorId: b.user.id, kind: 'dispute', note: 'Older claim wrong' });
    await createAnnotation(t.db, { recordId: newer.id, actorId: b.user.id, kind: 'dispute', note: 'Newer claim wrong' });
    let ids = await idsOf(author.cookie);
    expect(ids.indexOf(newer.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    const first = await call(t.app, 'GET', '/api/records/disputed?limit=200', { cookie: author.cookie });
    const item = (await first.json()).data.find((r: { id: string }) => r.id === newer.id);
    expect(item).toMatchObject({ review: 'disputed', latestDispute: { actor: { id: b.user.id, name: 'Test User' }, note: 'Newer claim wrong' } });
    // a curator decides after the dispute: the record leaves the queue
    await createAcceptedValue(t.db, { speciesId: sp1.id, traitId: trait.id, recordId: newer.id, actorId: author.user.id });
    ids = await idsOf(author.cookie);
    expect(ids).not.toContain(newer.id);
    expect(ids).toContain(older.id);
    // a new dispute after the decision brings it back
    await createAnnotation(t.db, { recordId: newer.id, actorId: b.user.id, kind: 'dispute', note: 'Still wrong' });
    expect(await idsOf(author.cookie)).toContain(newer.id);
    // the disputer steps back: gone
    await createAnnotation(t.db, { recordId: newer.id, actorId: b.user.id, kind: 'neutral' });
    expect(await idsOf(author.cookie)).not.toContain(newer.id);
    // withdrawn records never appear
    await createAnnotation(t.db, { recordId: older.id, actorId: author.user.id, kind: 'withdraw', note: 'Retracted' });
    expect(await idsOf(author.cookie)).not.toContain(older.id);
    const bad = await call(t.app, 'GET', '/api/records/disputed?cursor=nope', { cookie: author.cookie });
    expect(bad.status).toBe(400);
  });
});
```

Add `'GET /api/records/disputed'` to the guard list.

- [ ] **Step 2: Run to see it fail**

Expected: FAIL — `GET /api/records/disputed` answers 400 from the `:id` validator.

- [ ] **Step 3: Implement**

Append to `apps/api/src/dataset/queues.ts` (imports: `DisputedRecord` type; `inArray` from drizzle-orm; `traitRecords`, `users` schemas; `decodeCursor`, `encodeCursor`; `itemQuery`, `toItem` from `./records.ts`):

```ts
interface DisputeRow {
  record_id: string;
  annotation_id: string;
  actor_id: string;
  note: string | null;
  created_at: Date | string;
}

/**
 * Standing disputes: per record, the newest annotation among the actors whose
 * latest stance is `dispute`; excluded once withdrawn or once an accepted
 * decision for the species and trait is newer than the dispute. Starts from
 * `record_annotations` (human-scale), never scans `trait_records`. Two steps:
 * the page of dispute rows, then the record items through the shared join and
 * the actors through Drizzle so their names are decrypted (RFC-40).
 * @rfc RFC-65 R10
 */
export async function listDisputed(
  db: DbExecutor,
  input: { cursor?: string; limit: number },
): Promise<{ data: DisputedRecord[]; nextCursor: string | null }> {
  const after = input.cursor ? decodeCursor(input.cursor) : null;
  const rows = (await db.execute(sql`
    with stances as (
      select distinct on (a.record_id, a.actor_id) a.record_id, a.actor_id, a.id, a.kind, a.note, a.created_at
      from record_annotations a where a.kind <> 'withdraw'
      order by a.record_id, a.actor_id, a.id desc),
    standing as (
      select distinct on (s.record_id) s.record_id, s.id as annotation_id, s.actor_id, s.note, s.created_at
      from stances s where s.kind = 'dispute'
      order by s.record_id, s.id desc)
    select d.record_id, d.annotation_id, d.actor_id, d.note, d.created_at
    from standing d join trait_records r on r.id = d.record_id
    where not exists (select 1 from record_annotations w where w.record_id = d.record_id and w.kind = 'withdraw')
      and not exists (select 1 from accepted_values v
        where v.species_id = r.species_id and v.trait_id = r.trait_id and v.created_at > d.created_at)
      and (${after}::uuid is null or d.annotation_id < ${after}::uuid)
    order by d.annotation_id desc
    limit ${input.limit + 1}`)) as unknown as DisputeRow[];
  const { page, nextCursor } = pageOf(rows, input.limit, (r) => encodeCursor(r.annotation_id));
  if (page.length === 0) return { data: [], nextCursor };
  const [items, actors] = await Promise.all([
    itemQuery(db).where(inArray(traitRecords.id, page.map((r) => r.record_id))),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [...new Set(page.map((r) => r.actor_id))])),
  ]);
  const itemById = new Map(items.map((i) => [i.record.id, toItem(i)]));
  const actorById = new Map(actors.map((a) => [a.id, a]));
  const data = page.flatMap((r) => {
    const item = itemById.get(r.record_id);
    const actor = actorById.get(r.actor_id);
    if (!item || !actor) return [];
    return [
      {
        ...item,
        latestDispute: {
          id: r.annotation_id,
          actor,
          note: r.note,
          createdAt: new Date(r.created_at).toISOString(),
        },
      },
    ];
  });
  return { data, nextCursor };
}
```

Route, before `GET /:id`:

```ts
    .get(
      '/disputed',
      requirePermission(ctx, 'dataset.read'),
      validate('query', cursorQuerySchema),
      async (c) => {
        const q = c.req.valid('query');
        const { data, nextCursor } = await listDisputed(ctx.db, { cursor: q.cursor, limit: q.limit });
        return c.json({ data, meta: { nextCursor } });
      },
    )
```

- [ ] **Step 4: Run tests, commit**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/http/routes/dataset/records.integration.test.ts src/routes-guarded.integration.test.ts
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint:fix && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm typecheck && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check
git add apps/api/src
git commit -m "feat(api): disputed queue — standing disputes without a later accepted decision (RFC-65 R10)"
```

---

### Task 11: Export — `acceptedCsv`, `GET /api/export/accepted.csv`

**Files:**
- Create: `apps/api/src/dataset/export.ts`, `apps/api/src/dataset/export.test.ts`, `apps/api/src/http/routes/dataset/export.ts`, `apps/api/src/http/routes/dataset/export.integration.test.ts`
- Modify: `apps/api/src/http/routes/dataset/index.ts`, `apps/api/src/routes-guarded.integration.test.ts`

**Interfaces:**
- Consumes: `recordAudit` (audit.ts), `createAcceptedValue` helper, `lastAudit` helper.
- Produces: `EXPORT_COLUMNS`, `csvRow`, `acceptedCsv(db)`.

- [ ] **Step 1: Failing unit test**

Create `apps/api/src/dataset/export.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { csvRow, EXPORT_COLUMNS } from './export.ts';

describe('RFC-66 R4 csvRow', () => {
  it('joins with commas, ends with CRLF, quotes fields holding quotes, commas or line breaks', () => {
    expect(csvRow(['a', 'b', null, 3])).toBe('a,b,,3\r\n');
    expect(csvRow(['Smith, J.', 'say "hi"', 'two\nlines', 'cr\rhere'])).toBe(
      '"Smith, J.","say ""hi""","two\nlines","cr\rhere"\r\n',
    );
    expect(csvRow([''])).toBe('\r\n');
  });

  it('R2 the header names the fourteen columns in order', () => {
    expect([...EXPORT_COLUMNS]).toEqual([
      'family', 'genus', 'species', 'name_source', 'category', 'trait', 'value', 'unit', 'level',
      'numeric_value', 'primary_reference', 'secondary_reference', 'decided_at', 'record_id',
    ]);
  });
});
```

- [ ] **Step 2: Failing route test**

Create `apps/api/src/http/routes/dataset/export.integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { lastAudit } from '../../../../test/helpers/audit.ts';
import {
  createAcceptedValue,
  createFamily,
  createGenus,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';

/** RFC 4180 line → fields (quotes doubled inside quoted fields). */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

describe('RFC-66 GET /api/export/accepted.csv', () => {
  const t = useTestApp();

  it('streams one CSV row per current accepted value, ordered, quoted, with a BOM, and audits the download', async () => {
    const role = await createRole(t.db, { permissions: ['dataset.export'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    const { cookie } = await loginAs(t, user);
    const family = await createFamily(t.db, { name: `Aaaceae-${Math.random().toString(16).slice(2)}` });
    const genus = await createGenus(t.db, { familyId: family.id });
    const spA = await createSpecies(t.db, { genusId: genus.id });
    const spB = await createSpecies(t.db);
    const cat = await createTrait(t.db, { levels: ['red'] });
    const quant = await createTrait(t.db, { valueType: 'quantitative', unit: 'mm' });
    const ref = await createReference(t.db, { citationKey: `Smith, J. "et al." ${Math.random().toString(16).slice(2)}` });
    const mk = (speciesId: string, traitId: string, v: { levelId?: string; numericValue?: number; valueText: string }) =>
      createRecord(t.db, { speciesId, traitId, primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id, ...v });
    const a1 = await mk(spA.id, cat.id, { levelId: cat.levels[0]?.id, valueText: 'red' });
    const a2 = await mk(spA.id, quant.id, { numericValue: 12.5, valueText: '12.5' });
    const b1 = await mk(spB.id, cat.id, { levelId: cat.levels[0]?.id, valueText: 'red' });
    const replaced = await mk(spB.id, quant.id, { numericValue: 1, valueText: '1' });
    const replacement = await mk(spB.id, quant.id, { numericValue: 2, valueText: '2' });
    await createAcceptedValue(t.db, { speciesId: spA.id, traitId: cat.id, recordId: a1.id, actorId: user.id });
    await createAcceptedValue(t.db, { speciesId: spA.id, traitId: quant.id, recordId: a2.id, actorId: user.id });
    await createAcceptedValue(t.db, { speciesId: spB.id, traitId: cat.id, recordId: b1.id, actorId: user.id });
    await createAcceptedValue(t.db, { speciesId: spB.id, traitId: cat.id, actorId: user.id, decision: 'cleared', note: 'x' });
    await createAcceptedValue(t.db, { speciesId: spB.id, traitId: quant.id, recordId: replaced.id, actorId: user.id });
    await createAcceptedValue(t.db, { speciesId: spB.id, traitId: quant.id, recordId: replacement.id, actorId: user.id });

    const res = await call(t.app, 'GET', '/api/export/accepted.csv', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="treerepro-accepted-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(text.startsWith('\uFEFF')).toBe(true);
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe('family,genus,species,name_source,category,trait,value,unit,level,numeric_value,primary_reference,secondary_reference,decided_at,record_id');
    expect(lines[lines.length - 1]).toBe('');
    const rows = lines.slice(1, -1).map(parseLine);
    const byRecord = new Map(rows.map((r) => [r[13], r]));
    expect(byRecord.get(a1.id)).toEqual([
      family.name, genus.name, spA.canonicalName, 'wcvp', expect.any(String), cat.key, 'red', '', 'red', '',
      ref.citationKey, '', expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), a1.id,
    ]);
    expect(byRecord.get(a2.id)?.slice(6, 10)).toEqual(['12.5', 'mm', '', '12.5']);
    expect(byRecord.has(b1.id)).toBe(false);        // cleared
    expect(byRecord.has(replaced.id)).toBe(false);  // replaced
    expect(byRecord.get(replacement.id)?.[0]).toBe(''); // no family
    // R3 order: spA (family Aaaceae…) before spB (no family, nulls last); within spA by trait key
    const mine = rows.filter((r) => [a1.id, a2.id, replacement.id].includes(r[13] ?? '')).map((r) => r[13]);
    expect(mine.indexOf(a1.id)).toBeLessThan(mine.indexOf(replacement.id));
    expect(mine.indexOf(a2.id)).toBeLessThan(mine.indexOf(replacement.id));
    expect([...mine].slice(0, 2)).toEqual(cat.key < quant.key ? [a1.id, a2.id] : [a2.id, a1.id]);
    const audit = await lastAudit(t.db, 'dataset.exported', { actorUserId: user.id });
    expect(audit?.metadata).toEqual({ format: 'csv', scope: 'accepted' });
  });

  it('R7 an unauthenticated request keeps the JSON error envelope', async () => {
    const res = await call(t.app, 'GET', '/api/export/accepted.csv');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('AUTH_UNAUTHENTICATED');
  });
});
```

Add `'GET /api/export/accepted.csv'` to the guard list.

- [ ] **Step 3: Run to see them fail**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:unit src/dataset/export.test.ts
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/http/routes/dataset/export.integration.test.ts
```

Expected: FAIL — module missing; route 404.

- [ ] **Step 4: Implement the service**

Create `apps/api/src/dataset/export.ts`:

```ts
import type { Db } from '../db/client.ts';

/** @rfc RFC-66 R2 */
export const EXPORT_COLUMNS = [
  'family',
  'genus',
  'species',
  'name_source',
  'category',
  'trait',
  'value',
  'unit',
  'level',
  'numeric_value',
  'primary_reference',
  'secondary_reference',
  'decided_at',
  'record_id',
] as const;

function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One RFC 4180 line, CRLF-terminated. @rfc RFC-66 R4 */
export function csvRow(fields: ReadonlyArray<string | number | null | undefined>): string {
  return `${fields.map(csvField).join(',')}\r\n`;
}

interface ExportRow {
  family: string | null;
  genus: string | null;
  species: string;
  name_source: string;
  category: string;
  trait: string;
  value: string;
  unit: string | null;
  level: string | null;
  numeric_value: string | null;
  primary_reference: string | null;
  secondary_reference: string | null;
  decided_at: Date;
  record_id: string;
}

const BATCH = 500;

/**
 * The current accepted value per species and trait as a CSV stream: a
 * postgres.js cursor feeds a `ReadableStream` batch by batch, so the file is
 * never held in memory. The BOM lets spreadsheet software read UTF-8.
 * @rfc RFC-66 R2, R3, R4, R5
 */
export function acceptedCsv(db: Db): ReadableStream<Uint8Array> {
  const client = db.$client;
  const encoder = new TextEncoder();
  const cursor = client<ExportRow[]>`
    with current as (
      select distinct on (a.species_id, a.trait_id)
        a.species_id, a.trait_id, a.record_id, a.decision, a.created_at
      from accepted_values a
      order by a.species_id, a.trait_id, a.id desc)
    select f.name as family, g.name as genus, s.canonical_name as species, s.name_source,
      c.key as category, t.key as trait, r.value_text as value, t.unit, l.key as level,
      r.numeric_value::text as numeric_value,
      pr.citation_key as primary_reference, sr.citation_key as secondary_reference,
      cur.created_at as decided_at, r.id as record_id
    from current cur
    join trait_records r on r.id = cur.record_id
    join species s on s.id = cur.species_id
    left join genera g on g.id = s.genus_id
    left join families f on f.id = g.family_id
    join traits t on t.id = cur.trait_id
    join trait_categories c on c.key = t.category_key
    left join trait_levels l on l.id = r.level_id
    left join bibliographic_references pr on pr.id = r.primary_reference_id
    left join bibliographic_references sr on sr.id = r.secondary_reference_id
    where cur.decision = 'accepted'
    order by f.name nulls last, g.name nulls last, s.canonical_name, t.key`.cursor(BATCH);
  const batches = cursor[Symbol.asyncIterator]();
  const toLine = (r: ExportRow) =>
    csvRow([
      r.family,
      r.genus,
      r.species,
      r.name_source,
      r.category,
      r.trait,
      r.value,
      r.unit,
      r.level,
      r.numeric_value,
      r.primary_reference,
      r.secondary_reference,
      new Date(r.decided_at).toISOString(),
      r.record_id,
    ]);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`\uFEFF${csvRow(EXPORT_COLUMNS)}`));
    },
    async pull(controller) {
      const next = await batches.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(next.value.map(toLine).join('')));
    },
    async cancel() {
      await batches.return?.();
    },
  });
}
```

- [ ] **Step 5: Route and mount**

Create `apps/api/src/http/routes/dataset/export.ts`:

```ts
import { Hono } from 'hono';
import { recordAudit } from '../../../audit/audit.ts';
import type { AuthContext } from '../../../auth/context.ts';
import { acceptedCsv } from '../../../dataset/export.ts';
import type { AppEnv } from '../../env.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';

/** File download: the RFC-11 R2 exception. @rfc RFC-66 R1, R4, R6, R7 */
export function exportRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>().get(
    '/accepted.csv',
    requirePermission(ctx, 'dataset.export'),
    async (c) => {
      await recordAudit(ctx.db, {
        actorUserId: currentUser(c).id,
        action: 'dataset.exported',
        metadata: { format: 'csv', scope: 'accepted' },
      });
      const day = new Date(ctx.now()).toISOString().slice(0, 10);
      c.header('Content-Type', 'text/csv; charset=utf-8');
      c.header('Content-Disposition', `attachment; filename="treerepro-accepted-${day}.csv"`);
      c.header('Cache-Control', 'no-store');
      return c.body(acceptedCsv(ctx.db));
    },
  );
}
```

In `apps/api/src/http/routes/dataset/index.ts` add `.route('/export', exportRoutes(ctx))` and the import; JSDoc gains `@rfc RFC-66 R1`.

- [ ] **Step 6: Run tests, commit**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:unit src/dataset/export.test.ts
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/http/routes/dataset/export.integration.test.ts src/routes-guarded.integration.test.ts
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint:fix && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm typecheck && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check
git add apps/api/src
git commit -m "feat(api): streamed CSV export of accepted values with audit (RFC-66)"
```

---

### Task 12: Catalog writes — families, genera, species and alternative names (`catalog.ts`, routes, audit)

**Files:**
- Create: `apps/api/src/dataset/catalog.ts`, `apps/api/src/http/routes/dataset/taxa.integration.test.ts`
- Modify: `apps/api/src/http/routes/dataset/taxa.ts`, `apps/api/src/http/routes/dataset/species.ts`, `apps/api/src/routes-guarded.integration.test.ts`
- Test: `apps/api/src/http/routes/dataset/taxa.integration.test.ts`, `apps/api/src/http/routes/dataset/species.integration.test.ts`

**Interfaces:**
- Consumes: `normaliseName` (Task 4), `getFamily`, `getGenus`, `getSpecies` (taxa.ts), `recordAudit`, `isUniqueViolation`, the catalog body schemas (Task 5), `lastAudit` helper.
- Produces: `createFamily`, `updateFamily`, `createGenus`, `updateGenus`, `createSpecies`, `updateSpecies`, `addSpeciesName`.

- [ ] **Step 1: Failing route tests**

Create `apps/api/src/http/routes/dataset/taxa.integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { lastAudit } from '../../../../test/helpers/audit.ts';
import { createFamily, createGenus } from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';

const rand = () => Math.random().toString(16).slice(2);
const zero = '00000000-0000-7000-8000-000000000000';

describe('RFC-60 R9, R10 family and genus writes', () => {
  const t = useTestApp();

  async function taxonomist() {
    const role = await createRole(t.db, { permissions: ['taxa.manage', 'dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  it('creates and renames a family, normalises the name, refuses duplicates, audits with ids only', async () => {
    const { user, cookie } = await taxonomist();
    const name = `Testaceae-${rand()}`;
    const created = await call(t.app, 'POST', '/api/families', { cookie, body: { name: `  ${name}   x ` } });
    expect(created.status).toBe(201);
    const family = (await created.json()).data;
    expect(family).toEqual({ id: expect.any(String), name: `${name} x` });
    expect((await lastAudit(t.db, 'taxa.created', { targetId: family.id }))?.metadata).toEqual({ kind: 'family' });
    const dup = await call(t.app, 'POST', '/api/families', { cookie, body: { name: `${name} x` } });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe('FAMILY_NAME_TAKEN');
    const renamed = await call(t.app, 'PATCH', `/api/families/${family.id}`, { cookie, body: { name: `${name} y` } });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).data.name).toBe(`${name} y`);
    const audit = await lastAudit(t.db, 'taxa.updated', { targetId: family.id });
    expect(audit).toMatchObject({ actorUserId: user.id, targetType: 'families', metadata: { kind: 'family', fields: ['name'] } });
    const noop = await call(t.app, 'PATCH', `/api/families/${family.id}`, { cookie, body: { name: `${name} y` } });
    expect(noop.status).toBe(200);
    expect((await lastAudit(t.db, 'taxa.updated', { targetId: family.id }))?.id).toBe(audit?.id);
    const missing = await call(t.app, 'PATCH', `/api/families/${zero}`, { cookie, body: { name: 'x' } });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('FAMILY_NOT_FOUND');
    const empty = await call(t.app, 'PATCH', `/api/families/${family.id}`, { cookie, body: {} });
    expect(empty.status).toBe(400);
  });

  it('creates a genus in a family, moves and detaches it, refuses an unknown family', async () => {
    const { cookie } = await taxonomist();
    const f1 = await createFamily(t.db);
    const f2 = await createFamily(t.db);
    const created = await call(t.app, 'POST', '/api/genera', { cookie, body: { name: `Testus-${rand()}`, familyId: f1.id } });
    expect(created.status).toBe(201);
    const genus = (await created.json()).data;
    expect(genus).toMatchObject({ family: { id: f1.id, name: f1.name } });
    const moved = await call(t.app, 'PATCH', `/api/genera/${genus.id}`, { cookie, body: { familyId: f2.id } });
    expect((await moved.json()).data.family.id).toBe(f2.id);
    expect((await lastAudit(t.db, 'taxa.updated', { targetId: genus.id }))?.metadata).toEqual({ kind: 'genus', fields: ['familyId'] });
    const detached = await call(t.app, 'PATCH', `/api/genera/${genus.id}`, { cookie, body: { familyId: null } });
    expect((await detached.json()).data.family).toBeNull();
    const unknown = await call(t.app, 'POST', '/api/genera', { cookie, body: { name: `Testus-${rand()}`, familyId: zero } });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe('FAMILY_NOT_FOUND');
    const dup = await call(t.app, 'POST', '/api/genera', { cookie, body: { name: genus.name } });
    expect((await dup.json()).error.code).toBe('GENUS_NAME_TAKEN');
    const existing = await createGenus(t.db);
    const missing = await call(t.app, 'PATCH', `/api/genera/${zero}`, { cookie, body: { name: existing.name } });
    expect((await missing.json()).error.code).toBe('GENUS_NOT_FOUND');
  });
});
```

Append to `apps/api/src/http/routes/dataset/species.integration.test.ts`:

```ts
describe('RFC-60 R9, R10 species writes', () => {
  const t = useTestApp();

  async function taxonomist() {
    const role = await createRole(t.db, { permissions: ['taxa.manage', 'dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  it('creates a species, edits its name, source and genus, adds alternative names; 409s and 404s', async () => {
    const { user, cookie } = await taxonomist();
    const family = await createFamily(t.db);
    const genus = await createGenus(t.db, { familyId: family.id });
    const name = `Testus creatus-${Math.random().toString(16).slice(2)}`;
    const created = await call(t.app, 'POST', '/api/species', { cookie, body: { canonicalName: name, nameSource: 'original' } });
    expect(created.status).toBe(201);
    const sp = (await created.json()).data;
    expect(sp).toMatchObject({ canonicalName: name, nameSource: 'original', genus: null, family: null, unresolvedTaxon: true, names: [], recordCount: 0 });
    expect((await lastAudit(t.db, 'taxa.created', { targetId: sp.id }))?.metadata).toEqual({ kind: 'species' });
    const dup = await call(t.app, 'POST', '/api/species', { cookie, body: { canonicalName: name, nameSource: 'wcvp' } });
    expect((await dup.json()).error.code).toBe('SPECIES_NAME_TAKEN');
    const resolved = await call(t.app, 'PATCH', `/api/species/${sp.id}`, { cookie, body: { nameSource: 'wcvp', genusId: genus.id } });
    expect(resolved.status).toBe(200);
    expect((await resolved.json()).data).toMatchObject({ nameSource: 'wcvp', genus: { id: genus.id }, family: { id: family.id }, unresolvedTaxon: false });
    expect((await lastAudit(t.db, 'taxa.updated', { targetId: sp.id }))?.metadata).toEqual({ kind: 'species', fields: ['nameSource', 'genusId'] });
    const unknownGenus = await call(t.app, 'PATCH', `/api/species/${sp.id}`, { cookie, body: { genusId: '00000000-0000-7000-8000-000000000000' } });
    expect((await unknownGenus.json()).error.code).toBe('GENUS_NOT_FOUND');
    const alt = await call(t.app, 'POST', `/api/species/${sp.id}/names`, { cookie, body: { name: `${name} alt`, gbifUsageKey: '123' } });
    expect(alt.status).toBe(201);
    expect((await alt.json()).data.names).toEqual([{ name: `${name} alt`, source: 'gbif', gbifUsageKey: '123' }]);
    expect((await lastAudit(t.db, 'taxa.created', { actorUserId: user.id }))?.metadata).toEqual({ kind: 'species_name', speciesId: sp.id });
    const altAgain = await call(t.app, 'POST', `/api/species/${sp.id}/names`, { cookie, body: { name: `${name} alt` } });
    expect((await altAgain.json()).error.code).toBe('SPECIES_NAME_TAKEN');
    const canonical = await call(t.app, 'POST', `/api/species/${sp.id}/names`, { cookie, body: { name } });
    expect((await canonical.json()).error.code).toBe('SPECIES_NAME_TAKEN');
    const missing = await call(t.app, 'POST', '/api/species/00000000-0000-7000-8000-000000000000/names', { cookie, body: { name: 'x' } });
    expect((await missing.json()).error.code).toBe('SPECIES_NOT_FOUND');
  });
});
```

(The alternative-name audit is scoped by actor: the API does not return the `species_names` row id, and this actor's newest `taxa.created` is the name.) Extend the file's imports with `createFamily`, `createGenus` and `lastAudit`.

Add to the guard list: `'POST /api/families'`, `'PATCH /api/families/:id'`, `'POST /api/genera'`, `'PATCH /api/genera/:id'`, `'POST /api/species'`, `'PATCH /api/species/:id'`, `'POST /api/species/:id/names'`; all seven to `withBody`.

- [ ] **Step 2: Run to see them fail**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/http/routes/dataset/taxa.integration.test.ts src/http/routes/dataset/species.integration.test.ts
```

Expected: FAIL — 404 on every write route.

- [ ] **Step 3: Implement `catalog.ts` (taxa part)**

Create `apps/api/src/dataset/catalog.ts`:

```ts
import type { Genus, NameSource, Species, TaxonRef } from '@treerepro/contracts';
import { eq } from 'drizzle-orm';
import { recordAudit } from '../audit/audit.ts';
import type { DbExecutor } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { families, genera, species, speciesNames } from '../db/schema/taxa.ts';
import { AppError } from '../http/errors.ts';
import { normaliseName } from './names.ts';
import { getFamily, getGenus, getSpecies } from './taxa.ts';

type TaxonKind = 'family' | 'genus' | 'species' | 'species_name';

async function requireFamilyRow(db: DbExecutor, id: string) {
  const row = await getFamily(db, id);
  if (!row) throw new AppError('FAMILY_NOT_FOUND', 'Family not found');
  return row;
}

async function requireGenusRow(db: DbExecutor, id: string) {
  const [row] = await db
    .select({ id: genera.id, name: genera.name, familyId: genera.familyId })
    .from(genera)
    .where(eq(genera.id, id))
    .limit(1);
  if (!row) throw new AppError('GENUS_NOT_FOUND', 'Genus not found');
  return row;
}

async function requireSpeciesRow(db: DbExecutor, id: string) {
  const [row] = await db
    .select({
      id: species.id,
      canonicalName: species.canonicalName,
      nameSource: species.nameSource,
      genusId: species.genusId,
    })
    .from(species)
    .where(eq(species.id, id))
    .limit(1);
  if (!row) throw new AppError('SPECIES_NOT_FOUND', 'Species not found');
  return row;
}

async function taxaAudit(
  db: DbExecutor,
  actorId: string,
  action: 'taxa.created' | 'taxa.updated',
  targetType: string,
  targetId: string,
  metadata: { kind: TaxonKind; fields?: string[]; speciesId?: string },
): Promise<void> {
  await recordAudit(db, { actorUserId: actorId, action, targetType, targetId, metadata });
}

/** @rfc RFC-60 R9, R10 */
export async function createFamily(
  db: DbExecutor,
  input: { name: string; actorId: string },
): Promise<TaxonRef> {
  const name = normaliseName(input.name);
  return db.transaction(async (tx) => {
    let row: TaxonRef | undefined;
    try {
      [row] = await tx
        .insert(families)
        .values({ name, createdBy: input.actorId })
        .returning({ id: families.id, name: families.name });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError('FAMILY_NAME_TAKEN', 'A family with this name already exists');
      throw err;
    }
    if (!row) throw new Error('createFamily: insert returned no row');
    await taxaAudit(tx, input.actorId, 'taxa.created', 'families', row.id, { kind: 'family' });
    return row;
  });
}

/** @rfc RFC-60 R9, R10 */
export async function updateFamily(
  db: DbExecutor,
  input: { id: string; name: string; actorId: string },
): Promise<TaxonRef> {
  const name = normaliseName(input.name);
  return db.transaction(async (tx) => {
    const current = await requireFamilyRow(tx, input.id);
    if (current.name === name) return current;
    try {
      await tx.update(families).set({ name }).where(eq(families.id, input.id));
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError('FAMILY_NAME_TAKEN', 'A family with this name already exists');
      throw err;
    }
    await taxaAudit(tx, input.actorId, 'taxa.updated', 'families', input.id, {
      kind: 'family',
      fields: ['name'],
    });
    return { id: input.id, name };
  });
}

/** @rfc RFC-60 R9, R10 */
export async function createGenus(
  db: DbExecutor,
  input: { name: string; familyId?: string; actorId: string },
): Promise<Genus> {
  const name = normaliseName(input.name);
  return db.transaction(async (tx) => {
    if (input.familyId !== undefined) await requireFamilyRow(tx, input.familyId);
    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(genera)
        .values({ name, familyId: input.familyId ?? null, createdBy: input.actorId })
        .returning({ id: genera.id });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError('GENUS_NAME_TAKEN', 'A genus with this name already exists');
      throw err;
    }
    if (!row) throw new Error('createGenus: insert returned no row');
    await taxaAudit(tx, input.actorId, 'taxa.created', 'genera', row.id, { kind: 'genus' });
    const genus = await getGenus(tx, row.id);
    if (!genus) throw new Error('createGenus: genus vanished');
    return genus;
  });
}

/** `familyId: null` detaches the genus. @rfc RFC-60 R9, R10 */
export async function updateGenus(
  db: DbExecutor,
  input: { id: string; name?: string; familyId?: string | null; actorId: string },
): Promise<Genus> {
  const name = input.name === undefined ? undefined : normaliseName(input.name);
  return db.transaction(async (tx) => {
    const current = await requireGenusRow(tx, input.id);
    const fields: string[] = [];
    const set: { name?: string; familyId?: string | null } = {};
    if (name !== undefined && name !== current.name) {
      fields.push('name');
      set.name = name;
    }
    if (input.familyId !== undefined && input.familyId !== current.familyId) {
      if (input.familyId !== null) await requireFamilyRow(tx, input.familyId);
      fields.push('familyId');
      set.familyId = input.familyId;
    }
    if (fields.length > 0) {
      try {
        await tx.update(genera).set(set).where(eq(genera.id, input.id));
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('GENUS_NAME_TAKEN', 'A genus with this name already exists');
        throw err;
      }
      await taxaAudit(tx, input.actorId, 'taxa.updated', 'genera', input.id, {
        kind: 'genus',
        fields,
      });
    }
    const genus = await getGenus(tx, input.id);
    if (!genus) throw new Error('updateGenus: genus vanished');
    return genus;
  });
}

/** @rfc RFC-60 R9, R10 */
export async function createSpecies(
  db: DbExecutor,
  input: { canonicalName: string; nameSource: NameSource; genusId?: string; actorId: string },
): Promise<Species> {
  const canonicalName = normaliseName(input.canonicalName);
  return db.transaction(async (tx) => {
    if (input.genusId !== undefined) await requireGenusRow(tx, input.genusId);
    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(species)
        .values({
          canonicalName,
          nameSource: input.nameSource,
          genusId: input.genusId ?? null,
          createdBy: input.actorId,
        })
        .returning({ id: species.id });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError('SPECIES_NAME_TAKEN', 'A species with this canonical name already exists');
      throw err;
    }
    if (!row) throw new Error('createSpecies: insert returned no row');
    await taxaAudit(tx, input.actorId, 'taxa.created', 'species', row.id, { kind: 'species' });
    const created = await getSpecies(tx, row.id);
    if (!created) throw new Error('createSpecies: species vanished');
    return created;
  });
}

/** `genusId: null` detaches the species. @rfc RFC-60 R9, R10 */
export async function updateSpecies(
  db: DbExecutor,
  input: {
    id: string;
    canonicalName?: string;
    nameSource?: NameSource;
    genusId?: string | null;
    actorId: string;
  },
): Promise<Species> {
  const canonicalName =
    input.canonicalName === undefined ? undefined : normaliseName(input.canonicalName);
  return db.transaction(async (tx) => {
    const current = await requireSpeciesRow(tx, input.id);
    const fields: string[] = [];
    const set: { canonicalName?: string; nameSource?: NameSource; genusId?: string | null } = {};
    if (canonicalName !== undefined && canonicalName !== current.canonicalName) {
      fields.push('canonicalName');
      set.canonicalName = canonicalName;
    }
    if (input.nameSource !== undefined && input.nameSource !== current.nameSource) {
      fields.push('nameSource');
      set.nameSource = input.nameSource;
    }
    if (input.genusId !== undefined && input.genusId !== current.genusId) {
      if (input.genusId !== null) await requireGenusRow(tx, input.genusId);
      fields.push('genusId');
      set.genusId = input.genusId;
    }
    if (fields.length > 0) {
      try {
        await tx.update(species).set(set).where(eq(species.id, input.id));
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('SPECIES_NAME_TAKEN', 'A species with this canonical name already exists');
        throw err;
      }
      await taxaAudit(tx, input.actorId, 'taxa.updated', 'species', input.id, {
        kind: 'species',
        fields,
      });
    }
    const updated = await getSpecies(tx, input.id);
    if (!updated) throw new Error('updateSpecies: species vanished');
    return updated;
  });
}

/** @rfc RFC-60 R4, R9, R10 */
export async function addSpeciesName(
  db: DbExecutor,
  input: { speciesId: string; name: string; gbifUsageKey?: string; actorId: string },
): Promise<Species> {
  const name = normaliseName(input.name);
  return db.transaction(async (tx) => {
    const current = await requireSpeciesRow(tx, input.speciesId);
    if (current.canonicalName === name)
      throw new AppError('SPECIES_NAME_TAKEN', 'This is already the canonical name of the species');
    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(speciesNames)
        .values({ speciesId: input.speciesId, name, gbifUsageKey: input.gbifUsageKey ?? null })
        .returning({ id: speciesNames.id });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError('SPECIES_NAME_TAKEN', 'The species already carries this name');
      throw err;
    }
    if (!row) throw new Error('addSpeciesName: insert returned no row');
    await taxaAudit(tx, input.actorId, 'taxa.created', 'species_names', row.id, {
      kind: 'species_name',
      speciesId: input.speciesId,
    });
    const updated = await getSpecies(tx, input.speciesId);
    if (!updated) throw new Error('addSpeciesName: species vanished');
    return updated;
  });
}
```

- [ ] **Step 4: Routes**

`apps/api/src/http/routes/dataset/taxa.ts` — add to `familyRoutes`:

```ts
    .post(
      '/',
      requirePermission(ctx, 'taxa.manage'),
      validate('json', familyBodySchema),
      async (c) =>
        c.json(
          { data: await createFamily(ctx.db, { ...c.req.valid('json'), actorId: currentUser(c).id }) },
          201,
        ),
    )
    .patch(
      '/:id',
      requirePermission(ctx, 'taxa.manage'),
      validate('param', idParamSchema),
      validate('json', familyBodySchema),
      async (c) =>
        c.json({
          data: await updateFamily(ctx.db, {
            id: c.req.valid('param').id,
            ...c.req.valid('json'),
            actorId: currentUser(c).id,
          }),
        }),
    )
```

and to `genusRoutes` the same shape with `createGenusBodySchema` / `updateGenusBodySchema`, `createGenus` / `updateGenus`. (Turn the single `.get(…)` expressions into chains.) Imports from contracts and `'../../../dataset/catalog.ts'`; `currentUser`. JSDoc `@rfc RFC-60 R8, R9`.

`apps/api/src/http/routes/dataset/species.ts` — add:

```ts
    .post(
      '/',
      requirePermission(ctx, 'taxa.manage'),
      validate('json', createSpeciesBodySchema),
      async (c) =>
        c.json(
          { data: await createSpecies(ctx.db, { ...c.req.valid('json'), actorId: currentUser(c).id }) },
          201,
        ),
    )
    .patch(
      '/:id',
      requirePermission(ctx, 'taxa.manage'),
      validate('param', idParamSchema),
      validate('json', updateSpeciesBodySchema),
      async (c) =>
        c.json({
          data: await updateSpecies(ctx.db, {
            id: c.req.valid('param').id,
            ...c.req.valid('json'),
            actorId: currentUser(c).id,
          }),
        }),
    )
    .post(
      '/:id/names',
      requirePermission(ctx, 'taxa.manage'),
      validate('param', idParamSchema),
      validate('json', speciesNameBodySchema),
      async (c) =>
        c.json(
          {
            data: await addSpeciesName(ctx.db, {
              speciesId: c.req.valid('param').id,
              ...c.req.valid('json'),
              actorId: currentUser(c).id,
            }),
          },
          201,
        ),
    )
```

The `createSpecies` import from `catalog.ts` does not clash: `species.ts` imports `getSpecies` from `taxa.ts` and the writes from `catalog.ts`.

- [ ] **Step 5: Run tests, commit**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/http/routes/dataset/taxa.integration.test.ts src/http/routes/dataset/species.integration.test.ts src/routes-guarded.integration.test.ts
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint:fix && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm typecheck && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check
git add apps/api/src
git commit -m "feat(api): create and edit families, genera, species and alternative names with audit (RFC-60 R9, R10)"
```

---

### Task 13: Catalog writes — references, traits and levels; dictionary `sortOrder`; no HTTP cache on `GET /api/traits`

**Files:**
- Modify: `apps/api/src/dataset/catalog.ts`, `apps/api/src/dataset/dictionary.ts`, `apps/api/src/http/routes/dataset/references.ts`, `apps/api/src/http/routes/dataset/traits.ts`, `apps/api/src/routes-guarded.integration.test.ts`
- Modify: `packages/contracts/src/dataset.ts`, `apps/web/src/test/dataset-fixtures.ts`
- Create: `apps/api/src/http/routes/dataset/traits.integration.test.ts`
- Test: `apps/api/src/http/routes/dataset/references.integration.test.ts`, `apps/api/src/http/routes/dataset/traits.integration.test.ts`, `apps/api/src/dataset/dictionary.integration.test.ts`

**Interfaces:**
- Consumes: `getReference`, `toReference` (references.ts), `violatedConstraint` (Task 2), the reference/trait/level body schemas (Task 5).
- Produces: `createReference`, `updateReference`, `createTrait`, `updateTrait`, `createLevel`, `updateLevel`; `getTrait(db, id)`; `TraitLevel.sortOrder`.

- [ ] **Step 1: Failing route tests**

Append to `apps/api/src/http/routes/dataset/references.integration.test.ts` (imports: `lastAudit`, `createRole`, `createUser`, `loginAs` as needed):

```ts
describe('RFC-61 R6 reference writes', () => {
  const t = useTestApp();

  async function librarian() {
    const role = await createRole(t.db, { permissions: ['references.manage', 'dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  it('creates with metadata, edits and clears fields, refuses duplicate keys and DOIs, audits fields', async () => {
    const { cookie } = await librarian();
    const k = Math.random().toString(16).slice(2);
    const created = await call(t.app, 'POST', '/api/references', {
      cookie,
      body: { citationKey: ` Doe_${k} `, title: 'On seeds', year: 2020, doi: `10.1/${k}` },
    });
    expect(created.status).toBe(201);
    const ref = (await created.json()).data;
    expect(ref).toMatchObject({ citationKey: `Doe_${k}`, title: 'On seeds', year: 2020, doi: `10.1/${k}`, authors: null, primaryCount: 0, secondaryCount: 0, recordCount: 0 });
    expect((await lastAudit(t.db, 'references.created', { targetId: ref.id }))?.targetType).toBe('bibliographic_references');
    const dupKey = await call(t.app, 'POST', '/api/references', { cookie, body: { citationKey: `Doe_${k}` } });
    expect((await dupKey.json()).error.code).toBe('REFERENCE_KEY_TAKEN');
    const dupDoi = await call(t.app, 'POST', '/api/references', { cookie, body: { citationKey: `Roe_${k}`, doi: `10.1/${k}` } });
    expect((await dupDoi.json()).error.code).toBe('REFERENCE_DOI_TAKEN');
    const edited = await call(t.app, 'PATCH', `/api/references/${ref.id}`, { cookie, body: { authors: 'Doe, J.', doi: null, year: 2021 } });
    expect(edited.status).toBe(200);
    expect((await edited.json()).data).toMatchObject({ authors: 'Doe, J.', doi: null, year: 2021 });
    expect((await lastAudit(t.db, 'references.updated', { targetId: ref.id }))?.metadata).toEqual({ fields: ['authors', 'year', 'doi'] });
    const badKey = await call(t.app, 'PATCH', `/api/references/${ref.id}`, { cookie, body: { citationKey: null } });
    expect(badKey.status).toBe(400);
    const missing = await call(t.app, 'PATCH', '/api/references/00000000-0000-7000-8000-000000000000', { cookie, body: { title: 'x' } });
    expect((await missing.json()).error.code).toBe('REFERENCE_NOT_FOUND');
  });
});
```

Create `apps/api/src/http/routes/dataset/traits.integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { lastAudit } from '../../../../test/helpers/audit.ts';
import { createRecord, createReference, createSpecies, createTrait } from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';

const zero = '00000000-0000-7000-8000-000000000000';

describe('RFC-62 R5, R6 dictionary reads and writes', () => {
  const t = useTestApp();

  async function lexicographer() {
    const role = await createRole(t.db, { permissions: ['traits.manage', 'dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  it('R5 the dictionary carries level sortOrder and is not HTTP-cached', async () => {
    const { cookie } = await lexicographer();
    const own = await createTrait(t.db, { levels: ['one', 'two'] });
    const res = await call(t.app, 'GET', '/api/traits', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control') ?? '').not.toMatch(/max-age/);
    const dictionary = (await res.json()).data as { traits: { id: string; levels: { key: string; sortOrder: number }[] }[] }[];
    const trait = dictionary.flatMap((c) => c.traits).find((x) => x.id === own.id);
    expect(trait?.levels).toEqual([
      { id: own.levels[0]?.id, key: 'one', sortOrder: 0, active: true },
      { id: own.levels[1]?.id, key: 'two', sortOrder: 1, active: true },
    ]);
  });

  it('R6 creates a trait, edits description, category and active; key, valueType and unit are not editable', async () => {
    const { cookie } = await lexicographer();
    const key = `test_created_${Math.random().toString(16).slice(2)}`;
    const created = await call(t.app, 'POST', '/api/traits', {
      cookie,
      body: { key, categoryKey: 'flower_color', valueType: 'quantitative', unit: 'mm', description: 'Test' },
    });
    expect(created.status).toBe(201);
    const trait = (await created.json()).data;
    expect(trait).toEqual({ id: expect.any(String), key, valueType: 'quantitative', unit: 'mm', description: 'Test', active: true, levels: [] });
    expect((await lastAudit(t.db, 'traits.created', { targetId: trait.id }))?.targetType).toBe('traits');
    const dup = await call(t.app, 'POST', '/api/traits', { cookie, body: { key, categoryKey: 'flower_color', valueType: 'categorical' } });
    expect((await dup.json()).error.code).toBe('TRAIT_KEY_TAKEN');
    const badCategory = await call(t.app, 'POST', '/api/traits', { cookie, body: { key: `${key}_b`, categoryKey: 'nope', valueType: 'categorical' } });
    expect(badCategory.status).toBe(400);
    expect((await badCategory.json()).error.details[0].path).toBe('categoryKey');
    const edited = await call(t.app, 'PATCH', `/api/traits/${trait.id}`, { cookie, body: { description: 'Edited', active: false } });
    expect((await edited.json()).data).toMatchObject({ description: 'Edited', active: false, unit: 'mm' });
    expect((await lastAudit(t.db, 'traits.updated', { targetId: trait.id }))?.metadata).toEqual({ fields: ['description', 'active'] });
    const immutable = await call(t.app, 'PATCH', `/api/traits/${trait.id}`, { cookie, body: { unit: 'cm' } });
    expect(immutable.status).toBe(400);
    const missing = await call(t.app, 'PATCH', `/api/traits/${zero}`, { cookie, body: { active: true } });
    expect((await missing.json()).error.code).toBe('TRAIT_NOT_FOUND');
  });

  it('R6 adds, renames, reorders and retires levels; renaming keeps the records; 409 and 404', async () => {
    const { user, cookie } = await lexicographer();
    const own = await createTrait(t.db, { levels: ['grey'] });
    const sp1 = await createSpecies(t.db);
    const ref = await createReference(t.db);
    const rec = await createRecord(t.db, { speciesId: sp1.id, traitId: own.id, valueText: 'grey', levelId: own.levels[0]?.id, primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id });
    const added = await call(t.app, 'POST', `/api/traits/${own.id}/levels`, { cookie, body: { key: 'black' } });
    expect(added.status).toBe(201);
    const afterAdd = (await added.json()).data;
    expect(afterAdd.levels).toEqual([
      { id: own.levels[0]?.id, key: 'grey', sortOrder: 0, active: true },
      { id: expect.any(String), key: 'black', sortOrder: 1, active: true },
    ]);
    const black = afterAdd.levels[1].id;
    expect((await lastAudit(t.db, 'traits.updated', { targetId: own.id }))?.metadata).toEqual({ levelId: black, fields: ['levels'] });
    const dup = await call(t.app, 'POST', `/api/traits/${own.id}/levels`, { cookie, body: { key: 'GREY' } });
    expect((await dup.json()).error.code).toBe('LEVEL_KEY_TAKEN');
    const renamed = await call(t.app, 'PATCH', `/api/traits/${own.id}/levels/${own.levels[0]?.id}`, { cookie, body: { key: 'gray', sortOrder: 5 } });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).data.levels.map((l: { key: string }) => l.key)).toEqual(['black', 'gray']);
    expect((await lastAudit(t.db, 'traits.updated', { targetId: own.id }))?.metadata).toEqual({ levelId: own.levels[0]?.id, fields: ['key', 'sortOrder'] });
    const record = await call(t.app, 'GET', `/api/records/${rec.id}`, { cookie });
    expect((await record.json()).data).toMatchObject({ level: { id: own.levels[0]?.id, key: 'gray' }, valueText: 'grey' });
    const retired = await call(t.app, 'PATCH', `/api/traits/${own.id}/levels/${black}`, { cookie, body: { active: false } });
    expect((await retired.json()).data.levels.find((l: { id: string }) => l.id === black).active).toBe(false);
    const other = await createTrait(t.db, { levels: ['x'] });
    const foreign = await call(t.app, 'PATCH', `/api/traits/${own.id}/levels/${other.levels[0]?.id}`, { cookie, body: { key: 'y' } });
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).error.code).toBe('LEVEL_NOT_FOUND');
  });
});
```

Add to the guard list: `'POST /api/references'`, `'PATCH /api/references/:id'`, `'POST /api/traits'`, `'PATCH /api/traits/:id'`, `'POST /api/traits/:id/levels'`, `'PATCH /api/traits/:id/levels/:levelId'`; all six to `withBody`.

- [ ] **Step 2: Run to see them fail**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/http/routes/dataset/references.integration.test.ts src/http/routes/dataset/traits.integration.test.ts
```

Expected: FAIL — 404s; the dictionary has no `sortOrder` and still sends `max-age`.

- [ ] **Step 3: Contracts and dictionary reads**

`packages/contracts/src/dataset.ts`: `traitLevelSchema` becomes `z.strictObject({ id: z.uuid(), key: z.string(), sortOrder: z.number().int(), active: z.boolean() })`. Rebuild contracts. `apps/web/src/test/dataset-fixtures.ts`: add `sortOrder: 0`, `1`, … to every level literal in `DICTIONARY` (three levels); run the web tests.

`apps/api/src/dataset/dictionary.ts`: select `sortOrder: traitLevels.sortOrder` in `getDictionary` and emit it in each level; append:

```ts
/** One trait with its levels, in dictionary order. @rfc RFC-62 R5, R6 */
export async function getTrait(db: DbExecutor, id: string): Promise<Trait | null> {
  const [t] = await db.select().from(traits).where(eq(traits.id, id)).limit(1);
  if (!t) return null;
  const levels = await db
    .select({
      id: traitLevels.id,
      key: traitLevels.key,
      sortOrder: traitLevels.sortOrder,
      active: traitLevels.active,
    })
    .from(traitLevels)
    .where(eq(traitLevels.traitId, id))
    .orderBy(asc(traitLevels.sortOrder), asc(traitLevels.key));
  return {
    id: t.id,
    key: t.key,
    valueType: t.valueType,
    unit: t.unit,
    description: t.description,
    active: t.active,
    levels,
  };
}
```

In `apps/api/src/dataset/dictionary.integration.test.ts` extend the existing `getDictionary` assertion so a level literal includes `sortOrder` (whatever the seed gives the first level of the trait it checks — read the seed CSV position: levels are numbered from 0 in list order).

- [ ] **Step 4: `catalog.ts` — references, traits, levels**

Append to `apps/api/src/dataset/catalog.ts` (imports: `ReferenceDetail`, `Trait`, `TraitValueType` types; `violatedConstraint`; `bibliographicReferences`, `type ReferenceRow`; `traitCategories`, `traitLevels`, `traits`; `sql`, `and`; `getReference`; `getTrait`):

```ts
function referenceTaken(err: unknown): never {
  if (isUniqueViolation(err)) {
    throw violatedConstraint(err) === 'bibliographic_references_doi_idx'
      ? new AppError('REFERENCE_DOI_TAKEN', 'Another reference has this DOI')
      : new AppError('REFERENCE_KEY_TAKEN', 'Another reference has this citation key');
  }
  throw err;
}

export interface ReferenceFields {
  citationKey?: string;
  title?: string | null;
  authors?: string | null;
  year?: number | null;
  journal?: string | null;
  doi?: string | null;
  url?: string | null;
}

const REFERENCE_FIELDS = ['citationKey', 'title', 'authors', 'year', 'journal', 'doi', 'url'] as const;

/** @rfc RFC-61 R6 */
export async function createReference(
  db: DbExecutor,
  input: ReferenceFields & { citationKey: string; actorId: string },
): Promise<ReferenceDetail> {
  return db.transaction(async (tx) => {
    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(bibliographicReferences)
        .values({
          citationKey: input.citationKey,
          title: input.title ?? null,
          authors: input.authors ?? null,
          year: input.year ?? null,
          journal: input.journal ?? null,
          doi: input.doi ?? null,
          url: input.url ?? null,
          createdBy: input.actorId,
        })
        .returning({ id: bibliographicReferences.id });
    } catch (err) {
      referenceTaken(err);
    }
    if (!row) throw new Error('createReference: insert returned no row');
    await recordAudit(tx, {
      actorUserId: input.actorId,
      action: 'references.created',
      targetType: 'bibliographic_references',
      targetId: row.id,
      metadata: {},
    });
    const created = await getReference(tx, row.id);
    if (!created) throw new Error('createReference: reference vanished');
    return created;
  });
}

/** `null` clears a metadata field; `citationKey` is never null. @rfc RFC-61 R6 */
export async function updateReference(
  db: DbExecutor,
  input: ReferenceFields & { id: string; actorId: string },
): Promise<ReferenceDetail> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(bibliographicReferences)
      .where(eq(bibliographicReferences.id, input.id))
      .limit(1);
    if (!current) throw new AppError('REFERENCE_NOT_FOUND', 'Reference not found');
    const fields: string[] = [];
    const set: Partial<Pick<ReferenceRow, (typeof REFERENCE_FIELDS)[number]>> = {};
    for (const field of REFERENCE_FIELDS) {
      const next = input[field];
      if (next !== undefined && next !== current[field]) {
        fields.push(field);
        (set as Record<string, unknown>)[field] = next;
      }
    }
    if (fields.length > 0) {
      try {
        await tx
          .update(bibliographicReferences)
          .set(set)
          .where(eq(bibliographicReferences.id, input.id));
      } catch (err) {
        referenceTaken(err);
      }
      await recordAudit(tx, {
        actorUserId: input.actorId,
        action: 'references.updated',
        targetType: 'bibliographic_references',
        targetId: input.id,
        metadata: { fields },
      });
    }
    const updated = await getReference(tx, input.id);
    if (!updated) throw new Error('updateReference: reference vanished');
    return updated;
  });
}

async function requireCategory(db: DbExecutor, key: string): Promise<void> {
  const [row] = await db
    .select({ key: traitCategories.key })
    .from(traitCategories)
    .where(eq(traitCategories.key, key))
    .limit(1);
  if (!row)
    throw new AppError('VALIDATION_FAILED', 'Request validation failed', [
      { path: 'categoryKey', message: 'Unknown category' },
    ]);
}

async function requireTraitRow(db: DbExecutor, id: string) {
  const [row] = await db.select().from(traits).where(eq(traits.id, id)).limit(1);
  if (!row) throw new AppError('TRAIT_NOT_FOUND', 'Trait not found');
  return row;
}

async function traitAudit(
  db: DbExecutor,
  actorId: string,
  action: 'traits.created' | 'traits.updated',
  traitId: string,
  metadata: { fields?: string[]; levelId?: string },
): Promise<void> {
  await recordAudit(db, { actorUserId: actorId, action, targetType: 'traits', targetId: traitId, metadata });
}

async function traitOrThrow(db: DbExecutor, id: string, where: string): Promise<Trait> {
  const trait = await getTrait(db, id);
  if (!trait) throw new Error(`${where}: trait vanished`);
  return trait;
}

/** @rfc RFC-62 R6 */
export async function createTrait(
  db: DbExecutor,
  input: {
    key: string;
    categoryKey: string;
    valueType: TraitValueType;
    unit?: string;
    description?: string;
    actorId: string;
  },
): Promise<Trait> {
  return db.transaction(async (tx) => {
    await requireCategory(tx, input.categoryKey);
    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(traits)
        .values({
          key: input.key,
          categoryKey: input.categoryKey,
          valueType: input.valueType,
          unit: input.unit ?? null,
          description: input.description ?? '',
          createdBy: input.actorId,
        })
        .returning({ id: traits.id });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError('TRAIT_KEY_TAKEN', 'A trait with this key already exists');
      throw err;
    }
    if (!row) throw new Error('createTrait: insert returned no row');
    await traitAudit(tx, input.actorId, 'traits.created', row.id, {});
    return traitOrThrow(tx, row.id, 'createTrait');
  });
}

/** `key`, `valueType` and `unit` are immutable (RFC-62 R6). @rfc RFC-62 R6 */
export async function updateTrait(
  db: DbExecutor,
  input: { id: string; categoryKey?: string; description?: string; active?: boolean; actorId: string },
): Promise<Trait> {
  return db.transaction(async (tx) => {
    const current = await requireTraitRow(tx, input.id);
    const fields: string[] = [];
    const set: { categoryKey?: string; description?: string; active?: boolean } = {};
    if (input.categoryKey !== undefined && input.categoryKey !== current.categoryKey) {
      await requireCategory(tx, input.categoryKey);
      fields.push('categoryKey');
      set.categoryKey = input.categoryKey;
    }
    if (input.description !== undefined && input.description !== current.description) {
      fields.push('description');
      set.description = input.description;
    }
    if (input.active !== undefined && input.active !== current.active) {
      fields.push('active');
      set.active = input.active;
    }
    if (fields.length > 0) {
      await tx.update(traits).set(set).where(eq(traits.id, input.id));
      await traitAudit(tx, input.actorId, 'traits.updated', input.id, { fields });
    }
    return traitOrThrow(tx, input.id, 'updateTrait');
  });
}

/** @rfc RFC-62 R6 */
export async function createLevel(
  db: DbExecutor,
  input: { traitId: string; key: string; sortOrder?: number; actorId: string },
): Promise<Trait> {
  return db.transaction(async (tx) => {
    await requireTraitRow(tx, input.traitId);
    const [{ next }] = (await tx.execute(
      sql`select coalesce(max(sort_order), -1) + 1 as next from trait_levels where trait_id = ${input.traitId}`,
    )) as unknown as [{ next: number }];
    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(traitLevels)
        .values({
          traitId: input.traitId,
          key: input.key,
          sortOrder: input.sortOrder ?? next,
          createdBy: input.actorId,
        })
        .returning({ id: traitLevels.id });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError('LEVEL_KEY_TAKEN', 'The trait already has this level');
      throw err;
    }
    if (!row) throw new Error('createLevel: insert returned no row');
    await traitAudit(tx, input.actorId, 'traits.updated', input.traitId, { levelId: row.id, fields: ['levels'] });
    return traitOrThrow(tx, input.traitId, 'createLevel');
  });
}

/** Renaming keeps every record's `level_id` and `value_text`. @rfc RFC-62 R6 */
export async function updateLevel(
  db: DbExecutor,
  input: { traitId: string; levelId: string; key?: string; sortOrder?: number; active?: boolean; actorId: string },
): Promise<Trait> {
  return db.transaction(async (tx) => {
    await requireTraitRow(tx, input.traitId);
    const [current] = await tx
      .select()
      .from(traitLevels)
      .where(and(eq(traitLevels.id, input.levelId), eq(traitLevels.traitId, input.traitId)))
      .limit(1);
    if (!current) throw new AppError('LEVEL_NOT_FOUND', 'Level not found');
    const fields: string[] = [];
    const set: { key?: string; sortOrder?: number; active?: boolean } = {};
    if (input.key !== undefined && input.key !== current.key) {
      fields.push('key');
      set.key = input.key;
    }
    if (input.sortOrder !== undefined && input.sortOrder !== current.sortOrder) {
      fields.push('sortOrder');
      set.sortOrder = input.sortOrder;
    }
    if (input.active !== undefined && input.active !== current.active) {
      fields.push('active');
      set.active = input.active;
    }
    if (fields.length > 0) {
      try {
        await tx.update(traitLevels).set(set).where(eq(traitLevels.id, input.levelId));
      } catch (err) {
        if (isUniqueViolation(err)) throw new AppError('LEVEL_KEY_TAKEN', 'The trait already has this level');
        throw err;
      }
      await traitAudit(tx, input.actorId, 'traits.updated', input.traitId, { levelId: input.levelId, fields });
    }
    return traitOrThrow(tx, input.traitId, 'updateLevel');
  });
}
```

Note `recordAudit` rejects a `metadata` key named `name` (RFC-41 R7); the reference field list carries `citationKey`, `title`, `authors`, … as *values* of `fields`, never as keys — allowed.

- [ ] **Step 5: Routes**

`apps/api/src/http/routes/dataset/references.ts` — add `POST /` (`references.manage`, `createReferenceBodySchema`, 201) and `PATCH /:id` (`updateReferenceBodySchema`) in the shape of Task 12, calling `createReference` / `updateReference` with `actorId: currentUser(c).id`. JSDoc `@rfc RFC-61 R4, R6`.

`apps/api/src/http/routes/dataset/traits.ts` — rewrite:

```ts
import {
  createLevelBodySchema,
  createTraitBodySchema,
  idParamSchema,
  traitLevelParamSchema,
  updateLevelBodySchema,
  updateTraitBodySchema,
} from '@treerepro/contracts';
import { Hono } from 'hono';
import type { AuthContext } from '../../../auth/context.ts';
import { createLevel, createTrait, updateLevel, updateTrait } from '../../../dataset/catalog.ts';
import { getDictionary } from '../../../dataset/dictionary.ts';
import type { AppEnv } from '../../env.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';
import { validate } from '../../validate.ts';

/** @rfc RFC-62 R5, R6 */
export function traitRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get('/', requirePermission(ctx, 'dataset.read'), async (c) =>
      c.json({ data: await getDictionary(ctx.db) }),
    )
    .post(
      '/',
      requirePermission(ctx, 'traits.manage'),
      validate('json', createTraitBodySchema),
      async (c) =>
        c.json(
          { data: await createTrait(ctx.db, { ...c.req.valid('json'), actorId: currentUser(c).id }) },
          201,
        ),
    )
    .patch(
      '/:id',
      requirePermission(ctx, 'traits.manage'),
      validate('param', idParamSchema),
      validate('json', updateTraitBodySchema),
      async (c) =>
        c.json({
          data: await updateTrait(ctx.db, {
            id: c.req.valid('param').id,
            ...c.req.valid('json'),
            actorId: currentUser(c).id,
          }),
        }),
    )
    .post(
      '/:id/levels',
      requirePermission(ctx, 'traits.manage'),
      validate('param', idParamSchema),
      validate('json', createLevelBodySchema),
      async (c) =>
        c.json(
          {
            data: await createLevel(ctx.db, {
              traitId: c.req.valid('param').id,
              ...c.req.valid('json'),
              actorId: currentUser(c).id,
            }),
          },
          201,
        ),
    )
    .patch(
      '/:id/levels/:levelId',
      requirePermission(ctx, 'traits.manage'),
      validate('param', traitLevelParamSchema),
      validate('json', updateLevelBodySchema),
      async (c) => {
        const { id, levelId } = c.req.valid('param');
        return c.json({
          data: await updateLevel(ctx.db, {
            traitId: id,
            levelId,
            ...c.req.valid('json'),
            actorId: currentUser(c).id,
          }),
        });
      },
    );
}
```

- [ ] **Step 6: Run tests, commit**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts build
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/http/routes/dataset src/dataset/dictionary.integration.test.ts src/routes-guarded.integration.test.ts
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/web test
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint:fix && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm typecheck && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check
git add apps/api/src packages/contracts/src apps/web/src
git commit -m "feat(api): create and edit references, traits and levels with audit; dictionary level sortOrder; no HTTP cache on the dictionary (RFC-61 R6, RFC-62 R5, R6)"
```

---

### Task 14: Close-out — full suites, RFC acceptance, gotchas, README, spec alignment, follow-up issues, pull request

**Files:**
- Modify: `docs/rfc/60-dataset/65-curation.md`, `docs/rfc/60-dataset/66-dataset-export.md`, `docs/rfc/README.md`, `docs/specs/2026-09-13-curation-design.md`, `README.md`
- Create: `docs/gotchas/dataset.md`

- [ ] **Step 1: Full verification**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm typecheck && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm test
```

Expected: every project green (contracts, api:unit, api:integration, web, rfc-lint). Fix anything red before going on.

- [ ] **Step 2: Manual check on the dev stack**

```bash
docker compose up -d && docker compose restart api
# migrations 0013–0014 apply on start; then, signed in as an admin in the browser or with curl and the session cookie:
# 1. GET /api/records/pending/traits  → traits with counts from the sample import
# 2. POST /api/records/pending/map    → map one plural group of a categorical trait; GET the groups again: gone
# 3. POST /api/records + PUT accepted + GET /api/species/:id/traits → accepted shows on the summary
# 4. GET /api/export/accepted.csv     → opens in a spreadsheet with the BOM honoured
```

Record the four outcomes in the PR description.

- [ ] **Step 3: Accept the RFCs; align docs**

- `65-curation.md`, `66-dataset-export.md`: `Status | accepted`; changelog `- 2026-09-13 — accepted.`; `docs/rfc/README.md` rows → `accepted`.
- `docs/specs/2026-09-13-curation-design.md` section 9: the catalog writes live in `dataset/catalog.ts` (not in `taxa.ts` / `references.ts` / `dictionary.ts`, which only gained getters); `listDisputed` runs in two steps (dispute rows, then items and actors) so user names go through the decrypting column type; migrations 0013/0014 as in section 3.
- Create `docs/gotchas/dataset.md`:

```markdown
# Dataset gotchas

- **`seed:traits` re-inserts renamed levels.** The CSV in `apps/api/seed/trait-dictionary.csv` is the source of the vocabulary; `seed:traits` inserts whatever is missing. A level renamed through `PATCH /api/traits/:id/levels/:levelId` reappears under its old key on the next seed run unless the CSV is changed too (RFC-62 R6).
- **Guard numeric casts with nested `CASE`.** `x ~ pattern and abs(x::numeric) < 1e308` may evaluate the cast first — SQL `AND` does not short-circuit — and abort the whole import batch on `Aug`. `CASE WHEN … THEN (CASE WHEN … END) END` evaluates in order (RFC-64 R6).
- **`max(uuid)` does not exist.** For "the newest id of a group" use `(array_agg(id order by id desc))[1]` (pending groups' `sampleRecordId`).
- **User names only through Drizzle.** `users.name` is the `encryptedText` column type; a raw `db.execute` returns ciphertext. Fetch ids in SQL, names with `db.select({ name: users.name })` (disputed queue).
- **Arrays in Drizzle's `sql` tag are chunk lists, not parameters.** `sql\`… any(${ids})\`` splices the array as SQL fragments; build a `VALUES` list with `sql.join` (bulk mapping) or use `inArray`.
- **Literal routes before `/:id`.** Hono runs matching handlers in registration order; `GET /records/pending` registered after `GET /records/:id` dies in the uuid validator.
```

- `README.md`: add `docs/gotchas/dataset.md` where gotchas are listed; add the new modules (`curation.ts`, `queues.ts`, `catalog.ts`, `export.ts`, `names.ts`) to the layout section next to the plan-06 dataset modules; mention `GET /api/export/accepted.csv` under commands/endpoints if the README lists routes.

- [ ] **Step 4: Follow-up issues**

```bash
gh issue create --label tech-debt --title "seed.ts COPY lacks the idle guard the importer has" --body "seedDictionary streams the CSV with postgres.js .writable() without pipelineWithIdleGuard (docs/gotchas/import.md). Reuse the guard; keep the upstream report on postgres.js 3.4.9 in the gotcha. Deferred from plan 07 (docs/specs/2026-09-13-curation-design.md §14)."
gh issue create --label tech-debt --title "Web: layout route for the imports permission gate; consolidate the two 403 mappers; VALIDATION_FAILED on detail routes reads as not found" --body "Three small web follow-ups deferred from plan 07 (docs/specs/2026-09-13-curation-design.md §14): an /app/imports layout route carrying the imports.read gate; one shared 403 mapper instead of two; map VALIDATION_FAILED on /app/*/\$id routes to the not-found sentence."
```

- [ ] **Step 5: Commit, review, pull request**

```bash
git add docs README.md
git commit -m "docs: accept RFC-65 and RFC-66; dataset gotchas; README modules; spec aligned with the delivered layout"
git push -u origin feat/curation-07a
```

Run the CodeRabbit review (`coderabbit:code-review`) once on the branch; address findings in a `fix(review): …` commit. Then:

```bash
gh pr create --title "feat(api): curation — manual records, annotations, accepted values, queues, catalog writes, CSV export (plan 07a)" --body-file - <<'PR'
## Plan 07a — curation API

RFC-65 (curation) and RFC-66 (export) with the amendments to RFC-11, 12, 30, 41, 60–64. Spec: `docs/specs/2026-09-13-curation-design.md`; plan: `docs/plans/2026-09-13-curation-07a-api.md`. Closes the API half of #45; plans 07b/07c (web) follow.

### What
- `POST /api/records` — manual, always-harmonised claims; 409 `RECORD_DUPLICATE` names the existing record.
- `POST /api/records/:id/annotations` — confirm / dispute / neutral / withdraw (author or `records.withdraw`; never the accepted record).
- `GET`/`PUT /api/species/:id/traits/:traitId/accepted` — accepted value with history, idempotent.
- Harmonisation queue: `GET /api/records/pending/traits`, `GET /api/records/pending?traitId=`, `POST /api/records/pending/map` — bulk mapping through `trait_records.supersedes_record_id` (new column, migration 0014).
- `GET /api/records/disputed` — standing disputes without a later accepted decision.
- Catalog writes for families, genera, species (+ alternative names), references, traits and levels — `taxa.manage` / `references.manage` / `traits.manage`, audited (`taxa.*`, `references.*`, `traits.*`).
- `GET /api/export/accepted.csv` — streamed RFC 4180 CSV, `dataset.export`, audited `dataset.exported`.
- Carried over: converse harmonised CHECK; number rule bounded (64 chars, 1–3 exponent digits, |x| < 1e308) — `1e200000` no longer aborts an import; `unresolvedTaxon` on species list items; shared `pageOf`.

### Manual check (dev stack, sample data)
- pending traits: …
- mapping: …
- accepted on the summary: …
- export opened in a spreadsheet: …

### Tests
`pnpm test` green: contracts, api:unit, api:integration (every new route + the guard meta-test with 22 new routes), web (fixtures follow the schema changes).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01LT9ftjKpFbDxGthqxaKSLB
PR
```

Fill the four manual-check lines with what Step 2 showed before creating the PR.

---

## Self-review notes

- Spec coverage: §3 → Tasks 1, 2, 4; §4.1–4.3 → Tasks 6–8; §4.4–4.5 → Tasks 9–10; §4.6 → Task 3; §5 → Task 11; §6 → Tasks 12–13 (+ the `Cache-Control` drop in 13); §7–8 → Tasks 1, 5, 6, 13; §9 → the module list above (catalog writes consolidated in `catalog.ts`, recorded in the spec by Task 14); §11 → Task 1 (drafts and amendments) and Task 14 (acceptance); §12 → the tests of every task; §13–14 → Task 14. RFC-13 R10 (focus trap) belongs to plan 07b.
- Every route added between Tasks 6 and 13 is listed in the guard meta-test in the same task; the export route has no body and is not in `withBody`.
- Names used across tasks: `requireTrait` / `requireSpecies` / `resolveValue` / `numericText` / `currentAccepted` (curation.ts, Tasks 6–8, reused by queues.ts in Task 9); `itemQuery` / `toItem` exported in Task 6, consumed in Task 10; `pageOf` (Task 3) consumed in Tasks 9–10; `normaliseName` (Task 4) consumed in Task 12; `violatedConstraint` (Task 2) consumed in Task 13; `getFamily` / `getGenus` (Task 3) and `getTrait` (Task 13) consumed by catalog.ts; helpers `createTrait` / `createAnnotation` / `createAcceptedValue` (Task 2) consumed from Task 6 on.
