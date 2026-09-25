# Revision 13k — Replace That Preserves the Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `import:records --replace-imported --annotation-sheet <dir>` replaces the imported (`EB_`) records with a new file and keeps everything users produced (spec R-20). In **one transaction** it:

1. writes the annotation sheet;
2. stashes the annotations of `EB_` records and the `TR_` records that point at them;
3. deletes the `EB_` records and their annotations, and nothing else;
4. imports the new file through the normal import path;
5. re-links everything by `record_code`, and turns what cannot be re-linked into orphans;
6. recomputes the counters from scratch.

The run is allowed in production through a runbook. The total `--replace` is refused as soon as a `TR_` record exists (RFC-64 R12 as amended).

**Architecture:** One new module, `apps/api/src/dataset/replace-imported.ts`, exposes three calls. `importRecords` makes them inside the transaction it already opens (`runImport` → `sql.begin`), so staging, resolution, rejection and insertion are reused unchanged:

- `detachImported(tx, batchId, sheetDir)` runs before staging. It disables the RFC-63 R4 append-only triggers, which also locks both tables against writers until COMMIT. It stashes into two `on commit drop` temp tables, writes the sheet with every row `pending`, detaches the `TR_` links and deletes the `EB_` rows.
- `relinkImported(tx, detached)` runs after the records insert and before the batch row is marked `completed`. It re-attaches by code, restores the triggers, recomputes the counters and writes the final sheet to `<sheet>.tmp`.
- `publishSheet(detached)` runs after COMMIT and renames `<sheet>.tmp` over the pending sheet.

If the run fails, the transaction rolls back, the pending sheet stays, and the `.tmp` file is removed. The sheet reuses `csvRow`, `ANNOTATION_COLUMNS`, the reference label and the reference list of 13i's `export.ts`. The CLI argument rules move to a small pure module so they can be unit-tested. There is no migration and no new dependency.

**Tech Stack:** unchanged: TypeScript 7, postgres.js (`TransactionSql`), Drizzle `sql` + `PgDialect` (fragment rendering only), Node 24 `fs/promises`, Vitest 5 + testcontainers.

**Spec:** `docs/specs/2026-09-25-record-model-revision-design.md`: R-20, with R-2 (codes), R-13 (a withdrawn record leaves the counters) and R-19 (incremental import). §3 row 13k. §6 names: `trait_records.record_code`, `record_references`, the annotation kinds of 13g.

**Depends on:**

- 13a merged: RFC-64 R14/R15 and the R12 amendment.
- 13f merged:
  - `record_code` and `record_code_suffix`;
  - the import reads `ID`;
  - `record_references` and its usage trigger;
  - `rows_already_imported`;
  - the reimport runbook in `docs/gotchas/import.md`.
- 13g merged:
  - the kinds `confirm` / `withdraw` / `resolve`;
  - contest records with `intent` / `responds_to_record_id`;
  - `trait_records_uncount` and the `record_annotations_withdraw_counters` trigger;
  - the unique withdraw index;
  - `createAnnotation` without a default note.
- 13i merged: `export.ts` with `csvRow`, `ANNOTATION_COLUMNS`, `REF_LABEL` and `referencesOf`.
- 13e is merged through 13g: `accepted_values` and its triggers are gone.

13j runs beside this plan and touches only `content/help/*`.

## Cross-review amendments (2026-09-25 — owner decisions after the plan was written; apply these)

1. **Sheet publication after commit.** If renaming the final sheet fails after a successful COMMIT, the CLI exits 0 with a clear warning (`batch <id> committed; final sheet left at <path>.tmp — rename it by hand`), never a rollback message; the runbook says to check `import_batches.status` before any retry.
2. **Sheet directory check**: before creating the batch, `stat` the path (must be a directory) and create-then-delete a probe file in it; any failure exits 1 before anything is written.
3. **Owner ruling 2026-09-25 — contests state the correct levels** (spec R-8 as amended; RFC-63 R14, RFC-70 R2, R3, R9, R10): only quantitative `TR_` contests (and complements) respond to `EB_` records, so only they are listed as responses in the sheet and re-linked or orphaned; a categorical contest names levels, not records, and the replace leaves it and 13g's contest storage untouched (RFC-64 R15 as amended). Where task bodies assume a contest responds to one record's level, the amended rules win.

## Global Constraints

- The README non-negotiables apply:
  - RFC first: Task 1 comes before any code.
  - TDD: every task runs failing test → run → code → run.
  - No database mocks: integration tests use testcontainers and a database of their own.
  - Every exported symbol in `apps/*/src` carries `@rfc RFC-NN Rn`. Type-only exports are exempt.
  - English everywhere.
  - Security: the sheet holds user names, so it is written with mode `0600` and never holds an e-mail address.
- Rule numbers follow 13a's mapping: spec R-19 → RFC-64 R14, spec R-20 → RFC-64 **R15** plus the **R12** amendment. The CSV format and the annotation columns are RFC-66 R4 and R8. If 13a merged other numbers, retag. Change the tag, never the rule.
- **No migration.** A replace-imported batch records `mode = 'replace'`, so the existing `import_batches_mode_check` stands (Spec note 6). The migration-number check at push time (memory `migration-number-only-safe-at-merge`) therefore does not apply. If a reviewer asks for a distinct mode, that is a migration plus contracts, and it goes through RFC-64 R3 first.
- **Minimal diff.**
  - Staging, resolution, rejects, insert and batch bookkeeping stay as they are in `import.ts`.
  - `reset.ts` only exports `APPEND_ONLY_TRIGGERS`.
  - `export.ts` only exports `REF_LABEL` and `referencesOf`.
  - The sheet does **not** use 13i's `annotationRowsQuery`. That builder keeps only exportable rows: visible, not withdrawn, and only `confirm` and contest. The sheet must also list a withdrawal on a withdrawn `EB_` record (see EB_3 below) and every other kind (Spec note 3).
