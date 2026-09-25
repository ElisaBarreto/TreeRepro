# Revision 13e — No Accepted Value Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the accepted value everywhere (spec R-1). That covers the `accepted_values` table, `GET|PUT /api/species/:id/traits/:traitId/accepted`, **Set as accepted**, `AcceptedSection`, the accepted line and badge, the accepted history, the withdraw guard `RECORD_IS_ACCEPTED`, `GET /api/export/accepted.csv` and the permission `accepted.manage`. Every count of "accepted" becomes a count of **validated**: a species × trait is validated when at least one of its records carries a `confirm` annotation and has not been withdrawn. The export becomes the interim `GET /api/export/records.csv`, which streams every visible, non-withdrawn record in the old columns minus `decided_at`.

**Architecture:** This plan is mostly deletion. A single new SQL fragment, `validatedPairsSql()` in `apps/api/src/dataset/coverage.ts`, gives the distinct `(species_id, trait_id)` pairs that hold a confirmed, non-withdrawn record. It starts from `record_annotations`, which is human-scale. The trait summary (`validated: boolean`), the trait detail (`validatedCount`), the coverage rows (`validated`, `percentValidated`, `mode=least_validated`) and platform health (`validatedCells`) all read it. The contributions summary counts `validated` with a per-record `exists`. The export keeps its cursor-streaming machinery and changes only its query, columns, path, file name and audit scope. One migration drops the table, its trigger function and the permission rows.

**Tech Stack:** Hono 4 · Drizzle ORM 0.45 + PostgreSQL 18 · Zod 4 · React 19 + TanStack Router/Query · Vitest 5 + testcontainers · Playwright (CI only) · Biome 2.

**Spec:** `docs/specs/2026-09-25-record-model-revision-design.md`: R-1, §4 collisions, §5 (`accepted_values` dropped without keeping rows) and §6 (13e rows).

**Depends on:** 13a (RFC amendments) merged to `main`. Runs in wave 1 in parallel with 13b, 13c, 13d and 13f. 13g starts after this plan merges.

## Global Constraints

- **README rules apply:** RFC first, TDD (a failing test before production code), no DB mocks, a JSDoc `@rfc RFC-NN Rx` tag on every export, English everywhere. Claim the 13e issue first by adding the `in-progress` label and assigning it to yourself. Remove the label when the PR merges.
- **Branch and worktree:** after 13a is on `main`, run `git fetch origin && git worktree add ../TreeRepro-13e -b feat/13e-no-accepted origin/main`. Every path below is relative to that worktree.
- **RFC citations:** 13a amends RFC-31, 61, 63, 64, 65, 66, 69, 70, 71, 72, 73 and 80. This plan does not edit those files. It only fills gaps outside that list (Task 1) and edits the RFC-12 and RFC-30 catalog tables, which have code-parity tests (Tasks 2 and 8). The tags below assume 13a kept rule numbers stable (RFC-00 R3), for example "RFC-69 R5 (as amended by 13a for spec R-1)". Task 1 Step 1 checks that assumption.
- **Other plans:** do not touch files outside this plan's list. §4 collisions to keep narrow:
  - `summary.ts` and `traitSummarySchema`: 13f owns `numeric`, 13e owns `accepted`/`validated`. The lines are adjacent, so expect a conflict marker and keep both sides.
  - `packages/contracts/src/curation.ts`: 13d, 13f and 13g edit other blocks.
  - `apps/web/src/test/dataset-fixtures.ts`: the shared construction point. Edit only the accepted fields named here.
  - `records.ts`: 13f edits `itemQuery`/`toItem`, 13e edits only `getRecord`'s accepted history.
  - `reset.ts`: 13f may add `record_references`.
  - `WorkspacePage.tsx`: 13b edits the top-traits part, 13e edits one tile.
- **Migration number:** the number is fixed only at merge time (memory `migration-number-only-safe-at-merge`). This plan says `0035`. Before pushing, run `git fetch && ls apps/api/drizzle/*.sql`. If 13d, 13f or anyone else took the number, rename the `.sql` and its `meta/NNNN_snapshot.json`, fix the `_journal.json` `idx`/`tag`, re-chain `prevId` and copy the upstream migration's objects into this snapshot. `drizzle-kit generate` must then report "No schema changes, nothing to migrate".
- **Verification (this Mac has no Node).** Create one container and a sync script outside the repo. `$S` is the session scratchpad.

  ```sh
  docker run -d --name treerepro-13e -w /workspace \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
    -e TESTCONTAINERS_RYUK_DISABLED=true \
    treerepro-verify:base sleep infinity
  cat > "$S/v.sh" <<'EOF'
  #!/bin/sh
  # Sync the worktree into the container (delete first, AppleDouble-safe), then run "$@" there.
  set -e
  C=treerepro-13e
  W="$(git rev-parse --show-toplevel)"
  docker exec "$C" sh -c 'cd /workspace && find . -name node_modules -prune -o -type f -exec rm -f {} +'
  cd "$W" && COPYFILE_DISABLE=1 tar -cf - --exclude='./node_modules' --exclude='*/node_modules' \
    --exclude='./.git' --exclude='./data' --exclude='./.claude' --exclude='*/dist' \
    --exclude='.DS_Store' --exclude='._*' --exclude='*/._*' . \
    | docker exec -i "$C" tar -x -C /workspace
  docker exec -w /workspace "$C" "$@"
  EOF
  ```

  In the steps below, `V <cmd>` means `sh "$S/v.sh" <cmd>`, run from inside the worktree. The container is a copy, so anything generated inside it must be `docker cp`'d back out. `pnpm lint` in the container reports problems; apply the fixes in the worktree. E2E runs in CI only. The E2E specs are still updated here, with every asserted string checked against component source.
