# Outlier flag (issue #281) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the import reads the 36-column file, whose last column is `outlier_flag`. Records keep the flag, the record table and drawer show it, the species search filters by it, and the export carries it.

**Architecture:** the same path as #256 (PR #261):
- RFC amendments first;
- one nullable column on `trait_records`, filled by the staging-table import;
- one field on the record item;
- one `exists` predicate in `speciesListConditions`;
- one column in `records.csv`;
- three small web changes.

**Tech Stack:** Hono, Drizzle and PostgreSQL 18, Zod 4, React 19 and TanStack Router, Vitest 5 with testcontainers.

**Spec:** `docs/specs/2026-10-19-outlier-flag.md` (D1–D9).

## Global Constraints

- The values are exactly `species_disagreement`, `trait_extreme` and `both`. The constant is `OUTLIER_FLAGS` in `packages/contracts/src/dataset.ts`.
- `outlier_flag` is the 36th and last column, after `records_behind_row`. The 35-column header is refused (`header_mismatch`).
- Every new export in `apps/*/src` and `packages/*/src` carries a JSDoc `@rfc RFC-NN Rx`.
- The order is RFC → failing test → code. No database mocks.
- Everything is in English. Run every command in Docker (no Node on the host): `docker compose run --rm --no-deps api …`, or the repo's test container per `docs/gotchas`.
- The migration number is checked against `origin/main` right before the PR. Today it is `0047`.

## Review Focus

- **A flag with stray whitespace** (`" both "`, `"trait_extreme\t"`) must be accepted, trimmed and collapsed like `summary_source`. Test: Task 2, row 2.
- **A flag on a categorical row that splits on `;`** goes onto every part. Test: Task 2, row 3.
- **A flagged record on an inactive trait or a withdrawn or invisible record** must not make `outliers=true` list the species for a viewer who cannot see it. Test: Task 3.
- **A case variant** (`Both`) is not one of the values and is rejected. The pipeline writes lowercase. Test: Task 2, row 5.
- **The 35-column file the owner still holds** is refused with `header_mismatch`, not half-loaded. Test: Task 2, unit test.

---

### Task 1: RFC amendments

**Files:**
- `docs/rfc/60-dataset/64-bulk-import.md`:
  - **R2:** add `outlier_flag` as the 36th column. "these 35 columns" becomes "these 36 columns", "(the owner's `TABLE_LAYOUT.md`, 2026-10-05)" becomes "(… 2026-10-05, plus `outlier_flag` of 2026-10-19)", and "Any other header — including the 35-column one of 2026-10-05, the 30-column one …".
  - **R6:** add `outlier_flag` to the provenance list that every record of the row stores.
  - **R7:** add "when `outlier_flag` is non-empty and not one of `species_disagreement`, `trait_extreme` or `both`" after the `summary_source` item.
  - Add a changelog line.
- `docs/rfc/60-dataset/63-trait-records.md`:
  - **R1:** the column `outlier_flag text null`, checked against the three values, null for manual records, outside `value_text` and the claim key, with the partial index on `species_id`.
  - **R8:** the item exposes `outlierFlag` (R1; null when absent).
  - Add a changelog line.
- `docs/rfc/60-dataset/60-taxonomy-catalog.md` R6: add `&outliers=` to the route, plus "`outliers=true`, open to every viewer, keeps only species with a visible record (RFC-33 R3) on a visible trait whose `outlier_flag` is not null." Add a changelog line.
- `docs/rfc/60-dataset/66-dataset-export.md` R2: `records.csv` gains `outlier_flag` after `records_behind_row`. Add a changelog line.
- `docs/rfc/10-platform/13-presentation-layer.md`, only if it lists the record badges or the Scope filters: add the **Outlier** badge and **Outliers only**.

- [ ] **Step 1:** Make the edits above. Changelog lines are dated `2026-10-19` and cite issue #281.
- [ ] **Step 2:** Commit: `docs(rfc): outlier_flag, the 36th import column (RFC-60 R6, RFC-63 R1 R8, RFC-64 R2 R6 R7, RFC-66 R2)`.

### Task 2: Contracts, migration, import

