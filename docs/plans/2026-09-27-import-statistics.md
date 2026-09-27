# Import statistics — what each row is (issue #223) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `import:records` reads the owner's 28-column `sample_data.csv`. Each row is one **observation**, whose value is labelled by `statistic` and carries its range, spread, sample size, unit status and provenance. Summaries never treat a spread or a bound as a measurement, and the new fields reach the record API, the UI and the export.

**Architecture:** One migration (`0043`) adds nullable columns:
- on `trait_records`: `statistic`, `se_value`, `unit_status`, `source_folder`, `source_file`, `taxonomic_status`, `folded_record_codes`;
- on `families`: `order_name`;

and one new reject reason. The import's staging table grows by 12 columns. The existing resolution and insert CTEs fill the new fields and the existing `min_value` / `max_value` / `sd_value` / `n`. `relinkImported` gains one fallback pass keyed on `folded_record_codes`. Summaries gain a filter on `unit_status`. Contracts, the record API, the web table and drawer, and the export show the new fields.

**Tech Stack:** unchanged: TypeScript 7, postgres.js + Drizzle, Zod 4, React 19, Vitest 5 + testcontainers. No new dependency.

**Spec:** issue #223. Its body is the design, and the decisions are in its comments. The owner's layout is `TABLE_LAYOUT.md` in the owner's private export folder. The rules this plan relies on are copied into **Design** below, so the file is not needed.

## Design (settled with the owner, 2026-09-27)

- **D1 Header** (RFC-64 R2). The file has exactly these 28 columns, in this order:
  `ID,primary_reference,secondary_reference,wcvp_species,wcvp_genus,wcvp_family,gbif_species,gbif_usage_key,original_species_name,secondary_source_species_name,original_trait_name,final_standard_trait,broad_category,original_value_clean,trait_value_type,harmonised_value,statistic,sample_size,source_folder,file_name,wcvp_taxonomic_status,taxon_order,unit_harmonisation_status,min,max,sd,se,statistic_record_codes`.
  `ID` comes first, and there is no unnamed R row-number column any more. The old 17-column header is refused (`header_mismatch`), and so is a file with no `ID` column: that is a mid-rebuild snapshot, never a release.
- **D2 Value.** `harmonised_value` → `numeric_value`, the single-value field, as today. It may be empty: a row with one unpaired bound has no value. The import never fills or changes a value, and never converts se to sd.
- **D3 `statistic`** labels the value: `single_or_unspecified`, `mean`, `median` or `derived_midpoint`, where a derived midpoint is (min + max) / 2 computed upstream. It is stored in `trait_records.statistic` (null when empty) for quantitative records only. It never takes `min`, `max`, `sd`, `se` or `n`.
- **D4 Statistic columns** (quantitative trait only):
  - `min` → `min_value`, `max` → `max_value`, `sd` → `sd_value`, `se` → `se_value` (new), `sample_size` → `n`.
  - On a categorical row these columns are ignored and never stored.
  - The import never fills `mean_value`; a mean is `numeric_value` with `statistic = 'mean'`.
- **D5 `value_text`** of an imported quantitative record:
  - When `numeric_value` is the only value field present: the normalised `harmonised_value` text, unchanged from today, so existing claims keep their identity.
  - Otherwise: `concat_ws(';', …)` of the present fields as `<name>=<value>`, in the order `single, min, max, mean, sd, se, n`, each value printed as PostgreSQL prints `numeric` (`n` as an integer). This is RFC-63 R15's format with `se` inserted after `sd`.
  - Example: `single=9.3;min=6.2;max=18.8`.
- **D6 Rejects** use a new reason, `invalid_measurement` (RFC-64 R7). It is the **last** reason in R7's order, so every existing reason wins, and it is checked only on rows whose trait is known. A row is rejected when any of these holds:
  1. `statistic` is non-empty and not one of D3's four values. That includes the old meanings `min`/`max`/`sd`/`se`/`n`.
  2. On a quantitative trait, one of `min`, `max`, `sd` or `se` is non-empty and fails the number rule of RFC-64 R6 (pattern, 64 characters, magnitude below 1e308).
  3. On a quantitative trait, `sd` or `se` is negative.
  4. On a quantitative trait, `min > max`.
  5. On a quantitative trait, `sample_size` is non-empty and not `^[0-9]{1,10}$` with a value from 1 to 2147483647.
  6. On a quantitative trait, `harmonised_value` is non-empty and not a number while `min`, `max`, `sd`, `se` or `sample_size` is non-empty.
  7. On a quantitative trait, `sd`, `se` or `sample_size` is present and `harmonised_value`, `min` and `max` are all empty (a spread with nothing to spread around).
  8. `unit_harmonisation_status` is non-empty and not one of `converted_or_already_target`, `unit_missing`, `needs_unit_check`, `not_applicable`.
  9. A `;`-part of `statistic_record_codes`, trimmed and non-empty, does not match `^EB_[0-9]+$`.

  All values are trimmed, with whitespace collapsed, before any check. Without these rejects, a bad row would abort the whole transaction on a database CHECK.