- **Permission catalog:** Task 8 removes a catalog row, so its verification must include the **whole web suite** (the `RoleDialog` test hardcodes the group order).
- **Drizzle builders are lazy thenables.** Never hold a builder in a variable and await it twice. The only fan-out touched here (`summary.ts`) destructures `Promise.all`.
- **Sync with `main` by rebasing, never merging** (epic #85 rule 1). After the rebase, run the full pipeline on the rebased tree.
- **Before the PR:** run one CodeRabbit CLI review on the branch (`coderabbit:code-review`), then `gh pr create`. The PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Commit messages** end with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## File Structure

```
docs/rfc/30-access/33-data-visibility.md          # R3, R4: accepted route and accepted.csv out (Task 1)
docs/rfc/50-admin/52-platform-health.md           # R1: acceptedCells → validatedCells (Task 1)
docs/rfc/60-dataset/62-trait-dictionary.md        # R7 validatedCount, R8 accepted out (Task 1)
docs/rfc/60-dataset/66-dataset-export.md          # R8 interim records.csv, only if 13a wrote none (Task 1)
docs/rfc/10-platform/12-error-codes.md            # two rows out (Task 2)
docs/rfc/30-access/30-permission-catalog.md       # accepted.manage out; dataset.export reworded (Task 8)
docs/gotchas/dataset.md                            # acceptedCsv → recordsCsv (Task 7)
README.md                                          # three accepted mentions (Task 9)

packages/contracts/src/dataset.ts (+ test)        # ACCEPTED_DECISIONS, acceptedDecisionSchema, acceptedHistory,
                                                   # traitSummary.validated, traitDetail.validatedCount, traitSpeciesItem.accepted out
packages/contracts/src/curation.ts (+ test)       # setAccepted*/accepted* schemas, speciesTraitParamSchema out
packages/contracts/src/error-codes.ts             # RECORD_IS_ACCEPTED, RECORD_NOT_HARMONISED out
packages/contracts/src/coverage.ts (+ test)       # validated / percentValidated / least_validated
packages/contracts/src/dashboard.ts (+ test)      # coverage keys renamed
packages/contracts/src/health.ts (+ test)         # validatedCells
packages/contracts/src/contributions.ts (+ test)  # isAccepted out; summary.validated
packages/contracts/src/permissions.ts             # accepted.manage out; dataset.export reworded

apps/api/drizzle/0035_no_accepted_values.sql + meta/0035_snapshot.json + meta/_journal.json
apps/api/src/db/schema/curation.ts                 # acceptedValues out
apps/api/src/db/schema/dataset.integration.test.ts
apps/api/src/dataset/curation.ts (+ integration test)   # currentAccepted/getAccepted/setAccepted, RECORD_IS_ACCEPTED out
apps/api/src/dataset/records.ts (+ integration test)    # acceptedHistory out
apps/api/src/dataset/summary.ts (+ integration test)    # accepted → validated
apps/api/src/dataset/coverage.ts (+ unit, integration)  # validatedPairsSql; accepted → validated
apps/api/src/dataset/trait-page.ts (+ integration test) # acceptedCount → validatedCount; item accepted out
apps/api/src/dataset/contributions.ts (+ integration)   # isAccepted out; summary validated
apps/api/src/dataset/queues.ts (+ integration test)     # noDecisionAfter out
apps/api/src/dataset/export.ts (+ integration test)     # acceptedCsv → recordsCsv
apps/api/src/dataset/reset.ts                            # accepted_values out
apps/api/src/admin/health.ts (+ integration test)       # validatedCells
apps/api/src/access/visibility.ts                        # comment
apps/api/src/http/routes/dataset/species.ts (+ integration test)   # accepted routes out
apps/api/src/http/routes/dataset/export.ts (+ integration test)    # /records.csv
apps/api/src/http/routes/dataset/records.integration.test.ts
apps/api/src/http/routes/dataset/traits.integration.test.ts
apps/api/src/http/routes/coverage.integration.test.ts
apps/api/src/workspace/dashboard.integration.test.ts
apps/api/src/routes-guarded.integration.test.ts
apps/api/test/helpers/dataset.ts                         # createAcceptedValue out

apps/web/src/api/curation.ts (+ test)
apps/web/src/components/curation/AcceptedSection.tsx (+ test)   # deleted
apps/web/src/components/curation/RecordActions.tsx (+ test)
apps/web/src/components/curation/CoverageTable.tsx (+ test), TopGaps.tsx (+ test)
apps/web/src/components/dataset/RecordDrawer.tsx, RecordTable.tsx (+ test), TraitCard.tsx (+ test),
                                TraitPanel.tsx, TraitSpeciesTable.tsx (+ test)
apps/web/src/components/workspace/CurationCards.tsx (+ test)
apps/web/src/components/admin/RoleDialog.test.tsx
apps/web/src/lib/use-record-write.ts
apps/web/src/pages/curation/CoveragePage.tsx (+ test), DisputedPage.tsx
apps/web/src/pages/dataset/SpeciesPage.tsx (+ test), SpeciesSearchPage.tsx (+ test), TraitPage.tsx (+ test)
apps/web/src/pages/admin/HealthPage.tsx (+ test)
apps/web/src/pages/workspace/ContributionsPage.tsx (+ test)
apps/web/src/pages/WorkspacePage.tsx
apps/web/src/test/dataset-fixtures.ts, coverage-fixtures.ts, health-fixtures.ts
apps/e2e/tests/browsing.spec.ts, contributions.spec.ts
```

---

### Task 1: RFC gaps outside 13a's list

**Files:** `docs/rfc/30-access/33-data-visibility.md`, `docs/rfc/50-admin/52-platform-health.md`, `docs/rfc/60-dataset/62-trait-dictionary.md`, `docs/rfc/60-dataset/66-dataset-export.md`

**Interfaces:** Consumes the 13a amendments on `main`. Produces rule text for `RFC-33 R3, R4`, `RFC-52 R1`, `RFC-62 R7, R8` and `RFC-66 R8`, which later tasks cite.

- [ ] **Step 1: Check what 13a covered, and stop if a rule this plan codes against is missing.**

  ```sh
  grep -n "validated" docs/rfc/60-dataset/69-coverage-summary.md docs/rfc/60-dataset/63-trait-records.md docs/rfc/70-workspace/71-my-contributions.md docs/rfc/70-workspace/72-workspace-dashboard.md
  grep -nE "accepted|RECORD_IS_ACCEPTED" docs/rfc/60-dataset/65-curation.md docs/rfc/60-dataset/66-dataset-export.md docs/rfc/60-dataset/63-trait-records.md
  grep -n "records.csv" docs/rfc/60-dataset/66-dataset-export.md
  ```

  Expected:
  - RFC-69 R5 and R7 name `validated`, `percentValidated` and `least_validated`.
  - RFC-63 R10 names the trait summary's `validated`.
  - RFC-71 R2/R4 no longer name `isAccepted`/`accepted`.
  - RFC-65 R4/R6/R10/R11 and RFC-63 R4/R7/R8 are retired or amended.

  If any of these still describes the accepted value, **stop and report it to 13a's owner**; those files are 13a's. Note the rule numbers 13a used and substitute them wherever a tag below says `(as amended by 13a)`.

- [ ] **Step 2: RFC-33.** In R4, delete the sentence `` `GET /api/species/:id/traits/:traitId/accepted` answers `SPECIES_NOT_FOUND` / `TRAIT_NOT_FOUND` for an invisible species or trait.`` In R3, replace `` `GET /api/export/accepted.csv` `` with `` `GET /api/export/records.csv` `` (skip if 13a already wrote `dataset.zip`). Append to the Changelog:

  ```
  - 2026-09-25 — R3, R4: the accepted-value route and `accepted.csv` are gone (spec R-1, plan 13e).
  ```

- [ ] **Step 3: RFC-52 R1.**

  ```sh
  perl -pi -e 's/acceptedCells/validatedCells/g; s/is the count that have an accepted value/is the count that hold a validated record (RFC-69 R5)/' docs/rfc/50-admin/52-platform-health.md
  grep -n "accept" docs/rfc/50-admin/52-platform-health.md
  ```

  Expected: the grep prints only changelog lines and uses of "accepted as" / "acceptable". Append:

  ```
  - 2026-09-25 — R1: `acceptedCells` → `validatedCells`, the cells holding a validated record (spec R-1, plan 13e).
  ```

- [ ] **Step 4: RFC-62.**
  - In R7, replace `` `acceptedCount` (species whose current accepted value is on this trait) `` with `` `validatedCount` (species with at least one validated record on this trait — a record carrying a `confirm` annotation and no `withdraw`, spec R-1) ``.
  - Replace the later `` `speciesMissing` and `acceptedCount` `` with `` `speciesMissing` and `validatedCount` ``.
  - In R8, replace `` `recordCount`, `accepted: { recordId, valueText, reference: { id, citationKey, shortCitation, kind } } | null` and `summary: `` with `` `recordCount` and `summary: ``.

  Append:

  ```
  - 2026-09-25 — R7: `acceptedCount` → `validatedCount`; R8: the per-species accepted value is gone (spec R-1, plan 13e).
  ```

- [ ] **Step 5: RFC-66 interim rule, only if Step 1's `records.csv` grep printed nothing.** Append after the last rule. Use the next free number; `R8` if R1–R7 are the last:

  ```
  - **R8** Interim, until the `dataset.zip` of plan 13i replaces it: `GET /api/export/records.csv` (`dataset.export`) streams one row per record that is not withdrawn and whose species and trait are visible to the viewer (RFC-33 R1, R2; a level the viewer cannot see prints empty). Columns, in order: `family, genus, species, name_source, category, trait, value, unit, level, numeric_value, primary_reference, secondary_reference, record_id`, with R2's meanings; pending records are included with their raw `value`. Rows are ordered by `family` and `genus` (nulls last), then `species`, trait key and record id. Format, streaming, errors and audit follow R4, R5, R6 and R7, with file name `treerepro-records-<YYYY-MM-DD>.csv` and audit `metadata: { format: 'csv', scope: 'records' }`.
  ```

  Append to the Changelog:

  ```
  - 2026-09-25 — R8: interim `records.csv` replaces `accepted.csv` (spec R-1, plan 13e).
  ```

  If 13a already wrote an interim rule, use its number instead of `R8` in every `RFC-66 R8` tag below.

- [ ] **Step 6: Commit**

  ```sh
  git add docs/rfc
  git commit -m "docs(rfc): no accepted value outside the 13a set (spec R-1)

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 2: The accepted read/write path, the withdraw guard and the accepted history

**Files:**
- Modify: `docs/rfc/10-platform/12-error-codes.md`, `packages/contracts/src/{dataset,curation,error-codes}.ts`, `packages/contracts/src/{dataset,curation}.test.ts`
- Modify: `apps/api/src/dataset/{curation,records}.ts`, `apps/api/src/http/routes/dataset/species.ts`
- Modify tests: `apps/api/src/dataset/{curation,records}.integration.test.ts`, `apps/api/src/http/routes/dataset/{species,records}.integration.test.ts`, `apps/api/src/routes-guarded.integration.test.ts`
- Modify: `apps/web/src/api/curation.ts` (+ test), `apps/web/src/components/curation/RecordActions.tsx` (+ test), `apps/web/src/components/dataset/{RecordDrawer,TraitPanel}.tsx`, `apps/web/src/lib/use-record-write.ts`, `apps/web/src/pages/dataset/SpeciesPage.tsx` (+ test), `apps/web/src/test/dataset-fixtures.ts`
- Delete: `apps/web/src/components/curation/AcceptedSection.tsx`, `apps/web/src/components/curation/AcceptedSection.test.tsx`

**Interfaces:**
- Consumes: RFC-65 R3, R4 and R11 as amended by 13a (no accepted state, no `RECORD_IS_ACCEPTED`), RFC-63 R8 (record detail without `acceptedHistory`).
- Produces: `recordDetailSchema` without `acceptedHistory`. `ERROR_CODES` without `RECORD_IS_ACCEPTED`/`RECORD_NOT_HARMONISED`. `annotateRecord(db, visibility, input): Promise<RecordDetail>` keeps its signature. `currentAccepted`, `getAccepted`, `setAccepted`, `SetAcceptedInput`, `setAcceptedBodySchema`, `speciesTraitParamSchema`, `acceptedCurrentSchema`, `acceptedHistoryEntrySchema`, `acceptedStateSchema`, `acceptedDecisionSchema` and the web `fetchAccepted`/`setAccepted`/`curationKeys.accepted` no longer exist. `ACCEPTED_DECISIONS` stays until Task 8, because the table schema still reads it.

- [ ] **Step 1: Write the failing tests.**

  `packages/contracts/src/dataset.test.ts`: add `recordDetailSchema` to the existing import from `./dataset.ts`, then append:

  ```ts
  describe('RFC-63 R8 recordDetailSchema (spec R-1)', () => {
    it('carries no accepted history', () => {
      expect(Object.keys(recordDetailSchema.shape)).not.toContain('acceptedHistory');
    });
  });
  ```

  `docs/rfc/10-platform/12-error-codes.md`: delete the two table rows `| \`RECORD_IS_ACCEPTED\` | 409 | …` and `| \`RECORD_NOT_HARMONISED\` | 409 | …`, and append to its Changelog `- 2026-09-25 — RECORD_IS_ACCEPTED and RECORD_NOT_HARMONISED retired with the accepted value (spec R-1, plan 13e).` The parity test `error-codes.test.ts` now fails.

  `apps/api/src/http/routes/dataset/species.integration.test.ts`:
  - Delete the whole `describe('RFC-65 R6 accepted value per species and trait', …)` block, from its `describe(` line to the `});` just before `describe('RFC-33 R4, RFC-60 R6 species routes by viewer'`.
  - Put this in its place:

  ```ts
  describe('spec R-1 no accepted value per species and trait', () => {
    const t = useTestApp();

    it('answers 404 NOT_FOUND on both retired accepted routes, even for an admin', async () => {
      const { user } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
      const { cookie } = await loginAs(t, user);
      const sp = await createSpecies(t.db);
      const trait = await createTrait(t.db, { levels: ['a'] });
      const path = `/api/species/${sp.id}/traits/${trait.id}/accepted`;
      for (const method of ['GET', 'PUT']) {
        const res = await call(t.app, method, path, {
          cookie,
          body: method === 'PUT' ? { decision: 'cleared', note: 'x' } : undefined,
        });
        expect(res.status, method).toBe(404);
        expect((await res.json()).error.code, method).toBe('NOT_FOUND');
      }
    });
  });
  ```

  `apps/api/src/dataset/records.integration.test.ts`, in `it('R8 detail carries raw fields, batch, annotations and accepted history; …')`:
  - Rename the test to `'R8 detail carries raw fields, batch and annotations, no accepted history; manual records carry their author'`.
  - Delete both `await t.db.insert(acceptedValues).values({…});` statements.
  - Replace the two `expect(detail?.acceptedHistory…)` assertions with:

  ```ts
      expect(detail).not.toHaveProperty('acceptedHistory');
  ```

  Then change the import `import { acceptedValues, recordAnnotations } from '../db/schema/curation.ts';` to `import { recordAnnotations } from '../db/schema/curation.ts';`.

  `apps/web/src/components/curation/RecordActions.test.tsx`: append inside `describe('RFC-70 R4 RecordActions by permission', …)`:

  ```tsx
  it('spec R-1 offers no Set as accepted and no accepted badge, even with every permission', () => {
    renderWithProviders(<RecordActions record={CURATED_RECORD_DETAIL} />, { me: ME });
    expect(screen.queryByRole('button', { name: 'Set as accepted' })).not.toBeInTheDocument();
    expect(screen.queryByText('accepted value')).not.toBeInTheDocument();
  });
  ```

  `apps/web/src/pages/dataset/SpeciesPage.test.tsx`, in `it('shows a manual record with its author, note, annotations and accepted history', …)`:
  - Rename the test to `'shows a manual record with its author, note and annotations'`.
  - Replace `expect(within(drawer).getByText('accepted')).toBeInTheDocument();` and the `'2026-09-04'` line after it with:

  ```tsx
      expect(within(drawer).queryByText('Accepted history')).not.toBeInTheDocument();
  ```

- [ ] **Step 2: Run the tests and watch them fail.**

  ```sh
  V pnpm vitest run packages/contracts/src/dataset.test.ts packages/contracts/src/error-codes.test.ts
  V pnpm vitest run apps/api/src/http/routes/dataset/species.integration.test.ts apps/api/src/dataset/records.integration.test.ts
  V pnpm vitest run apps/web/src/components/curation/RecordActions.test.tsx apps/web/src/pages/dataset/SpeciesPage.test.tsx
  ```

  Expected failures:
  - `acceptedHistory` is present.
  - The error-code parity diff lists the two codes.
  - The accepted routes answer 200 for GET and 200 for PUT, not 404.
  - "accepted value" is found in RecordActions.
  - "Accepted history" is found in the drawer.

- [ ] **Step 3: Contracts.**

  `packages/contracts/src/error-codes.ts`: delete the lines `RECORD_IS_ACCEPTED: 409,` and `RECORD_NOT_HARMONISED: 409,`.

  `packages/contracts/src/dataset.ts`:
  - Delete the block `/** @rfc RFC-63 R8 */ export const acceptedDecisionSchema = z.strictObject({ … });`.
  - Delete the line `  acceptedHistory: z.array(acceptedDecisionSchema),` inside `recordDetailSchema`.
  - Delete `export type AcceptedDecisionEntry = z.infer<typeof acceptedDecisionSchema>;`.

  `packages/contracts/src/curation.ts`:
  - Delete `  acceptedDecisionSchema,` from the `./dataset.ts` import.
  - Delete the blocks `setAcceptedBodySchema`, `speciesTraitParamSchema`, `acceptedCurrentSchema`, `acceptedHistoryEntrySchema` and `acceptedStateSchema`, each with its JSDoc line.
  - Delete the type lines `SetAcceptedBody`, `AcceptedCurrent`, `AcceptedHistoryEntry` and `AcceptedState`.

  `packages/contracts/src/curation.test.ts`: delete `  setAcceptedBodySchema,` from the import and the whole `describe('RFC-65 R6 setAcceptedBodySchema', …)` block.

- [ ] **Step 4: API.**

  `apps/api/src/dataset/curation.ts`:
  - Delete `  AcceptedDecision,` and `  AcceptedState,` from the contracts import.
  - Change `import { acceptedValues, recordAnnotations } from '../db/schema/curation.ts';` to `import { recordAnnotations } from '../db/schema/curation.ts';`.
  - Delete `currentAccepted` together with its JSDoc.
  - Delete `getAccepted`, `SetAcceptedInput` and `setAccepted` together with their JSDoc, from `/** @rfc RFC-65 R6, R11 */` to the end of `setAccepted`.
  - In `annotateRecord`, delete the guard:

  ```ts
        const current = await currentAccepted(tx, rec.speciesId, rec.traitId);
        if (current?.decision === 'accepted' && current.recordId === rec.id)
          throw new AppError(
            'RECORD_IS_ACCEPTED',
            'This record is the accepted value; change the accepted value first',
          );
  ```

  Keep the advisory lock and replace the first paragraph of `annotateRecord`'s JSDoc (from ``/**\n * `treerepro_app` has no`` down to `the now-current state.`) with:

  ```ts
  /**
   * `treerepro_app` has no `UPDATE` on `trait_records`, so `SELECT … FOR
   * UPDATE` cannot serialise two annotations of the same record — two
   * withdrawals racing past the `withdrawn` check, say. `pg_advisory_xact_lock`,
   * keyed on the record id and held for the whole transaction, does instead.
  ```

  Its `@rfc` lines stay (`RFC-65 R3, R4`, `RFC-70 R4, R5`, `RFC-33 R2, R5`).

  `apps/api/src/http/routes/dataset/species.ts`:
  - Delete `  setAcceptedBodySchema,` and `  speciesTraitParamSchema,` from the contracts import.
  - Delete the whole `import { getAccepted, requireSpecies, requireTrait, setAccepted } from '../../../dataset/curation.ts';`.
  - Delete ` * @rfc RFC-65 R6` from `speciesRoutes`' JSDoc.
  - Delete the final `.get('/:id/traits/:traitId/accepted', …)` and `.put('/:id/traits/:traitId/accepted', …)` handlers, so the chain ends with the `/:id/names` `.post(…)` followed by `;`.

  `apps/api/src/dataset/records.ts`:
  - Change the import to `import { recordAnnotations } from '../db/schema/curation.ts';`.
  - In `getRecord`'s JSDoc, replace `its annotations and the accepted-value history of its species and trait.` with `and its annotations.`.
  - Change `const [batch, annotations, history, supersededBy, responses] = await Promise.all([` to `const [batch, annotations, supersededBy, responses] = await Promise.all([`.
  - Delete the third array element, the `db.select({ id: acceptedValues.id, … }).from(acceptedValues)…orderBy(desc(acceptedValues.id)),` query.
  - Delete the `acceptedHistory: history.map((h) => ({ … })),` property.

  `apps/api/src/dataset/curation.integration.test.ts`:
  - Delete `  currentAccepted,`, `  getAccepted,` and `  setAccepted,` from the `./curation.ts` import.
  - Delete the `settled` helper and `import { AppError } from '../http/errors.ts';`.
  - Delete both `describe('RFC-65 R4, R6 the withdraw-vs-accept race …')` and `describe('RFC-65 R6 setAccepted clearing branch …')`.

  `apps/api/src/http/routes/dataset/records.integration.test.ts`:
  - In the first detail assertion, replace `expect((await detail.json()).data).toMatchObject({ id: rec.id, annotations: [], acceptedHistory: [], importBatch: { id: batch.id } });` with:

  ```ts
      const detailBody = (await detail.json()).data;
      expect(detailBody).toMatchObject({ id: rec.id, annotations: [], importBatch: { id: batch.id } });
      expect(detailBody).not.toHaveProperty('acceptedHistory');
  ```

  - In `it('R4 import records are never withdrawn; the accepted record is not withdrawn', …)`, rename the test to `'R4 import records are never withdrawn'` and delete everything from `const { rec, sp1: sp2, trait: trait2 } = await manualRecord(a.user.id);` through `expect((await accepted.json()).error.code).toBe('RECORD_IS_ACCEPTED');`.

  `apps/api/src/routes-guarded.integration.test.ts`: delete the three list entries `'GET /api/species/:id/traits/:traitId/accepted'` and `'PUT /api/species/:id/traits/:traitId/accepted'` (the latter appears twice: in the route inventory and in `withBody`).

- [ ] **Step 5: Web.**

  `apps/web/src/api/curation.ts`:
  - Delete `  type AcceptedState,`, `  acceptedStateSchema,` and `  type SetAcceptedBody,` from the contracts import.
  - Change `curationKeys`' tag line from `@rfc RFC-65 R6, R8, R10` to `@rfc RFC-65 R8, R10`.
  - Delete the `accepted: (speciesId, traitId) => […]` key.
  - Delete `fetchAccepted` and `setAccepted` with their `/** @rfc RFC-65 R6 */` lines.
  - In `invalidateAfterRecordWrite`'s JSDoc, replace `After a record, annotation, accepted or mapping write` with `After a record, annotation or mapping write`.

  Delete the component and its test:

  ```sh
  git rm apps/web/src/components/curation/AcceptedSection.tsx apps/web/src/components/curation/AcceptedSection.test.tsx
  ```

  `apps/web/src/components/dataset/TraitPanel.tsx`: delete `import { AcceptedSection } from '../curation/AcceptedSection.tsx';` and the line `<AcceptedSection speciesId={speciesId} traitId={traitId} />`. Task 3 rewrites the rest.

  `apps/web/src/components/curation/RecordActions.tsx`:
  - The contracts import becomes `import type { AnnotateRecordBody, RecordDetail, ResolveDoiResult } from '@treerepro/contracts';`.
  - The API import becomes `import { annotateRecord, resolveDoi } from '../../api/curation.ts';`.
  - The UI import becomes `import { Alert, Button, Field, HelpTip, Textarea } from '../ui/index.ts';`.
  - In `actionErrorMessage`, delete the `case 'RECORD_IS_ACCEPTED':` and `case 'RECORD_NOT_HARMONISED':` branches with their returns.
  - In `RecordActions`' JSDoc, replace `stays with the author and the \`records.withdraw\` holder (RFC-65 R4) and\n * Set as accepted with \`accepted.manage\` (RFC-65 R6). A withdrawn record has` with `stays with the author and the \`records.withdraw\` holder (RFC-65 R4). A\n * withdrawn record has`, and change `@rfc RFC-65 R3, R4, R6` to `@rfc RFC-65 R3, R4`.
  - Delete `const accept = useRecordWrite<void, AcceptedState>({ … });`.
  - Delete `accept.reset();` in `openMode`.
  - Delete the `newest`, `isAccepted` and `canAccept` declarations.
  - Replace `const error = bound ? accept.error : (annotate.error ?? accept.error);` with `const error = bound ? null : annotate.error;`.
  - Replace `if (!canAnnotate && !canAccept && !isAccepted) return null;` with `if (!canAnnotate) return null;`.
  - Delete the JSX `{isAccepted ? <Badge tone="green">accepted value</Badge> : null}` and the whole `{canAccept ? ( <Button …>Set as accepted</Button> ) : null}`.
  - Replace the comment `// settles, and would detach an in-flight accept.` with `// settles, and would detach the in-flight invalidation.`.

  `apps/web/src/components/dataset/RecordDrawer.tsx`:
  - Delete `  AcceptedDecision,` from the contracts import.
  - Delete `const DECISION_TONES … };`.
  - Delete the whole `<DrawerSection title="Accepted history"> … </DrawerSection>`.
  - In `RecordDrawer`'s JSDoc, replace `the curation trail —\n * annotations and accepted-value decisions.` with `the curation trail —\n * its annotations.`, and change `@rfc RFC-65 R3, R4, R6, R7` to `@rfc RFC-65 R3, R4, R7`.

  `apps/web/src/lib/use-record-write.ts`: in the JSDoc, replace `(create, annotate, accept or\n * clear, map)` with `(create, annotate, map)` and `which already cover the pending queues and the\n * accepted-value query)` with `which already cover the pending queues)`, and change `@rfc RFC-65 R1, R3, R6, R9` to `@rfc RFC-65 R1, R3, R9`.

  `apps/web/src/pages/dataset/SpeciesPage.tsx`: in the JSDoc, replace `so the accepted badge follows a Clear or a Set-as-accepted\n * (which invalidate the summary) instead of freezing at the click;` with `so it follows every write that invalidates the\n * summary instead of freezing at the click;`, and change `@rfc RFC-65 R1, R6` to `@rfc RFC-65 R1`.

  `apps/web/src/test/dataset-fixtures.ts`:
  - Delete `  AcceptedState,` from the import.
  - Delete `  acceptedHistory: [],` in `RECORD_DETAIL`.
  - In `CURATED_RECORD_DETAIL`, delete the `acceptedHistory: [ … ],` block and change its JSDoc to `/** The detail of PENDING_RECORD: manual and annotated. @rfc RFC-63 R8 */`.
  - Delete `ACCEPTED_STATE` and `EMPTY_ACCEPTED` with their JSDoc lines.

  `apps/web/src/api/curation.test.ts`:
  - Delete `  ACCEPTED_STATE,`, `  fetchAccepted,` and `  setAccepted,` from the imports.
  - Delete `describe('RFC-65 R6 accepted value', …)`.
  - Delete the line `expect(curationKeys.accepted('s', 't')).toEqual(['species', 's', 'traits', 't', 'accepted']);`.

  `apps/web/src/components/curation/RecordActions.test.tsx`:
  - Delete `  ACCEPTED_STATE,` from the import, `  setAccepted: vi.fn(),` from the hoisted mock, `curation.setAccepted.mockReset();`, and `  acceptedHistory: [],` from `MINE`.
  - Delete the tests `'still offers Set as accepted to an accepted.manage holder'`, `'hides Set as accepted on a record that is not harmonised, even with accepted.manage'` and `'sets the record as the accepted value with accepted.manage; maps API refusals to sentences'`.
  - In `'has no action at all on a withdrawn record'`, change `perms('records.annotate', 'accepted.manage', 'records.create')` to `perms('records.annotate', 'records.create')`.
  - Rename `'never offers Withdraw on an import record; an accepted record shows the badge instead of Set as accepted'` to `'never offers Withdraw on an import record'`, and delete from `const { unmount } =` through the end of that test's second render. The test keeps only this body:

  ```tsx
      renderWithProviders(<RecordActions record={{ ...RECORD_DETAIL, review: 'unreviewed' }} />, {
        me: perms('records.annotate', 'records.withdraw'),
      });
      expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  ```

  `apps/web/src/pages/dataset/SpeciesPage.test.tsx`:
  - Delete `  ACCEPTED_STATE,` and `  EMPTY_ACCEPTED,` from the imports.
  - Delete the two comment lines `// TraitPanel renders AcceptedSection, …` / `// the panel tests below …`.
  - Delete `  fetchAccepted: vi.fn(),`, `  setAccepted: vi.fn(),`, `curation.fetchAccepted.mockReset()…;` and `curation.setAccepted.mockReset();`.
  - In the first drawer test, delete `expect(within(drawer).getByText('No accepted value decisions yet')).toBeInTheDocument();`.
  - In `describe('RFC-65 R6 SpeciesPage trait panel follows the live summary', …)`, delete the `cleared` constant and the test `'drops the accepted badge from the row once Clear refetches the summary'`. `withAccepted` is rewritten in Task 3.

- [ ] **Step 6: Run the tests, typecheck and lint until they pass.**

  ```sh
  V pnpm vitest run packages/contracts
  V pnpm vitest run apps/api/src/http/routes/dataset/species.integration.test.ts apps/api/src/dataset/records.integration.test.ts apps/api/src/dataset/curation.integration.test.ts apps/api/src/http/routes/dataset/records.integration.test.ts apps/api/src/routes-guarded.integration.test.ts
  V pnpm --filter @treerepro/web test
  V pnpm typecheck
  V pnpm lint
  V pnpm rfc:check
  ```

  Expected: everything passes. If `pnpm lint` reports unused imports in a touched test file (for example `createRole` in `species.integration.test.ts`), remove them in the worktree and re-run.

- [ ] **Step 7: Commit**

  ```sh
  git add -A packages/contracts apps/api/src apps/web/src docs/rfc/10-platform/12-error-codes.md
  git commit -m "feat: remove the accepted value routes, guard and history (spec R-1)

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 3: Trait summary — `accepted` becomes `validated`

**Files:** `packages/contracts/src/dataset.ts` (+ test), `apps/api/src/dataset/coverage.ts` (the fragment only), `apps/api/src/dataset/summary.ts` (+ integration test), `apps/api/src/http/routes/dataset/records.integration.test.ts`, `apps/web/src/components/dataset/{TraitCard,TraitPanel,RecordTable}.tsx`, `apps/web/src/components/dataset/{TraitCard,RecordTable}.test.tsx`, `apps/web/src/pages/dataset/SpeciesPage.test.tsx`, `apps/web/src/test/dataset-fixtures.ts`

**Interfaces:**
- Consumes: RFC-63 R10 and RFC-70 R7 as amended by 13a (trait summary `validated`).
- Produces:
  - `validatedPairsSql(): SQL` in `apps/api/src/dataset/coverage.ts`. It selects the distinct `(species_id, trait_id)` pairs holding a record with a `confirm` annotation and no `withdraw`.
  - `traitSummarySchema` gains `validated: z.boolean()` in place of `accepted`.
  - `RecordTable` loses `acceptedRecordId`.

- [ ] **Step 1: Write the failing tests.**

  `packages/contracts/src/dataset.test.ts`, in `'accepts categorical and quantitative summaries'`: replace `accepted: null,` with `validated: false,` and `accepted: { recordId: uuid, valueText: '2', decidedAt: '2026-09-13T00:00:00.000Z' },` with `validated: true,`.

  `apps/api/src/dataset/summary.integration.test.ts`:
  - Delete `import { acceptedValues } from '../db/schema/curation.ts';` and add `  createAnnotation,` to the helpers import.
  - Rename the first test to `'aggregates per category and trait: counts, levels, numeric stats, validated'`.
  - Replace `await t.db.insert(acceptedValues).values({ speciesId: sp1.id, traitId: color.id, recordId: b1.id, decision: 'accepted', actorId: user.id });` with:

  ```ts
      await createAnnotation(t.db, { recordId: b1.id, actorId: user.id, kind: 'confirm' });
  ```

  - In `expect(colorSummary).toEqual({…})`, replace `accepted: { recordId: b1.id, valueText: 'blue', decidedAt: expect.any(String) },` with `validated: true,`.
  - In the `petalSummary` expectation, replace `accepted: null,` with `validated: false,`.
  - Replace the block from `await t.db\n      .insert(acceptedValues)` through `).toBeNull();` with:

  ```ts
      // A withdrawn record is no longer a validated one (spec R-1).
      await createAnnotation(t.db, { recordId: b1.id, actorId: user.id, kind: 'withdraw' });
      expect(
        (await speciesTraitSummary(t.db, UNRESTRICTED, sp1.id))?.[1]?.traits[0]?.validated,
      ).toBe(false);
  ```

  - In the `includeMissing` test, change the comment's `no accepted\n    // value` to `not\n    // validated` and replace `accepted: null,` with `validated: false,`.

  `apps/api/src/http/routes/dataset/records.integration.test.ts`: in the species summary assertion (`trait: { key: 'flower_color' }, recordCount: 1, accepted: null`), replace `accepted: null,` with `validated: false,`.

  `apps/web/src/components/dataset/TraitCard.test.tsx`:
  - Rename the first test to `'is a button named after the trait, with the record count, level bars and the pending line'`.
  - Replace its comment `// Each bar's label sits next to its count; the accepted line repeats\n    // "dioecious" lower down, hence the selector.` with `// Each bar's label sits next to its count.`
  - Replace `expect(card).toHaveTextContent('accepted: dioecious');` with `expect(card).not.toHaveTextContent('accepted');`.
  - Rename the quantitative test to `'shows min · median · max with the unit for a quantitative trait, without a pending line'`.