- Never await a Drizzle builder twice (memory `drizzle-builder-is-a-lazy-thenable`). The tests below await each builder once.
- Integration tests assert only on their own fixtures (memory `shared-resource-assertions-break-on-merge`). Here the file owns a whole database, as `reset.integration.test.ts` does, because the replace deletes every `EB_` record in the database it runs on.
- Branch `feat/revision-13k-preserving-reimport` from an up-to-date `origin/main` (after 13f, 13g and 13i), in its own worktree. Before pushing, rebase on `origin/main`, never merge it in (epic #85 rule 1). Push with `git -c http.version=HTTP/1.1 push`.
- One commit per task. Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

### Verification (this Mac has no Node: everything runs in Docker)

Set up once, from the main checkout:

```sh
git fetch origin
git worktree add ../TreeRepro-13k -b feat/revision-13k-preserving-reimport origin/main
cd ../TreeRepro-13k
docker image inspect treerepro-verify:base > /dev/null   # built per memory "verify-in-docker-no-node"; build it from there if missing
docker run -d --name treerepro-13k -w /workspace \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
  -e TESTCONTAINERS_RYUK_DISABLED=true \
  treerepro-verify:base sleep infinity
```

**Sync.** Run from the worktree root before every test run. It deletes first (`-exec rm -f {} +`, never `-delete`), sets `COPYFILE_DISABLE`, and rebuilds contracts:

```sh
docker exec treerepro-13k sh -c 'cd /workspace && find . -name node_modules -prune -o -type f -exec rm -f {} +' \
&& COPYFILE_DISABLE=1 tar -cf - --exclude='./node_modules' --exclude='*/node_modules' --exclude='./.git' \
    --exclude='./data' --exclude='./.claude' --exclude='*/dist' \
    --exclude='.DS_Store' --exclude='._*' --exclude='*/._*' . \
  | docker exec -i treerepro-13k tar -x -C /workspace \
&& docker exec treerepro-13k sh -c 'cd /workspace && pnpm --filter @treerepro/contracts build'
```

Commands, always after **Sync**. `<file>` is relative to `apps/api`:

- api integration: `docker exec treerepro-13k sh -c 'cd /workspace && pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration <file>'`
- api unit: `docker exec treerepro-13k sh -c 'cd /workspace && pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:unit <file>'`
- typecheck: `docker exec treerepro-13k sh -c 'cd /workspace && pnpm --filter @treerepro/api typecheck'`
- rfc: `docker exec treerepro-13k sh -c 'cd /workspace && pnpm rfc:check'` (expected last line `rfc-lint: ok`)
- lint: `docker exec treerepro-13k sh -c 'cd /workspace && pnpm lint'`. Fix findings in the worktree, never with `lint:fix` in the container: the container is a copy.

## File Structure

```
docs/rfc/60-dataset/64-bulk-import.md                 # R1 synopsis, R3 waiver, R12 check detail, R15 precision; draft → accepted
docs/rfc/60-dataset/63-trait-records.md               # R4: R15 is the second sanctioned exception; draft → accepted
docs/rfc/README.md                                    # index rows RFC-63, RFC-64
apps/api/src/cli/import-records-args.ts               # new: parseImportRecordsArgs, IMPORT_RECORDS_USAGE
apps/api/src/cli/import-records-args.test.ts          # new: unit
apps/api/src/cli/import-records.ts                    # uses the parser; migrator for both replacing modes; report lines
apps/api/src/dataset/replace-imported.ts              # new: SHEET_COLUMNS, sheetPath, detachImported, relinkImported, publishSheet
apps/api/src/dataset/replace-imported.integration.test.ts  # new: own database, the R-20 scenario, refusals, rollbacks
apps/api/src/dataset/import.ts                        # ImportInput.replaceImported; refusals; R12 platform check; wiring
apps/api/src/dataset/reset.ts                         # export APPEND_ONLY_TRIGGERS
apps/api/src/dataset/export.ts                        # export REF_LABEL, referencesOf
README.md                                             # import:records command line
docs/gotchas/import.md                                # runbook: replacing the imported records while keeping the platform
```

---

### Task 1: Claim, RFC precision (RFC-64 R1, R3, R12, R15; RFC-63 R4)

**Files:** Modify `docs/rfc/60-dataset/64-bulk-import.md`, `docs/rfc/60-dataset/63-trait-records.md` and `docs/rfc/README.md`.

**Interfaces:** Consumes 13a's RFC-64 R12 amendment and R15, which carries spec R-20 verbatim. Produces the rule text every later task cites.

- [ ] **Step 1: Claim** (README rule 7)

```sh
gh issue list --search "13k in:title" --state open   # note the number <n>
gh issue edit <n> --add-assignee @me --add-label in-progress
```

- [ ] **Step 2: Failing check.** Run `grep -c 'annotation-sheet' docs/rfc/60-dataset/64-bulk-import.md; grep -c 'RFC-64 R12 and R15' docs/rfc/60-dataset/63-trait-records.md`. Both print `0`. Also run `grep -n "^- \*\*R15\*\*\|origin = 'manual'" docs/rfc/60-dataset/64-bulk-import.md`: it must show R15 (13a) and R12's manual-record refusal (13a). If either is missing, 13a has not merged: stop.

- [ ] **Step 3: RFC-64.** Replace `| Status | accepted |` with `| Status | draft |`. Then:
  - R1: replace `[--force] [--replace]` with `[--force | --replace | --replace-imported --annotation-sheet <dir>]`. Replace `when `--replace` is passed (R12)` with `when `--replace` or `--replace-imported` is passed (R12, R15)`.
  - R3: replace `unless `--force` or `--replace` (R12, which deletes that batch)` with `unless `--force`, `--replace` (R12, which deletes that batch) or `--replace-imported` (R15)`.
  - R12: append to the end of the R12 line: ` The check runs inside the run's transaction, under a `SHARE` lock on `trait_records` so that no record can arrive between the check and the wipe; a refused run's batch is recorded `failed` with the refusal as its error.`
  - R15: append to the end of the R15 line:

```markdown
 Precision (plan 13k). The command is `import:records --file <path> --replace-imported --annotation-sheet <dir>`. `--replace-imported` cannot be combined with `--replace` or `--force`, and `--annotation-sheet` is valid only with it: any of these is a usage error (exit 2). The run is not refused in production. It connects as `treerepro_migrator`, whose secret only the runbook's one-off container mounts (`docs/gotchas/import.md`); without that secret the command exits 1. It is refused (exit 1) before any batch row exists when `<dir>` is not writable. It waives R3 as `--replace` does and records `mode = 'replace'`. The sheet is `<dir>/replace-<batch id>-annotations.csv`, mode 0600. Its columns are those of RFC-66 R8 plus `status`, and it has one row for each of:
 - an annotation of any kind on an `EB_` record, with `confirm` written as `validation`;
 - a `TR_` record whose `responds_to_record_id` names an `EB_` record: kind = its intent, `contest_record_code` = its own code;
 - a `TR_` record whose `supersedes_record_id` names an `EB_` record: kind `harmonisation`.
 The sheet is written with every status `pending` before anything is deleted, and it stays so when the run fails. After a successful commit it is replaced by the same rows with `status` `relinked` or `orphan`.
 Re-linking by `record_code` keeps an annotation's id, actor, kind, note, reference, `generated` and `created_at`. A response or a harmonisation is re-linked only to a record of its own species and trait (RFC-63 R2); otherwise it is an orphan. An orphaned response loses `intent` and `responds_to_record_id`, and an orphaned harmonisation loses `supersedes_record_id`. When an orphaned harmonisation has no primary reference of its own, the run fails, rolls back and names it.
 The counters are recomputed from the records that are not withdrawn (RFC-63 R13). The append-only triggers are disabled from the first step to the re-link and restored in the same transaction, as in R12.
```

  - Append to the changelog: `- 2026-09-25 — R1, R3, R12, R15: the replace-imported command, its sheet, its orphans, and the total replace's in-transaction platform check (spec R-20; plan 13k). `draft` until plan 13k merges.`

- [ ] **Step 4: RFC-63.** Replace `| Status | accepted |` with `| Status | draft |`. In R4, `grep -n 'sanctioned exception' docs/rfc/60-dataset/63-trait-records.md` shows one sentence. Replace the sentence starting `The one sanctioned exception is RFC-64 R12` (through `restores them there.`) with `The sanctioned exceptions are the replacing imports of RFC-64 R12 and R15: they run as `treerepro_migrator`, disable these triggers inside their transaction and restore them there.` Append to the changelog: `- 2026-09-25 — R4: RFC-64 R15 is the second sanctioned exception (spec R-20; plan 13k). `draft` until plan 13k merges.`

- [ ] **Step 5: Index.** In `docs/rfc/README.md`, the rows `| RFC-63 | Trait records and provenance | accepted |` and `| RFC-64 | Bulk import | accepted |` end in `| draft |`.

- [ ] **Step 6: Check passes.** The Step 2 greps print `1` and `1`. Run **Sync**, then rfc → `rfc-lint: ok`.

- [ ] **Step 7: Commit**

```sh
git add docs/rfc/60-dataset/64-bulk-import.md docs/rfc/60-dataset/63-trait-records.md docs/rfc/README.md
git commit -m "docs(rfc-64,63): replace-imported command, sheet, orphans; in-transaction platform check (spec R-20, plan 13k)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: CLI arguments, as a pure function

**Files:** Create `apps/api/src/cli/import-records-args.ts` and `apps/api/src/cli/import-records-args.test.ts`.

**Interfaces:** Produces:

```ts
export const IMPORT_RECORDS_USAGE: string;
export interface ImportRecordsArgs {
  file: string;
  runBy?: string;
  force: boolean;
  replace: boolean;
  replaceImported?: { sheetDir: string };
}
export function parseImportRecordsArgs(args: string[]): ImportRecordsArgs | null; // null → usage, exit 2
```

`replaceImported` has the shape of `ImportInput.replaceImported` (Task 3), so the CLI passes it through untouched.

- [ ] **Step 1: Failing test.** Create `apps/api/src/cli/import-records-args.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseImportRecordsArgs } from './import-records-args.ts';