**Files:**
- Modify: `packages/contracts/src/dataset.ts`. Add `OUTLIER_FLAGS`, add `outlierFlag` to `recordSchema`, add `outliers` to `listSpeciesQuerySchema`.
- Modify: `packages/contracts/src/dataset.test.ts`, plus the record fixtures in `contributions.test.ts`, `curation.test.ts` and `dashboard.test.ts` (each gains `outlierFlag: null`).
- Modify: `apps/api/src/db/schema/records.ts`. Add the column, the check and the index.
- Create, generated: `apps/api/drizzle/0047_trait_record_outlier_flag.sql`, its snapshot and the journal entry.
- Modify: `apps/api/src/dataset/import.ts`. Change `IMPORT_COLUMNS`, the staging table, `COPY`, the normalisation, the check, the reject JSON, `parts`, `resolved` and the insert.
- Modify: `apps/api/test/fixtures/import/records-small.csv`. Add `,"outlier_flag"` to the header and a trailing `,` to every row.
- Modify: `apps/api/test/helpers/dataset.ts`. `createRecord` accepts `outlierFlag?: OutlierFlag`.
- Test: `apps/api/src/dataset/import.test.ts` and `apps/api/src/dataset/import.integration.test.ts`.

**Interfaces produced:** `OUTLIER_FLAGS`, `type OutlierFlag`, `recordSchema.outlierFlag`, `listSpeciesQuerySchema.outliers` (`'true' | 'false'`), and the Drizzle field `traitRecords.outlierFlag`.

- [ ] **Step 1: Contracts.**

```ts
/** The pipeline's outlier-audit reason, carried by an imported record. @rfc RFC-63 R1 */
export const OUTLIER_FLAGS = ['species_disagreement', 'trait_extreme', 'both'] as const;
/** A record's outlier flag. @rfc RFC-63 R1 */
export type OutlierFlag = (typeof OUTLIER_FLAGS)[number];
```

In `recordSchema`, after `unit`:

```ts
  /** The import's outlier-audit reason; null when the record was not flagged. @rfc RFC-63 R1, R8 */
  outlierFlag: z.enum(OUTLIER_FLAGS).nullable(),
```

In `listSpeciesQuerySchema`, after `unknownLevels`: `outliers: z.enum(['true', 'false']).optional(),`. Add `@rfc RFC-60 R6` to its JSDoc if it is missing.

Test, in `dataset.test.ts`. The record fixture already there gains `outlierFlag: null`:

```ts
it('RFC-63 R8 a record carries outlierFlag, one of three values or null', () => {
  expect(recordSchema.safeParse({ ...record, outlierFlag: 'both' }).success).toBe(true);
  expect(recordSchema.safeParse({ ...record, outlierFlag: 'Both' }).success).toBe(false);
  expect(recordSchema.safeParse({ ...record, outlierFlag: undefined }).success).toBe(false);
});
it('RFC-60 R6 the species query takes outliers', () => {
  expect(listSpeciesQuerySchema.parse({ outliers: 'true' }).outliers).toBe('true');
});
```

- [ ] **Step 2: Header unit test, failing.** In `import.test.ts`:
  - Change the R2 test to "the 36 columns …", with the expected string ending in `,records_behind_row,outlier_flag`.
  - Add a test that the 35-column header is refused:

```ts
it('R2 refuses the 35-column layout of 2026-10-05 (no outlier_flag)', () => {
  const old = IMPORT_COLUMNS.filter((c) => c !== 'outlier_flag').join(',');
  expect(old.split(',')).toHaveLength(35);
  expect(headerMatches(old)).toBe(false);
  expect(() => validateHeader(old)).toThrow(ImportRefusedError);
});
```

  - In the existing test, `noId` becomes length 35.

Run it and expect it to fail.

- [ ] **Step 3: Integration test, failing.** Add to `import.integration.test.ts`, inside `describe('RFC-64 R6 statistics')` so it can reuse `statLine`, `recordAt`, `recordsAt`, `rejectsOf` and `writeRecords`:

```ts
it('R6, R7 outlier_flag is stored on every record of the row and checked on every row (#281)', async () => {
  const tag = randomBytes(4).toString('hex');
  const n = randomInt(100_000_000, 999_999_000);
  let next = 0;
  const base = (cells: Partial<Record<Column, string>>) =>
    statLine({
      ID: `EB_${n + next++}`,
      primary_reference: 'OUTREF',
      wcvp_species: `Outlieria rara-${tag}`,
      wcvp_family: `Outlieriaceae${tag}`,
      final_standard_trait: 'seed_mass_dry',
      trait_value_type: 'quantitative',
      ...cells,
    });
  const lines = [
    base({ harmonised_value: '1', outlier_flag: 'species_disagreement' }),
    base({ harmonised_value: '2', outlier_flag: '  trait_extreme ' }),
    base({ final_standard_trait: 'flower_color', trait_value_type: 'categorical',
           harmonised_value: 'black;brown', outlier_flag: 'both' }),
    base({ harmonised_value: '3' }),
    base({ harmonised_value: '4', outlier_flag: 'Both' }),
    base({ final_standard_trait: 'flower_color', trait_value_type: 'categorical',
           harmonised_value: 'white', outlier_flag: 'weird' }),
  ];
  const batch = await importRecords(t.db, { filePath: await writeRecords('import-outlier-', lines) });
  expect(batch).toMatchObject({ status: 'completed', rowsTotal: 6, rowsRejected: 2 });
  expect(await recordAt(batch.id, 1)).toMatchObject({ outlierFlag: 'species_disagreement' });
  expect(await recordAt(batch.id, 2)).toMatchObject({ outlierFlag: 'trait_extreme', valueText: '2' });
  const parts = await recordsAt(batch.id, 3);
  expect(parts).toHaveLength(2);
  for (const part of parts) expect(part).toMatchObject({ outlierFlag: 'both' });
  expect(await recordAt(batch.id, 4)).toMatchObject({ outlierFlag: null });
  const rejects = await rejectsOf(batch.id);
  expect(rejects.map((r) => [r.rowNo, r.reason])).toEqual([
    [5, 'invalid_measurement'],
    [6, 'invalid_measurement'],
  ]);
  expect(rejects[0]?.raw).toMatchObject({ outlier_flag: 'Both' });
});
```

Run `import.integration.test.ts -t outlier` and expect it to fail: `outlierFlag` is undefined and the header is refused.

- [ ] **Step 4: Schema and migration.** In `records.ts`, after `recordsBehindRow`:

```ts
    /** The pipeline's outlier-audit reason (RFC-63 R1); null when not flagged. */
    outlierFlag: text('outlier_flag', { enum: OUTLIER_FLAGS }),
```

Then the check, after `trait_records_records_behind_row_check`:

```ts
    /** RFC-63 R1: outlier_flag takes only the three audit reasons. */
    check(
      'trait_records_outlier_flag_check',
      sql`${t.outlierFlag} is null or ${t.outlierFlag} in ('species_disagreement', 'trait_extreme', 'both')`,
    ),
```

And the index, beside the table's other indexes:

```ts
    /** RFC-60 R6: the `outliers` species filter reads only flagged rows. */
    index('trait_records_outlier_species_idx').on(t.speciesId).where(sql`${t.outlierFlag} is not null`),
```

Run `pnpm --filter @treerepro/api db:generate` and rename the generated file to `0047_trait_record_outlier_flag.sql`, together with its journal tag. Then in `apps/api/test/helpers/dataset.ts`, add `outlierFlag?: OutlierFlag` to the input type and `outlierFlag: input.outlierFlag ?? null` to the insert.

- [ ] **Step 5: Import.** In `import.ts`:
  - Append `'outlier_flag'` to `IMPORT_COLUMNS`, and update its JSDoc to "35 columns of … plus `outlier_flag` (issue #281)".
  - Staging DDL: `…, records_behind_row text, outlier_flag text`. Do the same in the `COPY` column list.
  - `alter table`: add `add column outlier_text text`. Normalise with `outlier_text = ${collapsed('outlier_flag')}`.
  - In the `bad_measurement` predicate, after the `summary_text` item:
    ```sql
    or (s.outlier_text is not null and s.outlier_text not in
      ('species_disagreement', 'trait_extreme', 'both'))
    ```
  - Reject JSON: `'outlier_flag', coalesce(s.outlier_flag, '')`.
  - Add `s.outlier_text` to `parts`' select list and `p.outlier_text` to `resolved`'s.
  - Insert column list: `…, records_behind_row, outlier_flag)`. Select list: `…, behind_int, outlier_text`.
  - `records-small.csv`: add `,"outlier_flag"` to the header and `,` to each data line.
  - Grep for any other 35-column fixture: `grep -rln records_behind_row apps/*/test apps/e2e`.

- [ ] **Step 6:** Run `import.test.ts`, `import.integration.test.ts`, `dataset.integration.test.ts` and the contracts tests. Expect them to pass.
- [ ] **Step 7:** Commit: `feat(import): outlier_flag, the 36th column, kept on every record (RFC-64 R2 R6 R7, RFC-63 R1)`.

### Task 3: Record item and species filter

**Files:**
- Modify: `apps/api/src/dataset/records.ts`. Add `outlierFlag: rec.outlierFlag ?? null,` after `unit` in the item mapper (around line 267).
- Modify: `apps/api/src/dataset/taxa.ts`. Add `outliers?: boolean` to `SpeciesListFilters`, the predicate, and a JSDoc sentence.
- Modify: `apps/api/src/http/routes/dataset/species.ts:54`. Add `outliers: q.outliers === 'true',`.
- Test: `apps/api/src/dataset/records.integration.test.ts` and `apps/api/src/dataset/taxa.integration.test.ts`.