- [ ] **Step 2: Run the tests and watch them fail.**

  ```sh
  V pnpm vitest run packages/contracts/src/dataset.test.ts apps/api/src/dataset/summary.integration.test.ts apps/web/src/components/dataset/TraitCard.test.tsx
  ```

  Expected: the strict schema rejects `validated`, the summary has `accepted` and no `validated`, and the card shows `accepted: dioecious`.

- [ ] **Step 3: Contract.** In `packages/contracts/src/dataset.ts`, in `traitSummarySchema`, replace:

  ```ts
    accepted: z
      .strictObject({ recordId: z.uuid(), valueText: z.string(), decidedAt: z.iso.datetime() })
      .nullable(),
  ```

  with:

  ```ts
    /** At least one of the species' records on the trait is validated (spec R-1). */
    validated: z.boolean(),
  ```

- [ ] **Step 4: The shared fragment.** In `apps/api/src/dataset/coverage.ts`, after `percentHalfUp`, add:

  ```ts
  /**
   * The species × trait pairs that hold a validated record: one carrying a
   * `confirm` annotation and no `withdraw` (spec R-1). It starts from
   * `record_annotations`, which is human-scale, and never scans
   * `trait_records`; callers join or filter the pairs by their own selection.
   * @rfc RFC-69 R5
   * @rfc RFC-63 R10
   */
  export function validatedPairsSql(): SQL {
    return sql`select distinct r.species_id, r.trait_id
      from record_annotations a
      join trait_records r on r.id = a.record_id
      where a.kind = 'confirm'
        and not exists (select 1 from record_annotations w
                        where w.record_id = r.id and w.kind = 'withdraw')`;
  }
  ```

- [ ] **Step 5: Service.** In `apps/api/src/dataset/summary.ts`:
  - Add `import { validatedPairsSql } from './coverage.ts';`.
  - Delete `interface AcceptedCurrent { … }`.
  - In the JSDoc, replace `level distribution or numeric spread, and the current accepted value.` with `level distribution or numeric spread, and whether any record is validated.`.
  - Change `const [aggregates, levels, accepted] = await Promise.all([` to `const [aggregates, levels, validated] = await Promise.all([`, and replace the third query (the `select distinct on (a.trait_id) … from accepted_values a …` one) with:

  ```ts
      // Visibility needs no predicate here: only visible traits reach
      // `summaryOf`, and the species was checked above.
      db.execute(sql`
        select v.trait_id from (${validatedPairsSql()}) v
        where v.species_id = ${speciesId}`) as unknown as Promise<{ trait_id: string }[]>,
  ```

  - Replace the whole `const acceptedByTrait = …; for (const a of accepted) { … }` with:

  ```ts
    const validatedTraits = new Set(validated.map((v) => v.trait_id));
  ```

  - In `summaryOf`, replace `accepted: acceptedByTrait.get(trait.id) ?? null,` with `validated: validatedTraits.has(trait.id),`.

- [ ] **Step 6: Web.**

  `apps/web/src/components/dataset/TraitCard.tsx`:
  - Change `const { trait, recordCount, levels, numeric, accepted } = summary;` to `const { trait, recordCount, levels, numeric } = summary;`.
  - Delete the `{accepted ? ( <span …>accepted: …</span> ) : null}` block.
  - In the JSDoc, replace `how many records still wait for\n * harmonisation, and the accepted value.` with `and how many records still wait for\n * harmonisation.`

  `apps/web/src/components/dataset/RecordTable.tsx`:
  - Delete the `acceptedRecordId` destructure, its prop type line and the JSX line `{record.id === acceptedRecordId ? <Badge tone="green">accepted</Badge> : null}`.
  - Change the UI import to `import { Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';`.
  - In the JSDoc, delete ``` `acceptedRecordId` marks the species × trait's current\n * accepted value with a badge next to it (RFC-65 R6).``` and ` * @rfc RFC-65 R6`, and replace `standing rather than the one accepted id a species page has.` with `standing.`.

  `apps/web/src/components/dataset/TraitPanel.tsx`: replace the JSDoc and the `RecordTable` element with:

  ```tsx
  /**
   * The records of one trait for one species, in a wide drawer: one page at a
   * time of `GET /api/records?speciesId&traitId` (RFC-63 R9) rendered as a
   * `RecordTable` without the species and trait columns, which the page and
   * the title already name; a row hands its id back so the page can open the
   * record.
   * @rfc RFC-63 R9
   */
  ```

  ```tsx
            <RecordTable records={list.items} onSelect={(record) => onSelectRecord(record.id)} />
  ```

  `apps/web/src/test/dataset-fixtures.ts`:
  - In `SEXUAL_SYSTEM_SUMMARY`, replace the `accepted: { … },` block with `validated: true,`.
  - In `SEED_MASS_SUMMARY`, `POLLINATION_MODE_SUMMARY`, `SELF_COMPATIBILITY_MISSING_SUMMARY` and `SEED_LENGTH_MISSING_SUMMARY`, replace `accepted: null,` with `validated: false,`.

  `apps/web/src/components/dataset/RecordTable.test.tsx`: delete `it('marks the accepted record row', …)`.

  `apps/web/src/pages/dataset/SpeciesPage.test.tsx`: in the live-summary describe:
  - Rename it to `describe('RFC-63 R10 SpeciesPage trait panel follows the live summary', …)`.
  - Delete its two-line opening comment.
  - Replace the `withAccepted` constant with:

  ```tsx
    const summary: SpeciesTraits = [
      { category: { key: 'sexual_system', label: 'Sexual system' }, traits: [SEXUAL_SYSTEM_SUMMARY] },
    ];
  ```

  In `'closes the panel when its trait leaves the summary'`, change `mockResolvedValueOnce(withAccepted)` to `mockResolvedValueOnce(summary)`.