describe('RFC-64 R1, R15 import:records arguments', () => {
  it('R15 takes --replace-imported with the sheet directory', () => {
    expect(
      parseImportRecordsArgs([
        '--file',
        'a.csv',
        '--replace-imported',
        '--annotation-sheet',
        '/sheets',
        '--run-by',
        'owner@example.test',
      ]),
    ).toEqual({
      file: 'a.csv',
      runBy: 'owner@example.test',
      force: false,
      replace: false,
      replaceImported: { sheetDir: '/sheets' },
    });
  });

  it('R1 keeps the existing flags', () => {
    expect(parseImportRecordsArgs(['--file', 'a.csv', '--replace', '--force'])).toEqual({
      file: 'a.csv',
      runBy: undefined,
      force: true,
      replace: true,
      replaceImported: undefined,
    });
  });

  it.each([
    [['--replace-imported', '--annotation-sheet', '/s']],
    [['--file', 'a.csv', '--replace-imported']],
    [['--file', 'a.csv', '--annotation-sheet', '/s']],
    [['--file', 'a.csv', '--replace-imported', '--annotation-sheet', '/s', '--replace']],
    [['--file', 'a.csv', '--replace-imported', '--annotation-sheet', '/s', '--force']],
    [['--file', 'a.csv', '--bogus']],
  ])('R15 %j is a usage error', (args) => {
    expect(parseImportRecordsArgs(args)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** After **Sync**, run api unit `src/cli/import-records-args.test.ts`. Expected: FAIL, `Cannot find module './import-records-args.ts'`.

- [ ] **Step 3: Implement.** Create `apps/api/src/cli/import-records-args.ts`:

```ts
import { parseArgs } from 'node:util';

/** @rfc RFC-64 R1, R15 */
export const IMPORT_RECORDS_USAGE =
  'usage: import-records --file <csv> [--run-by <email>] [--force | --replace | --replace-imported --annotation-sheet <dir>]\n';

export interface ImportRecordsArgs {
  file: string;
  runBy?: string;
  force: boolean;
  replace: boolean;
  /** RFC-64 R15: set only together with `--annotation-sheet`. */
  replaceImported?: { sheetDir: string };
}

/**
 * The command line of `import:records`, or `null` for a usage error (exit 2).
 * `--replace-imported` excludes `--replace` (two different wipes) and
 * `--force` (it already waives R3). `--annotation-sheet` goes with it and
 * only with it.
 * @rfc RFC-64 R1, R15
 */
export function parseImportRecordsArgs(args: string[]): ImportRecordsArgs | null {
  let values: {
    file?: string;
    'run-by'?: string;
    force: boolean;
    replace: boolean;
    'replace-imported': boolean;
    'annotation-sheet'?: string;
  };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        file: { type: 'string' },
        'run-by': { type: 'string' },
        force: { type: 'boolean', default: false },
        replace: { type: 'boolean', default: false },
        'replace-imported': { type: 'boolean', default: false },
        'annotation-sheet': { type: 'string' },
      },
      strict: true,
    }));
  } catch {
    return null;
  }
  const sheetDir = values['annotation-sheet'];
  if (!values.file) return null;
  if (values['replace-imported'] !== (sheetDir !== undefined)) return null;
  if (values['replace-imported'] && (values.replace || values.force)) return null;
  return {
    file: values.file,
    runBy: values['run-by'],
    force: values.force,
    replace: values.replace,
    replaceImported: sheetDir === undefined ? undefined : { sheetDir },
  };
}
```

- [ ] **Step 4: Run it and watch it pass.** After **Sync**, run api unit `src/cli/import-records-args.test.ts`, then typecheck and rfc. Expected: PASS and `rfc-lint: ok`.

- [ ] **Step 5: Commit**

```sh
git add apps/api/src/cli/import-records-args.ts apps/api/src/cli/import-records-args.test.ts
git commit -m "feat(cli): import:records argument rules for --replace-imported (RFC-64 R1, R15)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Refusals: total replace over platform records, unwritable sheet directory, both modes at once

**Files:** Create `apps/api/src/dataset/replace-imported.integration.test.ts`. Modify `apps/api/src/dataset/import.ts`.

**Interfaces:**
- Produces:
  - `ImportInput.replaceImported?: { sheetDir: string }`.
  - `ImportRefusedError.reason` gains `'platform_records_exist' | 'sheet_not_writable'`.
- Consumes:
  - 13f's `IMPORT_COLUMNS` (with `ID` first) and `record_code`;
  - 13g's `createAnnotation` (no default note) and the `withdraw` kind;
  - the helpers `createRecord`, `createReference`, `createAnnotation`, `levelByKey`, `traitByKey` (`test/helpers/dataset.ts`) and `createUser` (`test/helpers/users.ts`).

This task writes the whole test file skeleton: its own database, the fixture and the snapshot. Tasks 4 and 5 add `it` blocks to it. **The tests of this file run in order and share its database.**

- [ ] **Step 1: Failing tests.** Create `apps/api/src/dataset/replace-imported.integration.test.ts`:

```ts
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  createAnnotation,
  createRecord,
  createReference,
  levelByKey,
  traitByKey,
} from '../../test/helpers/dataset.ts';
import { createUser } from '../../test/helpers/users.ts';
import { createDb, type Db } from '../db/client.ts';
import { runMigrations } from '../db/migrator.ts';
import { speciesTraitCoverage } from '../db/schema/coverage.ts';
import { recordAnnotations } from '../db/schema/curation.ts';
import { importBatches } from '../db/schema/imports.ts';
import { referenceTraits } from '../db/schema/reference-traits.ts';
import { traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { species } from '../db/schema/taxa.ts';
import { IMPORT_COLUMNS, importRecords } from './import.ts';
import { seedDictionary } from './seed.ts';

const SPECIES = 'Fixturia relinka';

/** One import line: `ID`, a flower colour of SPECIES, its citation keys. */
function line(id: string, value: string, primary = 'REL_A', secondary = ''): string {
  const cells: Partial<Record<(typeof IMPORT_COLUMNS)[number], string>> = {
    ID: id,
    primary_reference: primary,
    secondary_reference: secondary,
    wcvp_species: SPECIES,
    wcvp_genus: 'Fixturia',
    wcvp_family: 'Fixturaceae',
    final_standard_trait: 'flower_color',
    trait_value_type: 'categorical',
    harmonised_value: value,
  };
  return IMPORT_COLUMNS.map((c) => cells[c] ?? '').join(',');
}

const csv = (...lines: string[]) => `${IMPORT_COLUMNS.join(',')}\n${lines.join('\n')}\n`;

describe('RFC-64 R15 replace-imported (spec R-20)', () => {
  // The run deletes every EB_ record of the database it runs on, so this file
  // provisions a database of its own in the same container, as
  // reset.integration.test.ts does. The superuser stands in for
  // treerepro_migrator (both own the tables and may disable the triggers).
  const DB_NAME = 'treerepro_replace_imported_test';
  let handle: { db: Db; close: () => Promise<void> } | undefined;
  let admin: { db: Db; close: () => Promise<void> } | undefined;
  const t = { db: undefined as unknown as Db };
  const fx = {} as {
    dir: string;
    v2: string;
    bad: string;
    speciesId: string;
    traitId: string;
    relA: string;
    relB: string;
    alice: string;
    old: Record<string, string>;
    orange: string;
    contest: string;
    mapping: string;
    validation: string;
    withdrawal: string;
  };

  /** record_code → id of every imported record. */
  async function importedByCode(): Promise<Record<string, string>> {
    const rows = await t.db
      .select({ id: traitRecords.id, code: traitRecords.recordCode })
      .from(traitRecords)
      .where(eq(traitRecords.origin, 'import'));
    return Object.fromEntries(rows.map((r) => [r.code, r.id]));
  }

  /** Everything a run may change, to prove that a refused or failed one changed nothing. */
  async function snapshot() {
    const records = await t.db
      .select({
        id: traitRecords.id,
        code: traitRecords.recordCode,
        intent: traitRecords.intent,
        respondsTo: traitRecords.respondsToRecordId,
        supersedes: traitRecords.supersedesRecordId,
      })
      .from(traitRecords)
      .orderBy(asc(traitRecords.id));
    const annotations = await t.db.select().from(recordAnnotations).orderBy(asc(recordAnnotations.id));
    const coverage = await t.db
      .select()
      .from(speciesTraitCoverage)
      .orderBy(asc(speciesTraitCoverage.speciesId), asc(speciesTraitCoverage.traitId));
    const refs = await t.db
      .select({
        id: bibliographicReferences.id,
        primary: bibliographicReferences.primaryCount,
        secondary: bibliographicReferences.secondaryCount,
      })
      .from(bibliographicReferences)
      .orderBy(asc(bibliographicReferences.id));
    const triggers = await t.db.execute(sql`
      select tgname, tgenabled from pg_trigger
      where tgname like '%append_only' or tgname like '%no_truncate' order by 1`);
    return { records, annotations, coverage, refs, triggers };
  }

  /** The one sheet a run wrote into `dir`, parsed (no field of the fixture holds a comma). */
  async function sheet(dir: string) {
    const names = await readdir(dir);
    const text = await readFile(join(dir, names[0] as string), 'utf8');
    const [header, ...rows] = text.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    return { names, header, rows: rows.map((r) => r.split(',')) };
  }

  beforeAll(async () => {
    const superuser = inject('superuserDatabaseUrl');
    admin = createDb(superuser, { max: 1 });
    await admin.db.$client.unsafe(`drop database if exists ${DB_NAME}`);
    await admin.db.$client.unsafe(`create database ${DB_NAME}`);
    const url = new URL(superuser);
    url.pathname = `/${DB_NAME}`;
    await runMigrations(url.toString());
    handle = createDb(url.toString(), { max: 2 }); // RFC-64 R13 reserves one for the lock
    t.db = handle.db;
    await seedDictionary(t.db);

    fx.dir = await mkdtemp(join(tmpdir(), 'replace-imported-'));
    const v1 = join(fx.dir, 'v1.csv');
    await writeFile(
      v1,
      csv(line('EB_1', 'blue'), line('EB_2', 'red'), line('EB_3', 'white'), line('EB_5', 'bluish')),
    );
    // The new file keeps EB_1, EB_3 and EB_5, drops EB_2, adds EB_4.
    fx.v2 = join(fx.dir, 'v2.csv');
    await writeFile(
      fx.v2,
      csv(line('EB_1', 'blue'), line('EB_3', 'white'), line('EB_4', 'yellow'), line('EB_5', 'bluish')),
    );
    // A valid header, then a row with one field too many: COPY fails after the wipe.
    fx.bad = join(fx.dir, 'bad.csv');
    await writeFile(fx.bad, `${IMPORT_COLUMNS.join(',')}\n${line('EB_1', 'blue')},EXTRA\n`);

    await importRecords(t.db, { filePath: v1 });
    fx.old = await importedByCode();
    const trait = await traitByKey(t.db, 'flower_color');
    fx.traitId = trait.id;
    const [sp] = await t.db
      .select({ id: species.id })
      .from(species)
      .where(eq(species.canonicalName, SPECIES));
    fx.speciesId = sp?.id as string;
    const [relA] = await t.db
      .select({ id: bibliographicReferences.id })
      .from(bibliographicReferences)
      .where(eq(bibliographicReferences.citationKey, 'REL_A'));
    fx.relA = relA?.id as string;
    fx.relB = (await createReference(t.db, { citationKey: 'REL_B' })).id;
    fx.alice = (await createUser(t.db, { name: 'Alice Relink' })).user.id;
    const bob = (await createUser(t.db, { name: 'Bob Relink' })).user.id;
    const carol = (await createUser(t.db, { name: 'Carol Relink' })).user.id;
    const level = async (key: string) => (await levelByKey(t.db, fx.traitId, key)).id;
    const manual = { speciesId: fx.speciesId, traitId: fx.traitId, origin: 'manual' as const };

    // A TR_ record of its own; a TR_ contest of EB_2; a TR_ harmonisation of the pending EB_5.
    fx.orange = (
      await createRecord(t.db, {
        ...manual,
        valueText: 'orange',
        levelId: await level('orange'),
        primaryReferenceId: fx.relB,
        createdBy: fx.alice,
      })
    ).id;
    fx.contest = (
      await createRecord(t.db, {
        ...manual,
        valueText: 'pink',
        levelId: await level('pink'),
        primaryReferenceId: fx.relB,
        createdBy: bob,
        intent: 'contest',
        respondsToRecordId: fx.old.EB_2 as string,
      })
    ).id;
    fx.mapping = (
      await createRecord(t.db, {
        ...manual,
        valueText: 'light_blue',
        levelId: await level('light_blue'),
        rawValue: 'bluish',
        primaryReferenceId: fx.relA,
        createdBy: fx.alice,
        supersedesRecordId: fx.old.EB_5 as string,
      })
    ).id;
    // A validation of EB_1 (with a reference) and a withdrawal of EB_3.
    fx.validation = (
      await createAnnotation(t.db, {
        recordId: fx.old.EB_1 as string,
        actorId: fx.alice,
        kind: 'confirm',
        referenceId: fx.relB,
      })
    ).id;
    fx.withdrawal = (
      await createAnnotation(t.db, { recordId: fx.old.EB_3 as string, actorId: carol, kind: 'withdraw' })
    ).id;
  }, 180_000);

  afterAll(async () => {
    await handle?.close();
    await admin?.db.$client.unsafe(`drop database if exists ${DB_NAME}`);
    await admin?.close();
  });

  it('R12 the total --replace is refused while a TR_ record exists, and nothing changes', async () => {
    const before = await snapshot();
    await expect(importRecords(t.db, { filePath: fx.v2, replace: true })).rejects.toMatchObject({
      name: 'ImportRefusedError',
      reason: 'platform_records_exist',
    });
    expect(await snapshot()).toEqual(before);
  });

  it('R15 refuses a sheet directory it cannot write, and both replacing modes at once, before any batch row', async () => {
    const batches = (await t.db.select({ id: importBatches.id }).from(importBatches)).length;
    await expect(
      importRecords(t.db, {
        filePath: fx.v2,
        replaceImported: { sheetDir: join(fx.dir, 'missing') },
      }),
    ).rejects.toMatchObject({ reason: 'sheet_not_writable' });
    await expect(
      importRecords(t.db, { filePath: fx.v2, replace: true, replaceImported: { sheetDir: fx.dir } }),
    ).rejects.toMatchObject({ reason: 'replace_not_allowed' });
    expect((await t.db.select({ id: importBatches.id }).from(importBatches)).length).toBe(batches);
  });
});
```

(`readFile`, `and`, `referenceTraits` and `sheet` are used by the Task 4 test. Biome may flag them as unused until then. If `pnpm lint` does, add them in Task 4 instead.)

- [ ] **Step 2: Run them and watch them fail.** After **Sync**, run api integration `src/dataset/replace-imported.integration.test.ts`. Expected: FAIL.
  - The first test fails because the replace succeeds and empties the file's own database (`promise resolved … instead of rejecting`).
  - The second fails on `replaceImported` being ignored: the append run completes instead of refusing.

- [ ] **Step 3: Implement**, in `apps/api/src/dataset/import.ts`:

  1. Imports: change `import { createReadStream } from 'node:fs';` to `import { constants, createReadStream } from 'node:fs';` and add `import { access } from 'node:fs/promises';`.
  2. `ImportRefusedError`: in **both** literal unions (the `reason` field and the constructor parameter), add `| 'platform_records_exist' | 'sheet_not_writable'`. The class JSDoc becomes `/** Why an import did not start. @rfc RFC-64 R2, R3, R12, R15 */`.
  3. `ImportInput`: after `replace?: boolean;` add:

```ts
  /**
   * Replace only the imported (`EB_`) records and keep everything users
   * produced, re-linked by `record_code` (RFC-64 R15). `sheetDir` receives
   * `replace-<batch id>-annotations.csv`.
   */
  replaceImported?: { sheetDir: string };
```

  4. `importRecords`: directly after the `if (input.replace && !isReplaceAllowed(…)) { … }` block, add:

```ts
  if (input.replace && input.replaceImported) {
    throw new ImportRefusedError(
      'replace_not_allowed',
      '--replace and --replace-imported exclude each other',
    );
  }
  // R15: the sheet is the only copy of what the run detaches, so its
  // directory has to take a file before anything else happens.
  if (input.replaceImported) {
    try {
      await access(input.replaceImported.sheetDir, constants.W_OK);
    } catch {
      throw new ImportRefusedError(
        'sheet_not_writable',
        `The annotation sheet directory ${input.replaceImported.sheetDir} is not writable`,
      );
    }
  }
```

  and add `@rfc RFC-64 R15` to its JSDoc tags.

  5. `runImport`, inside `sql.begin`: replace `if (input.replace) await resetDataset(tx, batch.id);` with:

```ts
      if (input.replace) {
        // R12: never while the platform holds records of its own. The SHARE
        // lock keeps one from arriving between this check and the wipe.
        await tx`lock table trait_records in share mode`;
        const [{ platform }] = (await tx`
          select exists (select 1 from trait_records where origin = 'manual') as platform`) as [
          { platform: boolean },
        ];
        if (platform) {
          throw new ImportRefusedError(
            'platform_records_exist',
            'Platform (TR_) records exist and --replace would delete them; use --replace-imported (RFC-64 R15)',
          );
        }
        await resetDataset(tx, batch.id);
      }
```

  The throw rolls the transaction back. `runImport`'s catch then records the batch `failed` with that message and rethrows the `ImportRefusedError`, so the CLI prints the message and exits 1.

- [ ] **Step 4: Run them and watch them pass.** After **Sync**, run api integration `src/dataset/replace-imported.integration.test.ts src/dataset/reset.integration.test.ts src/dataset/import.integration.test.ts`, then typecheck. Expected: PASS. The reset tests create no manual record, so the new check lets them through.

- [ ] **Step 5: Commit**

```sh
git add apps/api/src/dataset/import.ts apps/api/src/dataset/replace-imported.integration.test.ts
git commit -m "feat(import): refuse the total replace over platform records; replace-imported input and its refusals (RFC-64 R12, R15)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Detach, import, re-link, recompute, sheet

**Files:** Create `apps/api/src/dataset/replace-imported.ts`. Modify `apps/api/src/dataset/import.ts`, `apps/api/src/dataset/reset.ts`, `apps/api/src/dataset/export.ts` and `apps/api/src/dataset/replace-imported.integration.test.ts`.

**Interfaces:**
- Produces:

```ts
// replace-imported.ts
export const SHEET_COLUMNS: readonly [...typeof ANNOTATION_COLUMNS, 'status'];
export function sheetPath(dir: string, batchId: string): string;          // <dir>/replace-<batch>-annotations.csv
export interface SheetRow { key: string; fields: [string, string, string, string, string | null, string | null] }
export interface DetachedImported { path: string; rows: SheetRow[] }
export function detachImported(tx: TransactionSql, batchId: string, sheetDir: string): Promise<DetachedImported>;
export function relinkImported(tx: TransactionSql, detached: DetachedImported): Promise<void>;
export function publishSheet(detached: DetachedImported): Promise<void>;
// reset.ts
export const APPEND_ONLY_TRIGGERS: readonly [string, string][];  // was module-private
// export.ts (13i)
export const REF_LABEL: SQL;                   // was module-private
export function referencesOf(r: SQL): SQL;     // was module-private
```

- Consumes:
  - 13i: `csvRow` and `ANNOTATION_COLUMNS`;
  - 13f: `record_references`;
  - 13g: `record_annotations_withdraw_idx` (one withdraw per record, so a re-inserted withdrawal never collides) and the `record_annotations_withdraw_counters` trigger (it fires on the re-inserted withdrawal; the recompute supersedes its effect);
  - `getPii().decrypt(stored, 'users.name')`.

- [ ] **Step 1: Failing test.** Append inside the `describe` of `replace-imported.integration.test.ts`, after the Task 3 tests:

```ts
  it('R15 replaces the EB_ records, keeps the platform, re-links by record_code, writes the sheet, recomputes the counters', async () => {
    const platformBefore = await t.db
      .select()
      .from(traitRecords)
      .where(eq(traitRecords.origin, 'manual'))
      .orderBy(asc(traitRecords.id));
    const annotationsBefore = await t.db
      .select()
      .from(recordAnnotations)
      .orderBy(asc(recordAnnotations.id));
    const sheetDir = await mkdtemp(join(tmpdir(), 'replace-sheet-'));

    const batch = await importRecords(t.db, { filePath: fx.v2, replaceImported: { sheetDir } });

    expect(batch).toMatchObject({ status: 'completed', rowsTotal: 4, rowsInserted: 4, rowsRejected: 0 });
    const [stored] = await t.db
      .select({ mode: importBatches.mode })
      .from(importBatches)
      .where(eq(importBatches.id, batch.id));
    expect(stored?.mode).toBe('replace');

    // EB_: exactly the new file; EB_2 is gone; the kept codes are new rows.
    const eb = await importedByCode();
    expect(Object.keys(eb).sort()).toEqual(['EB_1', 'EB_3', 'EB_4', 'EB_5']);
    for (const code of ['EB_1', 'EB_3', 'EB_5']) expect(eb[code]).not.toBe(fx.old[code]);

    // TR_: every record kept with the same id and code; only the links moved.
    const platformAfter = await t.db
      .select()
      .from(traitRecords)
      .where(eq(traitRecords.origin, 'manual'))
      .orderBy(asc(traitRecords.id));
    const unlinked = (r: (typeof platformBefore)[number]) => ({
      ...r,
      intent: null,
      respondsToRecordId: null,
      supersedesRecordId: null,
    });
    expect(platformAfter.map(unlinked)).toEqual(platformBefore.map(unlinked));
    const after = new Map(platformAfter.map((r) => [r.id, r]));
    expect(after.get(fx.orange)).toEqual(platformBefore.find((r) => r.id === fx.orange));
    // The contest's EB_2 is gone: it is now an independent record.
    expect(after.get(fx.contest)).toMatchObject({ intent: null, respondsToRecordId: null });
    // The harmonisation follows EB_5 to its new row.
    expect(after.get(fx.mapping)?.supersedesRecordId).toBe(eb.EB_5);

    // Annotations: same id, actor, kind, note, reference, generated, created_at; new record.
    const annotationsAfter = await t.db
      .select()
      .from(recordAnnotations)
      .orderBy(asc(recordAnnotations.id));
    expect(annotationsAfter).toEqual(
      annotationsBefore.map((a) => ({
        ...a,
        recordId: a.id === fx.validation ? eb.EB_1 : eb.EB_3,
      })),
    );
    // EB_3 is still withdrawn.
    expect(annotationsAfter.find((a) => a.id === fx.withdrawal)).toMatchObject({
      recordId: eb.EB_3,
      kind: 'withdraw',
    });

    // Counters, by hand. Live records of the cell: EB_1, EB_4, EB_5 (pending),
    // orange, pink and light_blue; EB_3 is withdrawn. REL_A is primary for
    // EB_1, EB_4, EB_5 and the harmonisation; REL_B for orange and pink (the
    // validation's reference is not a usage).
    const [cell] = await t.db
      .select({
        recordCount: speciesTraitCoverage.recordCount,
        harmonisedCount: speciesTraitCoverage.harmonisedCount,
      })
      .from(speciesTraitCoverage)
      .where(
        and(
          eq(speciesTraitCoverage.speciesId, fx.speciesId),
          eq(speciesTraitCoverage.traitId, fx.traitId),
        ),
      );
    expect(cell).toEqual({ recordCount: 6, harmonisedCount: 5 });
    const [sp] = await t.db
      .select({ traitCount: species.traitCount })
      .from(species)
      .where(eq(species.id, fx.speciesId));
    expect(sp?.traitCount).toBe(1);
    const usage = async (id: string) => {
      const [ref] = await t.db
        .select({
          primary: bibliographicReferences.primaryCount,
          secondary: bibliographicReferences.secondaryCount,
        })
        .from(bibliographicReferences)
        .where(eq(bibliographicReferences.id, id));
      const [byTrait] = await t.db
        .select({ n: referenceTraits.recordCount })
        .from(referenceTraits)
        .where(and(eq(referenceTraits.referenceId, id), eq(referenceTraits.traitId, fx.traitId)));
      return { ...ref, byTrait: byTrait?.n ?? null };
    };
    expect(await usage(fx.relA)).toEqual({ primary: 4, secondary: 0, byTrait: 4 });
    expect(await usage(fx.relB)).toEqual({ primary: 2, secondary: 0, byTrait: 2 });
    // And the whole coverage table equals a from-scratch count of live records.
    const [drift] = await t.db.execute(sql`
      with want as (
        select r.species_id, r.trait_id, count(*)::int as n,
          (count(*) filter (where r.harmonisation = 'harmonised'))::int as h
        from trait_records r
        where not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
        group by 1, 2),
      have as (
        select species_id, trait_id, record_count as n, harmonised_count as h from species_trait_coverage)
      select (select count(*) from (
        (select * from want except select * from have)
        union all
        (select * from have except select * from want)) d)::int as rows`);
    expect(drift).toEqual({ rows: 0 });

    // The sheet: final, one file, statuses known.
    const codeOf = async (id: string) =>
      (
        await t.db
          .select({ code: traitRecords.recordCode })
          .from(traitRecords)
          .where(eq(traitRecords.id, id))
      )[0]?.code;
    const s = await sheet(sheetDir);
    expect(s.names).toEqual([`replace-${batch.id}-annotations.csv`]);
    expect(s.header).toBe('record_code,kind,user_name,date,reference,contest_record_code,status');
    const iso = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(s.rows).toEqual([
      ['EB_1', 'validation', 'Alice Relink', iso, 'REL_B', '', 'relinked'],
      ['EB_2', 'contest', 'Bob Relink', iso, 'REL_B', await codeOf(fx.contest), 'orphan'],
      ['EB_3', 'withdraw', 'Carol Relink', iso, '', '', 'relinked'],
      ['EB_5', 'harmonisation', 'Alice Relink', iso, 'REL_A', await codeOf(fx.mapping), 'relinked'],
    ]);
  });
```

- [ ] **Step 2: Run it and watch it fail.** After **Sync**, run api integration `src/dataset/replace-imported.integration.test.ts`. Expected: FAIL at `rowsInserted: 4`, because the run appended and got `1`: RFC-64 R14 skipped `EB_1`, `EB_3` and `EB_5` as already imported. The Task 3 tests still pass.

- [ ] **Step 3: Share the pieces.**
  - In `apps/api/src/dataset/reset.ts`, change `const APPEND_ONLY_TRIGGERS` to `export const APPEND_ONLY_TRIGGERS` and add `@rfc RFC-64 R12, R15` under its existing `@rfc RFC-63 R4` tag.
  - In `apps/api/src/dataset/export.ts` (13i):
    - Change `const REF_LABEL` to `export const REF_LABEL`. Its JSDoc becomes `/** A reference as the export names it: its citation key, or `Personal observation`. @rfc RFC-66 R2, R8 @rfc RFC-64 R15 */`.
    - Change `function referencesOf` to `export function referencesOf`, and add `@rfc RFC-66 R2, R8` and `@rfc RFC-64 R15` to its JSDoc.

- [ ] **Step 4: The module.** Create `apps/api/src/dataset/replace-imported.ts`:

```ts
import { open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { type SQL, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { TransactionSql } from 'postgres';
import { getPii } from '../security/pii.ts';
import { ANNOTATION_COLUMNS, csvRow, REF_LABEL, referencesOf } from './export.ts';
import { APPEND_ONLY_TRIGGERS } from './reset.ts';

/**
 * The annotation sheet: the columns of `annotations.csv` (RFC-66 R8) and
 * what the run did with the row: `pending` before the wipe, then `relinked`
 * or `orphan`.
 * @rfc RFC-64 R15
 */
export const SHEET_COLUMNS = [...ANNOTATION_COLUMNS, 'status'] as const;

/** `<dir>/replace-<batch id>-annotations.csv` (spec R-20). @rfc RFC-64 R15 */
export function sheetPath(dir: string, batchId: string): string {
  return join(dir, `replace-${batchId}-annotations.csv`);
}

// 13i's reference label and reference list, rendered once to SQL text for the
// two stash statements below. Neither fragment binds a parameter, so the text
// is the whole fragment; the check keeps it that way.
const dialect = new PgDialect();
function rendered(fragment: SQL): string {
  const query = dialect.sqlToQuery(fragment);
  if (query.params.length > 0) throw new Error('replace-imported: a shared fragment gained a parameter');
  return query.sql;
}
const REF_LABEL_SQL = rendered(REF_LABEL);
const REFERENCES_OF_K_SQL = rendered(referencesOf(sql.raw('k')));

export interface SheetRow {
  /** `a:<annotation id>` or `l:<link>:<record id>`: pairs the row with its outcome. */
  key: string;
  fields: [string, string, string, string, string | null, string | null];
}

export interface DetachedImported {
  path: string;
  rows: SheetRow[];
}

async function writeSheet(
  path: string,
  rows: SheetRow[],
  status: (row: SheetRow) => string,
  flag: 'wx' | 'w',
): Promise<void> {
  // 0600: the sheet names users (RFC-40); fsync, because the pending copy is
  // the record of what the run detached if everything after it fails.
  const file = await open(path, flag, 0o600);
  try {
    await file.writeFile(
      `﻿${csvRow(SHEET_COLUMNS)}${rows.map((r) => csvRow([...r.fields, status(r)])).join('')}`,
      'utf8',
    );
    await file.sync();
  } finally {
    await file.close();
  }
}

/**
 * RFC-64 R15 steps 1–2, inside the import's transaction and before the new
 * file is staged:
 * - Turn off the append-only triggers (RFC-63 R4). The ALTERs also lock
 *   `trait_records` and `record_annotations` against writers until COMMIT,
 *   so the stash misses nothing.
 * - Stash every annotation of an `EB_` record and every `TR_` link to one.
 * - Write the sheet, every row `pending`.
 * - Detach the links.
 * - Delete the `EB_` records and their annotations. Nothing else is touched.
 * @rfc RFC-64 R15
 * @rfc RFC-63 R4
 */
export async function detachImported(
  tx: TransactionSql,
  batchId: string,
  sheetDir: string,
): Promise<DetachedImported> {
  for (const [table, trigger] of APPEND_ONLY_TRIGGERS) {
    await tx`alter table ${tx(table)} disable trigger ${tx(trigger)}`;
  }
  // `unsafe` only because the two rendered fragments are SQL text; no value
  // is spliced into either statement.
  await tx.unsafe(`
    create temporary table replace_annotations on commit drop as
    select a.id, r.record_code, a.actor_id, a.kind, a.note, a.reference_id, a.generated,
      a.created_at, u.name as user_name, ${REF_LABEL_SQL} as reference
    from record_annotations a
    join trait_records r on r.id = a.record_id
    join users u on u.id = a.actor_id
    left join bibliographic_references b on b.id = a.reference_id
    where r.origin = 'import'`);
  await tx.unsafe(`
    create temporary table replace_links on commit drop as
    select k.id, k.record_code as own_code, t.record_code as target_code,
      'responds_to'::text as link, k.intent::text as kind, k.intent, k.created_at,
      u.name as user_name, ${REFERENCES_OF_K_SQL} as reference
    from trait_records k
    join trait_records t on t.id = k.responds_to_record_id
    join users u on u.id = k.created_by
    where t.origin = 'import'
    union all
    select k.id, k.record_code, t.record_code, 'supersedes', 'harmonisation', null,
      k.created_at, u.name, ${REFERENCES_OF_K_SQL}
    from trait_records k
    join trait_records t on t.id = k.supersedes_record_id
    join users u on u.id = k.created_by
    where t.origin = 'import'`);

  const rows = await tx<
    {
      key: string;
      record_code: string;
      kind: string;
      user_name: string;
      created_at: Date;
      reference: string | null;
      contest_record_code: string | null;
    }[]
  >`
    select 'a:' || id as key, record_code,
      case kind when 'confirm' then 'validation' else kind end as kind,
      user_name, created_at, reference, null::text as contest_record_code, id
    from replace_annotations
    union all
    select 'l:' || link || ':' || id, target_code, kind, user_name, created_at, reference, own_code, id
    from replace_links
    order by 2, 5, 8`;
  const pii = getPii();
  const sheetRows: SheetRow[] = rows.map((r) => ({
    key: r.key,
    fields: [
      r.record_code,
      r.kind,
      pii.decrypt(r.user_name, 'users.name'),
      new Date(r.created_at).toISOString(),
      r.reference,
      r.contest_record_code,
    ],
  }));
  const path = sheetPath(sheetDir, batchId);
  await writeSheet(path, sheetRows, () => 'pending', 'wx');

  await tx`
    update trait_records k set intent = null, responds_to_record_id = null
    from replace_links l where l.id = k.id and l.link = 'responds_to'`;
  // A harmonisation without a primary reference of its own needs a non-null
  // supersedes_record_id (trait_records_origin_check), so every detached one
  // points at itself until relinkImported settles it.
  await tx`
    update trait_records k set supersedes_record_id = k.id
    from replace_links l where l.id = k.id and l.link = 'supersedes'`;
  await tx`
    delete from record_annotations a using trait_records r
    where r.id = a.record_id and r.origin = 'import'`;
  await tx`delete from trait_records where origin = 'import'`;
  return { path, rows: sheetRows };
}

/**
 * The counters of RFC-69 R2 and RFC-61 R4, R9, rebuilt from the records that
 * are not withdrawn (spec R-13). This is the backfill SQL of 0015, 0022 and
 * 0027 with 13f's `record_references` counted on its own, as its trigger
 * does, and 13g's withdrawal filter. The deletes of detachImported
 * decremented nothing, so an incremental fix would be wrong.
 */
async function recomputeCounters(tx: TransactionSql): Promise<void> {
  await tx`
    update bibliographic_references set primary_count = 0, secondary_count = 0
    where primary_count <> 0 or secondary_count <> 0`;
  await tx`
    update bibliographic_references b set primary_count = u.n
    from (select id, count(*)::int as n from (
            select r.primary_reference_id as id from trait_records r
            where r.primary_reference_id is not null
              and not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
            union all
            select rr.reference_id from record_references rr join trait_records r on r.id = rr.record_id
            where not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
          ) x group by 1) u
    where b.id = u.id`;
  await tx`
    update bibliographic_references b set secondary_count = u.n
    from (select r.secondary_reference_id as id, count(*)::int as n from trait_records r
          where r.secondary_reference_id is not null
            and not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
          group by 1) u
    where b.id = u.id`;
  await tx`delete from species_trait_coverage`;
  await tx`
    insert into species_trait_coverage (species_id, trait_id, record_count, harmonised_count, first_record_at, last_record_at)
    select r.species_id, r.trait_id, count(*), count(*) filter (where r.harmonisation = 'harmonised'),
      min(r.created_at), max(r.created_at)
    from trait_records r
    where not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
    group by 1, 2`;
  await tx`update species set trait_count = 0 where trait_count <> 0`;
  await tx`
    update species s set trait_count = c.n
    from (select species_id, count(*)::int as n from species_trait_coverage group by 1) c
    where s.id = c.species_id`;
  await tx`delete from reference_traits`;
  // 0027's UNION over DISTINCT (record, reference, trait) triples (a
  // reference in both roles counts once), plus record_references on its own.
  await tx`
    insert into reference_traits (reference_id, trait_id, record_count)
    select reference_id, trait_id, count(*) from (
      select reference_id, trait_id from (
        select distinct r.id, r.primary_reference_id as reference_id, r.trait_id from trait_records r
        where r.primary_reference_id is not null
          and not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
        union
        select distinct r.id, r.secondary_reference_id, r.trait_id from trait_records r
        where r.secondary_reference_id is not null
          and not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
      ) d
      union all
      select rr.reference_id, r.trait_id from record_references rr join trait_records r on r.id = rr.record_id
      where not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
    ) x group by 1, 2`;
}

/**
 * RFC-64 R15 steps 4–5, after the new file's records are inserted and before
 * the batch is recorded:
 * - Re-attach by `record_code`.
 * - Restore the triggers.
 * - Recompute the counters.
 * - Write the final sheet beside the pending one, as `<sheet>.tmp`.
 *   {@link publishSheet} renames it after COMMIT.
 * @rfc RFC-64 R15
 * @rfc RFC-63 R2, R4
 */
export async function relinkImported(tx: TransactionSql, detached: DetachedImported): Promise<void> {
  // Same id, actor, kind, note, reference, generated and created_at; only the record changes.
  await tx`
    insert into record_annotations (id, record_id, actor_id, kind, note, reference_id, generated, created_at)
    select s.id, r.id, s.actor_id, s.kind, s.note, s.reference_id, s.generated, s.created_at
    from replace_annotations s
    join trait_records r on r.record_code = s.record_code and r.origin = 'import'`;
  // RFC-63 R2: a response names a record of its own species and trait. The
  // trigger that checks it fires on INSERT only, so the join checks it here.
  await tx`
    update trait_records k set intent = l.intent, responds_to_record_id = r.id
    from replace_links l
    join trait_records r on r.record_code = l.target_code and r.origin = 'import'
    where l.link = 'responds_to' and l.id = k.id
      and r.species_id = k.species_id and r.trait_id = k.trait_id`;
  await tx`
    update trait_records k set supersedes_record_id = r.id
    from replace_links l
    join trait_records r on r.record_code = l.target_code and r.origin = 'import'
    where l.link = 'supersedes' and l.id = k.id
      and r.species_id = k.species_id and r.trait_id = k.trait_id`;
  // An orphaned harmonisation with a primary reference stands on its own.
  await tx`
    update trait_records k set supersedes_record_id = null
    from replace_links l
    where l.link = 'supersedes' and l.id = k.id
      and k.supersedes_record_id = k.id and k.primary_reference_id is not null`;
  for (const [table, trigger] of APPEND_ONLY_TRIGGERS) {
    await tx`alter table ${tx(table)} enable trigger ${tx(trigger)}`;
  }
  await recomputeCounters(tx);
  const relinked = await tx<{ key: string }[]>`
    select 'a:' || s.id as key from replace_annotations s
    where exists (select 1 from record_annotations a where a.id = s.id)
    union all
    select 'l:' || l.link || ':' || l.id from replace_links l
    join trait_records k on k.id = l.id
    where (l.link = 'responds_to' and k.responds_to_record_id is not null)
       or (l.link = 'supersedes' and k.supersedes_record_id is not null)`;
  const keys = new Set(relinked.map((r) => r.key));
  await writeSheet(
    `${detached.path}.tmp`,
    detached.rows,
    (row) => (keys.has(row.key) ? 'relinked' : 'orphan'),
    'w',
  );
}

/** After COMMIT: the final sheet takes the pending one's place in one rename. @rfc RFC-64 R15 */
export async function publishSheet(detached: DetachedImported): Promise<void> {
  await rename(`${detached.path}.tmp`, detached.path);
}
```

- [ ] **Step 5: Wire it into `apps/api/src/dataset/import.ts`.**
  1. Imports: change `import { access } from 'node:fs/promises';` (Task 3) to `import { access, rm } from 'node:fs/promises';`, and add `import { type DetachedImported, detachImported, publishSheet, relinkImported } from './replace-imported.ts';`.
  2. `runImport`:
     - The R3 guard `if (!input.force && !input.replace) {` becomes `if (!input.force && !input.replace && !input.replaceImported) {`.
     - The batch insert's `mode: input.replace ? 'replace' : 'append',` becomes `mode: input.replace || input.replaceImported ? 'replace' : 'append',`.
  3. Directly above `const sql = db.$client;`, add:

```ts
  // R15: set inside the transaction below; the cast keeps TypeScript from
  // narrowing it to `null` across the callback.
  let detached = null as DetachedImported | null;
```

  4. Inside `sql.begin`, directly after the `if (input.replace) { … }` block of Task 3 and before `// R4 staging`:

```ts
      // R15: stash and detach what users produced, write the pending sheet,
      // delete the EB_ records. The file below then loads into their place.
      if (input.replaceImported) {
        detached = await detachImported(tx, batch.id, input.replaceImported.sheetDir);
      }
```

  5. Inside `sql.begin`, directly before the `await tx\`update import_batches set status = 'completed'` statement:

```ts
      // R15: re-link by record_code, restore the triggers, recompute the
      // counters, write the final sheet beside the pending one.
      if (detached) await relinkImported(tx, detached);
```

  6. In the `catch (err)` of `runImport`, as its first statement:

```ts
    // R15: the final sheet never outlives a rollback; the pending one stays.
    if (detached) await rm(`${detached.path}.tmp`, { force: true }).catch(() => undefined);
```

  7. After the whole `try { … } catch { … }` and before `const result = await getImportBatch(db, batch.id);`:

```ts
  if (detached) await publishSheet(detached);
```

- [ ] **Step 6: Run it and watch it pass.** After **Sync**, run api integration `src/dataset/replace-imported.integration.test.ts src/dataset/reset.integration.test.ts src/dataset/import.integration.test.ts src/dataset/export.integration.test.ts`, then typecheck, rfc and lint. Expected: PASS, `rfc-lint: ok`, and no lint findings.

- [ ] **Step 7: Commit**

```sh
git add apps/api/src/dataset/replace-imported.ts apps/api/src/dataset/replace-imported.integration.test.ts apps/api/src/dataset/import.ts apps/api/src/dataset/reset.ts apps/api/src/dataset/export.ts
git commit -m "feat(import): --replace-imported replaces EB_ records, re-links platform work by code, recomputes counters, writes the sheet (RFC-64 R15, spec R-20)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Data safety: a failed run changes nothing; a harmonisation is never left without a reference

**Files:** Modify `apps/api/src/dataset/replace-imported.integration.test.ts` and `apps/api/src/dataset/replace-imported.ts`.

**Interfaces:** No new export. `relinkImported` now throws when an orphaned harmonisation has no primary reference.

- [ ] **Step 1: Failing tests.** Append inside the `describe`, after the Task 4 test. The database now holds the state that test left.

```ts
  it('R9, R15 a file that fails after the wipe rolls everything back; the sheet stays, every row pending', async () => {
    const before = await snapshot();
    const sheetDir = await mkdtemp(join(tmpdir(), 'replace-sheet-'));
    await expect(
      importRecords(t.db, { filePath: fx.bad, replaceImported: { sheetDir }, copyIdleTimeoutMs: 2000 }),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    const s = await sheet(sheetDir);
    expect(s.names).toHaveLength(1); // no .tmp left behind
    expect(s.names[0]).toMatch(/^replace-[0-9a-f-]{36}-annotations\.csv$/);
    expect(s.rows.map((r) => [r[0], r[1], r[6]])).toEqual([
      ['EB_1', 'validation', 'pending'],
      ['EB_3', 'withdraw', 'pending'],
      ['EB_5', 'harmonisation', 'pending'],
    ]);
    const [failed] = await t.db
      .select({ status: importBatches.status })
      .from(importBatches)
      .where(eq(importBatches.fileName, 'bad.csv'));
    expect(failed?.status).toBe('failed');
  });

  it('R15 refuses to orphan a harmonisation that has no primary reference; nothing changes', async () => {
    // EB_9 names only a secondary reference; its harmonisation inherits exactly that.
    const late = join(fx.dir, 'late.csv');
    await writeFile(late, csv(line('EB_9', 'greyish', '', 'REL_S')));
    await importRecords(t.db, { filePath: late });
    const eb9 = (await importedByCode()).EB_9 as string;
    const [relS] = await t.db
      .select({ id: bibliographicReferences.id })
      .from(bibliographicReferences)
      .where(eq(bibliographicReferences.citationKey, 'REL_S'));
    await createRecord(t.db, {
      speciesId: fx.speciesId,
      traitId: fx.traitId,
      origin: 'manual',
      valueText: 'gray',
      levelId: (await levelByKey(t.db, fx.traitId, 'gray')).id,
      rawValue: 'greyish',
      primaryReferenceId: null,
      secondaryReferenceId: relS?.id as string,
      createdBy: fx.alice,
      supersedesRecordId: eb9,
    });
    const before = await snapshot();
    const sheetDir = await mkdtemp(join(tmpdir(), 'replace-sheet-'));
    // v2 has no EB_9.
    await expect(
      importRecords(t.db, { filePath: fx.v2, replaceImported: { sheetDir } }),
    ).rejects.toThrow(/TR_\d+[a-z]* harmonises EB_9/);
    expect(await snapshot()).toEqual(before);
  });
```

- [ ] **Step 2: Run them and see what fails.** After **Sync**, run api integration `src/dataset/replace-imported.integration.test.ts`.
  - The malformed-file test **passes already**: the run's single transaction covers it, and this test pins that guarantee.
  - The harmonisation test **FAILS**: the run completes (`promise resolved … instead of rejecting`), leaving a `TR_` record whose `supersedes_record_id` points at itself.

- [ ] **Step 3: Implement.** In `relinkImported`, directly after the `update … set supersedes_record_id = null` statement and before the trigger re-enable loop:

```ts
  // RFC-64 R15: a harmonisation whose EB_ record is gone and that has no
  // primary reference would be a manual record with no reference at all
  // (trait_records_origin_check). Stop here; the rollback restores everything.
  const stuck = await tx<{ own: string; target: string }[]>`
    select k.record_code as own, l.target_code as target
    from replace_links l join trait_records k on k.id = l.id
    where l.link = 'supersedes' and k.supersedes_record_id = k.id
    order by 1`;
  if (stuck.length > 0) {
    throw new Error(
      `Cannot orphan a harmonisation without a primary reference: ${stuck
        .map((s) => `${s.own} harmonises ${s.target}`)
        .join('; ')}. Put these rows back in the file (RFC-64 R15)`,
    );
  }
```

- [ ] **Step 4: Run them and watch them pass.** After **Sync**, run api integration `src/dataset/replace-imported.integration.test.ts`, then typecheck and lint. Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/api/src/dataset/replace-imported.ts apps/api/src/dataset/replace-imported.integration.test.ts
git commit -m "feat(import): replace-imported rolls back rather than orphan a harmonisation with no reference; failed runs change nothing (RFC-64 R15)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The CLI, the README line, the runbook

**Files:** Modify `apps/api/src/cli/import-records.ts`, `README.md` and `docs/gotchas/import.md`.

**Interfaces:** Consumes `parseImportRecordsArgs` and `IMPORT_RECORDS_USAGE` (Task 2), `importRecords` with `replaceImported` (Tasks 3–5), `sheetPath` (Task 4) and 13f's reimport runbook section.

- [ ] **Step 1: Failing check.** Run `grep -c 'replace-imported' apps/api/src/cli/import-records.ts README.md docs/gotchas/import.md`. It prints `0` for each file. (The CLI's top level runs on import and has no test of its own. Its logic is `parseImportRecordsArgs`, which Task 2 tested; this task only wires it in.)

- [ ] **Step 2: The CLI.** In `apps/api/src/cli/import-records.ts`:
  - The header comment becomes `// \`pnpm import:records --file <csv> [--run-by <email>] [--force | --replace | --replace-imported --annotation-sheet <dir>]\` — loads the` (the second comment line is unchanged).
  - Replace `import { parseArgs } from 'node:util';` with `import { IMPORT_RECORDS_USAGE, parseImportRecordsArgs } from './import-records-args.ts';`, and add `import { sheetPath } from '../dataset/replace-imported.ts';`.
  - Replace everything from `const USAGE = …` through the `if (!values.file) { … }` block with:

```ts
const values = parseImportRecordsArgs(process.argv.slice(2));
if (!values) {
  process.stderr.write(IMPORT_RECORDS_USAGE);
  process.exit(2);
}
```

  - Replace the block that starts with the comment `// R12: the reset empties tables …` and ends with `const dbUrl = values.replace ? loadMigratorConfig().db.url : config.db.url;` (keeping the `values.replace && !isReplaceAllowed` refusal and `configurePii` exactly as they are, in the same order) with:

```ts
const config = loadConfig();
// R12: the total replace is refused in production outright.
if (values.replace && !isReplaceAllowed(config.nodeEnv)) {
  process.stderr.write('--replace is not available in production\n');
  process.exit(1);
}
configurePii(config.pii.keyring.expose(), config.pii.hmacKey.expose());
// R12, R15: both replacing modes write past the RFC-63 R4 append-only
// triggers, which only the migrator role may switch off; `treerepro_app`
// never can. R15 runs in production too. There, the gate is this secret:
// only the runbook's one-off container mounts it (docs/gotchas/import.md).
let dbUrl = config.db.url;
if (values.replace || values.replaceImported) {
  try {
    dbUrl = loadMigratorConfig().db.url;
  } catch (err) {
    process.stderr.write(
      `${(err as Error).message}: --replace and --replace-imported run as treerepro_migrator; mount its secret as docs/gotchas/import.md shows\n`,
    );
    process.exit(1);
  }
}
```

  - In the `importRecords(db, { … })` call, after `replace: values.replace,` add `replaceImported: values.replaceImported,`.
  - The mode line becomes:

```ts
    values.replace
      ? 'Mode: replace (everything earlier imports loaded was cleared)'
      : values.replaceImported
        ? 'Mode: replace-imported (the EB_ records were replaced; platform records and annotations kept, re-linked by code)'
        : 'Mode: append',
```

  - Directly after the `` `Batch ${batch.id} completed in ${seconds}s`, `` line, add:

```ts
    ...(values.replaceImported
      ? [`Annotation sheet: ${sheetPath(values.replaceImported.sheetDir, batch.id)}`]
      : []),
```

- [ ] **Step 3: README.** Run `grep -n 'import:records --file' README.md` and replace that list item's opening, from `` `pnpm --filter @treerepro/api import:records --file <csv> [--run-by <email>] [--force]` — import a compiled-dataset CSV (RFC-64); prints the batch report. `` up to that point, with:

  `` `pnpm --filter @treerepro/api import:records --file <csv> [--run-by <email>] [--force | --replace | --replace-imported --annotation-sheet <dir>]` — import a compiled-dataset CSV (RFC-64); prints the batch report. `--replace-imported` replaces only the imported (`EB_`) records. It keeps every platform (`TR_`) record and every annotation, re-links them by record code, and writes an annotation sheet into `<dir>` (RFC-64 R15). Production procedure: "Replacing the imported records while keeping the platform" in `docs/gotchas/import.md`. The total `--replace` is for the test phase only: it is refused in production and once a platform record exists (RFC-64 R12). ``

  The rest of the item (the container and file-placement text) stays.

- [ ] **Step 4: The runbook.** Append this section to `docs/gotchas/import.md`, after 13f's "Replacing the imported data with the ID-carrying file":

````markdown
## Replacing the imported records while keeping the platform (`--replace-imported`, RFC-64 R15)

**Symptom:** A corrected compilation of the source file arrives after users have started working. The file keeps the `ID` column (`EB_<n>`) and may change, drop or add rows. `--replace` is out of the question: it deletes every platform record, and RFC-64 R12 refuses it anyway once one exists.

**Cause:** Imported records are append-only (RFC-63 R4), and users' validations, withdrawals, contests and harmonisations point at them by id. Swapping the file means deleting the `EB_` rows and re-attaching all of that to the new rows by `record_code`. RFC-64 R15 does this in one transaction, as `treerepro_migrator`.

**Fix:** Run it on the production host, from the checkout. Put the new file at `/srv/imports/records.csv`, with a first line starting `ID,primary_reference,`.

1. **Sheet directory.** The sheet names users (personal data), so the directory is private to the `api` image's user (`node`, uid 1000):
   ```sh
   sudo install -d -m 700 -o 1000 -g 1000 /srv/imports/replace-sheets
   head -1 /srv/imports/records.csv | cut -c1-22   # → ID,primary_reference,
   ```
2. **Back up**, as in the section above:
   ```sh
   docker compose run --rm --no-deps --entrypoint /usr/local/bin/backup.sh backup
   ```
   It prints `backup written: /backups/treerepro-<stamp>.sql.age`. Note the stamp. Restoring it is "Restoring a backup" in `docs/gotchas/infra.md`.
3. **Stop the API.** The run locks `trait_records` and `record_annotations` for its whole length (minutes on the full dataset), and nobody should be working meanwhile:
   ```sh
   docker compose stop api
   ```
4. **Dry checks.** Note the five numbers: platform records, their annotations, annotations of imported records, responses to imported records, harmonisations of imported records.
   ```sh
   docker compose exec -T postgres psql -U postgres -d treerepro -v ON_ERROR_STOP=1 -At -F ' ' -c \
     "select (select count(*) from trait_records where origin = 'manual'),
             (select count(*) from record_annotations a join trait_records r on r.id = a.record_id where r.origin = 'manual'),
             (select count(*) from record_annotations a join trait_records r on r.id = a.record_id where r.origin = 'import'),
             (select count(*) from trait_records k join trait_records t on t.id = k.responds_to_record_id where t.origin = 'import'),
             (select count(*) from trait_records k join trait_records t on t.id = k.supersedes_record_id where t.origin = 'import')"
   ```
   The sheet will have (3rd + 4th + 5th) rows. Then list the harmonisations that have no primary reference of their own. The run refuses to orphan one of those, so each code this prints must be an `ID` of the new file:
   ```sh
   docker compose exec -T postgres psql -U postgres -d treerepro -At -c \
     "select distinct regexp_replace(t.record_code, '[a-z]+$', '') from trait_records k join trait_records t on t.id = k.supersedes_record_id
      where t.origin = 'import' and k.primary_reference_id is null order by 1" > /tmp/needed-ids.txt
   cut -d, -f1 /srv/imports/records.csv | sort -u > /tmp/file-ids.txt
   sort -u /tmp/needed-ids.txt | comm -23 - /tmp/file-ids.txt   # must print nothing
   ```
   If it prints codes, stop: bring the API back (`docker compose up -d api`) and take the codes to the owner. The run would roll back anyway, naming them.
5. **Replace.** A one-off container of the `api` image, with the migrator secret mounted, the files read-only and the sheet directory writable. `NODE_ENV` stays `production`: RFC-64 R15 is allowed there, and the migrator secret is its gate.
   ```sh
   docker compose run --rm --no-deps \
     -v "$PWD/infra/secrets/db_migrator_password:/run/secrets/db_migrator_password:ro" \
     -v /srv/imports:/imports:ro \
     -v /srv/imports/replace-sheets:/sheets \
     api node dist/cli/import-records.js --file /imports/records.csv \
       --replace-imported --annotation-sheet /sheets --run-by <owner e-mail>
   ```
   The report must read `Mode: replace-imported …`, `Batch <id> completed …` and `Annotation sheet: /sheets/replace-<id>-annotations.csv`.
   On failure it exits 1 with `Import failed: …`, and nothing in the database changed. The sheet directory then holds the pre-wipe copy, every row `pending`. Go to step 7 and then step 9.
6. **Post-checks.**
   - Re-run the first query of step 4. Its first two numbers (platform records, their annotations) must be unchanged.
   - The sheet: no `pending` row and no `.tmp` file; the row count as expected; how many rows were re-linked and how many orphaned:
     ```sh
     ls /srv/imports/replace-sheets
     f=/srv/imports/replace-sheets/replace-<id>-annotations.csv
     grep -c ',pending'$'\r''$' "$f"                              # → 0
     tail -n +2 "$f" | wc -l                                       # → 3rd + 4th + 5th number of step 4
     grep -c ',relinked'$'\r''$' "$f"; grep -c ',orphan'$'\r''$' "$f"
     ```
   - The codes and the counters. The expected answer is `0 t`:
     ```sh
     docker compose exec -T postgres psql -U postgres -d treerepro -At -F ' ' -c \
       "select (select count(*) from trait_records where origin = 'import' and record_code !~ '^EB_[0-9]+([a-z]+)?\$'),
               (select coalesce(sum(primary_count), 0) from bibliographic_references) =
               (select count(*) from trait_records r where r.primary_reference_id is not null
                  and not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw'))
               + (select count(*) from record_references rr join trait_records r on r.id = rr.record_id
                  where not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw'))"
     ```
7. **Check the triggers are back on** (`O` = enabled):
   ```sh
   docker compose exec -T postgres psql -U postgres -d treerepro -At -c \
     "select tgname, tgenabled from pg_trigger where tgname in ('trait_records_append_only', 'trait_records_no_truncate', 'record_annotations_append_only', 'record_annotations_no_truncate') order by 1"
   ```
8. **Reclaim the space** the deleted rows left. This runs outside any transaction, and a few minutes is normal:
   ```sh
   docker compose exec -T postgres psql -U postgres -d treerepro -c 'vacuum (analyze) trait_records, record_annotations'
   ```
9. **Start the API:** run `docker compose up -d api`, then `docker compose ps` shows it healthy.
10. **The sheet.** Hand it to the owner. The `orphan` rows are the work whose record the new file dropped:
    - validations and withdrawals: removed;
    - contests: now independent records;
    - harmonisations: now records of their own.

    It names users, so it stays in the `700` directory and is deleted once the owner has reviewed it.

Nothing else needs reloading: species, taxa, references, plots, plot species, user plots, synonyms and proposals were never touched, and the file adds whatever is missing.
````

- [ ] **Step 5: Check every command against its source.**
  - `grep -n "import-records.js\|backup.sh" README.md docs/gotchas/import.md` shows the same script paths as 13f's section.
  - `grep -n "^USER" infra/docker/api.Dockerfile` shows `USER node`. In the Node base image, `node` has uid 1000; confirm with `docker run --rm --entrypoint id treerepro-api node` on a machine where the image is built.
  - `grep -n "db_migrator_password" compose.yml apps/api/src/config.ts` confirms the secret name.
  - Then run **Sync**, typecheck, lint and rfc. Expected: green and `rfc-lint: ok`. The Step 1 grep now prints non-zero for all three files.

- [ ] **Step 6: Commit**

```sh
git add apps/api/src/cli/import-records.ts README.md docs/gotchas/import.md
git commit -m "feat(cli): import:records --replace-imported --annotation-sheet; production runbook (RFC-64 R15, spec R-20)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Close-out: statuses, full pipeline, review, pull request

**Files:** Modify `docs/rfc/60-dataset/64-bulk-import.md`, `docs/rfc/60-dataset/63-trait-records.md` and `docs/rfc/README.md`.

- [ ] **Step 1: Rebase on the current `main`** (epic #85 rule 1; memory `main-moves-mid-run-recheck`):

```sh
git fetch origin && git rebase origin/main
```

  `ls apps/api/drizzle/*.sql | tail -3` must show no migration of this branch; none is expected. If a parallel plan changed `export.ts`, `reset.ts` or `import.ts` meanwhile, the rebase shows the conflict. Keep both sides, and re-run Step 3.

- [ ] **Step 2: Statuses.**
  - In RFC-64 and RFC-63, replace `| Status | draft |` with `| Status | accepted |`.
  - In `docs/rfc/README.md`, their two rows end in `| accepted |`.
  - Each RFC's changelog line from Task 1 ends `draft` until plan 13k merges. Append `- 2026-09-25 — accepted (plan 13k).` to each changelog.
  - Use the day of the merge if it is later.

- [ ] **Step 3: The whole pipeline** on the rebased tree (memory `parallel-plans-break-on-merge`):

```sh
# after Sync
docker exec treerepro-13k sh -c 'cd /workspace && pnpm lint && pnpm typecheck && pnpm rfc:check && pnpm build && pnpm test'
```

  Expected: all green. For a failure outside this plan's files, run the same suite on plain `origin/main` in a fresh container from `treerepro-verify:base` and compare counts before calling it pre-existing.

- [ ] **Step 4: Commit the statuses**

```sh
git add docs/rfc/60-dataset/64-bulk-import.md docs/rfc/60-dataset/63-trait-records.md docs/rfc/README.md
git commit -m "docs(rfc-64,63): accepted after replace-imported (plan 13k)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: CodeRabbit locally** on the branch before the PR (memory `coderabbit-local-before-pr`; the plan has an hourly quota). Apply the findings, re-run Step 3, and commit.

- [ ] **Step 6: Push and open the PR**

```sh
git fetch origin && git rebase origin/main   # main moved again? re-run Step 3 if anything came in
git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push -u origin feat/revision-13k-preserving-reimport
gh pr create --title "feat: replace the imported records while keeping the platform (plan 13k)" --body "$(cat <<'EOF'
Implements spec 2026-09-25 R-20 (RFC-64 R15) and the R12 amendment (plan 13k).

- `import:records --replace-imported --annotation-sheet <dir>`: in one transaction, stash and detach every annotation of an `EB_` record and every `TR_` response or harmonisation pointing at one, write the sheet (`pending`), delete the `EB_` records, import the new file, re-link by `record_code` (same species and trait for links, RFC-63 R2), recompute coverage, `trait_count`, reference usage and `reference_traits` from live records, then publish the sheet with `relinked` / `orphan`.
- A failure anywhere rolls everything back; the pending sheet stays. An orphaned harmonisation with no primary reference fails the run and names it.
- The total `--replace` is refused while any `TR_` record exists (checked in-transaction under a SHARE lock).
- Allowed in production through the runbook in `docs/gotchas/import.md`: the migrator secret, mounted only by the one-off container, is the gate.
- No migration; the batch records `mode = 'replace'`.

Closes #<n>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: After the merge.** Run `gh issue edit <n> --remove-label in-progress`, then `docker rm -f treerepro-13k`.

---

## Spec notes (ambiguities resolved minimally)

1. **When the sheet is written.** Statuses are known only after the import, and the spec wants the sheet written before the wipe. The run writes it twice:
   - Before the wipe, it writes `replace-<batch>-annotations.csv` with every status `pending`, fsync'd.
   - Once the counters are recomputed, still inside the transaction, it writes the final rows to `<sheet>.tmp`.
   - After COMMIT, one `rename` puts the final sheet in place.
   If the run fails, the `.tmp` is removed and the pending copy stays, so a `pending` sheet means the database did not change.
   The residual risk is a failure of the rename itself after COMMIT, in the same directory. The CLI then reports `Import failed: …` although the data committed, and the final sheet is the `.tmp` file. The runbook's `ls` check shows it.
2. **`--annotation-sheet` takes a directory**, not a file path. The spec fixes the file name, which contains the batch id, and the batch id exists only once the run has started. The directory must be writable **before any batch row exists** (`sheet_not_writable`). Creating the file with `wx` also refuses to overwrite anything.
3. **What the sheet lists.**
   - It lists every annotation on an `EB_` record, of every kind, with `confirm` written as `validation` (13i's word). Legacy `dispute`/`neutral` rows are listed and re-linked too: R-11 keeps them in the table, and dropping them would lose data.
   - It lists every `TR_` record whose `responds_to_record_id` names an `EB_` record. That covers contests and **complements** alike, because both block the delete through the foreign key. The kind is the record's intent.
   - It lists every `TR_` record whose `supersedes_record_id` names one (kind `harmonisation`, `mapPending`'s records). The spec does not mention these, but the foreign key forces them to be handled. `contest_record_code` carries the `TR_` code for both link kinds.
   - The sheet does not reuse 13i's `annotationRowsQuery`. That query keeps only exportable rows: visible, not withdrawn, `confirm` and contest only. The sheet must list, for example, the withdrawal of `EB_3`, a record that query drops. The sheet does reuse `csvRow`, `ANNOTATION_COLUMNS`, `REF_LABEL` and `referencesOf`.
4. **Species and trait on re-link.** A `TR_` response or harmonisation is re-linked only to a new `EB_n` of its own species and trait: RFC-63 R2's trigger fires on INSERT only, so the relink checks the same rule itself. A mismatch is an orphan. Annotations re-link by code alone, as the spec says.
5. **An orphaned harmonisation without a primary reference.** `mapPending` copies the pending record's references. When the pending `EB_` row had only a secondary reference, the harmonisation stands on `supersedes_record_id`, because `trait_records_origin_check` requires a primary reference or a supersession. Clearing it is impossible, so the run fails, rolls back and names the pairs. The runbook's dry check lists them first. Such a case needs the owner: restore the row in the file, or decide otherwise. It is expected to be empty, because IDs are stable across compilations.
6. **Batch mode.** The run records `mode = 'replace'`, because it did replace what earlier record imports loaded. A distinct `replace_imported` value would need a migration, the contracts and the web labels, for a difference the CLI report and the sheet already show. Earlier batches and their rejects are kept, unlike R12's run.
7. **Production gate.** R12's refusal stays for the total `--replace` (`isReplaceAllowed`, plus the missing secret). `--replace-imported` is **not** subject to `NODE_ENV`. Its gates are:
   - the migrator secret, mounted only by the runbook's one-off container: without it the CLI exits 1, and as `treerepro_app` the first `ALTER TABLE … DISABLE TRIGGER` fails and rolls back before any file or row is written;
   - the writable sheet directory, checked before any batch row exists.
   13f's runbook overrode `NODE_ENV` for the total replace. This one does not.
8. **Total replace over platform records** (13a's R12 amendment). This plan implements it inside the transaction, under a `SHARE` lock on `trait_records`, so no record can slip in between the check and the `TRUNCATE`. The refused run leaves a `failed` batch row that carries the message.
9. **Counters are recomputed globally**, from the migrations' backfill SQL with 13g's live filter and 13f's `record_references` counted on their own. `first_record_at`/`last_record_at` come out as the min and max over live records. The triggers never rewind `last_record_at` on a withdrawal, so a cell may show an earlier `last_record_at` than before. That is the correct value.
10. **Other orphans the spec implies:**
    - A new `EB_` row whose claim equals a `TR_` record's claim (`trait_records_claim_key`) is counted as a duplicate and not inserted. Its code is then absent, and its annotations become orphans.
    - A row that used to split (`EB_4a`, `EB_4b`) and no longer does (`EB_4`), or the reverse, changes codes. The annotations are orphaned, because the re-link is by exact code.
11. **Annotation ids are preserved**, not only the listed fields. Audit entries and anything else that names an annotation id keep resolving.
12. **RFC-63 R4** named RFC-64 R12 as the *one* sanctioned exception. Task 1 makes R15 the second, because the relink UPDATEs `trait_records` and both tables lose rows.
13. **Outside the spec's §3 file list:**
    - `export.ts` and `reset.ts`: two exports each, for reuse;
    - a pure `cli/import-records-args.ts`, so the new flag rules are tested (README rule 2); the CLI's top level runs on import and cannot be tested directly;
    - RFC-63;
    - the README command line.

## Risks

- **Run time on the full dataset.** The run deletes ~8M `EB_` rows. Each deleted row checks four foreign keys, all indexed (`responds_to`, `supersedes`, `record_annotations_record_idx`, the `record_references` PK). It then imports, recomputes the counters and leaves dead tuples. The runbook stops the API, and the vacuum step reclaims the space. The migrator connection has no statement timeout. The advisory lock and the table locks keep a second run out.
- **Personal data in the sheet.** It holds user names, never e-mails, in mode 0600 in a `700` directory. The runbook says to delete it after the owner's review.
- **13i or 13g drift.** If 13i renamed `REF_LABEL` or `referencesOf`, or 13g renamed the withdraw kind, the `rendered()` guard and the typecheck catch the first, and the Task 4 test catches the second.
- **Parallel with 13j:** no shared file.

## Self-review

- Spec R-20, step by step:
  - step 1, the sheet: Task 4 writes it pending, Task 5 covers the rollback;
  - step 2, delete only `EB_`: Task 4's `platformAfter` equals `platformBefore` except the links, and the counts are asserted;
  - step 3, the import: the normal path, with `rowsInserted: 4`;
  - step 4, re-link and orphans: the validation, the withdrawal, the harmonisation and the orphaned contest are asserted;
  - step 5, counters: hand-computed literals plus a from-scratch coverage diff.
- The runbook sentence of R-20 is covered by Task 6. The R12 refusal is covered by Task 3.
- The failure modes each have a test:
  - a malformed file after the wipe;
  - a stuck harmonisation;
  - an unwritable directory;
  - both flags at once;
  - a total replace over platform records.
  Every one of them asserts that the database is unchanged.
- No placeholders. `<n>`, `<id>` and `<owner e-mail>` are values known only at run time.