- [ ] **Step 1: Failing tests.** In `records.integration.test.ts`, extend the test that already asserts `unit` on the item: a record created with `outlierFlag: 'trait_extreme'` lists with `outlierFlag: 'trait_extreme'`, and one created without it lists with `null`.

In `taxa.integration.test.ts`, add:

```ts
it('RFC-60 R6 outliers keeps species with a visible flagged record, for every viewer (#281)', async () => {
  const k = tag();
  const q = `Outlierum-${k}`;
  const ref = await createReference(t.db);
  const trait = await createTrait(t.db, { valueType: 'quantitative' });
  const hidden = await createTrait(t.db, { valueType: 'quantitative', active: false });
  const flagged = await createSpecies(t.db, { canonicalName: `${q} flagged` });
  const onHidden = await createSpecies(t.db, { canonicalName: `${q} hidden` });
  const plain = await createSpecies(t.db, { canonicalName: `${q} plain` });
  const batch = await createImportBatch(t.db);
  const rec = (speciesId: string, traitId: string, outlierFlag?: 'both') =>
    createRecord(t.db, { speciesId, traitId, valueText: '1', numericValue: 1,
      primaryReferenceId: ref.id, importBatchId: batch.id, outlierFlag });
  await rec(flagged.id, trait.id, 'both');
  await rec(onHidden.id, hidden.id, 'both');
  await rec(plain.id, trait.id);
  const names = async (v: Visibility, f: object) =>
    (await searchSpecies(t.db, v, { q, limit: 50, ...f })).data.map((s) => s.canonicalName).sort();
  expect(await names(RESTRICTED, { outliers: true })).toEqual([`${q} flagged`]);
  expect(await names(RESTRICTED, { outliers: false })).toHaveLength(3);
});
```

Before relying on them, check that `createTrait`'s option names (`valueType`, `active`) and the `RESTRICTED` constant exist in the helpers or the file; adapt to what is there. Run both tests and expect them to fail.

- [ ] **Step 2: Implement.** In `taxa.ts`, after the `unknownLevels` block:

```ts
  // RFC-60 R6: outliers is open to every viewer; it counts only visible
  // flagged records on visible traits, so a viewer never learns of a flag on
  // data they cannot see.
  if (filters.outliers) {
    conditions.push(
      sql`exists (select 1 from ${traitRecords} otr join ${traits} ott on ott.id = otr.trait_id
        where otr.species_id = ${species.id} and otr.outlier_flag is not null
          and ${traitVisible(visibility, sql`ott.active`)}
          and ${recordVisible(visibility, sql`otr.id`, sql`otr.harmonisation`)})`,
    );
  }
```

- [ ] **Step 3:** Run the tests and expect them to pass. Also run `pnpm rfc:check` and the route meta-tests (`*meta*.test.ts`).
- [ ] **Step 4:** Commit: `feat(dataset): outlierFlag on the record item; species filter outliers=true (RFC-63 R8, RFC-60 R6)`.

### Task 4: Export

**Files:** `apps/api/src/dataset/export.ts`, `export.test.ts` and `export.integration.test.ts`.

- [ ] **Step 1: Failing test.**
  - In `export.test.ts`, the expected header gains `outlier_flag` after `records_behind_row`.
  - In `export.integration.test.ts`, extend the test that asserts `records_behind_row`: a record created with `outlierFlag: 'species_disagreement'` exports that value, and an unflagged one exports an empty cell.
- [ ] **Step 2: Implement.**
  - Add `'outlier_flag'` after `'records_behind_row'` in the column list (line 54).
  - Add `outlier_flag: string | null;` to the row type.
  - Add `r.outlier_flag` to the select after `r.records_behind_row` (line 287) and to the row writer (line 339).
  - Update the JSDoc at line 258.
- [ ] **Step 3:** Run the tests and expect them to pass. Commit: `feat(export): records.csv carries outlier_flag (RFC-66 R2)`.

### Task 5: Web

**Files:**
- `apps/web/src/components/dataset/RecordTable.tsx` (and its test): the badge.
- `apps/web/src/components/dataset/RecordDrawer.tsx` (and its test): the row.
- `apps/web/src/components/dataset/SpeciesSearchForm.tsx` (and its test): the checkbox.
- `apps/web/src/pages/dataset/SpeciesSearchPage.tsx`, `apps/web/src/api/dataset.ts` and `apps/web/src/routes/app/species/index.tsx`: the search param.
- `apps/web/src/pages/dataset/ImportPage.tsx` (and its test): the column list gains `'outlier_flag'`.
- `apps/web/src/test/dataset-fixtures.ts`: every record fixture gains `outlierFlag: null`.