- [ ] **Step 7: Run to pass.**

  ```sh
  V pnpm vitest run packages/contracts apps/api/src/dataset/summary.integration.test.ts apps/api/src/http/routes/dataset/records.integration.test.ts apps/api/src/http/routes/dataset/species.integration.test.ts
  V pnpm --filter @treerepro/web test
  V pnpm typecheck
  V pnpm lint
  V pnpm rfc:check
  ```

  Expected: PASS.

- [ ] **Step 8: Commit**

  ```sh
  git add -A packages/contracts apps/api/src apps/web/src
  git commit -m "feat: trait summary says validated, not accepted (spec R-1)

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 4: Trait page — `acceptedCount` becomes `validatedCount`, per-species accepted value removed

**Files:** `packages/contracts/src/dataset.ts` (+ test), `apps/api/src/dataset/trait-page.ts` (+ integration test), `apps/api/src/access/visibility.ts` (comment), `apps/api/src/http/routes/dataset/traits.integration.test.ts`, `apps/web/src/pages/dataset/TraitPage.tsx` (+ test), `apps/web/src/components/dataset/TraitSpeciesTable.tsx` (+ test), `apps/web/src/test/dataset-fixtures.ts`

**Interfaces:**
- Consumes: `validatedPairsSql()` (Task 3) and RFC-62 R7/R8 (Task 1).
- Produces: `traitDetailSchema.validatedCount: number`. `traitSpeciesItemSchema` without `accepted`. `getTraitDetail` and `listTraitSpecies` keep their signatures.

- [ ] **Step 1: Write the failing tests.**

  `apps/api/src/dataset/trait-page.integration.test.ts`:
  - Replace `  createAcceptedValue,` with `  createAnnotation,` in the helpers import.
  - Delete `import { ensurePersonalObservation } from './references.ts';`.
  - Change `expect(detail?.acceptedCount).toBe(0);` to `expect(detail?.validatedCount).toBe(0);`.
  - Replace the whole test `'counts the species whose current accepted value is on the trait, not every decision ever made'` with:

  ```ts
    it('counts the species with a validated record on the trait, once each; a withdrawal takes one out', async () => {
      const { user } = await createUser(t.db);
      const reference = await createReference(t.db);
      const trait = await createTrait(t.db, { levels: ['alpha'] });
      const alpha = levelOf(trait, 'alpha');
      const one = await createSpecies(t.db);
      const two = await createSpecies(t.db);
      const claim = { traitId: trait.id, valueText: 'alpha', levelId: alpha.id };
      const firstRecord = await record(t.db, {
        actor: user,
        speciesId: one.id,
        referenceId: reference.id,
        ...claim,
      });
      const secondRecord = await record(t.db, {
        actor: user,
        speciesId: two.id,
        referenceId: reference.id,
        ...claim,
      });

      try {
        const detail = async () => await getTraitDetail({ db: t.db, redis }, UNRESTRICTED, trait.id);
        expect((await detail())?.validatedCount).toBe(0);

        await createAnnotation(t.db, { recordId: firstRecord.id, actorId: user.id, kind: 'confirm' });
        await createAnnotation(t.db, { recordId: secondRecord.id, actorId: user.id, kind: 'confirm' });
        // A second validation of the same record does not count its species twice.
        await createAnnotation(t.db, { recordId: secondRecord.id, actorId: user.id, kind: 'confirm' });
        expect((await detail())?.validatedCount).toBe(2);

        await createAnnotation(t.db, { recordId: secondRecord.id, actorId: user.id, kind: 'withdraw' });
        expect((await detail())?.validatedCount).toBe(1);
      } finally {
        await forgetCached(redis, ...cacheKeys(trait.id));
      }
    });
  ```

  - In `'counts globally: a plot-bound viewer sees the numbers of the whole dataset'`:
    - Replace the comment `// The only accepted value is on the species outside the plot.` with `// The only validated record is on the species outside the plot.`
    - Replace the `createAcceptedValue(t.db, { … })` call with `await createAnnotation(t.db, { recordId: written.id, actorId: user.id, kind: 'confirm' });`.
    - Replace `expect(plotBound?.acceptedCount).toBe(1);` with `expect(plotBound?.validatedCount).toBe(1);`.
  - In `'with: every species that has a record, its count, its accepted value and a summary of its records'`:
    - Rename it to `'with: every species that has a record, its count and a summary of its records'`.
    - Change `const accepted = await record(t.db, {` to `await record(t.db, {`, because nothing reads the record any more.
    - Delete the `createAcceptedValue(…)` call and the whole `accepted: { … },` block from the `toMatchObject`, and add after it:

  ```ts
      expect(data[0]).not.toHaveProperty('accepted');
  ```

  - Delete the whole test `'RFC-61 R4, R7 with: an accepted value from a personal observation carries its observer, decrypted'`.
  - Rename `'with: a species no curator has decided on carries a null accepted value and a numeric summary'` to `'with: a quantitative species carries a numeric summary'` and delete its `accepted: null,` line.
  - In the `missing` test, change `expect(data[0]).toMatchObject({ recordCount: null, accepted: null, summary: null });` to `expect(data[0]).toEqual(expect.objectContaining({ recordCount: null, summary: null }));` followed by `expect(data[0]).not.toHaveProperty('accepted');`.

  `packages/contracts/src/dataset.test.ts`:
  - Change `acceptedCount: 8,` to `validatedCount: 8,`.
  - In the `traitSpeciesItemSchema` describe, rename `'accepted carries a reference with shortCitation; everything is nullable for missing mode'` to `'everything is nullable for missing mode'` and delete its `accepted: { … },` block and every `accepted: null,` line in that describe.
  - Add to that describe:

  ```ts
    it('spec R-1 has no accepted value', () => {
      expect(Object.keys(traitSpeciesItemSchema.shape)).not.toContain('accepted');
    });
  ```

  `apps/web/src/pages/dataset/TraitPage.test.tsx`:
  - Replace `expect(definition('Accepted values')).toHaveTextContent('1');` with `expect(definition('Species validated')).toHaveTextContent('1');`.
  - Replace `).toEqual(['Species', 'Family', 'Records', 'Accepted value', 'Source']);` with `).toEqual(['Species', 'Family', 'Records']);`.
  - Delete the two assertions on `cells[3]` and `cells[4]` in that test.
  - Rename `'reads "—" where no value was accepted and prints a numeric summary with the unit'` to `'prints a numeric summary with the unit'` and delete its `cells[3]`/`cells[4]` assertions.

  `apps/web/src/components/dataset/TraitSpeciesTable.test.tsx`:
  - Rename the first test to `'names the species, its family and its records'`.
  - Change its header list to `['Species', 'Family', 'Records']`.
  - Delete the `row[3]` and `row[4]` assertions.
  - Rename `'dashes the family, the accepted value and its source when there is none'` to `'dashes the family when there is none'` and keep only `expect(row[1]).toHaveTextContent('—');` plus `expect(row).toHaveLength(3);`.

- [ ] **Step 2: Run the tests and watch them fail.**

  ```sh
  V pnpm vitest run apps/api/src/dataset/trait-page.integration.test.ts packages/contracts/src/dataset.test.ts apps/web/src/pages/dataset/TraitPage.test.tsx apps/web/src/components/dataset/TraitSpeciesTable.test.tsx
  ```

  Expected: `validatedCount` is undefined, `accepted` is present, and the "Species validated" label and 3-column header are missing.

- [ ] **Step 3: Contract.** In `packages/contracts/src/dataset.ts`:
  - In `traitDetailSchema`, replace `acceptedCount: z.number().int().nonnegative(),` with `validatedCount: z.number().int().nonnegative(),`, and in its JSDoc replace `the accepted-value count` with `the count of species with a validated record`.
  - In `traitSpeciesItemSchema`, delete the `accepted: z.strictObject({ … }).nullable(),` property.
  - Replace its JSDoc body with:

  ```ts
  /**
   * A species row of `GET /api/traits/:id/species`: the species list item plus,
   * in `with` mode, its record count and a per-species summary of its records
   * on the trait — `levels` for a categorical trait, `numeric` for a
   * quantitative one. `missing` mode leaves both `null`.
   * @rfc RFC-62 R8
   */
  ```

- [ ] **Step 4: Service.** In `apps/api/src/dataset/trait-page.ts`:
  - The imports become `import { eq, sql } from 'drizzle-orm';`. Delete `import { users } from '../db/schema/users.ts';` and add `import { validatedPairsSql } from './coverage.ts';`.
  - In `getTraitDetail`'s JSDoc, replace `how many have\n * an accepted value,` with `how many have\n * a validated record,`.
  - Replace the `accepted_count` subselect (from `(select count(*)::int from (` down to `) newest where newest.decision = 'accepted') as accepted_count`) with:

  ```ts
          (select count(*)::int
             from (${validatedPairsSql()}) v
             join species s on s.id = v.species_id
            where v.trait_id = ${id}::uuid
              and ${globalSpeciesVisible(visibility, sql`s.active`, sql`s.id`)}
          ) as validated_count
  ```

  - Change the cast to `Promise<{ species_missing: number; validated_count: number }[]>` and the property to `validatedCount: counts[0]?.validated_count ?? 0,`.
  - Delete `interface AcceptedRow`, `observerNames` and `collectAccepted`.
  - Replace `Enrichment` and `enrich` with:

  ```ts
  /** What the page's species have on the trait, keyed by species id. */
  interface Enrichment {
    recordCount: Map<string, number>;
    summary: Map<string, Summary>;
  }

  /**
   * The records of the species of one page, in one query bounded to that
   * page's ids (at most `limit` ≤ 200, the coverage index's
   * `(species_id, trait_id)` prefix) rather than to the trait as a whole.
   */
  async function enrich(
    db: DbExecutor,
    visibility: Visibility,
    traitId: string,
    valueType: 'categorical' | 'quantitative',
    ids: string[],
  ): Promise<Enrichment> {
    const recordCount = new Map<string, number>();
    const summary = new Map<string, Summary>();

    if (valueType === 'quantitative') {
      const rows = (await db.execute(sql`
        select r.species_id, count(*)::int as record_count,
          min(r.numeric_value)::float8 as numeric_min,
          max(r.numeric_value)::float8 as numeric_max
        from trait_records r
        where r.trait_id = ${traitId}::uuid and r.species_id = any(${sql.param(ids)}::uuid[])
        group by r.species_id
      `)) as unknown as SpeciesNumericRow[];
      for (const r of rows) {
        recordCount.set(r.species_id, r.record_count);
        summary.set(
          r.species_id,
          r.numeric_min === null || r.numeric_max === null
            ? null
            : { numeric: { min: r.numeric_min, max: r.numeric_max } },
        );
      }
      return { recordCount, summary };
    }

    const rows = (await db.execute(sql`
      select r.species_id, l.key as level_key, count(*)::int as count
      from trait_records r
      left join trait_levels l
        on l.id = r.level_id and ${levelVisible(visibility, sql`l.active`)}
      where r.trait_id = ${traitId}::uuid and r.species_id = any(${sql.param(ids)}::uuid[])
      group by r.species_id, l.key
      order by count desc, l.key
    `)) as unknown as SpeciesLevelRow[];
    const levels = new Map<string, { key: string; count: number }[]>();
    for (const r of rows) {
      // Every record counts, harmonised or not; only the ones that landed on a
      // visible level can be summarised (RFC-63 R5).
      recordCount.set(r.species_id, (recordCount.get(r.species_id) ?? 0) + r.count);
      if (r.level_key === null) continue;
      levels.set(r.species_id, [
        ...(levels.get(r.species_id) ?? []),
        { key: r.level_key, count: r.count },
      ]);
    }
    for (const [speciesId, entries] of levels) summary.set(speciesId, { levels: entries });
    return { recordCount, summary };
  }
  ```

  - In `listTraitSpecies`, change the missing-mode map to `data.map((s) => ({ ...s, recordCount: null, summary: null }))` and delete `accepted: enrichment.accepted.get(s.id) ?? null,`.
  - In its JSDoc, replace `In \`with\` mode each row carries the species' own records on the trait and\n * the value a curator accepted from them; \`missing\` mode has no records to\n * describe, so all three are null.` with `In \`with\` mode each row carries the species' own records on the trait;\n * \`missing\` mode has no records to describe, so both are null.`

  `apps/api/src/access/visibility.ts`: in `globalSpeciesVisible`'s JSDoc, change `` `acceptedCount` `` to `` `validatedCount` ``.

  `apps/api/src/http/routes/dataset/traits.integration.test.ts`: change `acceptedCount: 0,` to `validatedCount: 0,`, and change `expect.objectContaining({ id: without.id, recordCount: null, accepted: null, summary: null }),` to `expect.objectContaining({ id: without.id, recordCount: null, summary: null }),`.

- [ ] **Step 5: Web.**

  `apps/web/src/pages/dataset/TraitPage.tsx`:
  - Replace `{ label: 'Accepted values', value: formatNumber(trait.acceptedCount) },` with `{ label: 'Species validated', value: formatNumber(trait.validatedCount) },`.
  - In the page JSDoc, replace `lack it or have an accepted value,` with `lack it or have a validated record,`.

  `apps/web/src/components/dataset/TraitSpeciesTable.tsx`:
  - Delete `import { referenceLabel } from '../../lib/references.ts';`.
  - Replace the with-mode header fragment `<> <Th>Records</Th> <Th>Accepted value</Th> <Th>Source</Th> </>` with `<Th>Records</Th>`.
  - In the with-mode row, delete the two `<Td>` cells after the Records cell (the accepted value and the Source link), leaving the Records `<Td>` alone inside the fragment. Replace the fragment `<> … </>` around it with the bare `<Td>` and move the `{/* The count and the summary … */}` comment inside the `<Td>`.
  - In the JSDoc, replace `a one-line\n * summary of them, the value a curator accepted and the article it came from\n * — each of the last two a dash while nothing has been accepted. In` with `and a one-line\n * summary of them. In`.

  `apps/web/src/test/dataset-fixtures.ts`:
  - Change `acceptedCount: 7,` / `1,` / `0,` to `validatedCount: 7,` / `1,` / `0,`.
  - In `TRAIT_SPECIES_WITH_DATA`, delete the `accepted: { … },` block and change its JSDoc to `/** A species row of \`mode=with\`: records and their summary. @rfc RFC-62 R8 */`.
  - In `TRAIT_SPECIES_UNDECIDED`, delete `accepted: null,` and change its JSDoc to `/** A quantitative \`mode=with\` row. @rfc RFC-62 R8 */`.
  - In `TRAIT_SPECIES_MISSING`, delete `accepted: null,` and change the JSDoc's `no count, value or summary` to `no count or summary`.