- **D7 Harmonisation.** A quantitative row is `harmonised` when `numeric_value`, `min_value` or `max_value` is present. It is `empty` when the value and every D4 column are empty, and `not_numeric` as today otherwise. The existing CHECKs (`harmonised_check`, `value_requires_harmonised_check`) stay valid thanks to D6 items 6 and 7.
- **D8 Provenance**, stored on every record of the row, split categorical parts included:
  - `unit_harmonisation_status` → `unit_status` (null when empty)
  - `source_folder` → `source_folder`
  - `file_name` → `source_file`
  - `wcvp_taxonomic_status` → `taxonomic_status` (free text: exact match, resolved synonym, fuzzy match…)
  - `statistic_record_codes` → `folded_record_codes text[]`: trimmed non-empty parts in file order, null when there are none.
- **D9 Taxonomy order** (RFC-60 R1). `families.order_name text null`, normalised per RFC-60 R2. The import fills `order_name` for families whose `order_name` is null, from the first non-empty `taxon_order` in `row_no` order among the rows naming that family. This fill of a null field is the one exception to RFC-64 R5's "existing rows are never changed". The species detail's family shows it, and the export gains an `order` column.
- **D10 Summaries** (RFC-63 R10; RFC-62 R7, R8 trait page).
  - Records with `unit_status = 'needs_unit_check'` are left out of every numeric min, max, mean, median and count.
  - `unit_missing` counts, because the standard unit is assumed.
  - sd and se never enter a summary: `sd_value` is already excluded, and so is `se_value`.
  - The mean stays `avg(coalesce(numeric_value, mean_value))`, so single, mean, median and derived midpoint count alike.
  - min and max stay `least`/`greatest` over `numeric_value, min_value, max_value, mean_value`. The bounds are values of the trait, never averaged.
  - Record counts, coverage and harmonisation counts are unchanged.
- **D11 Folded-code fallback** (RFC-64 R15 step 4). After the re-link by `record_code`, every annotation, response and harmonisation still unlinked whose target code appears in some new imported record's `folded_record_codes` is re-linked to that record. When several records list the code, the one with the smallest `record_code` in `(length, text)` order wins.
  - A response or harmonisation must still be of the same species and trait (RFC-63 R2).
  - An annotation that would break a unique index (e.g. a second `withdraw` on the surviving record) is not re-inserted and stays `orphan`.
- **D12 Display.**
  - Record item: `statistic` and `unitStatus`, plus `quantitative.se`.
  - Record detail: `sourceFolder`, `sourceFile`, `taxonomicStatus` and `foldedRecordCodes`.
  - `RecordTable` shows the statistic label next to the value, e.g. `9.3 (mean) · 6.2–18.8 · SD 0.5 · SE 0.1 · n 30`. It marks `needs_unit_check` as "unit not checked" and `unit_missing` as "unit assumed".
  - `RecordDrawer` shows every quantitative field, the statistic, the unit status, the provenance and the folded codes.
- **D13 Export** (RFC-66 R2) `records.csv`:
  - `order` is inserted before `family`.
  - `value_se` is inserted after `value_sd`.
  - `statistic` and `unit_status` are inserted after `value_n`.
  - `source_folder`, `source_file`, `taxonomic_status` and `folded_record_codes` are appended before `created_at`. `folded_record_codes` is joined by `; `, and is empty when null.
- **D14 Seed** (RFC-62 R2). `seed:traits` skips rows whose trimmed `broad_category` is `taxonomy`, `reference` or `record`. These describe columns of the data file, not traits.
- **D15 Manual entry is unchanged.** It never takes `se` or `statistic`, and `quantitativeValueSchema` (the input) does not gain `se`. The output shape gets a separate schema that adds `se`.

