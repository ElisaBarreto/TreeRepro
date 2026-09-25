# Revision 13f — Record Schema: IDs, Quantitative Fields, Several References per Record, Reimport Runbook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every record carries a `record_code` (`EB_<n>` from the import file's new `ID` column, `TR_<n>` from the database for anything created on the platform); a quantitative record holds single, min, max, mean, sd and n; a form with several references creates **one** record whose first reference is primary and the rest live in `record_references`, counted as usages; the trait card's numeric summary becomes `{ min, max, mean, count }`; and a runbook replaces the imported data with the new file in production.

**Architecture:** Database first. `trait_records` gains `record_code` (unique, not null, default `'TR_' || nextval('record_code_tr_seq')`, so every insert path that does not name a code — the manual writer, `mapPending`, the test helpers — gets one without code), four nullable `numeric` columns and `n integer`; the existing checks are widened so a harmonised quantitative row needs one of single/min/max/mean and a new check holds `min ≤ max`, `sd ≥ 0`, `n ≥ 1`. The new table `record_references` gets its own statement-level `AFTER INSERT` trigger (a new function, so 13g's edits to `trait_records_reference_usage()` never collide with it) that bumps `primary_count` and `reference_traits`. The migration adds `record_code` through a throw-away sequence (`EB_LEGACY_<n>`), which rewrites the table in the `ALTER` itself — no `UPDATE`, so the RFC-63 R4 append-only triggers never fire. Split entries take letter suffixes (RFC-63 R12, owner decision): the SQL function `record_code_suffix(n)` gives `a`…`z`, `aa`, … for the import's split rows (`EB_1a`, `EB_1b`) and for `nextRecordCodes(db, count)`, the helper 13g's multi-level form calls (`TR_7a`, `TR_7b`; one sequence number per entry). The importer reads `ID` and, after the existing reasons, rejects a missing or malformed ID (`invalid_record_id`) and an ID already stored or carried by an earlier row of the file (`duplicate_record_id`) through the existing `import_rejects` path (RFC-64 R7 as amended by 13a); the claim-key `ON CONFLICT` stays. Contracts move `numericValueSchema` next to the new `quantitativeValueSchema` in `dataset.ts` (the record item needs it, and `dataset.ts` cannot import `curation.ts` without a cycle).

**Tech Stack:** unchanged — Drizzle ORM 0.45.2 + drizzle-kit 0.31.10, PostgreSQL 18, Zod 4, Vitest + testcontainers, React 19. No new dependency.

**Spec:** `docs/specs/2026-09-25-record-model-revision-design.md` — R-2, R-4, R-5, §5 (Reimport), and the 13f rows of §6.

**Depends on:** 13a merged (RFC amendments for R-2, R-4, R-5). Runs in wave 1 beside 13b, 13c, 13d, 13e. 13g starts after this plan and 13e merge.

## Cross-review amendments (2026-09-25 — owner decisions after the plan was written; apply these)

1. **A stored ID is skipped, not rejected** (spec R-19, RFC-64 R14 as added by 13a). Later imports are incremental and may resend old rows. In the import, a row whose `ID` equals a stored `record_code`, or is the base of stored suffixed codes (`EB_4` when `EB_4a` exists), is skipped and counted in a new column `import_batches.rows_already_imported bigint not null default 0` (same migration as `record_code`); the CLI report prints `already imported: <n>`. A repeated ID inside the same file is still rejected (`duplicate_record_id`). Change the forced re-import test accordingly: the 22 stored rows count as `rowsAlreadyImported: 22`, `rowsRejected` stays at the fixture's own rejects, and no second record is created. Everything else in this plan that says "every stored ID now rejects its row" is superseded.
2. **Runbook:** the one-off reimport of this test phase stays the total `--replace` (no user data yet). Add a closing line: after this phase, reimports use `--replace-imported` (plan 13k); the total `--replace` becomes refused once any `TR_` record exists (RFC-64 R12 as amended).
3. **Withdraw response and `nextRecordCodes`** — unchanged from spec §6.
4. **`references` includes the secondary reference.** A record item's `references` is primary, then the legacy `secondary_reference_id` when present, then the `record_references` rows — the same order 13i's export uses.
5. **The new source file is `data/sample_data.csv`** (3.2 GB); `ID` is its **last** column (after `harmonised_value`), not the first — put `'ID'` last in the expected header and in the fixture. User-plot assignments for the runbook come from `data/PIs_per_plot_filtered.csv` through the existing `prepare:imports` (which writes the `user_email,plot_id` file), like plots, plot species and synonyms.

## Global Constraints

- Branch `feat/revision-13f-record-schema` from an up-to-date `origin/main` (after 13a). Claim the 13f issue first (README rule 7: assign yourself, add `in-progress`).
- README non-negotiables: RFC first (Task 1 before any code), TDD (every task: failing test → run → code → run), no database mocks (integration tests use testcontainers), every exported symbol in `apps/*/src` and `packages/*/src` carries `@rfc RFC-NN Rn` (type-only exports exempt), English everywhere.
- RFC rule numbers follow plan 13a (`docs/plans/2026-09-25-revision-13a-rules.md`): RFC-63 **R12** record ID (spec R-2), **R15** quantitative value (R-5), **R16** several references (R-4); RFC-63 R1 (columns), R5 (harmonised with one of single/min/max/mean), R8 (item), R10 (summary `numeric`); RFC-61 R4, R9 (usage); RFC-64 R2 (`ID`), R6 (split codes), R7 (`invalid_record_id`, `duplicate_record_id`), R8, R12 (wipe); RFC-65 R1 (`{ quantitative }`). In prose: "RFC-63 R15 (added by 13a for spec R-5)". If 13a merged with different numbers, retag before `pnpm rfc:check` (Task 10).
- The migration number is indicative (`0035_record_schema.sql`); 13d, 13e and 13g also add migrations. Re-check at push time (Task 10) and renumber per memory `migration-number-only-safe-at-merge`: rename `.sql` and `meta/NNNN_snapshot.json`, fix `_journal.json` `idx`/`tag`, re-chain `prevId`, copy upstream objects into the snapshot, confirm `drizzle-kit generate` says "No schema changes".
- Never await a Drizzle builder twice (memory `drizzle-builder-is-a-lazy-thenable`): the `Promise.all` in `getReference` below destructures its results and never re-awaits a builder.
- Keep `ON CONFLICT` behaviour on the manual path (13g adds duplicate → validation on top). Do not touch `{ levelId }` in the manual value (13g replaces it by `{ levelIds }`). `mapPending` keeps `{ numeric }`.

### Verification environment (this Mac has no Node)

Every `pnpm` command runs in a container (memory `verify-in-docker-no-node`). Once per session:

```sh
docker run -d --name treerepro-13f -w /workspace \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
  -e TESTCONTAINERS_RYUK_DISABLED=true \
  treerepro-verify:base sleep infinity
```

(If `treerepro-verify:base` does not exist, build it as the memory describes: `node:24.21.0-alpine`, `corepack prepare pnpm@12.4.1 --activate`, `pnpm install --frozen-lockfile`, `docker commit`.)

Before **every** run, sync the worktree in (delete first; `-exec rm -f {} +`, never `-delete`; `COPYFILE_DISABLE=1` on the tar). Call this **SYNC** below:

```sh
docker exec treerepro-13f sh -c 'cd /workspace && find . -name node_modules -prune -o -type f -exec rm -f {} +'
COPYFILE_DISABLE=1 tar -cf - --exclude='./node_modules' --exclude='*/node_modules' --exclude='./.git' \
    --exclude='./data' --exclude='./.claude' --exclude='*/dist' \
    --exclude='.DS_Store' --exclude='._*' --exclude='*/._*' . \
  | docker exec -i treerepro-13f tar -x -C /workspace
docker exec treerepro-13f find /workspace -name '._*'   # must print nothing
```

Test commands used below (all after SYNC):

- API integration file: `docker exec treerepro-13f sh -c 'cd /workspace && pnpm exec vitest run --project api:integration <path relative to apps/api>'`
- API unit file: `docker exec treerepro-13f sh -c 'cd /workspace && pnpm exec vitest run --project api:unit <path relative to apps/api>'`
- Contracts: `docker exec treerepro-13f sh -c 'cd /workspace && pnpm --filter @treerepro/contracts test -- <file filter>'`
- Web: `docker exec treerepro-13f sh -c 'cd /workspace && pnpm --filter @treerepro/web test -- <file filter>'`

Files generated inside the container (the migration) are `docker cp`'d out; the container is a copy. E2E runs in CI only (the one E2E edit is a request body; verify the string against the contract).

`pnpm typecheck` is green again only at the end of Task 8 (contracts change in Task 2 ripples into api and web); per-task verification runs the named Vitest files, which transpile without typechecking.

## File Structure

```
docs/rfc/60-dataset/61-bibliographic-references.md   # verify/complete 13a: record_references usage (R4, R9)
docs/rfc/60-dataset/63-trait-records.md              # verify/complete 13a: R1, R2, R3, R8, R9, R10
docs/rfc/60-dataset/64-import.md                     # verify/complete 13a: R2 ID, R6 split codes, R7 reasons, R8 duplicates, R12 closure + production procedure
docs/rfc/60-dataset/65-curation.md                   # verify/complete 13a: R1 quantitative value
docs/specs/2026-09-25-record-model-revision-design.md # §6: trait summary mean is nullable
packages/contracts/src/dataset.ts                    # numericValueSchema moved here; quantitativeValueSchema; recordSchema fields; traitSummary numeric; reject reasons
packages/contracts/src/curation.ts                   # recordValueSchema { quantitative }; imports numericValueSchema
packages/contracts/src/{dataset,curation,contributions,dashboard}.test.ts
apps/api/src/db/schema/records.ts                    # sequence, columns, checks, recordReferences table
apps/api/drizzle/0035_record_schema.sql (+ meta/0035_snapshot.json, meta/_journal.json)  # generated + hand edits
apps/api/src/db/schema/dataset.integration.test.ts
apps/api/test/helpers/dataset.ts                     # createRecord: quantitative columns
apps/api/src/dataset/curation.ts                     # resolveValue, quantitativeText, createRecords one record per value
apps/api/src/dataset/queues.ts                       # mapPending adapts to resolveValue
apps/api/src/dataset/curation.integration.test.ts
apps/api/src/http/routes/dataset/records.integration.test.ts
apps/api/src/dataset/records.ts                      # item: recordCode, quantitative, references; listRecords by reference
apps/api/src/dataset/references.ts                   # getReference.recordCount counts record_references
apps/api/src/dataset/records.integration.test.ts, contributions.integration.test.ts, references.integration.test.ts
apps/api/src/dataset/summary.ts (+ summary.integration.test.ts)   # numeric { min, max, mean, count }
apps/api/src/dataset/import.ts (+ import.test.ts, import.integration.test.ts)
apps/api/src/dataset/reset.ts (+ reset.integration.test.ts)       # record_references in the closure
apps/api/test/fixtures/import/records-small.csv      # gains ID
apps/web/src/test/dataset-fixtures.ts
apps/web/src/components/dataset/TraitCard.tsx (+ TraitCard.test.tsx)
apps/web/src/pages/dataset/ImportPage.tsx
apps/web/src/components/curation/AddEntriesDialog.tsx (+ AddEntriesDialog.test.tsx), ContestDialog.tsx
apps/e2e/tests/dashboard.spec.ts                     # request body
docs/gotchas/import.md                               # reimport runbook
```

---

### Task 1: RFC and spec alignment (docs only)

**Files:** `docs/rfc/60-dataset/61-bibliographic-references.md`, `63-trait-records.md`, `64-import.md`, `65-curation.md`, `docs/specs/2026-09-25-record-model-revision-design.md`.

**Interfaces:** Consumes 13a's amendments. Produces the rule text every later task tags.

13a writes R-2/R-4/R-5 into the RFCs. This task checks that the text covers the decisions this plan takes (see Spec notes) and adds what is missing, as amendments with a Changelog line `- 2026-09-25 — <rules>: <what> (plan 13f).` It never rewrites what 13a wrote.

- [ ] **Step 1: Check 13a is merged and read its wording**

```sh
git fetch origin && git log --oneline origin/main | head -5
grep -n "record_code\|record_references\|min_value\|mean" docs/rfc/60-dataset/6[1345]-*.md
```

Expected: hits in RFC-63 (R-2, R-4, R-5), RFC-61 (usage), RFC-64 (ID), RFC-65 (manual value). If there are none, 13a is not merged: stop.

- [ ] **Step 2: Add what 13a leaves out** (13a's text covers RFC-63 R1, R5, R8, R10, R12, R15, R16, RFC-61 R4, R9, RFC-64 R2, R6, R7, R8, R12 and RFC-65 R1 — check each against the list in 13a's Task 1, 2 and 5 and do not rewrite them). Add, each as an amendment with its Changelog line:

  - RFC-63 R9: after `or `referenceId` alone (primary or secondary)` insert `, a `record_references` row (R16) naming it too`.
  - RFC-63 R16: after `primary first, joined by `; `.` insert ` On a record item the further references follow the primary one in `citation_key` order; they are never personal observations (RFC-61 R7).`
  - RFC-63 R2: append `The quantitative columns are checked by the database: a level excludes all six; any of them implies `harmonised`; `trait_records_quantitative_check` holds `min_value <= max_value`, `sd_value >= 0` and `n >= 1`. `record_references` is insert-only for `treerepro_app` (no `UPDATE`, `DELETE` or `TRUNCATE`).`
  - RFC-64 R7: if it still reads `the part before `-<n>` for a split row`, replace that with `or its first part `<ID>a` for a split row (RFC-63 R12)`.
  - RFC-64 R12: append `The owner's one-time reimport of the record model revision (spec 2026-09-25 §5) is the single sanctioned exception to the production refusal: it follows the runbook "Replacing the imported data with the ID-carrying file" in `docs/gotchas/import.md` (backup, a check that no manual record, annotation or `record_references` row exists, and a one-off container with `NODE_ENV=development` and the migrator secret mounted).`

- [ ] **Step 3: Amend spec §6** — in `docs/specs/2026-09-25-record-model-revision-design.md`, the row `| 13f | trait summary \`numeric\` | …` becomes:

```
| 13f | trait summary `numeric` | `{ min, max, mean: number \| null, count } \| null` (replaces `{ min, median, max, count }`; `mean` is null when no record has a single value or a mean) |
```

- [ ] **Step 4: Commit**

```sh
git add docs/rfc/60-dataset docs/specs/2026-09-25-record-model-revision-design.md
git commit -m "docs(rfc): record code, quantitative fields and record_references details for plan 13f

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Contracts — quantitative value, record item, trait summary, reject reasons

**Files:** `packages/contracts/src/dataset.ts`, `packages/contracts/src/curation.ts`, `packages/contracts/src/dataset.test.ts`, `curation.test.ts`, `contributions.test.ts`, `dashboard.test.ts`.

**Interfaces — Produces:**

```ts
// dataset.ts
export const NUMERIC_VALUE_LIMIT = 1e308;                       // moved from curation.ts
export const numericValueSchema: z.ZodNumber;                   // moved from curation.ts
export const quantitativeValueSchema;                           // { single?, min?, max?, mean?, sd?, n? }
export type QuantitativeValue = z.infer<typeof quantitativeValueSchema>;
export type ReferenceSummary = ReferenceRef;                    // spec §6 name for the record item's references
// recordSchema gains: recordCode: string; quantitative: QuantitativeValue | null; references: ReferenceSummary[]
// traitSummarySchema.numeric: { min: number; max: number; mean: number | null; count: number } | null
// IMPORT_REJECT_REASONS gains 'invalid_record_id', 'duplicate_record_id'
// curation.ts
export const recordValueSchema; // { levelId: uuid } | { quantitative: QuantitativeValue }
```

- [ ] **Step 1: Write the failing tests**

Append to `packages/contracts/src/dataset.test.ts` (add `quantitativeValueSchema` and `IMPORT_REJECT_REASONS` to its import from `./dataset.ts`):

```ts
describe('RFC-65 R1 quantitativeValueSchema (spec R-5)', () => {
  it('takes any of the six fields with at least one of single, min, max, mean', () => {
    expect(quantitativeValueSchema.parse({ single: 3 })).toEqual({ single: 3 });
    expect(
      quantitativeValueSchema.parse({ min: 1, max: 4, mean: 2.5, sd: 0.4, n: 12 }),
    ).toEqual({ min: 1, max: 4, mean: 2.5, sd: 0.4, n: 12 });
    expect(quantitativeValueSchema.safeParse({}).success).toBe(false);
    expect(quantitativeValueSchema.safeParse({ sd: 1, n: 3 }).success).toBe(false);
  });

  it('refuses min > max, a negative sd, n below 1 or fractional, out-of-range numbers and extra keys', () => {
    expect(quantitativeValueSchema.safeParse({ min: 5, max: 2 }).success).toBe(false);
    expect(quantitativeValueSchema.safeParse({ min: 2, max: 2 }).success).toBe(true);
    expect(quantitativeValueSchema.safeParse({ mean: 2, sd: -0.1 }).success).toBe(false);
    expect(quantitativeValueSchema.safeParse({ mean: 2, n: 0 }).success).toBe(false);
    expect(quantitativeValueSchema.safeParse({ mean: 2, n: 1.5 }).success).toBe(false);
    expect(quantitativeValueSchema.safeParse({ single: 1e308 }).success).toBe(false);
    expect(quantitativeValueSchema.safeParse({ single: Number.NaN }).success).toBe(false);
    expect(quantitativeValueSchema.safeParse({ single: 1, median: 2 }).success).toBe(false);
  });
});

describe('RFC-64 R7 reject reasons (spec R-2)', () => {
  it('include the two ID reasons', () => {
    expect(IMPORT_REJECT_REASONS).toEqual(
      expect.arrayContaining(['invalid_record_id', 'duplicate_record_id']),
    );
  });
});
```

In the same file, the record literal inside `describe('RFC-63 R8 …')` (the object ending `respondsTo: null,`) gains three fields after `respondsTo: null,`:

```ts
      recordCode: 'EB_1',
      quantitative: null,
      references: [],
```

and in `describe('RFC-63 R10 speciesTraitsSchema')` replace `numeric: { min: 1.5, median: 2, max: 2.5, count: 2 },` with `numeric: { min: 1.5, max: 2.5, mean: 2, count: 2 },`, then add after the `expect(speciesTraitsSchema.parse(payload))…` line:

```ts
    const quantitativeTrait = payload[0]?.traits[1];
    expect(
      speciesTraitsSchema.safeParse([
        {
          category: { key: 'flower_color', label: 'Flower color' },
          traits: [{ ...quantitativeTrait, numeric: { min: 1, max: 3, mean: null, count: 1 } }],
        },
      ]).success,
    ).toBe(true);
```

In `packages/contracts/src/curation.test.ts`: the module-level `record` literal gains the same three lines after `respondsTo: null,`; in `describe('RFC-65 R1 createRecordBodySchema')` every `value: { numeric: X }` becomes `value: { quantitative: { single: X } }` (the cases `12.5`, `1e308`, `Number.NaN`, and the three `value: { numeric: 1 }` in the intent cases), `{ levelId: uuid, numeric: 1 }` becomes `{ levelId: uuid, quantitative: { single: 1 } }`, and add:

```ts
  it('spec R-5 takes the six quantitative fields and refuses min > max', () => {
    expect(
      createRecordBodySchema.safeParse({
        ...base,
        value: { quantitative: { min: 2, max: 8, mean: 4.5, sd: 0.5, n: 12 } },
      }).success,
    ).toBe(true);
    expect(
      createRecordBodySchema.safeParse({ ...base, value: { quantitative: { min: 8, max: 2 } } })
        .success,
    ).toBe(false);
    expect(createRecordBodySchema.safeParse({ ...base, value: { numeric: 1 } }).success).toBe(
      false,
    );
  });
```

`mapPendingBodySchema` cases keep `{ numeric: 3 }` (unchanged contract).

In `packages/contracts/src/contributions.test.ts` and `packages/contracts/src/dashboard.test.ts`, the record literal (the object ending `respondsTo: null,`) gains the same three lines.

- [ ] **Step 2: Run to see them fail**

`docker exec treerepro-13f sh -c 'cd /workspace && pnpm --filter @treerepro/contracts test'` (after SYNC)
Expected: FAIL — `quantitativeValueSchema` is not exported; `recordSchema` refuses `recordCode` (strict object); `numeric` refuses `mean`.

- [ ] **Step 3: Implement**

`packages/contracts/src/dataset.ts` — add `'invalid_record_id'` and `'duplicate_record_id'` at the end of `IMPORT_REJECT_REASONS` (the RFC order of checking is in the SQL, not the array):

```ts
/** @rfc RFC-64 R7 */
export const IMPORT_REJECT_REASONS = [
  'no_species_name',
  'unknown_trait',
  'no_reference',
  'unknown_species',
  'unknown_plot',
  'unknown_user',
  'unknown_reference',
  'doi_taken',
  'invalid_value',
  'invalid_record_id',
  'duplicate_record_id',
] as const;
```

(keep the JSDoc that is already above it; only the two entries are new). Immediately above `/** @rfc RFC-63 R8 */ export const recordSchema`, add:

```ts
/** Largest magnitude a manual number may have (RFC-64 R6). @rfc RFC-64 R6 */
export const NUMERIC_VALUE_LIMIT = 1e308;

/** @rfc RFC-65 R1 */
export const numericValueSchema = z
  .number()
  .finite()
  .refine((n) => Math.abs(n) < NUMERIC_VALUE_LIMIT, { message: 'Number is out of range' });

/**
 * A quantitative claim (spec R-5): `single` is the stored `numeric_value`;
 * at least one of single, min, max and mean; `min ≤ max`; `sd ≥ 0`; `n` an
 * integer ≥ 1. The manual input and the record item's `quantitative` share it.
 * @rfc RFC-65 R1
 * @rfc RFC-63 R15
 */
export const quantitativeValueSchema = z
  .strictObject({
    single: numericValueSchema.optional(),
    min: numericValueSchema.optional(),
    max: numericValueSchema.optional(),
    mean: numericValueSchema.optional(),
    sd: numericValueSchema.optional(),
    n: z.number().int().min(1).max(2147483647).optional(),
  })
  .refine(
    (q) =>
      q.single !== undefined || q.min !== undefined || q.max !== undefined || q.mean !== undefined,
    { path: ['single'], message: 'Give at least one of single, min, max or mean' },
  )
  .refine((q) => q.min === undefined || q.max === undefined || q.min <= q.max, {
    path: ['min'],
    message: 'min must not exceed max',
  })
  .refine((q) => q.sd === undefined || q.sd >= 0, {
    path: ['sd'],
    message: 'sd must not be negative',
  });
```

In `recordSchema`, add `recordCode: z.string(),` after `id: z.uuid(),`, `quantitative: quantitativeValueSchema.nullable(),` after `numericValue: z.number().nullable(),`, and `references: z.array(referenceRefSchema),` after `secondaryReference: referenceRefSchema.nullable(),`.

In `traitSummarySchema`, replace the `numeric` strict object with:

```ts
  numeric: z
    .strictObject({
      min: z.number(),
      max: z.number(),
      mean: z.number().nullable(),
      count: z.number().int().nonnegative(),
    })
    .nullable(),
```

In the type list at the bottom add:

```ts
export type QuantitativeValue = z.infer<typeof quantitativeValueSchema>;
export type ReferenceSummary = ReferenceRef;
```

`packages/contracts/src/curation.ts` — delete the `NUMERIC_VALUE_LIMIT` and `numericValueSchema` declarations (with their JSDoc), add `numericValueSchema` and `quantitativeValueSchema` to the existing `import { … } from './dataset.ts'` list, and replace `recordValueSchema`:

```ts
/** A level for a categorical trait, or a quantitative value for a quantitative one. @rfc RFC-65 R1 */
export const recordValueSchema = z.union([
  z.strictObject({ levelId: z.uuid() }),
  z.strictObject({ quantitative: quantitativeValueSchema }),
]);
```

(`mapPendingBodySchema` keeps `z.strictObject({ numeric: numericValueSchema })`, now resolved through the import. Do not re-export the moved names from `curation.ts`: `index.ts` already re-exports `dataset.ts`.)

- [ ] **Step 4: Run to pass**

`docker exec treerepro-13f sh -c 'cd /workspace && pnpm --filter @treerepro/contracts test && pnpm --filter @treerepro/contracts typecheck'` (after SYNC)
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/contracts/src
git commit -m "feat(contracts): quantitative value, record code and references on the record item, mean in the trait summary (spec R-2, R-4, R-5)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Schema and migration — record code, quantitative columns, record_references

**Files:** `apps/api/src/db/schema/records.ts`, `apps/api/drizzle/0035_record_schema.sql`, `apps/api/drizzle/meta/0035_snapshot.json`, `apps/api/drizzle/meta/_journal.json`, `apps/api/src/db/schema/dataset.integration.test.ts`, `apps/api/test/helpers/dataset.ts`.

**Interfaces — Produces:**

```ts
// records.ts
export const recordCodeTrSeq;                      // pgSequence('record_code_tr_seq')
// traitRecords gains: recordCode (text not null unique, default 'TR_' || nextval), minValue, maxValue, meanValue, sdValue (numeric number), n (integer)
export const recordReferences;                     // pgTable('record_references', { recordId, referenceId }), PK (record_id, reference_id)
export type RecordReferenceRow = typeof recordReferences.$inferSelect;
// SQL: function record_code_suffix(n bigint) → 'a'…'z','aa',… (RFC-63 R12)
// SQL: function record_references_usage(), trigger record_references_usage AFTER INSERT ON record_references
// test helper createRecord input gains: minValue?, maxValue?, meanValue?, sdValue?, n?
```

- [ ] **Step 1: Write the failing tests** — append to `apps/api/src/db/schema/dataset.integration.test.ts`; change its first import to `import { and, eq, sql } from 'drizzle-orm';`, add `import { referenceTraits } from './reference-traits.ts';`, and change `import { traitRecords } from './records.ts';` to `import { type NewTraitRecordRow, recordReferences, traitRecords } from './records.ts';`:

```ts
describe('RFC-63 R12, R15 record code and quantitative fields (spec R-2, R-5)', () => {
  const t = useTestDb();

  it('record_code defaults to TR_<n>, distinct per row, and is unique', async () => {
    await withRollback(t.db, async (tx) => {
      const sp1 = await createSpecies(tx);
      const trait = await traitByKey(tx, 'petal_length');
      const ref = await createReference(tx);
      const { user } = await createUser(tx);
      const base = {
        speciesId: sp1.id,
        traitId: trait.id,
        harmonisation: 'harmonised' as const,
        origin: 'manual' as const,
        createdBy: user.id,
        primaryReferenceId: ref.id,
      };
      const [a] = await tx.insert(traitRecords).values({ ...base, valueText: '1', numericValue: 1 }).returning();
      const [b] = await tx.insert(traitRecords).values({ ...base, valueText: '2', numericValue: 2 }).returning();
      expect(a?.recordCode).toMatch(/^TR_\d+$/);
      expect(b?.recordCode).toMatch(/^TR_\d+$/);
      expect(a?.recordCode).not.toBe(b?.recordCode);
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(traitRecords).values({
              ...base,
              valueText: '3',
              numericValue: 3,
              recordCode: a?.recordCode as string,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23505', constraint_name: 'trait_records_record_code_key' });
    });
  });

  it('record_code_suffix letters the parts of a split entry: a…z, aa, ab…', async () => {
    const [row] = await t.db.execute(sql`
      select record_code_suffix(1) as a, record_code_suffix(26) as z, record_code_suffix(27) as aa,
        record_code_suffix(28) as ab, record_code_suffix(702) as zz, record_code_suffix(703) as aaa`);
    expect(row).toEqual({ a: 'a', z: 'z', aa: 'aa', ab: 'ab', zz: 'zz', aaa: 'aaa' });
  });

  it('harmonised needs one of single/min/max/mean; min ≤ max; sd ≥ 0; n ≥ 1; never with a level; implies harmonised', async () => {
    await withRollback(t.db, async (tx) => {
      const sp1 = await createSpecies(tx);
      const petal = await traitByKey(tx, 'petal_length');
      const colour = await traitByKey(tx, 'flower_color');
      const blue = await levelByKey(tx, colour.id, 'blue');
      const ref = await createReference(tx);
      const { user } = await createUser(tx);
      const base = {
        speciesId: sp1.id,
        traitId: petal.id,
        origin: 'manual' as const,
        createdBy: user.id,
        primaryReferenceId: ref.id,
      };
      const refused: Partial<NewTraitRecordRow>[] = [
        { valueText: 'sd=1', harmonisation: 'harmonised', sdValue: 1 },
        { valueText: 'min=5;max=2', harmonisation: 'harmonised', minValue: 5, maxValue: 2 },
        { valueText: 'mean=3;sd=-1', harmonisation: 'harmonised', meanValue: 3, sdValue: -1 },
        { valueText: 'mean=3;n=0', harmonisation: 'harmonised', meanValue: 3, n: 0 },
        { valueText: 'min=1', harmonisation: 'not_numeric', minValue: 1 },
        { valueText: 'blue', harmonisation: 'harmonised', traitId: colour.id, levelId: blue.id, minValue: 1 },
      ];
      for (const row of refused) {
        await expect(
          unwrapDbError(
            tx.transaction((sp) =>
              sp.insert(traitRecords).values({ ...base, ...row } as NewTraitRecordRow),
            ),
          ),
          String(row.valueText),
        ).rejects.toMatchObject({ code: '23514' });
      }
      const [ok] = await tx
        .insert(traitRecords)
        .values({ ...base, valueText: 'min=2;max=8;n=3', harmonisation: 'harmonised', minValue: 2, maxValue: 8, n: 3 })
        .returning();
      expect(ok).toMatchObject({ minValue: 2, maxValue: 8, n: 3, numericValue: null });
    });
  });
});

describe('RFC-63 R16, RFC-61 R4, R9 record_references (spec R-4)', () => {
  const t = useTestDb();

  it('is keyed on both columns and counts as a primary usage and in reference_traits', async () => {
    await withRollback(t.db, async (tx) => {
      const sp1 = await createSpecies(tx);
      const trait = await traitByKey(tx, 'petal_length');
      const primary = await createReference(tx);
      const extra = await createReference(tx);
      const { user } = await createUser(tx);
      const rec = await createRecord(tx, {
        speciesId: sp1.id,
        traitId: trait.id,
        valueText: '1',
        numericValue: 1,
        primaryReferenceId: primary.id,
        origin: 'manual',
        createdBy: user.id,
      });
      await tx.insert(recordReferences).values({ recordId: rec.id, referenceId: extra.id });
      const [counted] = await tx
        .select({ primaryCount: bibliographicReferences.primaryCount })
        .from(bibliographicReferences)
        .where(eq(bibliographicReferences.id, extra.id));
      expect(counted?.primaryCount).toBe(1);
      const [usage] = await tx
        .select({ recordCount: referenceTraits.recordCount })
        .from(referenceTraits)
        .where(and(eq(referenceTraits.referenceId, extra.id), eq(referenceTraits.traitId, trait.id)));
      expect(usage?.recordCount).toBe(1);
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(recordReferences).values({ recordId: rec.id, referenceId: extra.id }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('treerepro_app may read and insert record_references but neither update, delete nor truncate', async () => {
    const rows = await t.db.execute(sql`
      select privilege_type, has_table_privilege('treerepro_app', 'record_references', privilege_type) as granted
      from unnest(array['SELECT', 'INSERT', 'DELETE', 'UPDATE', 'TRUNCATE']) as privilege_type
    `);
    expect(Object.fromEntries(rows.map((r) => [r.privilege_type, r.granted]))).toEqual({
      SELECT: true,
      INSERT: true,
      DELETE: false,
      UPDATE: false,
      TRUNCATE: false,
    });
  });
});
```

- [ ] **Step 2: Run to see them fail**

`docker exec treerepro-13f sh -c 'cd /workspace && pnpm exec vitest run --project api:integration src/db/schema/dataset.integration.test.ts'` (after SYNC)
Expected: FAIL — `recordReferences` is not exported; no `record_code` column.

- [ ] **Step 3: Schema** — `apps/api/src/db/schema/records.ts`

Imports: add `integer`, `pgSequence` and `primaryKey` to the `drizzle-orm/pg-core` import.

Above `traitRecords`:

```ts
/** Numbers the platform's record codes: `TR_<n>`, gaps accepted (spec R-2). @rfc RFC-63 R12 */
export const recordCodeTrSeq = pgSequence('record_code_tr_seq');
```

In the column list of `traitRecords`, after `id`:

```ts
    /** `EB_<n>` from the import file, `TR_<n>` for anything created on the platform (RFC-63 R12). */
    recordCode: text('record_code')
      .notNull()
      .unique('trait_records_record_code_key')
      .default(sql`('TR_' || nextval('record_code_tr_seq'))`),
```

after `numericValue` (which stays and means *single*):

```ts
    minValue: numeric('min_value', { mode: 'number' }),
    maxValue: numeric('max_value', { mode: 'number' }),
    meanValue: numeric('mean_value', { mode: 'number' }),
    sdValue: numeric('sd_value', { mode: 'number' }),
    n: integer('n'),
```

In the constraint list, replace the three value checks with:

```ts
    check(
      'trait_records_harmonised_check',
      sql`${t.harmonisation} <> 'harmonised' or ${t.levelId} is not null
        or coalesce(${t.numericValue}, ${t.minValue}, ${t.maxValue}, ${t.meanValue}) is not null`,
    ),
    check(
      'trait_records_one_value_check',
      sql`${t.levelId} is null or num_nonnulls(${t.numericValue}, ${t.minValue}, ${t.maxValue}, ${t.meanValue}, ${t.sdValue}, ${t.n}) = 0`,
    ),
    check(
      'trait_records_value_requires_harmonised_check',
      sql`(${t.levelId} is null and num_nonnulls(${t.numericValue}, ${t.minValue}, ${t.maxValue}, ${t.meanValue}, ${t.sdValue}, ${t.n}) = 0)
        or ${t.harmonisation} = 'harmonised'`,
    ),
    check(
      'trait_records_quantitative_check',
      sql`(${t.minValue} is null or ${t.maxValue} is null or ${t.minValue} <= ${t.maxValue})
        and (${t.sdValue} is null or ${t.sdValue} >= 0) and (${t.n} is null or ${t.n} >= 1)`,
    ),
```

Update the JSDoc of `traitRecords` to `@rfc RFC-63 R1-R3, R5, R12, R15`. At the end of the file:

```ts
/**
 * The references of a record beyond its primary one (spec R-4): the first
 * source of a form is `primary_reference_id`, the rest land here. Imported
 * records never use it. Insert-only for the app role (migration 0035).
 * @rfc RFC-63 R16
 * @rfc RFC-61 R4, R9
 */
export const recordReferences = pgTable(
  'record_references',
  {
    recordId: uuid('record_id')
      .notNull()
      .references(() => traitRecords.id, { onDelete: 'restrict' }),
    referenceId: uuid('reference_id')
      .notNull()
      .references(() => bibliographicReferences.id, { onDelete: 'restrict' }),
  },
  (t) => [
    primaryKey({ columns: [t.recordId, t.referenceId] }),
    index('record_references_reference_idx').on(t.referenceId),
  ],
);

export type RecordReferenceRow = typeof recordReferences.$inferSelect;
```

- [ ] **Step 4: Generate the migration in the container and copy it out**

```sh
# after SYNC
docker exec treerepro-13f sh -c 'cd /workspace && pnpm --filter @treerepro/api db:generate --name record_schema'
docker exec treerepro-13f sh -c 'ls /workspace/apps/api/drizzle | tail -2'
docker cp treerepro-13f:/workspace/apps/api/drizzle/0035_record_schema.sql apps/api/drizzle/
docker cp treerepro-13f:/workspace/apps/api/drizzle/meta/0035_snapshot.json apps/api/drizzle/meta/
docker cp treerepro-13f:/workspace/apps/api/drizzle/meta/_journal.json apps/api/drizzle/meta/
```

(If `ls` shows another number, use it everywhere below.)

- [ ] **Step 5: Hand-edit `apps/api/drizzle/0035_record_schema.sql`**

(a) Replace the generated `ALTER TABLE "trait_records" ADD COLUMN "record_code" text DEFAULT ('TR_' || nextval('record_code_tr_seq')) NOT NULL;--> statement-breakpoint` with:

```sql
-- Spec R-2 / §5: existing rows get a throw-away code the replacing import of
-- the reimport runbook swaps out (docs/gotchas/import.md). A volatile default
-- on ADD COLUMN rewrites the table inside the ALTER, so no UPDATE runs and the
-- RFC-63 R4 append-only triggers never fire; the platform's own sequence
-- starts untouched at TR_1.
CREATE SEQUENCE "record_code_legacy_seq";--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "record_code" text DEFAULT ('EB_LEGACY_' || nextval('record_code_legacy_seq')) NOT NULL;--> statement-breakpoint
ALTER TABLE "trait_records" ALTER COLUMN "record_code" SET DEFAULT ('TR_' || nextval('record_code_tr_seq'));--> statement-breakpoint
DROP SEQUENCE "record_code_legacy_seq";--> statement-breakpoint
```

The `CREATE SEQUENCE "public"."record_code_tr_seq" …` statement drizzle generated must stay **before** this block (drizzle emits sequences first; check).

(b) Append at the end of the file:

```sql
--> statement-breakpoint
-- RFC-63 R12 (spec R-2): the letters of the parts of a split entry, in
-- bijective base 26 — 1 → a, 26 → z, 27 → aa, 28 → ab. The import suffixes
-- `EB_1a`, `EB_1b`; nextRecordCodes() suffixes `TR_7a`, `TR_7b`.
CREATE FUNCTION record_code_suffix(n bigint) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  WITH RECURSIVE d(q, s) AS (
    SELECT n, ''::text
    UNION ALL
    SELECT (q - 1) / 26, chr(97 + ((q - 1) % 26)::int) || s FROM d WHERE q > 0
  )
  SELECT s FROM d WHERE q = 0
$$;
--> statement-breakpoint
-- RFC-61 R4, R9 (spec R-4): a record_references row is a use of its reference
-- in the primary role and in reference_traits. A trigger of its own, not an
-- edit of trait_records_reference_usage(), so the functions never collide.
-- SECURITY DEFINER with pg_temp named last, the 0022/0027 pattern:
-- reference_traits is read-only for the app role.
CREATE FUNCTION record_references_usage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE bibliographic_references r SET primary_count = r.primary_count + u.n
  FROM (SELECT reference_id AS id, count(*) AS n FROM inserted GROUP BY 1) u
  WHERE r.id = u.id;
  INSERT INTO reference_traits (reference_id, trait_id, record_count)
  SELECT i.reference_id, t.trait_id, count(*)
  FROM inserted i JOIN trait_records t ON t.id = i.record_id
  GROUP BY 1, 2
  ON CONFLICT (reference_id, trait_id) DO UPDATE SET record_count = reference_traits.record_count + EXCLUDED.record_count;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION record_references_usage() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER record_references_usage AFTER INSERT ON record_references
REFERENCING NEW TABLE AS inserted
FOR EACH STATEMENT EXECUTE FUNCTION record_references_usage();
--> statement-breakpoint
-- RFC-63 R4 technique: the app role inserts but never rewrites.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'treerepro_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON record_references FROM treerepro_app;
  END IF;
END;
$$;
```

- [ ] **Step 6: Confirm the snapshot matches the schema**

```sh
# after SYNC (the edited .sql is now in the container)
docker exec treerepro-13f sh -c 'cd /workspace && pnpm --filter @treerepro/api db:generate --name check_only'
```

Expected: `No schema changes, nothing to migrate`. (If it writes a file, the snapshot is off: delete the new file in the container and re-check the copy-out of Step 4.)

- [ ] **Step 7: Test helper** — `apps/api/test/helpers/dataset.ts`, in `type RecordBase` add:

```ts
  minValue?: number;
  maxValue?: number;
  meanValue?: number;
  sdValue?: number;
  n?: number;
```

and in `createRecord` replace the `harmonisation` default and add the columns to `.values({ … })` after `numericValue`:

```ts
  const quantitative = [input.numericValue, input.minValue, input.maxValue, input.meanValue];
  const harmonisation =
    input.harmonisation ??
    (input.levelId !== undefined || quantitative.some((v) => v !== undefined)
      ? 'harmonised'
      : 'unknown_level');
```

```ts
      minValue: input.minValue ?? null,
      maxValue: input.maxValue ?? null,
      meanValue: input.meanValue ?? null,
      sdValue: input.sdValue ?? null,
      n: input.n ?? null,
```

Update the helper's doc line to "…defaults to `harmonised` when a level or one of single/min/max/mean is given…".

- [ ] **Step 8: Run to pass**

`docker exec treerepro-13f sh -c 'cd /workspace && pnpm exec vitest run --project api:integration src/db/schema/ src/dataset/references.integration.test.ts'` (after SYNC)
Expected: PASS (the reference counter tests still pass: the old trigger is untouched).

- [ ] **Step 9: Commit**

```sh
git add apps/api/src/db/schema/records.ts apps/api/src/db/schema/dataset.integration.test.ts apps/api/drizzle apps/api/test/helpers/dataset.ts
git commit -m "feat(db): record_code, quantitative columns and record_references with usage trigger (spec R-2, R-4, R-5)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Manual creation — one record per value, all references, quantitative value

**Files:** `apps/api/src/dataset/curation.ts`, `apps/api/src/dataset/queues.ts`, `apps/api/src/dataset/curation.integration.test.ts`, `apps/api/src/http/routes/dataset/records.integration.test.ts`.

**Interfaces:**

Consumes: `recordValueSchema` / `RecordValue` (Task 2), `QuantitativeValue`, `recordReferences` (Task 3).

Produces:

```ts
export type ResolvedValue =
  | { levelId: string; levelKey: string; quantitative: null }
  | { levelId: null; levelKey: null; quantitative: QuantitativeValue };
export async function resolveValue(db, visibility, trait, value: RecordValue, path = 'value'): Promise<ResolvedValue>;
export function quantitativeText(q: QuantitativeValue): SQL<string>;   // replaces numericText
export async function nextRecordCodes(db: DbExecutor, count: number): Promise<string[]>;
// spec §6 / RFC-63 R12: one nextval('record_code_tr_seq'); ['TR_7'] for 1, ['TR_7a','TR_7b',…] for more.
// 13g's multi-level create path calls it with the number of records it creates and names the codes;
// a lone insert (this plan's createRecords, mapPending) keeps the column default.
export async function createRecords(db, visibility, input: CreateRecordsInput): Promise<CreateRecordsResult>;
// unchanged signature; now: created has exactly one record; duplicates is always []; a conflicting claim → 409 RECORD_DUPLICATE
```

- [ ] **Step 1: Write the failing tests** — in `apps/api/src/dataset/curation.integration.test.ts`, add `nextRecordCodes` to the `./curation.ts` import, then replace the test `'creates multiple records across references in input order; detects duplicates'` with:

```ts
  it('RFC-63 R12 nextRecordCodes takes one sequence number: bare for one record, lettered for several', async () => {
    const [one] = await nextRecordCodes(t.db, 1);
    expect(one).toMatch(/^TR_\d+$/);
    const three = await nextRecordCodes(t.db, 3);
    const base = three[0]?.slice(0, -1);
    expect(base).toMatch(/^TR_\d+$/);
    expect(base).not.toBe(one);
    expect(three).toEqual([`${base}a`, `${base}b`, `${base}c`]);
    await expect(nextRecordCodes(t.db, 0)).rejects.toThrow();
  });

  it('spec R-4 creates one record per value: first reference primary, the rest in record_references', async () => {
    const { user } = await createUser(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const sp = await createSpecies(t.db);
    const ref1 = await createReference(t.db);
    const ref2 = await createReference(t.db);
    const ref3 = await createReference(t.db);

    const res = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: sp.id,
      traitId: trait.id,
      value: { levelId: trait.levels[0]?.id as string },
      referenceIds: [ref1.id, ref2.id, ref3.id],
    });
    expect(res.created).toHaveLength(1);
    expect(res.duplicates).toEqual([]);
    const record = res.created[0];
    expect(record?.recordCode).toMatch(/^TR_\d+$/);
    expect(record?.primaryReference?.id).toBe(ref1.id);
    const extras = [ref2, ref3]
      .sort((x, y) => x.citationKey.localeCompare(y.citationKey))
      .map((r) => r.id);
    expect(record?.references.map((r) => r.id)).toEqual([ref1.id, ...extras]);

    // The same claim again (same primary reference) → 409 naming the record.
    await expect(
      createRecords(t.db, UNRESTRICTED, {
        actorId: user.id,
        speciesId: sp.id,
        traitId: trait.id,
        value: { levelId: trait.levels[0]?.id as string },
        referenceIds: [ref1.id, ref2.id],
      }),
    ).rejects.toMatchObject({
      code: 'RECORD_DUPLICATE',
      details: [{ path: 'sources.references.0', message: record?.id }],
    });
  });

  it('spec R-5 stores the six quantitative fields and derives value_text from them', async () => {
    const { user } = await createUser(t.db);
    const trait = await createTrait(t.db, { valueType: 'quantitative', unit: 'mm' });
    const sp = await createSpecies(t.db);
    const ref = await createReference(t.db);
    const res = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: sp.id,
      traitId: trait.id,
      value: { quantitative: { min: 2, max: 8, mean: 4.5, sd: 0.5, n: 12 } },
      referenceIds: [ref.id],
    });
    expect(res.created[0]).toMatchObject({
      valueText: 'min=2;max=8;mean=4.5;sd=0.5;n=12',
      numericValue: null,
      quantitative: { min: 2, max: 8, mean: 4.5, sd: 0.5, n: 12 },
      harmonisation: 'harmonised',
    });
    const single = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: sp.id,
      traitId: trait.id,
      value: { quantitative: { single: 1e3 } },
      referenceIds: [ref.id],
    });
    expect(single.created[0]).toMatchObject({
      valueText: '1000',
      numericValue: 1000,
      quantitative: { single: 1000 },
    });
    await expect(
      createRecords(t.db, UNRESTRICTED, {
        actorId: user.id,
        speciesId: sp.id,
        traitId: trait.id,
        value: { quantitative: { mean: 1e308 } },
        referenceIds: [ref.id],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'value.quantitative.mean' }],
    });
  });
```

In `'contest generates a dispute annotation on the base record; complement does not'`: replace `expect(contestRes.created).toHaveLength(2);` by

```ts
    expect(contestRes.created).toHaveLength(1);
    expect(contestRes.created[0]?.references.map((r) => r.id).sort()).toEqual(
      [ref2.id, ref3.id].sort(),
    );
```

the note expectation by `` expect(disputeAnn?.note).toBe(`Contested by record ${contestRes.created[0]?.id}`); `` and `expect(updatedBase?.responses).toHaveLength(2);` by `expect(updatedBase?.responses).toHaveLength(1);`.

In `apps/api/src/http/routes/dataset/records.integration.test.ts`: in `'creates a quantitative record with the canonical number as value_text'` replace `value: { numeric: 1e3 },` by `value: { quantitative: { single: 1e3 } },` and add `quantitative: { single: 1000 },` to its `toMatchObject`; in the validation cases replace `[{ traitId: cat.id, value: { numeric: 1 } }, 'value'],` by `[{ traitId: cat.id, value: { quantitative: { single: 1 } } }, 'value'],`; and add inside `describe('RFC-65 R1, R2 POST /api/records')`:

```ts
  it('spec R-5 refuses min > max before touching the database', async () => {
    const { cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { valueType: 'quantitative' });
    const ref = await createReference(t.db);
    const res = await call(t.app, 'POST', '/api/records', {
      cookie,
      body: {
        speciesId: sp1.id,
        traitId: trait.id,
        value: { quantitative: { min: 8, max: 2 } },
        sources: { references: [{ id: ref.id }] },
      },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED');
  });
```

- [ ] **Step 2: Run to see them fail**

`docker exec treerepro-13f sh -c 'cd /workspace && pnpm exec vitest run --project api:integration src/dataset/curation.integration.test.ts src/http/routes/dataset/records.integration.test.ts'` (after SYNC)
Expected: FAIL — `created` has 3 records; `resolveValue` rejects `{ quantitative }` ("A categorical trait takes a level" never reached / wrong shape).

- [ ] **Step 3: Implement** — `apps/api/src/dataset/curation.ts`

Imports: add `QuantitativeValue` to the `@treerepro/contracts` type import; change `import { traitRecords } from '../db/schema/records.ts';` to `import { recordReferences, traitRecords } from '../db/schema/records.ts';`.

Replace `ResolvedValue`, the quantitative half of `resolveValue`, and `numericText`:

```ts
export type ResolvedValue =
  | { levelId: string; levelKey: string; quantitative: null }
  | { levelId: null; levelKey: null; quantitative: QuantitativeValue };
```

In `resolveValue`, the categorical branch returns `{ levelId: level.id, levelKey: level.key, quantitative: null }`; the tail becomes:

```ts
  if (trait.valueType !== 'quantitative')
    throw validation(path, 'A categorical trait takes a level');
  const q = value.quantitative;
  for (const key of ['single', 'min', 'max', 'mean', 'sd'] as const) {
    const n = q[key];
    if (n !== undefined && !isHarmonisableNumber(String(n)))
      throw validation(`${path}.quantitative.${key}`, 'Number is out of range');
  }
  return { levelId: null, levelKey: null, quantitative: q };
```

and its first-branch message for a categorical value on a quantitative trait stays `'A quantitative trait takes a number'`. Replace `numericText` with:

```ts
/**
 * The `value_text` of a quantitative claim (RFC-63 R15): the single value as
 * PostgreSQL prints `numeric` (`1e3` → `1000`) when it is the only field;
 * otherwise every given field as `<name>=<value>`, `;`-joined in the order
 * single, min, max, mean, sd, n — so claims differing in any of the six
 * fields differ in the claim key (RFC-63 R3).
 * @rfc RFC-63 R3, R15
 * @rfc RFC-65 R1
 */
export function quantitativeText(q: QuantitativeValue): SQL<string> {
  const num = (v: number) => sql<string>`(${String(v)}::numeric)::text`;
  const fields = [
    ['single', q.single],
    ['min', q.min],
    ['max', q.max],
    ['mean', q.mean],
    ['sd', q.sd],
    ['n', q.n],
  ] as const;
  const given = fields.filter(([, v]) => v !== undefined) as [string, number][];
  const [only] = given;
  if (given.length === 1 && only?.[0] === 'single') return num(only[1]);
  return sql<string>`concat_ws(';', ${sql.join(
    given.map(([name, v]) => sql`${`${name}=`}::text || ${num(v)}`),
    sql`, `,
  )})`;
}
```

Below it, add the code helper spec §6 names for 13g:

```ts
/**
 * The record codes of one entry (RFC-63 R12): one `record_code_tr_seq`
 * number, bare for a single record (`TR_5`) and lettered for several
 * (`TR_7a`, `TR_7b`, …, `record_code_suffix` of migration 0035). A lone
 * insert may rely on the column default instead; a form that creates several
 * records (plan 13g) names the codes this returns.
 * @rfc RFC-63 R12
 */
export async function nextRecordCodes(db: DbExecutor, count: number): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('nextRecordCodes: count must be a positive integer');
  }
  // The FROM subquery holds a volatile call, so PostgreSQL evaluates it once:
  // every code of the entry shares one number.
  const rows = (await db.execute(sql`
    select 'TR_' || s.v || case when ${count}::int = 1 then '' else record_code_suffix(g) end as code
    from (select nextval('record_code_tr_seq') as v) s
    cross join generate_series(1, ${count}::int) g
    order by g`)) as unknown as { code: string }[];
  return rows.map((r) => r.code);
}
```

In `createRecords`: JSDoc becomes

```ts
/**
 * One record per value (spec R-4): the first reference is the primary one,
 * the others go to `record_references`. An identical claim (the RFC-63 R3 key,
 * which names the primary reference only) creates nothing and answers 409.
 * `duplicates` stays empty until plan 13g turns a match into a validation.
 * @rfc RFC-70 R2, R3
 * @rfc RFC-63 R3, R16
 */
```

the contest same-value test becomes

```ts
      const sameValue =
        (value.levelId !== null && value.levelId === target.levelId) ||
        (value.quantitative?.single !== undefined &&
          target.numericValue !== null &&
          Number(value.quantitative.single) === Number(target.numericValue));
```

and everything from `const valueText` to the end of the function becomes:

```ts
  const valueText: string | SQL<string> =
    value.levelKey !== null ? value.levelKey : quantitativeText(value.quantitative);
  const [primaryReferenceId, ...moreReferenceIds] = input.referenceIds;
  if (primaryReferenceId === undefined) throw validation('sources', 'A reference is required');

  return db.transaction(async (tx) => {
    if (input.intent === 'contest' && input.respondsToRecordId) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.respondsToRecordId}, 0))`,
      );
    }

    const [inserted] = await tx
      .insert(traitRecords)
      .values({
        speciesId: input.speciesId,
        traitId: input.traitId,
        valueText,
        levelId: value.levelId,
        numericValue: value.quantitative?.single ?? null,
        minValue: value.quantitative?.min ?? null,
        maxValue: value.quantitative?.max ?? null,
        meanValue: value.quantitative?.mean ?? null,
        sdValue: value.quantitative?.sd ?? null,
        n: value.quantitative?.n ?? null,
        harmonisation: 'harmonised',
        rawValue: input.rawValue ?? null,
        primaryReferenceId,
        secondaryReferenceId: input.secondaryReferenceId ?? null,
        origin: 'manual',
        createdBy: input.actorId,
        note: input.note ?? null,
        intent: input.intent ?? null,
        respondsToRecordId: input.respondsToRecordId ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: traitRecords.id });

    if (!inserted) {
      const [existing] = await tx
        .select({ id: traitRecords.id })
        .from(traitRecords)
        .where(
          and(
            eq(traitRecords.speciesId, input.speciesId),
            eq(traitRecords.traitId, input.traitId),
            eq(traitRecords.valueText, valueText),
            input.rawValue == null
              ? isNull(traitRecords.rawValue)
              : eq(traitRecords.rawValue, input.rawValue),
            eq(traitRecords.primaryReferenceId, primaryReferenceId),
            input.secondaryReferenceId == null
              ? isNull(traitRecords.secondaryReferenceId)
              : eq(traitRecords.secondaryReferenceId, input.secondaryReferenceId),
          ),
        )
        .limit(1);
      throw new AppError('RECORD_DUPLICATE', 'This claim already exists; confirm it instead', [
        { path: 'sources.references.0', message: existing?.id ?? '' },
      ]);
    }

    if (moreReferenceIds.length > 0) {
      await tx
        .insert(recordReferences)
        .values(moreReferenceIds.map((referenceId) => ({ recordId: inserted.id, referenceId })));
    }

    if (input.intent === 'contest' && input.respondsToRecordId) {
      await tx.insert(recordAnnotations).values({
        recordId: input.respondsToRecordId,
        actorId: input.actorId,
        kind: 'dispute',
        note: CONTEST_NOTE([inserted.id]),
        generated: true,
      });
    }

    const detail = await getRecord(tx, UNRESTRICTED, inserted.id);
    if (!detail) throw new Error('createRecords: record vanished');
    return { created: [detail], duplicates: [] };
  });
```

`apps/api/src/dataset/queues.ts`, in `mapPending`, replace the `else` branch:

```ts
  } else {
    await resolveValue(db, visibility, trait, { quantitative: { single: input.value.numeric } });
    numeric = String(input.value.numeric);
  }
```

- [ ] **Step 4: Run to pass**

`docker exec treerepro-13f sh -c 'cd /workspace && pnpm exec vitest run --project api:integration src/dataset/curation.integration.test.ts src/dataset/queues.integration.test.ts src/http/routes/dataset/records.integration.test.ts'` (after SYNC)
Expected: PASS except assertions that read `recordCode`/`references` off a record item (`record?.recordCode`, `record?.references`) — those need Task 5. If they are the only failures, proceed; they pass at the end of Task 5.

- [ ] **Step 5: Commit**

```sh
git add apps/api/src/dataset/curation.ts apps/api/src/dataset/queues.ts apps/api/src/dataset/curation.integration.test.ts apps/api/src/http/routes/dataset/records.integration.test.ts
git commit -m "feat(api): one record per value with all its references; quantitative manual value (spec R-4, R-5)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Record item — recordCode, quantitative, references; reading a reference's records

**Files:** `apps/api/src/dataset/records.ts`, `apps/api/src/dataset/references.ts`, `apps/api/src/dataset/records.integration.test.ts`, `apps/api/src/dataset/contributions.integration.test.ts`, `apps/api/src/dataset/references.integration.test.ts`.

**Interfaces:**

Consumes: `recordReferences`, `traitRecords` new columns (Task 3); `RecordItem` shape (Task 2).

Produces: `toItem(r: ItemRow): RecordItem` fills `recordCode`, `quantitative`, `references`; `ItemRow` gains `extraReferences: { id: string; citationKey: string; kind: ReferenceKind; shortCitation: string | null }[]`; `itemQuery` selects it; `listRecords({ referenceId })` includes `record_references`; `getReference(...).recordCount` counts them.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/dataset/records.integration.test.ts` — in the exact `toEqual` of `byTrait.data[1]`, add after `respondsTo: null,`:

```ts
      recordCode: expect.stringMatching(/^TR_\d+$/),
      quantitative: null,
      references: [
        { id: ref.id, citationKey: ref.citationKey, kind: 'publication', observer: null, shortCitation: null },
      ],
```

and append (add `recordReferences` to the `../db/schema/records.ts` import):

```ts
describe('RFC-63 R8, R9 record code, quantitative value and references (spec R-2, R-4, R-5)', () => {
  const t = useTestDb();

  it('lists the primary reference first, then record_references; a reference lists the records it appears on', async () => {
    const { user } = await createUser(t.db);
    const sp1 = await createSpecies(t.db);
    const petal = await traitByKey(t.db, 'petal_length');
    const primary = await createReference(t.db);
    const extra = await createReference(t.db);
    const rec = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: petal.id,
      valueText: 'min=2;max=8',
      minValue: 2,
      maxValue: 8,
      primaryReferenceId: primary.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await t.db.insert(recordReferences).values({ recordId: rec.id, referenceId: extra.id });

    const detail = await getRecord(t.db, UNRESTRICTED, rec.id);
    expect(detail?.recordCode).toMatch(/^TR_\d+$/);
    expect(detail?.quantitative).toEqual({ min: 2, max: 8 });
    expect(detail?.references).toEqual([
      { id: primary.id, citationKey: primary.citationKey, kind: 'publication', observer: null, shortCitation: null },
      { id: extra.id, citationKey: extra.citationKey, kind: 'publication', observer: null, shortCitation: null },
    ]);

    const byExtra = await listRecords(t.db, UNRESTRICTED, { referenceId: extra.id, limit: 10 });
    expect(byExtra.data.map((r) => r.id)).toEqual([rec.id]);
  });
});
```

(`createRecord`, `createReference`, `createSpecies`, `traitByKey` are already imported there; add any that are missing to the `../../test/helpers/dataset.ts` import.)

`apps/api/src/dataset/contributions.integration.test.ts` — in the exact `toEqual` of `second.data[0]`, add after `respondsTo: null,`:

```ts
      recordCode: expect.stringMatching(/^TR_\d+$/),
      quantitative: null,
      references: [expect.objectContaining({ id: reference.id })],
```

`apps/api/src/dataset/references.integration.test.ts` — append inside the `describe` that holds `'usage counters live on the reference row, …'` (add `import { recordReferences } from '../db/schema/records.ts';` and `createUser` from `../../test/helpers/users.ts` if absent):

```ts
  it('spec R-4 a record_references row counts in the detail as it does in the counters', async () => {
    const { user } = await createUser(t.db);
    const primary = await createReference(t.db);
    const extra = await createReference(t.db);
    const sp = await createSpecies(t.db);
    const trait = await traitByKey(t.db, 'flower_color');
    const rec = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'x',
      primaryReferenceId: primary.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await t.db.insert(recordReferences).values({ recordId: rec.id, referenceId: extra.id });
    expect(await getReference(t.db, extra.id)).toMatchObject({
      recordCount: 1,
      primaryCount: 1,
      traits: [{ trait: { id: trait.id }, recordCount: 1 }],
    });
  });
```

- [ ] **Step 2: Run to see them fail**

`docker exec treerepro-13f sh -c 'cd /workspace && pnpm exec vitest run --project api:integration src/dataset/records.integration.test.ts src/dataset/contributions.integration.test.ts src/dataset/references.integration.test.ts'` (after SYNC)
Expected: FAIL — items have no `recordCode`; `listRecords` by `extra` is empty; `recordCount` is 0.

- [ ] **Step 3: Implement** — `apps/api/src/dataset/records.ts`

Imports: `import type { QuantitativeValue, RecordDetail, RecordItem, ReferenceKind, ReviewStatus } from '@treerepro/contracts';` and `import { recordReferences, traitRecords } from '../db/schema/records.ts';`.

Below the aliases, add:

```ts
type ExtraReference = {
  id: string;
  citationKey: string;
  kind: ReferenceKind;
  shortCitation: string | null;
};

/**
 * A record's `record_references`, ordered by citation key, as one JSON array
 * per row. They are never personal observations — `resolveSources` gives a
 * personal observation alone and refuses one named by id (RFC-61 R7) — so
 * `observer` is always null and no encrypted name is read here.
 */
const extraReferencesSql = sql<ExtraReference[]>`(select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'citationKey', b.citation_key, 'kind', b.kind, 'shortCitation', b.short_citation)
    order by b.citation_key), '[]'::jsonb)
  from ${recordReferences} rr join ${bibliographicReferences} b on b.id = rr.reference_id
  where rr.record_id = ${traitRecords.id})`;

function quantitativeOf(rec: typeof traitRecords.$inferSelect): QuantitativeValue | null {
  const fields = {
    single: rec.numericValue,
    min: rec.minValue,
    max: rec.maxValue,
    mean: rec.meanValue,
    sd: rec.sdValue,
    n: rec.n,
  };
  const given = Object.entries(fields).filter(([, v]) => v !== null);
  return given.length > 0 ? (Object.fromEntries(given) as QuantitativeValue) : null;
}
```

Add `extraReferences: extraReferencesSql,` at the end of `itemColumns` and `extraReferences: ExtraReference[];` to `ItemRow` (before `review`). In `toItem`, compute the primary reference once and add the three fields:

```ts
export function toItem(r: ItemRow): RecordItem {
  const rec = r.record;
  const primaryReference =
    rec.primaryReferenceId && r.primaryKey && r.primaryKind
      ? {
          id: rec.primaryReferenceId,
          citationKey: r.primaryKey,
          kind: r.primaryKind,
          observer:
            r.primaryObserverId && r.primaryObserverName
              ? { id: r.primaryObserverId, name: r.primaryObserverName }
              : null,
          shortCitation: r.primaryShortCitation,
        }
      : null;
  return {
    id: rec.id,
    recordCode: rec.recordCode,
    speciesId: rec.speciesId,
    species: { id: rec.speciesId, canonicalName: r.speciesName },
    trait: { id: rec.traitId, key: r.traitKey, valueType: r.traitValueType, unit: r.traitUnit },
    valueText: rec.valueText,
    level: rec.levelId && r.levelKey ? { id: rec.levelId, key: r.levelKey } : null,
    numericValue: rec.numericValue,
    quantitative: quantitativeOf(rec),
    harmonisation: rec.harmonisation,
    review: r.review,
    primaryReference,
    secondaryReference:
      rec.secondaryReferenceId && r.secondaryKey && r.secondaryKind
        ? {
            id: rec.secondaryReferenceId,
            citationKey: r.secondaryKey,
            kind: r.secondaryKind,
            observer:
              r.secondaryObserverId && r.secondaryObserverName
                ? { id: r.secondaryObserverId, name: r.secondaryObserverName }
                : null,
            shortCitation: r.secondaryShortCitation,
          }
        : null,
    references: [
      ...(primaryReference ? [primaryReference] : []),
      ...r.extraReferences.map((x) => ({ ...x, observer: null })),
    ],
    origin: rec.origin,
    createdAt: rec.createdAt.toISOString(),
    createdBy: rec.createdBy && r.authorName ? { id: rec.createdBy, name: r.authorName } : null,
    intent: rec.intent ?? null,
    respondsTo: rec.respondsToRecordId ? { id: rec.respondsToRecordId } : null,
  };
}
```

Update the JSDoc of `toItem` to `@rfc RFC-63 R8`, unchanged tag, and of `listRecords` to "…or `referenceId` alone (primary, secondary or `record_references`)…". In `listRecords`, replace the `referenceId` branch:

```ts
  } else if (input.referenceId) {
    conditions.push(
      sql`${traitRecords.id} in (
        select r.id from ${traitRecords} r
        where r.primary_reference_id = ${input.referenceId} or r.secondary_reference_id = ${input.referenceId}
        union all
        select rr.record_id from ${recordReferences} rr where rr.reference_id = ${input.referenceId})`,
    );
  }
```

(`or` is then unused in `records.ts`: drop it from the `drizzle-orm` import if Biome says so.)

`apps/api/src/dataset/references.ts` — import `recordReferences` with `traitRecords` from `../db/schema/records.ts`; in `getReference` the `Promise.all` becomes:

```ts
  const [counts, extraCounts, traitRows] = await Promise.all([
    db
      .select({ recordCount: count() })
      .from(traitRecords)
      .where(
        or(eq(traitRecords.primaryReferenceId, id), eq(traitRecords.secondaryReferenceId, id)),
      ),
    db
      .select({ recordCount: count() })
      .from(recordReferences)
      .where(eq(recordReferences.referenceId, id)),
    db
      .select({
        id: traits.id,
        key: traits.key,
        valueType: traits.valueType,
        unit: traits.unit,
        recordCount: referenceTraits.recordCount,
      })
      .from(referenceTraits)
      .innerJoin(traits, eq(traits.id, referenceTraits.traitId))
      .where(and(eq(referenceTraits.referenceId, id), traitVisible(visibility)))
      .orderBy(desc(referenceTraits.recordCount), asc(traits.key)),
  ]);
```

and `recordCount: (counts[0]?.recordCount ?? 0) + (extraCounts[0]?.recordCount ?? 0),`. Add to its JSDoc: "`recordCount` includes the records naming the reference in `record_references` (spec R-4)."

- [ ] **Step 4: Run to pass**

`docker exec treerepro-13f sh -c 'cd /workspace && pnpm exec vitest run --project api:integration src/dataset/ src/http/routes/dataset/ src/workspace/'` (after SYNC)
Expected: PASS, including the Task 4 assertions on `recordCode` and `references`.

- [ ] **Step 5: Commit**

```sh
git add apps/api/src/dataset/records.ts apps/api/src/dataset/references.ts apps/api/src/dataset/records.integration.test.ts apps/api/src/dataset/contributions.integration.test.ts apps/api/src/dataset/references.integration.test.ts
git commit -m "feat(api): record items carry recordCode, quantitative and references; a reference lists its record_references records (spec R-2, R-4, R-5)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Trait summary numeric — `{ min, max, mean, count }`

**Files:** `apps/api/src/dataset/summary.ts`, `apps/api/src/dataset/summary.integration.test.ts`.

**Interfaces:** Produces `TraitSummary['numeric'] = { min: number; max: number; mean: number | null; count: number } | null` (Task 2 contract). Only the numeric aggregate and `summaryOf`'s `numeric` change; 13e edits the accepted query and field of the same function.

- [ ] **Step 1: Write the failing tests** — in `apps/api/src/dataset/summary.integration.test.ts` replace `numeric: { min: 1, median: 2, max: 4, count: 3 },` with `numeric: { min: 1, max: 4, mean: expect.closeTo(7 / 3, 10), count: 3 },` and append inside `describe('RFC-63 R10 speciesTraitSummary')`:

```ts
  it('spec R-5 numeric: extremes over single/min/max/mean; mean of each single, else the record mean', async () => {
    const { user } = await createUser(t.db);
    const sp1 = await createSpecies(t.db);
    const petal = await traitByKey(t.db, 'petal_length');
    const ref = await createReference(t.db);
    const manual = {
      speciesId: sp1.id,
      traitId: petal.id,
      primaryReferenceId: ref.id,
      origin: 'manual' as const,
      createdBy: user.id,
    };
    await createRecord(t.db, { ...manual, valueText: '5', numericValue: 5 });
    await createRecord(t.db, { ...manual, valueText: 'min=2;max=8', minValue: 2, maxValue: 8 });
    await createRecord(t.db, {
      ...manual,
      valueText: 'mean=4;sd=1;n=10',
      meanValue: 4,
      sdValue: 1,
      n: 10,
    });
    const summary = await speciesTraitSummary(t.db, UNRESTRICTED, sp1.id);
    const numeric = summary?.flatMap((c) => c.traits).find((x) => x.trait.id === petal.id)?.numeric;
    expect(numeric).toEqual({ min: 2, max: 8, mean: 4.5, count: 3 });
  });

  it('spec R-5 mean is null when no record has a single value or a mean', async () => {
    const { user } = await createUser(t.db);
    const sp1 = await createSpecies(t.db);
    const petal = await traitByKey(t.db, 'petal_length');
    const ref = await createReference(t.db);
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: petal.id,
      valueText: 'min=1;max=3',
      minValue: 1,
      maxValue: 3,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    const summary = await speciesTraitSummary(t.db, UNRESTRICTED, sp1.id);
    expect(summary?.flatMap((c) => c.traits).find((x) => x.trait.id === petal.id)?.numeric).toEqual(
      { min: 1, max: 3, mean: null, count: 1 },
    );
  });
```

- [ ] **Step 2: Run to see them fail**

`docker exec treerepro-13f sh -c 'cd /workspace && pnpm exec vitest run --project api:integration src/dataset/summary.integration.test.ts'` (after SYNC)
Expected: FAIL — `numeric` carries `median`, not `mean`; min/max ignore the new columns.

- [ ] **Step 3: Implement** — `apps/api/src/dataset/summary.ts`

In `TraitAggregate`, replace `numeric_median: number | null;` with `numeric_mean: number | null;`. In the aggregate SQL, replace the four numeric lines with:

```sql
        min(least(r.numeric_value, r.min_value, r.max_value, r.mean_value))::float8 as numeric_min,
        max(greatest(r.numeric_value, r.min_value, r.max_value, r.mean_value))::float8 as numeric_max,
        avg(coalesce(r.numeric_value, r.mean_value))::float8 as numeric_mean,
        count(*) filter (where coalesce(r.numeric_value, r.min_value, r.max_value, r.mean_value) is not null)::int as numeric_count
```

(`least`/`greatest` ignore nulls; `avg` skips them.) In `summaryOf`:

```ts
      numeric:
        quantitative &&
        row !== undefined &&
        row.numeric_count > 0 &&
        row.numeric_min !== null &&
        row.numeric_max !== null
          ? {
              min: row.numeric_min,
              max: row.numeric_max,
              mean: row.numeric_mean,
              count: row.numeric_count,
            }
          : null,
```

Add to the function's JSDoc: "The numeric spread follows spec R-5: the smallest and largest of single, min, max and mean, and the mean of each record's single value or, without one, its mean."

- [ ] **Step 4: Run to pass**

`docker exec treerepro-13f sh -c 'cd /workspace && pnpm exec vitest run --project api:integration src/dataset/summary.integration.test.ts src/http/routes/dataset/'` (after SYNC)
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/api/src/dataset/summary.ts apps/api/src/dataset/summary.integration.test.ts
git commit -m "feat(api): trait summary numeric over the six quantitative fields (spec R-5)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Import — the `ID` column, record codes, ID rejects; `record_references` in the reset

**Files:** `apps/api/src/dataset/import.ts`, `apps/api/src/dataset/reset.ts`, `apps/api/src/dataset/import.test.ts`, `apps/api/src/dataset/import.integration.test.ts`, `apps/api/src/dataset/reset.integration.test.ts`, `apps/api/test/fixtures/import/records-small.csv`.

**Interfaces:** Produces `IMPORT_COLUMNS` with `'ID'` first (16 columns); `RESET_TABLES` with `'record_references'`; the import writes `trait_records.record_code`. Consumes `IMPORT_REJECT_REASONS` (Task 2).

- [ ] **Step 1: Fixture** — rewrite `apps/api/test/fixtures/import/records-small.csv` so the header reads `ID,primary_reference,…,harmonised_value` and data line *k* (1-based, 27 lines) starts with `EB_<k>,`, all else unchanged. Run from the repo root:

```sh
f=apps/api/test/fixtures/import/records-small.csv
awk 'NR==1 { print "ID," $0; next } { print "EB_" (NR-1) "," $0 }' "$f" > "$f.new" && mv "$f.new" "$f"
head -3 "$f"
```

Expected: `ID,primary_reference,…`, `EB_1,Fix_2020_A,…`, `EB_2,Fix_2020_A,TRYX,…`.

- [ ] **Step 2: Write the failing tests**

`apps/api/src/dataset/import.test.ts`, append inside `describe('RFC-64 R2 header validation')`:

```ts
  it('spec R-2 the header starts with ID', () => {
    expect(IMPORT_COLUMNS[0]).toBe('ID');
    expect(IMPORT_COLUMNS).toHaveLength(16);
  });
```

`apps/api/src/dataset/import.integration.test.ts`:

- change `import { randomBytes } from 'node:crypto';` to `import { randomBytes, randomInt } from 'node:crypto';` and add below `FIXTURE`:

```ts
/** A record code no other test in the shared database uses. */
const freshId = () => `EB_${randomInt(100_000_000, 999_999_999)}`;
```

- in the fixture test: `expect(await recordAt(batch.id, 1)).toMatchObject({` gains `recordCode: 'EB_1',`; the two split expectations gain `recordCode: 'EB_4a',` (`split[0]`, `shrub`) and `recordCode: 'EB_4b',` (`split[1]`, `tree`); `expect(Object.keys(rejects[0]?.raw ?? {})).toHaveLength(15);` becomes `toHaveLength(16)`; the forced re-import expectation becomes the block below, because every stored ID now rejects its row (RFC-64 R7 as amended by 13a) — the 22 rows whose records exist, row 4 included although its records are `EB_4a`/`EB_4b`, while rows 7 and 22 (claim duplicates whose IDs were never stored) stay duplicates:

```ts
    const forced = await importRecords(t.db, { filePath: FIXTURE, force: true });
    expect(forced).toMatchObject({
      rowsTotal: 27,
      rowsInserted: 0,
      rowsDuplicate: 2,
      rowsRejected: 25,
      rowsPending: 0,
    });
    expect((await batchReport(t.db, forced.id)).rejectReasons).toMatchObject({
      duplicate_record_id: 22,
      no_species_name: 1,
      unknown_trait: 1,
      no_reference: 1,
    });
```
- in `'R6 collapses internal whitespace …'` the `IMPORT_COLUMNS.map` gains a first case `c === 'ID' ? freshId() :` before `c === 'primary_reference'`.
- in `'R9 an insert-time Postgres error …'` the row becomes `` `${header}\n${freshId()},${hugeRef},${hugeRef},Overflowia numerica,,,,,,,Plant height,plant_height,plant_form,1,quantitative_or_text,1\n` ``.
- in `'R9 a malformed row fails the batch …'` the row becomes `` `${header}\n${freshId()},Fix_X,Fix_X,Broken sp,Fixturia,Fixturaceae,,,,,t,flower_color,flower_color,x,categorical,x,EXTRA\n` `` (17 fields: still one too many).
- in `'R5 a whitespace-only wcvp_species …'` the array becomes `[freshId(), '', '', '"\t"', '', '', gbifName, '', '', '', '', '', '', '', '', '']`.
- append inside `describe('RFC-64 importRecords')`:

```ts
  it('R2, R7, R8 spec R-2: ID required, ^EB_[0-9]+$, not carried by an earlier row nor by a stored record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'import-id-'));
    const file = join(dir, 'ids.csv');
    const n = randomInt(100_000_000, 999_999_000);
    const name = `Fixturia identica-${randomBytes(4).toString('hex')}`;
    const line = (id: string, value: string) =>
      IMPORT_COLUMNS.map((c) =>
        c === 'ID'
          ? id
          : c === 'primary_reference'
            ? 'IDREF'
            : c === 'wcvp_species'
              ? name
              : c === 'final_standard_trait'
                ? 'petal_length'
                : c === 'trait_value_type'
                  ? 'quantitative_or_text'
                  : c === 'harmonised_value'
                    ? value
                    : '',
      ).join(',');
    const rows = [
      line('', '1'),
      line('EB_x', '2'),
      line('TR_5', '3'),
      line(`EB_${n}`, '4'),
      line(`EB_${n}`, '5'),
      line(`EB_${n + 1}`, '6'),
    ];
    await writeFile(file, `${IMPORT_COLUMNS.join(',')}\n${rows.join('\n')}\n`, 'utf8');

    const batch = await importRecords(t.db, { filePath: file });
    expect(batch).toMatchObject({ rowsTotal: 6, rowsInserted: 2, rowsRejected: 4, rowsDuplicate: 0 });
    const rejects = await t.db
      .select({ rowNo: importRejects.rowNo, reason: importRejects.reason, raw: importRejects.rawRow })
      .from(importRejects)
      .where(eq(importRejects.batchId, batch.id))
      .orderBy(asc(importRejects.rowNo));
    expect(rejects.map((r) => [r.rowNo, r.reason])).toEqual([
      [1, 'invalid_record_id'],
      [2, 'invalid_record_id'],
      [3, 'invalid_record_id'],
      [5, 'duplicate_record_id'],
    ]);
    expect(rejects[1]?.raw).toMatchObject({ ID: 'EB_x', harmonised_value: '2' });
    expect(await recordAt(batch.id, 4)).toMatchObject({ recordCode: `EB_${n}`, numericValue: 4 });
    expect(await recordAt(batch.id, 6)).toMatchObject({
      recordCode: `EB_${n + 1}`,
      numericValue: 6,
    });

    // A later file reusing a stored ID: rejected, never a second record.
    const again = join(dir, 'ids-again.csv');
    await writeFile(again, `${IMPORT_COLUMNS.join(',')}\n${line(`EB_${n + 1}`, '7')}\n`, 'utf8');
    const second = await importRecords(t.db, { filePath: again });
    expect(second).toMatchObject({ rowsTotal: 1, rowsInserted: 0, rowsDuplicate: 0, rowsRejected: 1 });
    expect((await batchReport(t.db, second.id)).rejectReasons.duplicate_record_id).toBe(1);
  });
```

`apps/api/src/dataset/reset.integration.test.ts`:

- add `import { recordReferences } from '../db/schema/records.ts';` (merge into the existing `traitRecords` import) and `import { sql } from 'drizzle-orm';` if absent;
- in `'an import that fails after the wipe …'` the `IMPORT_COLUMNS.map` gains a first case `c === 'ID' ? 'EB_1' :`;
- in `'clears what an earlier import loaded and keeps the trait dictionary'`, right after `expect(before.refs).toBeGreaterThan(0);`, add:

```ts
    // spec R-4: a record_references row is part of what the replace clears
    // (and TRUNCATE refuses to leave it behind a truncated trait_records).
    const [someRecord] = await t.db.select({ id: traitRecords.id }).from(traitRecords).limit(1);
    const [someRef] = await t.db
      .select({ id: bibliographicReferences.id })
      .from(bibliographicReferences)
      .where(sql`${bibliographicReferences.citationKey} = 'TRYX'`);
    await t.db
      .insert(recordReferences)
      .values({ recordId: someRecord?.id as string, referenceId: someRef?.id as string });
```

and after `expect(after.rejects).toBe(before.rejects);`:

```ts
    expect(await t.db.select().from(recordReferences)).toEqual([]);
```

- [ ] **Step 3: Run to see them fail**

`docker exec treerepro-13f sh -c 'cd /workspace && pnpm exec vitest run --project api:unit src/dataset/import.test.ts && pnpm exec vitest run --project api:integration src/dataset/import.integration.test.ts src/dataset/reset.integration.test.ts'` (after SYNC)
Expected: FAIL — `header_mismatch` on every fixture import; `IMPORT_COLUMNS[0]` is `primary_reference`; the replace fails with `cannot truncate a table referenced in a foreign key constraint`.

- [ ] **Step 4: Implement** — `apps/api/src/dataset/import.ts`

`IMPORT_COLUMNS`: JSDoc `/** The 16 columns of the compiled dataset, in file order; \`ID\` is the record code (spec R-2). @rfc RFC-64 R2 */` and `'ID',` as the first entry.

In `runImport`:

1. staging table: add `source_id text,` after `row_no bigserial primary key,`; COPY column list starts `source_id, primary_reference, …`.
2. the `alter table import_staging add column …` statement gains `add column record_code text, add column id_problem text,` (before `add column species_name text`).
3. the big `update import_staging set` gains, as its first assignment, `record_code = nullif(trim(source_id), ''),`.
4. right after that update (before `create index on import_staging (species_name)`):

```ts
      // R7 (spec R-2): an ID is missing or malformed, or already carried by an
      // earlier row of the file or by a stored record — its bare code, or the
      // first part `<ID>a` of a split row (RFC-63 R12). The reason ranks after
      // the older ones (the reject insert below).
      await tx`
        update import_staging set id_problem = 'invalid_record_id'
        where record_code is null or record_code !~ '^EB_[0-9]+$'`;
      await tx`
        update import_staging s set id_problem = 'duplicate_record_id'
        from (select record_code, min(row_no) as first_row from import_staging
              where id_problem is null group by record_code having count(*) > 1) d
        where s.record_code = d.record_code and s.row_no > d.first_row`;
      await tx`
        update import_staging s set id_problem = 'duplicate_record_id'
        where s.id_problem is null and exists (
          select 1 from trait_records r where r.record_code in (s.record_code, s.record_code || 'a'))`;
```

5. the reject insert: the reason becomes

```sql
          case when s.species_name is null then 'no_species_name'
               when t.id is null then 'unknown_trait'
               when s.primary_key is null and s.secondary_key is null then 'no_reference'
               else s.id_problem end,
```

   `jsonb_build_object(` gains `'ID', coalesce(s.source_id, ''),` as its first pair, and the `where` becomes

```sql
        where s.species_name is null or t.id is null
           or (s.primary_key is null and s.secondary_key is null)
           or s.id_problem is not null
```

6. the records statement: in `parts`, select `s.record_code,` and `cardinality(split.vals) as part_count, pv.part_no,` beside `pv.value_text`; the unnest line becomes `cross join lateral unnest(split.vals) with ordinality as pv(value_text, part_no)`; its `where` becomes `where s.id_problem is null and (s.primary_key is not null or s.secondary_key is not null)`. In `resolved`, add

```sql
            case when p.part_count > 1 then p.record_code || record_code_suffix(p.part_no) else p.record_code end as record_code,
```

   The insert column list gains `record_code` (after `species_id, trait_id, level_id, numeric_value, value_text, harmonisation,` add it at the end, after `import_row_no`), and the select list gains `record_code` in the same position (after `row_no`). `on conflict on constraint trait_records_claim_key do nothing` stays: a stored ID never reaches the insert (it was rejected above), so the unique `record_code` cannot collide.

   Add to the comment block above `parts`: "Each part's `record_code` is `<ID>` plus the letter of its position (`EB_1a`, `EB_1b`, …, `record_code_suffix` of migration 0035) when the row splits, `<ID>` otherwise (RFC-63 R12, RFC-64 R6)."

`apps/api/src/dataset/reset.ts` — add `'record_references',` to `RESET_TABLES` directly before `'trait_records',`, and in its JSDoc list: "`record_references` goes with `trait_records`, which it references."

- [ ] **Step 5: Run to pass**

`docker exec treerepro-13f sh -c 'cd /workspace && pnpm exec vitest run --project api:unit src/dataset/ && pnpm exec vitest run --project api:integration src/dataset/import.integration.test.ts src/dataset/reset.integration.test.ts'` (after SYNC)
Expected: PASS — the first fixture import is unchanged (27 total, 23 inserted, 2 duplicate, 3 rejected, 6 pending); the forced one rejects the 22 stored IDs.

- [ ] **Step 6: Commit**

```sh
git add apps/api/src/dataset/import.ts apps/api/src/dataset/reset.ts apps/api/src/dataset/import.test.ts apps/api/src/dataset/import.integration.test.ts apps/api/src/dataset/reset.integration.test.ts apps/api/test/fixtures/import/records-small.csv
git commit -m "feat(import): the ID column becomes record_code; missing, malformed, repeated and stored IDs are rejected (spec R-2)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Web and E2E follow the contracts

**Files:** `apps/web/src/test/dataset-fixtures.ts`, `apps/web/src/components/dataset/TraitCard.tsx`, `apps/web/src/components/dataset/TraitCard.test.tsx`, `apps/web/src/pages/dataset/ImportPage.tsx`, `apps/web/src/components/curation/AddEntriesDialog.tsx`, `apps/web/src/components/curation/AddEntriesDialog.test.tsx`, `apps/web/src/components/curation/ContestDialog.tsx`, `apps/e2e/tests/dashboard.spec.ts`.

**Interfaces:** Consumes the Task 2 contracts. Produces no new API. The six-field entry, the reference list on the record panel and the new help text are 13h/13j; this task only keeps the web compiling and truthful.

- [ ] **Step 1: Write the failing test** — `apps/web/src/components/dataset/TraitCard.test.tsx`: rename `'shows min · median · max with the unit …'` to `'shows min · mean · max with the unit for a quantitative trait, without pending or accepted lines'`, add `expect(within(card).getByText('min · mean · max')).toBeInTheDocument();` inside it, and add:

```ts
  it('spec R-5 shows a dash for the mean when no record has a single value or a mean', () => {
    render(
      <TraitCard
        summary={{ ...SEED_MASS_SUMMARY, numeric: { min: 2, max: 8, mean: null, count: 1 } }}
        onOpen={() => {}}
      />,
    );
    const card = screen.getByRole('button', { name: /seed mass/ });
    expect(within(card).getByText('2 · — · 8 mg')).toBeInTheDocument();
  });
```

`apps/web/src/components/curation/AddEntriesDialog.test.tsx`: the expectation `value: { numeric: 12.5 },` becomes `value: { quantitative: { single: 12.5 } },`.

- [ ] **Step 2: Run to see them fail**

`docker exec treerepro-13f sh -c 'cd /workspace && pnpm --filter @treerepro/web test -- TraitCard AddEntriesDialog'` (after SYNC)
Expected: FAIL — the card reads `min · median · max`; the dialog sends `{ numeric }`.

- [ ] **Step 3: Implement**

`apps/web/src/test/dataset-fixtures.ts`:
- `SEED_MASS_SUMMARY.numeric` → `{ min: 0.5, max: 3, mean: 1.25, count: 3 }` (the card still reads `0.5 · 1.25 · 3 mg`, which `SpeciesPage.test.tsx` asserts);
- `RECORD` gains `recordCode: 'EB_1',` after `id`, `quantitative: null,` after `numericValue`, `references: [PRIMARY_REFERENCE],` after `secondaryReference`;
- `PENDING_RECORD` gains `recordCode: 'TR_1',`, `quantitative: null,`, `references: [PRIMARY_REFERENCE],` in the same places.

`apps/web/src/components/dataset/TraitCard.tsx`: in the JSDoc, "min · median · max for a measurement" → "min · mean · max for a measurement (the mean a dash when no record has one)"; the label `min · median · max` → `min · mean · max`; the value line:

```tsx
              {`${formatNumber(numeric.min)} · ${numeric.mean === null ? '—' : formatNumber(numeric.mean)} · ${formatNumber(numeric.max)}${trait.unit ? ` ${trait.unit}` : ''}`}
```

`apps/web/src/pages/dataset/ImportPage.tsx`: `REASONS` gains `invalid_record_id: 'Missing or malformed ID',` and `duplicate_record_id: 'ID already used',`; `RAW_ROW_COLUMNS` gains `'ID',` as its first entry.

`apps/web/src/components/curation/AddEntriesDialog.tsx` and `ContestDialog.tsx`: the candidate's value line becomes

```ts
      value:
        valueType === 'quantitative' ? { quantitative: { single: Number(numeric) } } : { levelId },
```

(the local `'value.numeric'` message keys stay: they are UI-local; 13h replaces the field.)

`apps/e2e/tests/dashboard.spec.ts`: `value: { numeric: 12.5 },` → `value: { quantitative: { single: 12.5 } },` (checked against `recordValueSchema`; E2E runs in CI).

- [ ] **Step 4: Run to pass, then the whole typecheck**

```sh
# after SYNC
docker exec treerepro-13f sh -c 'cd /workspace && pnpm --filter @treerepro/web test && pnpm typecheck'
```

Expected: PASS. If `pnpm typecheck` names another `RecordItem` literal (any object with `respondsTo:` typed as `RecordItem`), add `recordCode: 'EB_1', quantitative: null, references: []` to it and re-run. Then `grep -rn "numeric: {" apps/web/src apps/e2e` must show only `MapDialog` (`mapPending`, unchanged) and trait-page distribution entries.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src apps/e2e/tests/dashboard.spec.ts
git commit -m "feat(web): trait card shows min · mean · max; ID reject reasons; quantitative request body (spec R-2, R-5)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The reimport runbook

**Files:** `docs/gotchas/import.md`.

**Interfaces:** Consumes the `--replace` import (RFC-64 R12), the backup service (`infra/docker/backup.sh`), the README production commands. Produces the operator procedure RFC-64 R12 points to (Task 1).

- [ ] **Step 1: Append this section to `docs/gotchas/import.md`**

````markdown
## Replacing the imported data with the ID-carrying file (spec 2026-09-25 §5)

**Symptom:** After migration 0035 every existing record has a `record_code` of `EB_LEGACY_<n>`, and the owner has the new source file whose first column is `ID`.

**Cause:** The `ID` column did not exist when the data was loaded; the migration only makes `record_code NOT NULL` possible. The owner decided to replace everything earlier imports loaded with the new file (RFC-64 R12). `--replace` is refused in production twice — by `isReplaceAllowed` and by the missing migrator secret in the `api` container — and this procedure is the one sanctioned exception (RFC-64 R12). It is safe only while nothing but imported data would be lost, so it stops unless manual records, annotations and `record_references` are all zero.

**Fix:** Run on the production host, from the checkout, with the new file at `/srv/imports/records.csv` (its first line must start `ID,primary_reference,`) and the supplementary files beside it.

1. **Back up** (a `pg_dump` by the read-only `treerepro_backup` role, `age`-encrypted into the `backups` volume):
   ```sh
   docker compose run --rm --no-deps --entrypoint /usr/local/bin/backup.sh backup
   ```
   It prints `backup written: /backups/treerepro-<stamp>.sql.age`. Restoring it is "Restoring a backup" in `docs/gotchas/infra.md`.
2. **Stop the API**, then deploy and migrate (a running `api` would keep writing through the old trigger functions — see "Stop `api` before applying migration 0022" in `docs/gotchas/postgres.md`; 0035 rewrites `trait_records` and takes minutes on the full dataset: let it finish):
   ```sh
   docker compose stop api
   git pull && docker compose build
   docker compose run --rm migrate
   ```
3. **Stop unless nothing but imported data exists:**
   ```sh
   docker compose exec -T postgres psql -U postgres -d treerepro -v ON_ERROR_STOP=1 -At -F ' ' -c \
     "select (select count(*) from trait_records where origin = 'manual'), (select count(*) from record_annotations), (select count(*) from record_references)"
   ```
   The answer must be `0 0 0`. Anything else: **do not continue** — bring the API back (`docker compose up -d api`) and take the numbers to the owner. Note, for step 6, what the replace will also empty:
   ```sh
   docker compose exec -T postgres psql -U postgres -d treerepro -At -F ' ' -c \
     "select (select count(*) from plots), (select count(*) from plot_species), (select count(*) from user_plots), (select count(*) from species_names where name_type <> 'gbif'), (select count(*) from species where not active)"
   ```
4. **Replace.** A one-off container of the `api` image, with the migrator secret mounted and `NODE_ENV` overridden for this run only (the CLI then connects as `treerepro_migrator`, which may disable the RFC-63 R4 append-only triggers inside the import's own transaction and restores them there):
   ```sh
   docker compose run --rm --no-deps \
     -e NODE_ENV=development \
     -v "$PWD/infra/secrets/db_migrator_password:/run/secrets/db_migrator_password:ro" \
     -v /srv/imports:/imports:ro \
     api node dist/cli/import-records.js --file /imports/records.csv --replace --run-by <owner e-mail>
   ```
   The report must read `Mode: replace` and `completed`. `invalid_record_id` and `duplicate_record_id` in `Rejections:` are rows of the file with a missing or malformed `ID`, or one an earlier row already used; they are listed on the batch page (`/app/imports/<batch id>` in the workspace) and are not loaded. A failure rolls everything back and the previous data stays.
5. **Check the triggers are back on** (`O` = enabled):
   ```sh
   docker compose exec -T postgres psql -U postgres -d treerepro -At -c \
     "select tgname, tgenabled from pg_trigger where tgname in ('trait_records_append_only', 'trait_records_no_truncate', 'record_annotations_append_only', 'record_annotations_no_truncate') order by 1"
   ```
6. **Reload what the replace emptied** (README commands, same files as the first load, in this order; the user-plots file is kept by the owner, never generated):
   ```sh
   docker compose run --rm --no-deps -v /srv/imports:/imports:ro api node dist/cli/import-species-status.js --file /imports/species-status.csv
   docker compose run --rm --no-deps -v /srv/imports:/imports:ro api node dist/cli/import-plots.js --file /imports/plots.csv
   docker compose run --rm --no-deps -v /srv/imports:/imports:ro api node dist/cli/import-plot-species.js --file /imports/plot-species.csv
   docker compose run --rm --no-deps -v /srv/imports:/imports:ro api node dist/cli/import-user-plots.js --file /imports/user-plots.csv
   docker compose run --rm --no-deps -v /srv/imports:/imports:ro api node dist/cli/import-synonyms.js --file /imports/synonyms.csv
   docker compose run --rm --no-deps -v /srv/imports:/imports:ro api node dist/cli/import-references.js --file /imports/references.csv
   ```
   Re-run the second query of step 3 and compare. Taxonomy proposals (`species_proposals`) are rebuilt by their own job.
7. **Verify:**
   ```sh
   docker compose exec -T postgres psql -U postgres -d treerepro -At -F ' ' -c \
     "select (select count(*) from import_batches where kind = 'records'), (select count(*) from trait_records), (select count(*) from trait_records where record_code like 'EB_LEGACY_%'), (select count(*) from trait_records where record_code !~ '^EB_[0-9]+([a-z]+)?\$'), (select coalesce(sum(primary_count), 0) from bibliographic_references) = (select count(*) from trait_records where primary_reference_id is not null)"
   ```
   Expected: `1 <N> 0 0 t`, where `<N>` equals `inserted` in step 4's `Rows:` line.
8. **Start the API:** `docker compose up -d api`, then `docker compose ps` shows it healthy.
````

- [ ] **Step 2: Check every command against its source** — `grep -n "import-records.js\|import-species-status.js\|import-plots.js\|import-plot-species.js\|import-user-plots.js\|import-synonyms.js\|import-references.js" README.md` shows the same script paths; `grep -n "ENTRYPOINT\|backup.sh" infra/docker/backup.Dockerfile` confirms `/usr/local/bin/backup.sh`; `grep -n "db_migrator_password\|DB_MIGRATOR_USER" compose.yml apps/api/src/config.ts` confirms the secret name and that `api` already has `DB_MIGRATOR_USER`.

- [ ] **Step 3: Commit**

```sh
git add docs/gotchas/import.md
git commit -m "docs(gotchas): runbook to replace the imported data with the ID-carrying file (spec §5)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Full verification, migration number, pull request

**Files:** none new (renumbering touches `apps/api/drizzle/*` only if needed).

- [ ] **Step 1: Sync with main and re-check the migration number**

```sh
git fetch origin && git rebase origin/main
ls apps/api/drizzle/*.sql | tail -4
```

If another `0035_*.sql` landed, renumber per memory `migration-number-only-safe-at-merge` (rename the `.sql` and snapshot, fix `_journal.json` `idx`/`tag`, re-chain `prevId`, copy the upstream migration's objects into this snapshot), then after SYNC confirm:
`docker exec treerepro-13f sh -c 'cd /workspace && pnpm --filter @treerepro/api db:generate --name check_only'` → `No schema changes, nothing to migrate`.
If 13e merged first, `RESET_TABLES` and the privileges loop lost `accepted_values`: keep their removal and this plan's `record_references` line. If 13d merged first, the conflict in `packages/contracts/src/curation.ts` is its sources block against this plan's import line and `recordValueSchema`: keep both.

- [ ] **Step 2: The whole pipeline on the rebased tree** (memory `parallel-plans-break-on-merge`)

```sh
# after SYNC
docker exec treerepro-13f sh -c 'cd /workspace && pnpm lint && pnpm typecheck && pnpm rfc:check && pnpm build && pnpm test'
```

Expected: all green. `pnpm lint` findings are fixed in the worktree (the container is a copy), then re-SYNC and re-run. A failure outside this plan's files: run the same suite on plain `origin/main` in a fresh container from `treerepro-verify:base` and compare before calling it pre-existing.

- [ ] **Step 3: Review, push, PR**

Run CodeRabbit locally on the branch (memory `coderabbit-local-before-pr`), address findings, then:

```sh
git -c http.version=HTTP/1.1 push -u origin feat/revision-13f-record-schema
gh pr create --title "feat: record codes, quantitative fields, several references per record, reimport runbook (plan 13f)" --body "$(cat <<'EOF'
Implements spec 2026-09-25 R-2, R-4, R-5 and the reimport runbook of §5 (plan 13f).

- `trait_records.record_code` (EB_ from the import's new `ID` column, TR_ from `record_code_tr_seq`), min/max/mean/sd/n with DB checks, `record_references` counted as usage.
- A form creates one record per value: first reference primary, the rest in `record_references`.
- Trait summary numeric is `{ min, max, mean, count }` (mean nullable).
- Migration 0035 gives existing rows `EB_LEGACY_<n>`; `docs/gotchas/import.md` has the production runbook (backup, zero-check, replacing import, reloads, verification).

Closes #<13f issue>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

After merge: `gh issue edit <13f issue> --remove-label in-progress`.

---

## Spec notes (ambiguities resolved minimally)

1. **Trait summary `mean` is nullable** (`number | null`): R-5's mean has no value when every record has only min/max. Task 1 amends §6 first, as §6 requires.
2. **Split entries get letter suffixes** (owner decision, spec R-2 and RFC-63 R12 as amended): `EB_4a`, `EB_4b` for a split import row, and `TR_7a`, `TR_7b` from `nextRecordCodes` for a multi-level form (13g). A single-part entry keeps its bare code. The file's `ID` must still match `^EB_[0-9]+$`. Stored codes match `^(EB|TR)_[0-9]+([a-z]+)?$`, but no database CHECK enforces that, because the migration's transitional `EB_LEGACY_<n>` codes would fail it. The runbook's verification query checks the pattern after the reimport. Within this plan, `createRecords` (still one record) and `mapPending` keep the column default. 13a's RFC-64 R7 text still says "the part before `-<n>`": the import checks a stored `<ID>` or `<ID>a`, and Task 1 fixes the wording if 13a has not.
3. **`ID` is the first column** of the header. The owner's file was not available. If its `ID` sits somewhere else, move `'ID'` in `IMPORT_COLUMNS` (and the fixture); the header check is exact.
4. **Reject reasons follow 13a's RFC-64 R7:** `invalid_record_id` (missing or not `^EB_[0-9]+$`) and `duplicate_record_id` (an ID carried by an earlier row of the file, or by a stored record as `<ID>` or `<ID>a`). The first row with an ID wins. Both reasons rank after `no_species_name`, `unknown_trait` and `no_reference`.
5. **A stored ID rejects the row** (13a). A forced re-import of the same file therefore reports `duplicate_record_id` rejects instead of duplicates: the fixture test changes from 24 duplicates to 22 rejects plus 2 duplicates. The claim-key `ON CONFLICT` is unchanged.
6. **The claim key does not change.** It still names only the primary reference, so a form that repeats a claim (same primary) gets a 409. `duplicates` is always `[]` until 13g turns a match into a validation. A manual quantitative `value_text` encodes all six fields, which lets the key separate claims that differ in any one of them.
7. **`record_references` counts in `primary_count` and `reference_traits`.** It gets its own trigger, so it never collides with 13g's edits to `trait_records_reference_usage()`. Nothing in the database stops an extra reference from equalling the record's primary or secondary reference; `resolveSources` de-duplicates the list.
8. **Extra references are listed by `citation_key`** because the table has no ordering column. Their `observer` is always null, since a personal observation can never be an extra reference.
9. **Reading a reference's records includes `record_references`.** `listRecords({ referenceId })` and `getReference().recordCount` both count them, so the detail agrees with the counters.
10. **Legacy codes come from a throw-away sequence during `ADD COLUMN`.** There is no `UPDATE`, so the append-only triggers never fire, and `TR_` starts at 1.
11. **Production replace means overriding RFC-64 R12's two gates:** `NODE_ENV=development` for one container, plus the migrator secret mounted into it. Task 1 writes this into R12 as the one sanctioned exception. **The owner must approve it.** The alternative is a fresh volume plus a restore, which is heavier.
12. **The replace also empties** plots, plot species, user plots, synonym and common names, species status and taxonomy proposals (the R12 closure). The runbook reloads them.
13. **Out of scope and unchanged:** the trait page distribution (`median`) and the per-species summary on `/traits/:id/species` still read `numeric_value` only. `mapPending` keeps `{ numeric }`. The contest same-value check compares only the single value (13g rewrites it). The web UI for the six fields and the reference list belongs to 13h.
14. **Contracts:** `numericValueSchema` and `NUMERIC_VALUE_LIMIT` move from `curation.ts` to `dataset.ts`. `recordSchema` needs `quantitativeValueSchema`, and `dataset.ts` importing `curation.ts` would create a cycle and hit a TDZ error when the module loads. `ReferenceSummary` is a type alias of `ReferenceRef`.

## Collisions and risks

- **`apps/api/src/dataset/summary.ts`:** §4 calls the two edits "different functions", but 13e's accepted part and this plan's numeric part are both inside `speciesTraitSummary`. The hunks are separate (the accepted query and field against the aggregate SQL and `numeric`), so any conflict shows a marker.
- **`apps/api/src/dataset/reset.ts`:** 13e removes `accepted_values` from `RESET_TABLES` and the trigger list; this plan adds `record_references`.
- **`packages/contracts/src/curation.ts`:** 13d edits the sources block, and this plan edits the import list, the removed number schema and `recordValueSchema`. The blocks are adjacent.
- **`apps/api/src/dataset/curation.ts` `createRecords`:** 13g builds duplicate → validation on this version, so it starts after 13f merges.
- **Migration numbering:** 13d, 13e and 13g all add migrations. Task 10 re-checks and renumbers.
- **Migration 0035 on the full dataset:** the table rewrite plus the new checks and the unique index take minutes. The runbook stops `api` first.
- **jsonb from a Drizzle `sql` field:** postgres.js parses `jsonb` by default and Drizzle only overrides date parsers. The Task 5 test proves the reference list comes back as objects.