- [ ] **Step 6: Run to pass.**

  ```sh
  V pnpm vitest run packages/contracts apps/api/src/dataset/trait-page.integration.test.ts apps/api/src/http/routes/dataset/traits.integration.test.ts
  V pnpm --filter @treerepro/web test
  V pnpm typecheck
  V pnpm lint
  V pnpm rfc:check
  ```

  Expected: PASS.

- [ ] **Step 7: Commit**

  ```sh
  git add -A packages/contracts apps/api/src apps/web/src
  git commit -m "feat: trait page counts validated species, drops the accepted value (spec R-1)

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 5: Coverage, dashboard tile and platform health — `accepted` becomes `validated`

**Files:** `packages/contracts/src/{coverage,dashboard,health}.ts` (+ tests), `apps/api/src/dataset/coverage.ts` (+ `coverage.test.ts`, `coverage.integration.test.ts`), `apps/api/src/admin/health.ts` (+ integration test), `apps/api/src/http/routes/coverage.integration.test.ts`, `apps/api/src/workspace/dashboard.integration.test.ts`, `apps/web/src/components/curation/{CoverageTable,TopGaps}.tsx` (+ tests), `apps/web/src/pages/curation/CoveragePage.tsx` (+ test), `apps/web/src/components/workspace/CurationCards.tsx` (+ test), `apps/web/src/pages/admin/HealthPage.tsx` (+ test), `apps/web/src/api/coverage.ts`, `apps/web/src/test/{coverage-fixtures,health-fixtures,dataset-fixtures}.ts`

**Interfaces:**
- Consumes: `validatedPairsSql()`, RFC-69 R5/R7 and RFC-72 R1 as amended by 13a, and RFC-52 R1 (Task 1).
- Produces:
  - `CoverageRow`/`CoverageTotals` = `{ cells, withData, validated, percentWithData, percentValidated }`.
  - `coverageTopQuerySchema.mode: 'missing' | 'least_validated'`.
  - `rankCoverageTraits(rows, mode: 'missing' | 'least_validated')`.
  - `platformHealthSchema.dataset.validatedCells`.
  - `dashboardSchema.curation.coverage` with the same five keys.

- [ ] **Step 1: Write the failing tests with a mechanical rename, then fix the fixtures by hand.**

  ```sh
  perl -pi -e 's/percentAccepted/percentValidated/g; s/least_accepted/least_validated/g; s/LEAST_ACCEPTED/LEAST_VALIDATED/g; s/\baccepted\b/validated/g' \
    apps/api/src/dataset/coverage.test.ts apps/api/src/dataset/coverage.integration.test.ts \
    packages/contracts/src/coverage.test.ts
  perl -pi -e 's/percentAccepted/percentValidated/g; s/least_accepted/least_validated/g; s/\baccepted: /validated: /g; s/\.accepted\b/.validated/g; s/'"'"'accepted'"'"',/'"'"'validated'"'"',/g; s/acceptedCells/validatedCells/g' \
    apps/api/src/http/routes/coverage.integration.test.ts apps/api/src/workspace/dashboard.integration.test.ts \
    apps/api/src/admin/health.integration.test.ts packages/contracts/src/health.test.ts \
    apps/web/src/components/curation/CoverageTable.test.tsx apps/web/src/pages/curation/CoveragePage.test.tsx \
    apps/web/src/components/workspace/CurationCards.test.tsx apps/web/src/pages/admin/HealthPage.test.tsx
  ```

  Then make these edits by hand:

  1. `packages/contracts/src/dashboard.test.ts`: in the `curation.coverage` literal only, change `accepted: 40` to `validated: 40` and `percentAccepted: 40` to `percentValidated: 40`. The `summary` literal's `accepted: 2` is Task 6.
  2. `apps/api/src/workspace/dashboard.integration.test.ts`: the sorted key list must read `['cells', 'percentValidated', 'percentWithData', 'validated', 'withData']`.
  3. `apps/api/src/dataset/coverage.integration.test.ts`:
     - The import: replace `  createAcceptedValue,` with `  createAnnotation,`.
     - In `coverageTotals over the visible grid`, replace the `cell` helper and its five calls with:

     ```ts
          // A confirmed record validates its cell; one withdrawn afterwards
          // does not, and a dispute before the confirmation changes nothing.
          const cell = async (
            speciesId: string,
            trait: { id: string; levels: { id: string; key: string }[] },
            kinds: ('confirm' | 'dispute' | 'withdraw')[],
          ) => {
            const record = await createRecord(tx, {
              speciesId,
              traitId: trait.id,
              valueText: 'a',
              levelId: trait.levels[0]?.id,
              primaryReferenceId: reference.id,
              origin: 'manual',
              createdBy: user.id,
            });
            for (const kind of kinds) {
              await createAnnotation(tx, { recordId: record.id, actorId: user.id, kind });
            }
          };
          await cell(speciesOne.id, traitOne, ['confirm']);
          await cell(speciesTwo.id, traitOne, ['confirm', 'withdraw']);
          await cell(speciesOne.id, traitTwo, ['dispute', 'confirm']);
          await cell(speciesOff.id, traitOne, ['confirm']);
          await cell(speciesOne.id, traitOff, ['confirm']);
     ```

     The deltas stay `after.validated - before.validated === 2` and `afterInactive… === 4`. `withData` stays 3 and 5, because a withdrawn record keeps its coverage row until 13g.
     - In `coverageFixture`, rename `acceptedRecord` to `validatedRecord` and replace the `createAcceptedValue(tx, {…})` call with `await createAnnotation(tx, { recordId: validatedRecord.id, actorId: user.id, kind: 'confirm' });`.
     - In `'stores each viewer class under the key RFC-69 R5 names'`, the list is compared against sorted keys, so it must read `const fields = ['cells', 'percentValidated', 'percentWithData', 'validated', 'withData'];`.
  4. `apps/api/src/admin/health.integration.test.ts`:
     - Delete `  createAcceptedValue,` from the import.
     - Delete the `for (const [index, cell] of cells.slice(0, 2).entries()) { await createAcceptedValue(…) }` loop. The two `confirm` annotations the test already writes on `records[0]` and `records[1]` now make those cells validated. Only `records[0]` sits on the active × active cell, so `after.dataset.validatedCells - before.dataset.validatedCells` stays `1`.
     - Change the comment `Four records on four distinct cells, two of them accepted.` to `Four records on four distinct cells, two of them validated.` and `of the two that gained an accepted value exactly one` to `of the two that gained a validated record exactly one`.
  5. `apps/web/src/test/coverage-fixtures.ts`: run `perl -pi -e 's/percentAccepted/percentValidated/g; s/least_accepted/least_validated/g; s/LEAST_ACCEPTED/LEAST_VALIDATED/g; s/\baccepted: /validated: /g; s/unaccepted/unvalidated/g; s/lowest accepted share/lowest validated share/g'` on it.
  6. `apps/web/src/test/health-fixtures.ts`: `perl -pi -e 's/acceptedCells/validatedCells/g'`.
  7. `apps/web/src/test/dataset-fixtures.ts`: in `DASHBOARD_CURATION.coverage`, change `accepted: 57` to `validated: 57` and `percentAccepted: 29` to `percentValidated: 29`.
  8. `apps/web/src/components/curation/TopGaps.test.tsx`:
     - Run `perl -pi -e 's/LEAST_ACCEPTED/LEAST_VALIDATED/g; s/least_accepted/least_validated/g; s/percentAccepted/percentValidated/g; s/lowest accepted share/lowest validated share/g; s/% accepted/% validated/g; s/least accepted/least validated/g; s/shows accepted percentages/shows validated percentages/g'` on it.

  Then run `grep -n "ccepted" <each file above>` and hand-fix any remaining word in a test title or comment to "validated".

- [ ] **Step 2: Run the tests and watch them fail.**

  ```sh
  V pnpm vitest run apps/api/src/dataset/coverage.test.ts packages/contracts/src/coverage.test.ts packages/contracts/src/health.test.ts packages/contracts/src/dashboard.test.ts
  V pnpm vitest run apps/api/src/dataset/coverage.integration.test.ts apps/api/src/admin/health.integration.test.ts
  V pnpm vitest run apps/web/src/components/curation apps/web/src/pages/curation apps/web/src/components/workspace apps/web/src/pages/admin
  ```

  Expected failures:
  - `least_validated` ranks by `withData`, so the order is `['03','02','01','04']`.
  - The strict schemas reject `validated`/`validatedCells`.
  - The services return `accepted`.
  - The web toggle still reads "Lowest accepted share".

- [ ] **Step 3: Contracts.**

  `packages/contracts/src/coverage.ts`:
  - In `coverageRowSchema`, change `accepted: n,` to `validated: n,` and `percentAccepted: pct,` to `percentValidated: pct,`.
  - In its JSDoc, change `` `percentAccepted =\n * accepted / cells` `` to `` `percentValidated =\n * validated / cells` `` (validated = a species × trait holding a record with a `confirm` annotation and no `withdraw`).
  - In `coverageTopQuerySchema`, change the enum to `mode: z.enum(['missing', 'least_validated']).optional(),` and the JSDoc's ``the lowest accepted share\n * (`mode=least_accepted`)`` to ``the lowest validated share\n * (`mode=least_validated`)``.

  `packages/contracts/src/dashboard.ts`: change `accepted: z.number().int().nonnegative(),` to `validated: z.number().int().nonnegative(),` and `percentAccepted:` to `percentValidated:` in `curation.coverage`.

  `packages/contracts/src/health.ts`:
  - Change `acceptedCells: n,` to `validatedCells: n,`.
  - Change the JSDoc lines to `` `dataset.validatedCells` the number with a validated record, so `` and `` `validatedCells <= coverageCells <= activeSpecies * activeTraits`. ``.

- [ ] **Step 4: Services.**

  `apps/api/src/dataset/coverage.ts`:
  - `CoverageTotals` becomes `{ cells: number; withData: number; validated: number; percentWithData: number; percentValidated: number; }`, and its JSDoc becomes `/** How full the dataset is: the visible grid, the cells that hold data and the validated ones. */`.
  - `TotalsRow.accepted` becomes `validated: number`.
  - In `computeCoverageTotals`, change the JSDoc `and the newest decision of each species × trait\n * pair` to `and the validated pairs ({@link validatedPairsSql})`, and replace the last subselect (from `(select count(*)::int from (` to `as accepted`) with:

  ```ts
        (select count(*)::int from (${validatedPairsSql()}) v
          join species s on s.id = v.species_id
          join traits t on t.id = v.trait_id
          where ${speciesSeen} and ${traitSeen}) as validated`)) as unknown as [TotalsRow | undefined];
  ```

  - Its return becomes:

  ```ts
    const validated = row?.validated ?? 0;
    return {
      cells,
      withData,
      validated,
      percentWithData: percentHalfUp(withData, cells),
      percentValidated: percentHalfUp(validated, cells),
    };
  ```

  - `coverageRow` becomes:

  ```ts
  function coverageRow(cells: number, withData: number, validated: number): CoverageRow {
    return {
      cells,
      withData,
      validated,
      percentWithData: percentHalfUp(withData, cells),
      percentValidated: percentHalfUp(validated, cells),
    };
  }
  ```

  - `TraitMetricRow.accepted` becomes `validated: number`.
  - In `coverageGrid`, change `coalesce(a.n, 0)::int as accepted` to `coalesce(a.n, 0)::int as validated`, and replace the second `left join (select newest.trait_id … ) a on a.trait_id = t.id` with:

  ```ts
        left join (select v.trait_id as trait_id, count(*)::int as n
                   from (${validatedPairsSql()}) v
                   where v.species_id in (select id from sel_species)
                     and v.trait_id in (select id from sel_traits)
                   group by v.trait_id) a on a.trait_id = t.id
  ```

  - Replace the three `r.accepted` reads (`coverageRow(species, r.with_data, r.accepted)` and the two `reduce((n, r) => n + r.accepted, 0)`) with `r.validated`.
  - In `coverageGrid`'s JSDoc, change `and the accepted\n * pairs it holds` to `and the validated\n * pairs it holds`.
  - `rankCoverageTraits`: change the body to `const rank = (r: CoverageTraitRow) => mode === 'least_validated' ? r.percentValidated : r.withData;`, and in its JSDoc change `` `percentAccepted` for `least_accepted` `` to `` `percentValidated` for `least_validated` ``.
  - In `coverageTop`'s JSDoc, change `or with the lowest accepted share` to `or with the lowest validated share` and `` a `distinct on` over `accepted_values` `` to `a scan of the validated pairs`.

  `apps/api/src/admin/health.ts`: replace the comment and the property with:

  ```ts
        // RFC-52 R1: the cells that hold data and the cells with a validated
        // record — not `cells`, which is the grid size by definition.
        coverageCells: coverage.withData,
        validatedCells: coverage.validated,
  ```

- [ ] **Step 5: Web.**

  `apps/web/src/components/curation/CoverageTable.tsx`:
  - `<Th>Accepted</Th>` becomes `<Th>Validated</Th>`.
  - In the category row meter: `value={category.validated}`, `percent={category.percentValidated}`, ``label={`${category.category.label} species × trait cells with a validated record`}``.
  - In the trait row meter: `value={trait.validated}`, `percent={trait.percentValidated}`, ``label={`${name} species with a validated record`}``.

  `apps/web/src/components/curation/TopGaps.tsx`:
  - `{ value: 'least_validated', label: 'Lowest validated share' },`.
  - `` : `${row.percentValidated}% validated`} ``.
  - In the JSDoc, `or with the lowest validated share`.

  `apps/web/src/api/coverage.ts`: in `fetchCoverageTop`'s JSDoc, `or the lowest validated share`.

  `apps/web/src/pages/curation/CoveragePage.tsx`: the tile becomes `<p className={TILE_LABEL}>Validated</p>` with `value={coverage.data.validated}`, `percent={coverage.data.percentValidated}`, `label="Species × trait cells with a validated record"`.

  `apps/web/src/components/workspace/CurationCards.tsx`: the second meter becomes `value={coverage.validated}`, `percent={coverage.percentValidated}`, `label="Species × trait cells with a validated record"`.

  `apps/web/src/pages/admin/HealthPage.tsx`: the first `MeterTile` becomes:

  ```tsx
                  <MeterTile
                    label="Validated of populated cells (active)"
                    meterLabel="Species × trait cells with a validated record, of the cells with any record"
                    value={health.data.dataset.validatedCells}
                    max={health.data.dataset.coverageCells}
                  />
  ```

- [ ] **Step 6: Run to pass.**

  ```sh
  V pnpm vitest run packages/contracts apps/api/src/dataset/coverage.test.ts apps/api/src/dataset/coverage.integration.test.ts apps/api/src/admin apps/api/src/http/routes/coverage.integration.test.ts apps/api/src/workspace
  V pnpm --filter @treerepro/web test
  V pnpm typecheck
  V pnpm lint
  V pnpm rfc:check
  ```

  Expected: PASS.

- [ ] **Step 7: Commit**

  ```sh
  git add -A packages/contracts apps/api/src apps/web/src
  git commit -m "feat: coverage, dashboard and health count validated cells (spec R-1)

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 6: My contributions — `isAccepted` removed, the summary counts `validated`

**Files:** `packages/contracts/src/contributions.ts` (+ test), `packages/contracts/src/dashboard.test.ts`, `apps/api/src/dataset/contributions.ts` (+ integration test), `apps/web/src/pages/workspace/ContributionsPage.tsx` (+ test), `apps/web/src/pages/WorkspacePage.tsx`, `apps/web/src/test/dataset-fixtures.ts`, `apps/e2e/tests/contributions.spec.ts`

**Interfaces:**
- Consumes: RFC-71 R2/R4 as amended by 13a.
- Produces:
  - `contributionRecordSchema = recordSchema.extend({ responseCount })`.
  - `contributionSummarySchema` with `validated` in place of `accepted`: the viewer's manual records that carry at least one `confirm` annotation.
  - `contributionSummary(db, userId)` keeps its signature.

- [ ] **Step 1: Write the failing tests.**

  `apps/api/src/dataset/contributions.integration.test.ts`:
  - Delete `  createAcceptedValue,` from the import.
  - In the first records test, delete `isAccepted: false,`.
  - Replace the test `'marks the record the latest accepted decision points at and counts its responses'` up to `const { user: b } = await createUser(t.db);` so it reads:

  ```ts
    it('counts the responses to each record and carries no accepted flag', async () => {
      const { user: a } = await createUser(t.db);
      const { species, trait, reference } = await scene(t.db);
      const mine = async (valueText: string) =>
        createRecord(t.db, {
          speciesId: species.id,
          traitId: trait.id,
          valueText,
          levelId: level(trait.levels, valueText),
          primaryReferenceId: reference.id,
          origin: 'manual',
          createdBy: a.id,
        });
      const a1 = await mine('alpha');
      const a2 = await mine('beta');

      const { user: b } = await createUser(t.db);
  ```

  and add, after the two `responseCount` assertions at its end:

  ```ts
      expect(rows.data[0]).not.toHaveProperty('isAccepted');
  ```

  - In `'counts records, intents, stances, withdrawals and accepted values'`:
    - Rename it to `'counts records, intents, stances, withdrawals and validated records'`.
    - Replace the `createAcceptedValue(t.db, { … recordId: complement.id })` call with:

  ```ts
      // One of A's records is validated by B; the withdrawn contest has none.
      await createAnnotation(t.db, { recordId: complement.id, actorId: b.id, kind: 'confirm' });
  ```

    - Change both summaries' `accepted: 1` and `accepted: 0` to `validated: 1` and `validated: 0`.
  - In the visibility test, change `accepted: 0,` to `validated: 1,` and add above it the comment `// A's own confirmation of their record counts until 13g forbids self-validation (spec R-6).`

  `packages/contracts/src/contributions.test.ts`:
  - Rename `'is a record item plus isAccepted and responseCount'` to `'is a record item plus responseCount'`.
  - `const contribution = { ...record, responseCount: 2 };`.
  - Replace the `isAccepted: 'yes'` assertion with `expect(contributionRecordSchema.safeParse({ ...contribution, isAccepted: true }).success).toBe(false);`.
  - Change `accepted: 2,` to `validated: 2,`.

  `packages/contracts/src/dashboard.test.ts`: in `summary`, change `accepted: 2,` to `validated: 2,`.

  `apps/web/src/pages/workspace/ContributionsPage.test.tsx`:
  - Change `'Accepted4',` to `'Validated4',`.
  - In `'marks each record with its standing and opens the drawer on a row'`, rename the destructured `accepted` to `answered` in every use.
  - Delete `expect(within(accepted as HTMLElement).getByText('accepted')).toBeInTheDocument();` and `expect(within(contesting as HTMLElement).queryByText('accepted')).not.toBeInTheDocument();`.
  - Add `expect(within(table).queryByText('accepted')).not.toBeInTheDocument();`.
  - Change the comment to `// \`responseCount\` of RFC-71 R2: one record answers this one.`

- [ ] **Step 2: Run the tests and watch them fail.**

  ```sh
  V pnpm vitest run packages/contracts/src/contributions.test.ts packages/contracts/src/dashboard.test.ts apps/api/src/dataset/contributions.integration.test.ts apps/web/src/pages/workspace/ContributionsPage.test.tsx
  ```

  Expected: the strict schema accepts `isAccepted: true` and rejects `validated`, the summary has `accepted`, and the tile reads `Accepted4`.

- [ ] **Step 3: Contract.** In `packages/contracts/src/contributions.ts`:
  - Delete `  isAccepted: z.boolean(),` from `contributionRecordSchema`.
  - Change `accepted: z.number().int().nonnegative(),` to `validated: z.number().int().nonnegative(),` in `contributionSummarySchema`.

- [ ] **Step 4: Service.** In `apps/api/src/dataset/contributions.ts`:
  - The schema import becomes `import { recordAnnotations } from '../db/schema/curation.ts';`.
  - Replace `isAcceptedSql` and its JSDoc with:

  ```ts
  /** Has anybody validated this record (spec R-1)? The id is wrapped as {@link withdrawnSql} wraps it. */
  function validatedSql(recordId: SQL): SQL<boolean> {
    return sql<boolean>`exists (select 1 from ${recordAnnotations} c
      where c.record_id = ${recordId} and c.kind = 'confirm')`;
  }
  ```

  - Replace `standings` and its JSDoc with:

  ```ts
  /**
   * `responseCount` for one page of records. It is read separately because
   * {@link itemQuery}'s selection is fixed, and keeping it that way is what
   * lets every record item in the API share one join.
   */
  async function responseCounts(db: DbExecutor, ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await db
      .select({
        id: traitRecords.id,
        responseCount: responseCountSql(sql`${traitRecords.id}`).as('response_count'),
      })
      .from(traitRecords)
      .where(inArray(traitRecords.id, ids));
    return new Map(rows.map((r) => [r.id, r.responseCount]));
  }
  ```

  - In `listRecordContributions`, replace the `standings(…)` call and the `data` mapping with:

  ```ts
    const counts = await responseCounts(
      db,
      page.map((r) => r.record.id),
    );
    const data = page.map((r) => ({
      ...toItem(r),
      responseCount: counts.get(r.record.id) ?? 0,
    }));
  ```

  - In `contributionSummary`, rename the last destructured name to `validated` and replace the last `records(and(mine, isAcceptedSql(…)) as SQL)` with `records(and(mine, validatedSql(sql\`${traitRecords.id}\`)) as SQL),`. In the returned object, replace `accepted,` with `validated,`.

- [ ] **Step 5: Web.**

  `apps/web/src/pages/workspace/ContributionsPage.tsx`:
  - In `tilesOf`, `{ label: 'Validated', value: summary.validated },`.
  - Delete `{record.isAccepted ? <Badge tone="green">accepted</Badge> : null}`.
  - Change `{!record.isAccepted && !record.intent && record.responseCount === 0 ? DASH : null}` to `{!record.intent && record.responseCount === 0 ? DASH : null}`.

  `apps/web/src/pages/WorkspacePage.tsx`: in `contributionTiles`, `{ label: 'Validated', value: summary.validated },`.

  `apps/web/src/test/dataset-fixtures.ts`:
  - In `CONTRIBUTION_RECORD`, delete `isAccepted: true,` and change the JSDoc to `The viewer's own manual record, as \`/api/me/contributions?kind=records\`\n * answers it, with one record answering it.`
  - In `CONTESTING_CONTRIBUTION`, delete `isAccepted: false,` and change the JSDoc to `/** The viewer's own record contesting {@link RECORD}. @rfc RFC-71 R2 */`.
  - In `CONTRIBUTION_SUMMARY`, change `accepted: 4,` to `validated: 4,`.
  - In the zero summary after it, change `accepted: 0,` to `validated: 0,`.

  `apps/e2e/tests/contributions.spec.ts`:
  - Change `await tileShows('Accepted', '0');` to `await tileShows('Validated', '0');`. The contest has no `confirm`; this label is checked against `ContributionsPage.tsx`'s `tilesOf`.
  - Replace the comment `// the accepted value.` ending line with `// validated by anyone.`.
  - Delete `await expect(recordRow.getByText('accepted', { exact: true })).toHaveCount(0);`.

- [ ] **Step 6: Run to pass.**

  ```sh
  V pnpm vitest run packages/contracts apps/api/src/dataset/contributions.integration.test.ts apps/api/src/http/routes/admin/users.integration.test.ts apps/api/src/workspace
  V pnpm --filter @treerepro/web test
  V pnpm typecheck
  V pnpm lint
  V pnpm rfc:check
  ```

  Expected: PASS.

- [ ] **Step 7: Commit**

  ```sh
  git add -A packages/contracts apps/api/src apps/web/src apps/e2e
  git commit -m "feat: contributions count validated records, drop isAccepted (spec R-1)

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 7: Interim export — `GET /api/export/records.csv`

**Files:** `apps/api/src/dataset/export.ts` (+ integration test), `apps/api/src/http/routes/dataset/export.ts` (+ integration test), `apps/api/src/routes-guarded.integration.test.ts`, `apps/web/src/api/curation.ts` (+ test), `apps/web/src/pages/dataset/SpeciesSearchPage.tsx` (+ test), `docs/gotchas/dataset.md`

**Interfaces:**
- Consumes: RFC-66 R4–R8 (R8 from Task 1) and RFC-33 R1–R3.
- Produces:
  - `EXPORT_COLUMNS` (13 names).
  - `recordsCsv(db: Db, visibility: Visibility, options?: { batch?: number }): ReadableStream<Uint8Array>` in place of `acceptedCsv`.
  - The route `GET /api/export/records.csv`.
  - The web constant `EXPORT_RECORDS_URL = '/api/export/records.csv'` in place of `EXPORT_ACCEPTED_URL`.
  - 13i later replaces the three with `dataset.zip`.

- [ ] **Step 1: Write the failing tests.**

  Replace `apps/api/src/http/routes/dataset/export.integration.test.ts` from its `describe('RFC-66 GET /api/export/accepted.csv', …)` to the end of the file. Keep the imports and `parseLine`. In the imports, replace `  createAcceptedValue,` with `  createAnnotation,`.

  ```ts
  describe('RFC-66 R8 GET /api/export/records.csv', () => {
    const t = useTestApp();

    it('streams one CSV row per visible non-withdrawn record, ordered, quoted, with a BOM, and audits the download', async () => {
      const role = await createRole(t.db, { permissions: ['dataset.export'] });
      const { user } = await createUser(t.db, { roles: [role.id] });
      const { cookie } = await loginAs(t, user);
      const family = await createFamily(t.db, {
        name: `Aaaceae-${Math.random().toString(16).slice(2)}`,
      });
      const genus = await createGenus(t.db, { familyId: family.id });
      const spA = await createSpecies(t.db, { genusId: genus.id });
      const spB = await createSpecies(t.db);
      const cat = await createTrait(t.db, { levels: ['red'] });
      const quant = await createTrait(t.db, { valueType: 'quantitative', unit: 'mm' });
      const ref = await createReference(t.db, {
        citationKey: `Smith, J. "et al." ${Math.random().toString(16).slice(2)}`,
      });
      const mk = (
        speciesId: string,
        traitId: string,
        v: { levelId?: string; numericValue?: number; valueText: string },
      ) =>
        createRecord(t.db, {
          speciesId,
          traitId,
          primaryReferenceId: ref.id,
          origin: 'manual',
          createdBy: user.id,
          ...v,
        });
      const a1 = await mk(spA.id, cat.id, { levelId: cat.levels[0]?.id, valueText: 'red' });
      const a2 = await mk(spA.id, quant.id, { numericValue: 12.5, valueText: '12.5' });
      const b1 = await mk(spB.id, quant.id, { numericValue: 2, valueText: '2' });
      const gone = await mk(spB.id, cat.id, { levelId: cat.levels[0]?.id, valueText: 'red' });
      await createAnnotation(t.db, { recordId: gone.id, actorId: user.id, kind: 'withdraw' });

      const res = await call(t.app, 'GET', '/api/export/records.csv', { cookie });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
      expect(res.headers.get('content-disposition')).toMatch(
        /^attachment; filename="treerepro-records-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(res.headers.get('cache-control')).toBe('no-store');
      // `Response.text()` strips a leading BOM; read the raw bytes (RFC-66 R4).
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
      expect(text.startsWith('\uFEFF')).toBe(true);
      const lines = text.slice(1).split('\r\n');
      expect(lines[0]).toBe(
        'family,genus,species,name_source,category,trait,value,unit,level,numeric_value,primary_reference,secondary_reference,record_id',
      );
      expect(lines[lines.length - 1]).toBe('');
      const rows = lines.slice(1, -1).map(parseLine);
      const byRecord = new Map(rows.map((r) => [r[12], r]));
      expect(byRecord.get(a1.id)).toEqual([
        family.name,
        genus.name,
        spA.canonicalName,
        'wcvp',
        expect.any(String),
        cat.key,
        'red',
        '',
        'red',
        '',
        ref.citationKey,
        '',
        a1.id,
      ]);
      expect(byRecord.get(a2.id)?.slice(6, 10)).toEqual(['12.5', 'mm', '', '12.5']);
      expect(byRecord.get(b1.id)?.[0]).toBe(''); // no family
      expect(byRecord.has(gone.id)).toBe(false); // withdrawn
      // Order: spA (family Aaaceae…) before spB (no family, nulls last); within spA by trait key.
      const mine = rows
        .filter((r) => [a1.id, a2.id, b1.id].includes(r[12] ?? ''))
        .map((r) => r[12]);
      expect(mine.indexOf(a1.id)).toBeLessThan(mine.indexOf(b1.id));
      expect(mine.indexOf(a2.id)).toBeLessThan(mine.indexOf(b1.id));
      expect([...mine].slice(0, 2)).toEqual(cat.key < quant.key ? [a1.id, a2.id] : [a2.id, a1.id]);
      const audit = await lastAudit(t.db, 'dataset.exported', { actorUserId: user.id });
      expect(audit?.metadata).toEqual({ format: 'csv', scope: 'records' });
    });

    it('RFC-33 R9 two viewers: a plot-bound viewer without dataset.read_inactive gets only the visible rows, an unrestricted viewer gets every row', async () => {
      const unrestrictedRole = await createRole(t.db, {
        permissions: ['dataset.export', 'dataset.read_inactive'],
      });
      const restrictedRole = await createRole(t.db, { permissions: ['dataset.export'] });
      const { user: manager } = await createUser(t.db, { roles: [unrestrictedRole.id] });
      const { user: contributor } = await createUser(t.db, { roles: [restrictedRole.id] });
      const f = await createVisibilityFixture(t.db, manager.id);
      // A fourth row: an active species on an active trait, outside the contributor's plot.
      const outsideSpecies = await createSpecies(t.db);
      const outsidePlot = await createRecord(t.db, {
        speciesId: outsideSpecies.id,
        traitId: f.activeTrait.id,
        valueText: 'one',
        levelId: f.activeTrait.levels[0]?.id,
        primaryReferenceId: f.reference.id,
        origin: 'manual',
        createdBy: manager.id,
      });
      const plot = await createPlot(t.db);
      await addPlotSpecies(t.db, plot.id, [f.shownSpecies.id, f.hiddenSpecies.id]);
      await assignPlots(t.db, contributor.id, [plot.id], true);
      const recordIds = async (cookie: string) => {
        const res = await call(t.app, 'GET', '/api/export/records.csv', { cookie });
        expect(res.status).toBe(200);
        const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
        return text
          .slice(1)
          .split('\r\n')
          .slice(1, -1)
          .map((line) => parseLine(line)[12]);
      };
      const all = [f.onHiddenSpecies.id, f.onInactiveTrait.id, f.visible.id, outsidePlot.id];

      const m = await recordIds((await loginAs(t, manager)).cookie);
      expect(all.filter((id) => m.includes(id))).toEqual(all);

      const c = await recordIds((await loginAs(t, contributor)).cookie);
      expect(all.filter((id) => c.includes(id))).toEqual([f.visible.id]);
    });

    it('R7 an unauthenticated request keeps the JSON error envelope', async () => {
      const res = await call(t.app, 'GET', '/api/export/records.csv');
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('AUTH_UNAUTHENTICATED');
    });
  });
  ```

  `apps/api/src/dataset/export.integration.test.ts`:
  - Delete `  createAcceptedValue,` from the import.
  - Change `import { acceptedCsv } from './export.ts';` to `import { recordsCsv } from './export.ts';` and `describe('RFC-66 acceptedCsv connection safety'` to `describe('RFC-66 R5 recordsCsv connection safety'`.
  - Change the loop body to create the record only: `await createRecord(db, { … })` with no assignment and no `createAcceptedValue`.
  - Change `acceptedCsv(db, UNRESTRICTED, { batch: 2 })` to `recordsCsv(db, UNRESTRICTED, { batch: 2 })`.

  `apps/api/src/routes-guarded.integration.test.ts`: change `'GET /api/export/accepted.csv'` to `'GET /api/export/records.csv'`.

  `apps/web/src/pages/dataset/SpeciesSearchPage.test.tsx`:
  - In `'RFC-66 R1 shows the export link only with dataset.export'`, rename the test to `'RFC-66 R8 shows the export link only with dataset.export'`, change `/export accepted values/i` to `/export records/i` and the href to `'/api/export/records.csv'`.
  - In the hide test, change `/export accepted values/i` to `/export records/i`.

  `apps/web/src/api/curation.test.ts`: in the import, `EXPORT_ACCEPTED_URL` becomes `EXPORT_RECORDS_URL`, and the assertion becomes `expect(EXPORT_RECORDS_URL).toBe('/api/export/records.csv');`.

- [ ] **Step 2: Run the tests and watch them fail.**

  ```sh
  V pnpm vitest run apps/api/src/http/routes/dataset/export.integration.test.ts apps/api/src/dataset/export.integration.test.ts apps/web/src/pages/dataset/SpeciesSearchPage.test.tsx apps/web/src/api/curation.test.ts
  ```

  Expected: `/records.csv` answers 404 NOT_FOUND, `recordsCsv` is not exported, and the link text and href are old.

- [ ] **Step 3: Service.** In `apps/api/src/dataset/export.ts`:
  - The import becomes `import { levelVisible, speciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';`.
  - Change `EXPORT_COLUMNS`' tag to `/** @rfc RFC-66 R8 */` and delete `'decided_at',` from it.
  - Delete `decided_at: Date;` from `ExportRow`.
  - Replace `acceptedCsv`'s JSDoc, signature and `query` with:

  ```ts
  /**
   * Every visible, non-withdrawn record as a CSV stream — the interim export of
   * spec R-1, until plan 13i's `dataset.zip`. A postgres.js cursor feeds a
   * `ReadableStream` batch by batch, so the file is never held in memory; the
   * BOM lets spreadsheet software read UTF-8. `batch` is injectable so tests can
   * force several small batches instead of one that swallows every row.
   * @rfc RFC-66 R4, R5, R8
   * @rfc RFC-33 R2, R3
   */
  export function recordsCsv(
    db: Db,
    visibility: Visibility,
    options: { batch?: number } = {},
  ): ReadableStream<Uint8Array> {
    const client = db.$client;
    const encoder = new TextEncoder();
    const query = dialect.sqlToQuery(sql`
      select f.name as family, g.name as genus, s.canonical_name as species, s.name_source,
        c.key as category, t.key as trait, r.value_text as value, t.unit, l.key as level,
        r.numeric_value::text as numeric_value,
        case when pr.kind = 'personal_observation' then 'Personal observation' else pr.citation_key end as primary_reference,
        case when sr.kind = 'personal_observation' then 'Personal observation' else sr.citation_key end as secondary_reference,
        r.id as record_id
      from trait_records r
      join species s on s.id = r.species_id
      left join genera g on g.id = s.genus_id
      left join families f on f.id = g.family_id
      join traits t on t.id = r.trait_id
      join trait_categories c on c.key = t.category_key
      left join trait_levels l on l.id = r.level_id and ${levelVisible(visibility, sql`l.active`)}
      left join bibliographic_references pr on pr.id = r.primary_reference_id
      left join bibliographic_references sr on sr.id = r.secondary_reference_id
      where not exists (select 1 from record_annotations w
                        where w.record_id = r.id and w.kind = 'withdraw')
        and ${speciesVisible(visibility, sql`s.active`, sql`s.id`)}
        and ${traitVisible(visibility, sql`t.active`)}
      order by f.name nulls last, g.name nulls last, s.canonical_name, t.key, r.id`);
  ```

  - Delete `new Date(r.decided_at).toISOString(),` from `toLine`. The rest of the function (cursor, `inflight`, stream) is unchanged.

- [ ] **Step 4: Route.** Replace the body of `apps/api/src/http/routes/dataset/export.ts` from the JSDoc down with:

  ```ts
  /**
   * File download: the RFC-11 R2 exception. The viewer's visibility is resolved
   * here and handed down, like every other dataset read (RFC-33 R1, R3).
   * @rfc RFC-66 R4, R6, R7, R8
   * @rfc RFC-33 R1, R3
   */
  export function exportRoutes(ctx: AuthContext) {
    return new Hono<AppEnv>().get(
      '/records.csv',
      requirePermission(ctx, 'dataset.export'),
      async (c) => {
        // Resolved before the audit entry: a viewer that cannot be resolved is
        // an export that never started (RFC-66 R6).
        const visibility = await visibilityOf(ctx, c);
        await recordAudit(ctx.db, {
          actorUserId: currentUser(c).id,
          action: 'dataset.exported',
          metadata: { format: 'csv', scope: 'records' },
        });
        const day = new Date(ctx.now()).toISOString().slice(0, 10);
        c.header('Content-Type', 'text/csv; charset=utf-8');
        c.header('Content-Disposition', `attachment; filename="treerepro-records-${day}.csv"`);
        c.header('Cache-Control', 'no-store');
        return c.body(recordsCsv(ctx.db, visibility));
      },
    );
  }
  ```

  Its import line becomes `import { recordsCsv } from '../../../dataset/export.ts';`.

- [ ] **Step 5: Web and docs.**

  `apps/web/src/api/curation.ts`: replace the constant with:

  ```ts
  /** The file download of RFC-66; a plain link, the session cookie authenticates it. @rfc RFC-66 R8 */
  export const EXPORT_RECORDS_URL = '/api/export/records.csv';
  ```

  `apps/web/src/pages/dataset/SpeciesSearchPage.tsx`:
  - The import becomes `import { EXPORT_RECORDS_URL } from '../../api/curation.ts';`.
  - Use `href={EXPORT_RECORDS_URL}` and the link text `Export records (CSV)`.
  - Change the `@rfc RFC-66 R1` tag on the page to `@rfc RFC-66 R8`.

  `docs/gotchas/dataset.md`: change `` see `acceptedCsv` `` to `` see `recordsCsv` ``.

- [ ] **Step 6: Run to pass.**

  ```sh
  V pnpm vitest run apps/api/src/http/routes/dataset/export.integration.test.ts apps/api/src/dataset/export.integration.test.ts apps/api/src/routes-guarded.integration.test.ts apps/api/src/routes-visibility.integration.test.ts
  V pnpm --filter @treerepro/web test
  V pnpm typecheck
  V pnpm lint
  V pnpm rfc:check
  ```

  Expected: PASS.

- [ ] **Step 7: Commit**

  ```sh
  git add -A apps/api/src apps/web/src docs/gotchas/dataset.md
  git commit -m "feat(api): interim records.csv export replaces accepted.csv (spec R-1, RFC-66 R8)

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 8: Drop `accepted_values`, its trigger function and `accepted.manage`; queues stop reading decisions

**Files:**
- Create: `apps/api/drizzle/0035_no_accepted_values.sql`, `apps/api/drizzle/meta/0035_snapshot.json`
- Modify: `apps/api/drizzle/meta/_journal.json`, `apps/api/src/db/schema/curation.ts`, `apps/api/src/db/schema/dataset.integration.test.ts`, `apps/api/src/dataset/{queues,reset}.ts`, `apps/api/src/dataset/queues.integration.test.ts`, `apps/api/src/http/routes/dataset/records.integration.test.ts`, `apps/api/test/helpers/dataset.ts`, `packages/contracts/src/{dataset,permissions}.ts`, `docs/rfc/30-access/30-permission-catalog.md`, `apps/web/src/components/admin/RoleDialog.test.tsx`, `apps/web/src/pages/curation/DisputedPage.tsx`

**Interfaces:**
- Consumes: RFC-63 R4/R7 and RFC-65 R10 as amended by 13a, and RFC-30 R1–R3.
- Produces: `PERMISSIONS` without `accepted.manage`, with `'dataset.export': 'Download the dataset'`. `ACCEPTED_DECISIONS`, `AcceptedDecision`, `acceptedValues`, `AcceptedValueRow` and `createAcceptedValue` are gone. `countDisputed`, `countContested` and `listDisputed` keep their signatures.

- [ ] **Step 1: Write the failing tests.**

  `apps/api/src/db/schema/dataset.integration.test.ts`:
  - Change the import to `import { recordAnnotations } from './curation.ts';`.
  - In the privileges test, change the table list to `['trait_records', 'record_annotations']`.
  - Replace the test `'R7 an accepted value must point at a record of the same species and trait'` with:

  ```ts
    it('RFC-63 R6 a dispute annotation needs a note', async () => {
      await withRollback(t.db, async (tx) => {
        const sp1 = await createSpecies(tx);
        const trait = await traitByKey(tx, 'flower_color');
        const ref = await createReference(tx);
        const batch = await createImportBatch(tx);
        const { user } = await createUser(tx);
        const record = await createRecord(tx, {
          speciesId: sp1.id,
          traitId: trait.id,
          valueText: 'x',
          harmonisation: 'unknown_level',
          primaryReferenceId: ref.id,
          importBatchId: batch.id,
        });
        await expect(
          unwrapDbError(
            tx.transaction((sp) =>
              sp
                .insert(recordAnnotations)
                .values({ recordId: record.id, actorId: user.id, kind: 'dispute' }),
            ),
          ),
        ).rejects.toMatchObject({ code: '23514' }); // dispute needs a note
      });
    });
  ```

  - Replace the whole `describe('RFC-62 R7 trait detail index on accepted_values', …)` with:

  ```ts
  describe('spec R-1 the accepted value is gone from the database', () => {
    const t = useTestDb();

    it('has no accepted_values table, no trigger function for it and no accepted.manage rows', async () => {
      const [row] = (await t.db.execute(sql`
        select to_regclass('public.accepted_values')::text as tbl,
          (select count(*)::int from pg_proc where proname = 'accepted_values_match_record') as fn,
          (select count(*)::int from permissions where key = 'accepted.manage') as perm,
          (select count(*)::int from role_permissions where permission_key = 'accepted.manage') as grants,
          (select description from permissions where key = 'dataset.export') as export_description
      `)) as unknown as [
        { tbl: string | null; fn: number; perm: number; grants: number; export_description: string },
      ];
      expect(row).toEqual({
        tbl: null,
        fn: 0,
        perm: 0,
        grants: 0,
        export_description: 'Download the dataset',
      });
    });
  });
  ```

  `docs/rfc/30-access/30-permission-catalog.md`:
  - Delete the table row `` | `accepted.manage` | Set and clear the accepted value per species and trait | ``.
  - Change the `dataset.export` row to `` | `dataset.export` | Download the dataset | ``.
  - Append `- 2026-09-25 — accepted.manage removed and dataset.export reworded with the accepted value (spec R-1, plan 13e).` to its Changelog.

  `apps/web/src/components/admin/RoleDialog.test.tsx`: delete `      'accepted',` from the expected group list.

- [ ] **Step 2: Run the tests and watch them fail.**

  ```sh
  V pnpm vitest run apps/api/src/db/schema/dataset.integration.test.ts packages/contracts/src/permissions.test.ts apps/web/src/components/admin/RoleDialog.test.tsx
  ```

  Expected: `tbl` is `'accepted_values'`, `fn`/`perm` are 1, the catalog parity diff shows `accepted.manage` and the `dataset.export` description, and the group list still contains `accepted`.

- [ ] **Step 3: Contracts.**
  - `packages/contracts/src/permissions.ts`: delete the line `'accepted.manage': 'Set and clear the accepted value per species and trait',` and change `'dataset.export': 'Download the accepted values',` to `'dataset.export': 'Download the dataset',`.
  - `packages/contracts/src/dataset.ts`: delete `export const ACCEPTED_DECISIONS = ['accepted', 'cleared'] as const;`, its JSDoc line if any, and `export type AcceptedDecision = …;`.

- [ ] **Step 4: Schema, then generate the migration in the container.**
  - `apps/api/src/db/schema/curation.ts`:
    - The contracts import becomes `import { ANNOTATION_KINDS } from '@treerepro/contracts';`.
    - Delete `import { traits } from './dictionary.ts';` and `import { species } from './taxa.ts';`, which only `acceptedValues` used. The pg-core import stays as it is, because `recordAnnotations` uses every name in it.
    - Delete the `acceptedValues` table with its JSDoc, and `export type AcceptedValueRow = …;`.

  ```sh
  V pnpm --filter @treerepro/api db:generate --name no_accepted_values
  docker cp treerepro-13e:/workspace/apps/api/drizzle/0035_no_accepted_values.sql apps/api/drizzle/
  docker cp treerepro-13e:/workspace/apps/api/drizzle/meta/0035_snapshot.json apps/api/drizzle/meta/
  docker cp treerepro-13e:/workspace/apps/api/drizzle/meta/_journal.json apps/api/drizzle/meta/
  cat apps/api/drizzle/0035_no_accepted_values.sql
  ```

  Expected: the file holds `DROP TABLE "accepted_values" CASCADE;`. If the generator picked a number other than 0035, use its number everywhere below.

  Append the custom statements to that file, so it reads in full:

  ```sql
  DROP TABLE "accepted_values" CASCADE;
  --> statement-breakpoint
  -- Spec R-1 (RFC-63 R4, R7 as amended by 13a): the trigger function served
  -- accepted_values alone; its trigger went with the table.
  DROP FUNCTION accepted_values_match_record();
  --> statement-breakpoint
  -- RFC-30 R3: accepted.manage leaves the catalog. Any custom role may hold it,
  -- and role_permissions references permissions without a cascade.
  DELETE FROM role_permissions WHERE permission_key = 'accepted.manage';
  --> statement-breakpoint
  DELETE FROM permissions WHERE key = 'accepted.manage';
  --> statement-breakpoint
  UPDATE permissions SET description = 'Download the dataset' WHERE key = 'dataset.export';
  ```

  Keep the generator's own first line exactly as generated if it differs in quoting.

  Confirm the snapshot is clean:

  ```sh
  V pnpm --filter @treerepro/api db:generate
  ```

  Expected: `No schema changes, nothing to migrate`.

- [ ] **Step 5: Code that read the table.**

  `apps/api/src/dataset/reset.ts`: delete `'accepted_values',` from `RESET_TABLES` and the two `['accepted_values', …]` entries from `APPEND_ONLY_TRIGGERS`.

  `apps/api/src/dataset/queues.ts`:
  - Delete `noDecisionAfter` and its JSDoc.
  - Delete the line `      and ${noDecisionAfter(sql\`r.species_id\`, sql\`r.trait_id\`, sql\`d.created_at\`)}` in `disputedQuery`.
  - Delete the line `      and ${noDecisionAfter(sql\`c.species_id\`, sql\`c.trait_id\`, sql\`c.created_at\`, 'accepted')}` in `countContested`.
  - `disputedQuery` JSDoc: replace `excluded once withdrawn or once\n * an accepted decision for the species and trait is newer than the dispute,\n * and,` with `excluded once withdrawn, and,`.
  - `countContested` JSDoc:
    - Replace `whose responded record is not withdrawn and whose\n * species and trait carry no accepted decision newer than the contest.` with `whose responded record is not withdrawn.`
    - Replace `on everything the rule does hold in common — bar the decision, which both\n * rules word as an **accepted** one here and \`disputedQuery\` words as any\n * decision (see \`noDecisionAfter\`).` with `on everything the rule does hold in common.`

  `apps/api/src/dataset/queues.integration.test.ts`: delete `  createAcceptedValue,` from the import and the whole `describe('spec §4 R1 countContested reads only accepted decisions', …)` block (to the end of the file).

  `apps/api/src/http/routes/dataset/records.integration.test.ts`:
  - Delete `  createAcceptedValue,` from the import.
  - In the disputed-queue test:
    - Rename it to `'lists standing disputes newest first, drops them after a changed stance, never withdrawn records'`.
    - Change `let ids = await idsOf(author.cookie);` to `const ids = await idsOf(author.cookie);`.
    - Delete everything from `// a curator decides after both standing disputes: the decision retires them both` through `expect(await idsOf(author.cookie)).toContain(older.id);`, i.e. the decision, the two `not.toContain`, the two re-disputes and their `toContain`s.

  `apps/api/test/helpers/dataset.ts`:
  - Delete `  AcceptedDecision,` from the contracts import.
  - Change `import { acceptedValues, recordAnnotations } from '../../src/db/schema/curation.ts';` to `import { recordAnnotations } from '../../src/db/schema/curation.ts';`.
  - Delete `createAcceptedValue`.

  `apps/web/src/pages/curation/DisputedPage.tsx`:
  - In the JSDoc, replace `records whose review is \`disputed\` and\n * whose species × trait has no later accepted decision, newest dispute\n * first.` with `records whose review is \`disputed\`, newest\n * dispute first.`
  - Change the two descriptions to `'Records a scientist has answered with a competing value. Wait for the contest to be withdrawn.'` and `'Records a scientist disputes. Wait for the disputer to step back.'`. `DisputedPage.test.tsx` matches `/competing value/`, which still holds.

- [ ] **Step 6: Run the full suites.** The catalog changed, so this includes the whole web suite.

  ```sh
  V pnpm vitest run packages/contracts
  V pnpm --filter @treerepro/api test
  V pnpm --filter @treerepro/web test
  V pnpm typecheck
  V pnpm lint
  V pnpm rfc:check
  ```

  Expected: PASS. This includes:
  - `access.integration.test.ts` (DB catalog = `PERMISSIONS`).
  - `permissions.test.ts` (RFC-30 table = `PERMISSIONS`).
  - `permissions.integration.test.ts` (admin holds every key).
  - `RoleDialog.test.tsx`.
  - The import `--replace` tests that exercise `resetDataset`.

- [ ] **Step 7: Commit**

  ```sh
  git add -A apps/api/drizzle apps/api/src apps/api/test packages/contracts apps/web/src docs/rfc/30-access/30-permission-catalog.md
  git commit -m "feat(api): drop accepted_values and accepted.manage (spec R-1)

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 9: E2E specs, README and full verification

**Files:** `apps/e2e/tests/browsing.spec.ts`, `README.md`

**Interfaces:**
- Consumes: the labels written in Tasks 4, 6 and 7 (`Species validated`, `Validated`, `Export records (CSV)`).
- Produces: nothing new.

- [ ] **Step 1: Update `apps/e2e/tests/browsing.spec.ts`.** Every string here is checked against `TraitPage.tsx` and `TraitSpeciesTable.tsx` as changed in Task 4.
  - Replace the comment `// which is what R7's distribution counts; nothing accepts the record,\n      // so \`acceptedCount\` stays 0 and the Accepted value column is a dash.` with `// which is what R7's distribution counts; nobody validates the record,\n      // so \`validatedCount\` stays 0.`
  - Replace `await expect(page.locator('dt:text-is("Accepted values") + dd')).toHaveText('0');` with `await expect(page.locator('dt:text-is("Species validated") + dd')).toHaveText('0');`.
  - Change `// Columns in with mode: Species, Family, Records, Accepted value, Source.` to `// Columns in with mode: Species, Family, Records.`.
  - Replace the `expect(page.getByRole('columnheader', { name: 'Accepted value', exact: true })).toBeVisible();` statement with `await expect(page.getByRole('columnheader', { name: 'Accepted value', exact: true })).toHaveCount(0);`.
  - Change `// The three cells are addressed by position` to `// The cells are addressed by position`.
  - Delete the three lines from `// Nothing was accepted, so the value and its source are both dashes.` through `await expect(coveredRow.getByRole('cell').nth(4)).toHaveText('—');`.

  Then search for leftover old strings:

  ```sh
  grep -rn "Accepted\|accepted\.csv\|Export accepted" apps/e2e/tests
  ```

  Expected: only the new `toHaveCount(0)` line and the unrelated `critical-flow.spec.ts` comment ("always accepted and never collides").

- [ ] **Step 2: README.**
  - Replace `on the record drawer, confirm / dispute / withdraw / set as accepted, with the accepted value shown on the trait panel; an Export accepted values (CSV) link (\`dataset.export\`) sits on the species search header.` with `on the record drawer, confirm / dispute / withdraw; an Export records (CSV) link (\`dataset.export\`) sits on the species search header.`
  - Delete `the accepted value per species and trait, ` from the Curation API line.
  - Replace `` `GET /api/export/accepted.csv` (`dataset.export`, streamed RFC 4180 CSV, audited): RFC-66. `` with `` `GET /api/export/records.csv` (`dataset.export`, every visible non-withdrawn record, streamed RFC 4180 CSV, audited): RFC-66. ``

- [ ] **Step 3: Residue check.**

  ```sh
  grep -rnE "acceptedValues|accepted_values|acceptedCount|isAccepted|percentAccepted|least_accepted|acceptedCells|acceptedHistory|AcceptedSection|setAccepted|getAccepted|currentAccepted|accepted\.manage|accepted\.csv|RECORD_IS_ACCEPTED|RECORD_NOT_HARMONISED|createAcceptedValue|ACCEPTED_DECISIONS|AcceptedState|AcceptedDecision|EXPORT_ACCEPTED_URL|acceptedCsv" apps packages tools README.md docs/gotchas --exclude-dir=node_modules --exclude-dir=dist | grep -v "^apps/api/drizzle/"
  ```

  Expected: no output. `apps/web/src/content/help/*` still mentions the accepted value in prose; that belongs to 13j (Spec notes).

- [ ] **Step 4: Full pipeline on a fresh sync.**

  ```sh
  V pnpm lint
  V pnpm typecheck
  V pnpm rfc:check
  V pnpm build
  V pnpm test
  ```

  Expected: all green. If a failure lands in a file this plan did not touch, run the same suite on plain `main` in a second container from `treerepro-verify:base` and compare counts before calling it pre-existing.

- [ ] **Step 5: Commit**

  ```sh
  git add apps/e2e/tests/browsing.spec.ts README.md
  git commit -m "test(e2e), docs: no accepted value on the trait page; README (spec R-1)

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
  ```

- [ ] **Step 6: Before the PR.**
  1. Run `git fetch origin && git rebase origin/main`.
  2. Run `ls apps/api/drizzle/*.sql`. If `0035` is taken, renumber per Global Constraints, re-chain `prevId`, copy the upstream objects into the snapshot, and confirm `V pnpm --filter @treerepro/api db:generate` prints "No schema changes".
  3. Re-run Step 4 on the rebased tree.
  4. Grep the other wave-1 branches' merged strings in `apps/web` and `apps/e2e`, in particular 13f's summary `numeric` shape in `dataset-fixtures.ts` and `summary.ts`.
  5. Run one CodeRabbit CLI review (`coderabbit:code-review`) and apply its findings.
  6. Push with HTTP/1.1 (`git -c http.version=HTTP/1.1 push -u origin feat/13e-no-accepted`).
  7. Open the PR titled `feat: no accepted value (plan 13e)`, with `Closes #<13e issue>` in the body and the deploy note of Spec note 13 (flush `coverage:*`, `dashboard:*` and `health` in Redis after rollout). Remove `in-progress` from the issue after merge.

## Spec notes

1. **Definition of "validated".** A species × trait is validated when one of its records has a `confirm` annotation and no `withdraw` annotation (`validatedPairsSql`). Records count whatever their harmonisation and level visibility. Visibility is the caller's species/trait predicate. The author's own `confirm` counts until 13g forbids self-validation (R-6). R-13 (withdrawn leaves the dataset) is already honoured here for validation, but `withData` still counts withdrawn records until 13g decrements the counters.
2. **§6 names only the trait summary, trait page and coverage fields.** The minimal readings for the rest:
   - Trait summary: `validated: boolean`.
   - Trait detail: `validatedCount`.
   - Trait-species item: `accepted` removed with **no** replacement, so `TraitSpeciesTable` loses its "Accepted value" and "Source" columns.
   - Health: `acceptedCells` → `validatedCells`.
   - Contributions: `isAccepted` removed with no replacement; summary `accepted` → `validated`, counting the viewer's manual records with ≥ 1 `confirm`.
   - Dashboard tile: renamed with coverage.

   If 13a's RFC-71/RFC-72 text names these differently, 13a's names win. Task 1 Step 1 catches that.
3. **`validated` is in the trait summary but `TraitCard` does not render it yet.** 13h redesigns the card (validation counts per level).
4. **RFCs outside 13a's list are amended here:** RFC-12 (two error codes), RFC-30 (catalog rows), RFC-33 R3/R4, RFC-52 R1 and RFC-62 R7/R8. **RFC-66 gets an interim R8** for `records.csv` only if 13a wrote none. 13i should retire it when `dataset.zip` lands. Exact rule numbers depend on 13a; Task 1 Step 1 records them.
5. **`dataset.export`'s description** changes from "Download the accepted values" to "Download the dataset" (contracts, migration `UPDATE` and RFC-30). This was not asked for, but the old text would be false.
6. **`speciesTraitParamSchema` is deleted** with the routes it served. 13g's `…/levels/:levelId/…` routes need their own param schema.
7. **Queues.** The disputed queue and the contested count no longer drop rows after an accepted decision, because there are none. 13g replaces both with contest-derived logic.
8. **`annotateRecord` keeps its advisory lock.** Its comment now names the remaining race (two withdrawals of one record).
9. **Interim export details:**
   - Pending records are included with their raw `value_text`.
   - A level invisible to the viewer prints empty (`levelVisible` in the join, a small hardening over the old query).
   - Order gains `r.id` as a final key for determinism.
   - The sort runs over all records, which is acceptable for an interim export.
10. **Help pages (`apps/web/src/content/help/*`) still describe the accepted value** between this merge and 13j, which owns that text. `StatTiles.test.tsx` keeps a generic "Accepted" label as test data.
11. **Collisions to watch at merge:**
    - `traitSummarySchema` and `summary.ts` (13f's `numeric` lines are adjacent, so expect a marker).
    - `dataset-fixtures.ts` (13f/13d).
    - `records.ts` (13f).
    - `reset.ts` (13f may add `record_references`).
    - `WorkspacePage.tsx` (13b).
    - The migration number (13d/13f/13g).
    - Later, 13h rewrites `TraitCard`, `RecordTable` and `RecordActions`, and 13g rewrites `curation.ts`, `queues.ts` and `DisputedPage`, all after this merges.
12. **Redis permission caches** may list `accepted.manage` until their TTL. No route checks it any more, so this is harmless.
13. **Deploy risk: cached JSON in the old shape.** These entries keep the `accepted`/`acceptedCells` shape until they expire:
    - `coverage:totals:<u|r>` and `coverage:<u|r>:…` (10 min).
    - `dashboard:<userId>` (5 min; its contributor summary still says `accepted`).
    - `health` (60 s).

    The web's strict schemas would reject them. The cache keys stay as RFC-69 R5/R6, RFC-72 R1 and RFC-52 R1 name them, rather than adding a version segment. The PR description instead carries a deploy note: right after the API rolls out, run `docker compose exec redis sh -c "redis-cli --scan --pattern 'coverage:*' | xargs -r redis-cli del; redis-cli --scan --pattern 'dashboard:*' | xargs -r redis-cli del; redis-cli del health"` (adjust for the Redis auth the stack uses), or accept up to ten minutes of failing dashboard, coverage and health pages.