Out of scope:
- the crosswalk re-link (#224);
- de-duplication (done upstream);
- a taxonomy filter by order;
- the real reload, which waits for the owner's first 28-column release.

## Global Constraints

- CLAUDE.md non-negotiables:
  - RFC first: Task 1 comes before any code.
  - TDD: failing test → run → code → run.
  - No database mocks.
  - Every exported symbol in `apps/*/src` and `packages/*/src` has `@rfc RFC-NN Rn`.
  - English everywhere.
  - Rule 10: any change to a route's shape updates `apps/api/src/http/route-catalog.ts`, `docs/api/guide.md` and its changelog in the same PR, and the guide's `openapi-sha256` line changes only together with a changelog entry ending `(openapi <12 hex>)`.
- Worktree `/Users/elisabarreto/Library/CloudStorage/OneDrive-Personal/Documentos/Academia/PostDoc/TREE_CHANGE/TreeRepro-223`, branch `feat/223-import-statistics`. Commit there, never in the main checkout.
- One commit per task, and every commit message ends with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Ignore any other attribution reminder.
- Never await a Drizzle builder twice. Integration tests assert only on their own fixtures. Tests that run a replace own a database, as `replace-imported.integration.test.ts` does.
- Migration number `0043`. It is re-checked against `origin/main` at push time and renumbered, with the snapshot's `prevId` re-chained, if taken.

### Verification (no Node on this Mac: everything runs in the Docker container `treerepro-223`)

**Sync** before every run, from the worktree root:

```sh
docker exec treerepro-223 sh -c 'cd /workspace && find . -name node_modules -prune -o -type f -exec rm -f {} +' \
&& COPYFILE_DISABLE=1 tar -cf - --exclude='./node_modules' --exclude='*/node_modules' --exclude='./.git' \
    --exclude='./data' --exclude='./.claude' --exclude='*/dist' \
    --exclude='.DS_Store' --exclude='._*' --exclude='*/._*' . \
  | docker exec -i treerepro-223 tar -x -C /workspace \
&& docker exec treerepro-223 sh -c 'cd /workspace && pnpm --filter @treerepro/contracts build'
```

Commands (after Sync; `<file>` relative to `apps/api` or `apps/web`):

- api integration: `docker exec treerepro-223 sh -c 'cd /workspace && pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration <file>'`
- api unit: same with `--project api:unit`
- web: `docker exec treerepro-223 sh -c 'cd /workspace && pnpm --filter @treerepro/web exec vitest run --config ../../vitest.config.ts --project web --maxWorkers=3 --testTimeout=30000 <file>'`
- typecheck: `docker exec treerepro-223 sh -c 'cd /workspace && pnpm typecheck'`
- rfc: `docker exec treerepro-223 sh -c 'cd /workspace && pnpm rfc:check'` (last line `rfc-lint: ok`)
- lint: `docker exec treerepro-223 sh -c 'cd /workspace && pnpm lint'`. Fix findings in the worktree; the container is a copy.
- migration generation runs **in the container**: `docker exec treerepro-223 sh -c 'cd /workspace && pnpm --filter @treerepro/api db:generate --name import_statistics'`. Then `docker cp` the new `apps/api/drizzle/0043_*.sql`, `meta/0043_snapshot.json` and `meta/_journal.json` back into the worktree. Check that `find apps/api/drizzle -name '._*'` in the container returns nothing first.

## Review Focus

1. **An old 17-column file, or a 23-column one.** Expected: refused before any batch row with `header_mismatch`, never imported half-read. Test in Task 3.
2. **A value with only one bound** (`harmonised_value` empty, `min` = 4). Expected: one harmonised record with `numeric_value` null, `min_value` 4 and `value_text` `min=4`. It counts in the species min and max, and not in the mean. Tests in Task 3 and Task 5.
3. **`min > max`, or a comma decimal in `sd`.** Expected: that row is rejected as `invalid_measurement` with its raw row kept, and the rest of the file imports. The transaction must not abort. Test in Task 3.
4. **An annotation on a folded code** (`EB_12` folded into `EB_10`) across a preserving replace. Expected: re-linked to `EB_10`, and the sheet says `relinked`. Test in Task 4.
5. **`needs_unit_check` on the only record of a trait.** Expected: `numeric` is null (no harmonised record left to summarise) while `recordCount` still counts it. Test in Task 5.

---

## File Structure

```
docs/rfc/60-dataset/60-taxonomy-catalog.md     # R1 families.order_name; R2 applies
docs/rfc/60-dataset/62-trait-dictionary.md     # R2 non-trait categories skipped; R7/R8 unit filter
docs/rfc/60-dataset/63-trait-records.md        # R1 columns; R8 item/detail fields; R10 summary; R15 statistic, se, value_text
docs/rfc/60-dataset/64-bulk-import.md          # R2 header; R5 order fill; R6 statistic columns; R7 invalid_measurement; R15 fallback
docs/rfc/60-dataset/66-dataset-export.md       # R2 columns
apps/api/drizzle/0043_import_statistics.sql (+ meta)   # migration
apps/api/src/db/schema/records.ts, taxa.ts, (imports schema for reject reasons)
packages/contracts/src/dataset.ts              # STATISTICS, UNIT_STATUSES, record + detail fields, family.order
apps/api/src/dataset/import.ts                 # header, staging, rejects, fill, value_text, order fill, raw_row
apps/api/src/cli/prepare-imports.ts            # uses the new header
apps/api/test/fixtures/import/records-small.csv
apps/api/src/dataset/*.integration.test.ts     # fixtures moved to the 28-column header
apps/api/src/dataset/replace-imported.ts       # folded-code fallback
apps/api/src/dataset/summary.ts, trait-page.ts # unit filter
apps/api/src/dataset/records.ts                # item/detail fields
apps/api/src/dataset/export.ts                 # columns
apps/api/src/dataset/seed.ts                   # category filter
apps/api/src/http/route-catalog.ts, docs/api/guide.md
apps/web/src/components/dataset/RecordTable.tsx, RecordDrawer.tsx, species header (family order)
apps/web/src/pages/dataset/ImportPage.tsx (+ test), apps/web/src/test/dataset-fixtures.ts
docs/gotchas/import.md                         # the 28-column file, statistic meaning
```

---

### Task 1: RFC amendments

**Files:** the five RFCs above, and `docs/rfc/README.md` if a status changes. Every changelog line is dated 2026-09-27 and ends `(issue #223)`.

- [ ] **Step 1:** RFC-64:
  - R2 lists the D1 header. Say that the first line must equal it exactly and that a file without `ID` is not a release.
  - R5 gains the D9 fill-only exception for `families.order_name`.
  - R6 replaces "A quantitative value fills only the single value" with D2–D5 and D7, and cites RFC-63 R15.
  - R7 appends `invalid_measurement` to the reason list, and to the order, with D6's nine conditions.
  - The staging description in R4 is unchanged.
  - R15 step 4 gains D11.
- [ ] **Step 2:** RFC-63:
  - R1 adds `statistic`, `se_value`, `unit_status`, `source_folder`, `source_file`, `taxonomic_status` and `folded_record_codes` to the column list.
  - R15 adds `statistic` (the four values, nullable, quantitative only), `se_value` (nullable `numeric`, CHECK `>= 0`), and the D5 `value_text` order with `se`. Manual entry never sets `se_value` or `statistic`.
  - R10 applies D10.
  - R8's item gains `statistic`, `unitStatus` and `quantitative.se`, and the detail gains `sourceFolder`, `sourceFile`, `taxonomicStatus` and `foldedRecordCodes` (D12).
  - A new sentence in R15 states the owner's two rules: sd and se are spreads, never summarised as values; min and max are the bounds of one observation.
- [ ] **Step 3:** RFC-60 R1 adds `order_name text null` to `families`, and the species detail family shows `order`. RFC-62 R2 adds D14, and R7/R8 (the trait page min/median/max) add D10's `needs_unit_check` exclusion. RFC-66 R2 gets D13's column list, written out in full.
- [ ] **Step 4:** Commit: `docs(rfc): import statistics, unit status and provenance (issue #223)`.

### Task 2: Migration, Drizzle schema, contracts constants

**Files:**
- Modify `apps/api/src/db/schema/records.ts` and `apps/api/src/db/schema/taxa.ts`, plus the schema file that holds `import_rejects`' reason check (find it with `grep -rn "duplicate_record_id" apps/api/src/db`).
- Modify `packages/contracts/src/dataset.ts`.
- Create `apps/api/drizzle/0043_import_statistics.sql` and its meta.
- Test in `apps/api/src/db/schema-statistics.integration.test.ts` (new), or extend the existing records schema integration test if there is one (`ls apps/api/src/db/*.integration.test.ts`).

**Interfaces produced:**
- `packages/contracts`: `export const STATISTICS = ['single_or_unspecified','mean','median','derived_midpoint'] as const`, `export type Statistic`, `export const UNIT_STATUSES = ['converted_or_already_target','unit_missing','needs_unit_check','not_applicable'] as const`, `export type UnitStatus`. Put them next to `HARMONISATION_STATUSES`. The reject-reason list, wherever it lives in contracts (`grep -rn "duplicate_record_id" packages/contracts/src`), gains `'invalid_measurement'`.
- Drizzle `traitRecords` gains:
  - `statistic: text('statistic', { enum: STATISTICS })`
  - `seValue: numeric('se_value', { mode: 'number' })`
  - `unitStatus: text('unit_status', { enum: UNIT_STATUSES })`
  - `sourceFolder: text('source_folder')`
  - `sourceFile: text('source_file')`
  - `taxonomicStatus: text('taxonomic_status')`
  - `foldedRecordCodes: text('folded_record_codes').array()`

  All nullable.
- CHECKs on `trait_records`:
  - `trait_records_statistic_check`: `statistic is null or statistic in (…)`
  - `trait_records_unit_status_check`
  - `trait_records_se_check`: `se_value is null or se_value >= 0`
  - `value_requires_harmonised_check` and `one_value_check` are extended so that `se_value` counts as a value field, as `sd_value` does.
  - `trait_records_statistic_quantitative_check`: `statistic is null or level_id is null`.
- `families` gains `orderName: text('order_name')`.
- The `import_rejects` reason CHECK gains `invalid_measurement`.

- [ ] **Step 1: Failing test.** Integration test, run as the migrator/superuser URL like the existing constraint tests (`useTestDb`). It checks that:
  - an insert with `statistic = 'min'` fails with `check_violation`;
  - `se_value = -1` fails;
  - a record with a `level_id` and `se_value` fails;
  - a harmonised quantitative record with `statistic = 'mean'`, `se_value = 0.1`, `unit_status = 'unit_missing'` and `folded_record_codes = '{EB_1,EB_2}'` round-trips;
  - `families.order_name` accepts `'Rosales'`;
  - an `import_rejects` row with reason `invalid_measurement` inserts.

  Use `createRecord`/`createFamily` from `apps/api/test/helpers/dataset.ts` where they fit, and raw `sql` otherwise.
- [ ] **Step 2:** Run it and expect FAIL (column does not exist).
- [ ] **Step 3:** Edit the schemas and contracts, generate the migration in the container (see Verification), copy it back, and review the SQL: only `ADD COLUMN`, `ADD`/`DROP CONSTRAINT` and the reason check swap. Existing rows get nulls.
- [ ] **Step 4:** Run it and expect PASS. Then run typecheck and rfc.
- [ ] **Step 5:** Commit: `feat(db): statistic, se, unit status, provenance and family order columns (RFC-63 R1, R15; RFC-60 R1; issue #223)`.

### Task 3: Import reads the 28 columns

**Files:**
- Modify `apps/api/src/dataset/import.ts` and `apps/api/src/cli/prepare-imports.ts` (it checks `sample_data.csv` against `IMPORT_COLUMNS`, so keep it using the constant).
- Modify `apps/api/test/fixtures/import/records-small.csv`, rewritten to the 28-column header with the same rows (`ID` moves first; new columns empty), so the existing count assertion at `import.integration.test.ts:48` holds unchanged.
- Modify every test that builds an import CSV: `import.integration.test.ts` (the positional raw strings around lines 300–395), `replace-imported.integration.test.ts` (`line()` helper), `reset.integration.test.ts`, and any other file from `grep -rln "IMPORT_COLUMNS\|records-small" apps/api`.
- Modify `apps/web/src/pages/dataset/ImportPage.tsx` (`RAW_ROW_COLUMNS`), `ImportPage.test.tsx` and `apps/web/src/test/dataset-fixtures.ts` (`IMPORT_REJECT.rawRow`): 28 columns, in D1 order.
- Tests go in `apps/api/src/dataset/import.test.ts` (header unit) and `import.integration.test.ts` (new `describe('RFC-64 R6 statistics')`).

**Interfaces:** consumes the Task 2 columns and constants. `IMPORT_COLUMNS` becomes the D1 list (no `''` entry). Staging `import_staging` columns follow D1 exactly: rename `source_id` → `id_code` if clearer, and keep `row_label` only if still used. The `COPY` column list matches positionally.

- [ ] **Step 1: Failing tests.**
  - *Unit:* `headerMatches(IMPORT_COLUMNS)` is true. The old 17-column header, `['', ...]`, is false. A 27-column header lacking `ID` is false.
  - *Integration:* write one CSV with the new `line()`-style helper (keyed by column name, joined in `IMPORT_COLUMNS` order). Rows and expectations:
    - `A`: seed-mass quantitative trait (use a quantitative key from `apps/api/seed/trait-dictionary.csv`, e.g. `seed_mass_dry`), `harmonised_value 9.3`, `statistic mean`, `min 6.2`, `max 18.8`, `sd 0.5`, `se 0.1`, `sample_size 30`, `unit_harmonisation_status converted_or_already_target`, `source_folder GIFT`, `file_name seeds.csv`, `wcvp_taxonomic_status exact`, `taxon_order Sapindales`, `wcvp_family` a fresh family name, `statistic_record_codes 'EB_900001; EB_900002'`.
      → one harmonised record: `numeric_value 9.3`, `statistic 'mean'`, `min_value 6.2`, `max_value 18.8`, `sd_value 0.5`, `se_value 0.1`, `n 30`, `value_text 'single=9.3;min=6.2;max=18.8;sd=0.5;se=0.1;n=30'`, `unit_status`, `source_folder`, `source_file`, `taxonomic_status`, `folded_record_codes ['EB_900001','EB_900002']`. The family's `order_name` is `'Sapindales'`.
    - `B`: the same trait, `harmonised_value ''`, `min 4` → harmonised, `numeric_value` null, `min_value 4`, `value_text 'min=4'`, `statistic` null.
    - `C`: `harmonised_value 2.4`, `statistic derived_midpoint`, `min 0.8`, `max 4.0` → `value_text 'single=2.4;min=0.8;max=4.0'` (PostgreSQL prints `4.0` for `'4.0'::numeric`, so assert whatever `(x::numeric)::text` yields, computed in the test with a `select`), `statistic 'derived_midpoint'`.
    - `D`: `harmonised_value 5`, `statistic single_or_unspecified`, nothing else → `value_text '5'` (the D5 unchanged path).
    - `E`: categorical `flower_color` `black;brown`, `statistic ''`, `min 3` (ignored), `unit_harmonisation_status not_applicable`, `source_folder X` → two records, both with `min_value` null, `statistic` null, `unit_status 'not_applicable'` and `source_folder 'X'`.
    - Rejects, each `invalid_measurement` with `raw_row` holding all 28 keys:
      - `statistic min`
      - `min 20, max 4`
      - `sd 1,5`
      - `sd -1`
      - `sample_size 0`
      - `sample_size 2.5`
      - `harmonised_value abc, sd 1`
      - `harmonised_value '', sd 1`
      - `unit_harmonisation_status weird`
      - `statistic_record_codes 'EB_1;TR_2'`
    - A row with an unknown trait **and** `statistic min` is rejected `unknown_trait` (R7 order).
    - The batch completes; `rowsRejected` equals the number of rejects above.
    - A second family row with a different `taxon_order`, for a family whose `order_name` is already set, leaves it unchanged.
- [ ] **Step 2:** Run both files and expect FAIL.
- [ ] **Step 3: Implement** in `import.ts`:
  - `IMPORT_COLUMNS` = D1.
  - Staging DDL and `COPY` list, in D1 order.
  - The normalisation pass adds trimmed and collapsed `stat`, `n_text`, `unit_status`, `src_folder`, `src_file`, `tax_status`, `order_name`, `min_text`, `max_text`, `sd_text`, `se_text` and `folded` (`array_remove(array(select btrim(x) from unnest(string_to_array(statistic_record_codes, ';')) x), '')`, null when empty).
  - The reject insert appends the D6 predicate as the last `case` branch, reason `'invalid_measurement'`, with the number rule expressed through `NUMBER_PATTERN_SQL`, `NUMBER_MAX_LENGTH` and the 1e308 bound (`abs(x::numeric) < 1e308`, evaluated only after the pattern matches, e.g. via `case`).
  - `raw_row`'s `jsonb_build_object` holds all 28 keys.
  - The order fill runs after the families insert: `update families f set order_name = o.order_name from (select distinct on (family_name) family_name, order_name from import_staging where <not rejected> and family_name <> '' and order_name <> '' order by family_name, row_no) o where f.name = o.family_name and f.order_name is null`.
  - The `resolved` CTE computes `min_value`, `max_value`, `sd_value`, `se_value`, `n` and `statistic` (only when `value_type = 'quantitative'`, else null) and `value_text` per D5.
  - The `insert into trait_records` column list gains those, plus `unit_status`, `source_folder`, `source_file`, `taxonomic_status` and `folded_record_codes`.
  - Harmonisation follows D7: add `or min_value is not null or max_value is not null` to the harmonised branch, and treat a quantitative row with an empty value and non-empty stats as not `empty`.
  - `prepare-imports.ts` needs no logic change if it compares against `IMPORT_COLUMNS`. Update its test fixture header if one exists.
- [ ] **Step 4:** Update every fixture and helper listed under Files. Run `import.test.ts`, `import.integration.test.ts`, `replace-imported.integration.test.ts`, `reset.integration.test.ts`, the prepare-imports tests and the web `ImportPage.test.tsx`, and expect PASS. Then run typecheck, lint and rfc.
- [ ] **Step 5:** `docs/gotchas/import.md` gets a short section, "The 28-column file (issue #223)", saying:
  - `statistic` says what the value is;
  - the statistic columns are D4;
  - `invalid_measurement` rejects are listed in the batch report;
  - the old 16/17-column exports are refused.

  Also update the `import:records` line in `CLAUDE.md` only if it names the column count (it does not today, so leave it).
- [ ] **Step 6:** Commit: `feat(import): read statistic, range, spread, sample size, unit status and provenance (RFC-64 R2, R5–R7; issue #223)`.

### Task 4: Folded-code fallback in the preserving replace

**Files:** modify `apps/api/src/dataset/replace-imported.ts` (`relinkImported`); test in `apps/api/src/dataset/replace-imported.integration.test.ts`.

- [ ] **Step 1: Failing test** (in the file's own database). First import:
  - `EB_10` (seed mass `5`);
  - `EB_12` (seed mass `4`, same species, trait and reference);
  - `EB_13` (flower_color `red`).

  Then:
  - a user validates `EB_12` and `EB_13`;
  - a `TR_` quantitative contest responds to `EB_12` (use the existing helpers in the file for annotations and contests).

  The second file has:
  - `EB_10`, value `4`–`20` midpoint `12`, `statistic derived_midpoint`, `min 4`, `max 20`, `statistic_record_codes 'EB_12'`;
  - `EB_13` unchanged.

  Expect:
  - the validation of `EB_12` now sits on the new `EB_10` record, and the sheet row says `relinked`;
  - the contest's `responds_to_record_id` is the new `EB_10`;
  - `EB_13`'s validation is re-linked by code as before.

  A second case: the folded list names `EB_12` on a record of **another trait**, which leaves the contest `orphan` (RFC-63 R2), while the validation (an annotation, with no species or trait rule) is `relinked`.
- [ ] **Step 2:** Run it and expect FAIL (the rows are `orphan`).
- [ ] **Step 3: Implement.** After the existing code-matched inserts and updates in `relinkImported`, add three statements shaped like the existing ones, joining on the folded code instead:
  - a `fold` lateral or subquery: `select distinct on (code) code, r.id, r.species_id, r.trait_id from trait_records r, unnest(r.folded_record_codes) code where r.origin = 'import' order by code, length(r.record_code), r.record_code`;
  - annotations: `insert into record_annotations (...) select ... from replace_annotations s join fold f on f.code = s.record_code where not exists (select 1 from record_annotations a where a.id = s.id) on conflict do nothing`;
  - `responds_to` and `supersedes` updates: `where k.<link> is null or k.supersedes_record_id = k.id`. Mirror exactly how the existing statements detect "still detached", and read them first. Keep the same species and trait condition.

  The orphan and status query at the end needs no change, because it inspects the final state.
- [ ] **Step 4:** Run it and expect PASS; run the whole replace-imported file.
- [ ] **Step 5:** Commit: `feat(import): re-link to the record a folded code was merged into (RFC-64 R15; issue #223)`.

### Task 5: Summaries leave out `needs_unit_check`

**Files:** modify `apps/api/src/dataset/summary.ts` (lines ~74–77) and `apps/api/src/dataset/trait-page.ts` (~56–64, ~251–252). Tests go in their existing integration test files (`ls apps/api/src/dataset/{summary,trait-page}*.test.ts`).

- [ ] **Step 1: Failing tests.**
  - *Species summary.* One species and quantitative trait holds three harmonised records:
    - `numeric_value 10`, `unit_status 'converted_or_already_target'`;
    - `numeric_value 1000`, `unit_status 'needs_unit_check'`;
    - `numeric_value null`, `min_value 4`, `unit_status 'unit_missing'`.

    Expect `numeric` `{ min: 4, max: 10, mean: 10, count: 2 }` and `recordCount` 3.
  - A record with `sd_value 50` and `se_value 70` alongside `numeric_value 10` does not move min or max.
  - A trait whose only harmonised record is `needs_unit_check` → `numeric: null`.
  - *Trait page:* the `needs_unit_check` record is out of the min, median and max.

  Insert the records with `createRecord` or raw SQL. `createRecord` may need optional `statistic`, `unitStatus`, `seValue`, `minValue` and friends; extend the helper minimally.
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Add `and r.unit_status is distinct from 'needs_unit_check'` as a `filter (where …)` on the four numeric aggregates in `summary.ts`. In `trait-page.ts`, add it to the `where` of the numeric queries (or as a filter, if those queries also count records). Leave `harmonisationCounts` and `recordCount` untouched. The `numeric` null rule (no harmonised records) becomes "no numeric record passes the filter": check how 143–155 decides null and base it on the filtered count.
- [ ] **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit: `feat(dataset): summaries leave out values whose unit needs checking (RFC-63 R10, RFC-62 R7, R8; issue #223)`.

### Task 6: Record API, contracts, web display, API guide

**Files:**
- Contracts: `packages/contracts/src/dataset.ts`.
  - `recordSchema` gains `statistic: z.enum(STATISTICS).nullable()` and `unitStatus: z.enum(UNIT_STATUSES).nullable()`, and `quantitative` becomes `recordQuantitativeSchema.nullable()`, a new output schema equal to the quantitative shape plus `se: z.number().nonnegative().optional()`. `quantitativeValueSchema` (the manual input) stays unchanged (D15).
  - `recordDetailSchema` gains `sourceFolder`, `sourceFile`, `taxonomicStatus` (`z.string().nullable()`) and `foldedRecordCodes: z.array(z.string()).nullable()`.
  - The species detail's family object gains `order: z.string().nullable()` (find it with `grep -n "family" packages/contracts/src/dataset.ts`).
- API:
  - `apps/api/src/dataset/records.ts`: `quantitativeOf` adds `se`, and the item and detail selects carry the new columns.
  - The species detail route's family select adds `order_name` (find the module with `grep -rln "speciesDetail" apps/api/src`).
  - `apps/api/src/http/route-catalog.ts` changes only if a schema reference changes name.
- Web:
  - `apps/web/src/components/dataset/RecordTable.tsx` (`recordValueLabel`) and `RecordDrawer.tsx`.
  - The species page header, which shows the family: add `Order › Family` when there is an order.
  - `apps/web/src/test/dataset-fixtures.ts` gets the new fields, with null defaults.
- Guide: `docs/api/guide.md`, plus its changelog and hash.
- Tests: `apps/api/src/dataset/records.integration.test.ts` (or the file that covers `GET /api/records/:id`), the species detail test, `RecordTable.test.tsx` and `RecordDrawer.test.tsx`, plus `openapi-lock.integration.test.ts`, which will fail until the guide is updated.

- [ ] **Step 1: Failing tests.**
  - *API:* a record with `statistic 'mean'`, `unit_status 'needs_unit_check'`, `se_value 0.1`, `source_folder 'GIFT'`, `source_file 'a.csv'`, `taxonomic_status 'resolved synonym'` and `folded_record_codes {EB_1}`.
    - `GET /api/records?speciesId&traitId`: the item has `statistic: 'mean'`, `unitStatus: 'needs_unit_check'` and `quantitative.se: 0.1`.
    - `GET /api/records/:id`: the detail has `sourceFolder`, `sourceFile`, `taxonomicStatus` and `foldedRecordCodes: ['EB_1']`.
    - A family with `order_name 'Rosales'` shows `family.order: 'Rosales'` on the species detail.
  - *Web:*
    - `recordValueLabel` for single 9.3, mean statistic, min 6.2, max 18.8, sd 0.5, se 0.1, n 30 renders text containing `mean`, `6.2–18.8`, `SD 0.5`, `SE 0.1` and `n 30`. Read the current function first and keep its existing format for the parts it already renders.
    - A record with `unitStatus 'needs_unit_check'` shows `unit not checked`, and one with `unit_missing` shows `unit assumed`.
    - The drawer shows `Statistic`, `SE`, `Source folder`, `Source file`, `Name match` and `Folded records`, each only when present.
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement. Keep the web labels short and in English. The unit caveat uses the existing muted or warning text style of the component (look for an existing badge or `text-amber` usage in `apps/web/src/components/dataset`).
- [ ] **Step 4: Guide.**
  - In `docs/api/guide.md`, describe the new record fields where records are documented: what `statistic` means, and that `quantitative.sd`/`se` are spreads, never values of the trait.
  - Add the family `order` and the `unitStatus` caveat.
  - Run `openapi-lock.integration.test.ts`. Its failure prints the new hash: set line 1 to it.
  - Add a changelog entry, newest first: `- 2026-09-27 — Records carry \`statistic\`, \`unitStatus\`, \`quantitative.se\` and their import provenance; a species' family carries its \`order\` (issue #223). (openapi <first 12 hex>)`.
  - Re-run and expect PASS.
- [ ] **Step 5:** Run the api tests touched, the web tests touched, typecheck, lint and rfc.
- [ ] **Step 6:** Commit: `feat(records): show statistic, spread, unit status and provenance (RFC-63 R8, RFC-60 R1, RFC-82 R16–R21; issue #223)`.

### Task 7: Export columns and seed filter

**Files:**
- `apps/api/src/dataset/export.ts` (`RECORD_COLUMNS`, `RecordRow`, the SQL and the `csvRow` mapping), tested in `export.test.ts` (pinned column list) and `export.integration.test.ts`.
- `apps/api/src/dataset/seed.ts`, tested in `seed.integration.test.ts`.
- `docs/api/guide.md`, only if it lists the export columns (`grep -n "value_sd" docs/api/guide.md`). If it does, update the list with no hash change, since the export has no schema. A text-only guide change does not require a changelog entry unless the hash changes; follow what `openapi-lock` enforces.

- [ ] **Step 1: Failing tests.**
  - `export.test.ts` pins the D13 list.
  - `export.integration.test.ts`: a record like Task 6's, under a family with an order, exports `order`, `value_se`, `statistic`, `unit_status`, `source_folder`, `source_file`, `taxonomic_status` and `folded_record_codes` (`EB_1; EB_2` for two codes).
  - `seed.integration.test.ts`: a CSV with a `record`-category row (`statistic,record,text,,What the value is.,`), a `taxonomy` row and a `reference` row next to one trait row loads one trait and no category named `record`, `taxonomy` or `reference`.
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement. For the seed, filter in the staging-to-insert SQL with `where lower(trim(broad_category)) not in ('taxonomy','reference','record')`, applied to the category insert and to the trait and level inserts alike.
- [ ] **Step 4:** Run and expect PASS; then typecheck, lint and rfc.
- [ ] **Step 5:** Commit: `feat(export,seed): export statistics and provenance; skip non-trait dictionary rows (RFC-66 R2, RFC-62 R2; issue #223)`.

### Task 8: Close-out (controller)

- [ ] `git fetch origin && git rebase origin/main`. Re-check that the migration number is free (`git ls-tree origin/main apps/api/drizzle/ | grep 0043`). If it is taken, renumber the file, update the journal entry and re-chain the snapshot `prevId`.
- [ ] Sync, then run the full pipeline: `pnpm lint && pnpm typecheck && pnpm rfc:check && pnpm build && pnpm test`, then the web suite with `--maxWorkers=3 --testTimeout=30000`.
- [ ] Whole-branch review, then CodeRabbit locally with `--base-commit $(git merge-base HEAD origin/main)`. Triage every finding against the RFCs.
- [ ] Push with HTTP/1.1, open the PR with `Closes #223`, and wait for the checks. Read CodeRabbit's PR comments before merging, then merge.
- [ ] Remove the `in-progress` label. Add the **Outcome** section to #223 (PR, merge commit, decisions, limits, follow-up #224, the reload waiting for the first 28-column release). Remove the container and the worktree.

## Self-review

- Coverage: D1 → T3; D2–D7 → T3; D8 → T3/T6; D9 → T2/T3/T6/T7; D10 → T5; D11 → T4; D12 → T6; D13 → T7; D14 → T7; D15 → T6. The Review Focus items are tested in T3, T4 and T5.
- Types: `STATISTICS`, `UNIT_STATUSES`, `seValue`/`se_value`, `unitStatus`/`unit_status`, `foldedRecordCodes`/`folded_record_codes` and `orderName`/`order_name` are used consistently from Task 2 onwards.