- [ ] **Step 1: Failing tests.**
  - `RecordTable.test.tsx`: a record with `outlierFlag: 'trait_extreme'` shows an `Outlier` badge with `title="Extreme for this trait"`, and a record with `null` shows none.
  - `RecordDrawer.test.tsx`: the detail with `outlierFlag: 'both'` lists `Outlier` → "Disagrees with this species' other values and extreme for this trait".
  - `SpeciesSearchForm.test.tsx`: clicking **Outliers only** calls `onChange` with `outliers: true`.
- [ ] **Step 2: Implement.** In `RecordTable.tsx`:

```ts
/** What each outlier-audit reason means, worded for a viewer. @rfc RFC-63 R8 */
export const OUTLIER_LABELS: Record<OutlierFlag, string> = {
  species_disagreement: "Disagrees with this species' other values",
  trait_extreme: 'Extreme for this trait',
  both: "Disagrees with this species' other values and extreme for this trait",
};
```

Next to the unit-caveat badge (line 165), add:

```tsx
{record.outlierFlag ? (
  <span title={OUTLIER_LABELS[record.outlierFlag]}>
    <Badge tone="amber">Outlier</Badge>
  </span>
) : null}
```

In `RecordDrawer.tsx`, add a row `{ label: 'Outlier', value: record.outlierFlag ? OUTLIER_LABELS[record.outlierFlag] : DASH }` to the definitions that list the provenance. Read the component to place it after `recordsBehindRow`. `outlierFlag` is an item field, so map it explicitly rather than through `PROVENANCE_FIELDS`.

For the search:
- `SpeciesSearchValue` gains `outliers?: boolean`. It is optional, so the existing test fixtures stay valid.
- After **Contested only**, add the checkbox labelled `Outliers only`, with `checked={value.outliers === true}` and `onChange` setting `outliers: event.target.checked`.
- `SpeciesSearchPage.tsx`:
  - `toValue`: `outliers: search.outliers === true`;
  - `toSearch`: `outliers: value.outliers ? true : undefined`;
  - `searchKey`: add `value.outliers`;
  - the query call: `outliers: form.outliers`;
  - the `SpeciesSearch` type: `outliers?: boolean`.
- Mirror the `unknownLevels` handling in the route's search validation (`routes/app/species/index.tsx`) and in `searchSpecies` (`outliers?: boolean`).
- [ ] **Step 3:** Run the web suite, `pnpm --filter @treerepro/web test`, and expect it to pass. Run `grep -rn "Contested only\|Has unknown levels\|records_behind_row" apps/e2e`; if any spec asserts the full filter list or the import header, update it.
- [ ] **Step 4:** Commit: `feat(web): Outlier badge and drawer row; Outliers only species filter (RFC-63 R8, RFC-60 R6)`.

### Task 6: API guide, runbook, handbook

**Files:** `docs/api/guide.md`, `docs/gotchas/import.md` and `CLAUDE.md`.

- [ ] **Step 1:** In `docs/api/guide.md`:
  - Document `outlierFlag` on the record item, `outliers` on `GET /api/species`, and the `records.csv` column.
  - Run `pnpm test`; the openapi hash test prints the new sha256.
  - Write it on the `openapi-sha256` line and add a changelog entry dated 2026-10-19 ending with `(openapi <first 12 hex>)`.
- [ ] **Step 2:** In `docs/gotchas/import.md`, add a short note. The 36-column file is required from #281. Existing `EB_` records are skipped by an incremental import, so they get their flags only through `--replace-imported`, or through `--replace --discard-platform` while the platform is in its test phase.
- [ ] **Step 3:** In `CLAUDE.md`, the Layout sentence about the Scope group gains **Outliers only**: "…the Scope group also offers **Contested only** and **Outliers only** for every viewer and…".
- [ ] **Step 4:** Commit: `docs: outlier_flag in the API guide, the import runbook and the handbook`.

### Task 7: Verify and ship

- [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm rfc:check` in Docker, and confirm the output.
- [ ] Rebase on `origin/main` and re-check the migration number.
- [ ] Run CodeRabbit locally (`--base-commit origin/main`).
- [ ] Open the PR with `Closes #281`.
- [ ] Once checks are green, merge. Then remove `in-progress` from #281 and write its Outcome section.
