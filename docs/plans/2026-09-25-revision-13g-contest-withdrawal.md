# Revision 13g — Contest and Withdrawal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec R-3 and R-6 to R-15 on the API, plus the manager screens. The changes:

- A form with several levels creates one record per level.
- An entry that matches a visible record becomes a validation of that record.
- Contested is derived from contest records: at level granularity for a categorical trait, at record granularity for a quantitative one.
- Neutral and Dispute are gone.
- Withdrawal takes no note and follows the three-way permission of R-12, with the new admin-only permission `records.withdraw_imported`.
- A withdrawn record leaves every read, and its counters step back.
- Non-harmonised records and the unresolved badge are for `records.review` holders only.
- The species list gains a Contested filter for everyone, and Has unknown levels for reviewers.
- The records list is sortable.
- The disputed queue becomes the contested queue, with **Keep both**, **Withdraw contest** and **Withdraw level**.

**Architecture:**

- Every liveness and visibility rule is one SQL helper in `apps/api/src/dataset/records.ts`:
  - `liveSql`: no withdraw annotation.
  - `harmonisedFor` / `recordVisible`: R-14 over `Visibility.review`.
  - `openContestSql`: R-9.
  - `reviewStatusSql`, with the dispute branch dropped.
- Every read reuses these helpers, so the lists, the counts, the queue, the filter and the dashboard cannot disagree.
- The counters decrement in the database. A statement trigger on `record_annotations` calls one `SECURITY DEFINER` function, `trait_records_uncount(uuid[])`, which mirrors the insert trigger `trait_records_reference_usage` (0015/0022/0027). The migration's backfill calls the same function once for the records that are already withdrawn.
- A partial unique index allows one withdraw per record, so nothing is ever decremented twice.
- The web changes are limited to:
  - the contested queue page (`DisputedPage`/`DisputedTable`, same route);
  - the species filters;
  - `RecordActions`, which loses Neutral, Dispute and the note field;
  - the minimum needed to keep the existing dialogs compiling and working against the new contracts.

**Tech Stack:** unchanged (TypeScript 7, Hono 4, Zod 4, Drizzle + PostgreSQL 18, Redis 8, React 19, TanStack Router/Query, Tailwind 4, Vitest 5 + testcontainers, Playwright). No new dependency. One migration.

**Spec:** `docs/specs/2026-09-25-record-model-revision-design.md`: R-3, R-6 to R-15 (§1.1 to §1.5), §3 row 13g, §4, and the 13g rows of §6. Their names are used verbatim here.

**Depends on:**

- **13a** is merged: RFC amendments for R-1 to R-18.
- **13e** is merged: `accepted_values`, `currentAccepted`, `setAccepted`, `accepted.manage`, `RECORD_IS_ACCEPTED` and every `accepted*` field are gone.
- **13f** is merged. It provides:
  - `trait_records.record_code`, `min_value`, `max_value`, `mean_value`, `sd_value` and `n`;
  - the helper `nextRecordCodes(tx, count)`, for spec R-2 as amended by the owner: one form shares one number, `TR_7a`, `TR_7b`, …;
  - `record_references` with its counter trigger;
  - the `{ quantitative }` value and `quantitativeValueSchema`;
  - the record item's `recordCode`, `quantitative` and `references`.
- **13d** does not block this plan: `sourceRefSchema` keeps its name there (13d plan §Architecture). Start from `origin/main` only once 13e and 13f are both on it.

## Cross-review amendments (2026-09-25 — apply these; they override the code below)

1. **A categorical match validates the whole level** (owner decision: level actions act on every record of the level; 13a RFC-65 R13). When a new categorical entry matches an existing level, write the validations on **every** visible record of that level that is not the actor's own and not already validated by them — exactly what `validateLevel` does; reuse it from the create path instead of picking the oldest match. It is a duplicate (no writes) only when every record of the level is the actor's own. `validated` in the create response lists every record validated. Spec note 4 below is superseded. Quantitative matches (six identical fields) still validate the single matching record.
2. **Record withdraw** answers `200 { data: null }` — 13a's RFC-65 R3 text was amended to match this plan.
3. **Contest target liveness under the lock.** Check that the contested target is live (not withdrawn; for a categorical level, at least one live record remains) *inside* the create transaction, after taking the same lock the withdraw paths take (`pg_advisory_xact_lock` on species×trait, or `SELECT … FOR UPDATE` on the target rows — use whatever the withdraw path uses), so a concurrent withdrawal cannot leave a contest pointing at a withdrawn target. Add a test: target withdrawn → contest refused with 409 `RECORD_WITHDRAWN`-equivalent 404 (`RECORD_NOT_FOUND`, since withdrawn records are invisible).
 The task bodies below predate these amendments: where they disagree, the amendment wins and the executor edits the task code accordingly.
4. **Withdraw level with records the actor cannot withdraw** (spec R-10 clarified): the action withdraws every record of the level the actor may withdraw; the contest clears only when the level is left with no visible record, or through Keep both. When imported records remain for a manager, the response lists them (`remaining: RecordCodeRef[]`) and the page says "<n> imported records remain — an admin can withdraw them, or use Keep both". `withdrawLevelResultSchema` becomes `{ withdrawn: RecordCodeRef[], remaining: RecordCodeRef[] }`; the contested-queue page shows the message.
5. **Owner ruling 2026-09-25 — contests state the correct levels** (spec R-8 as amended; RFC-63 R14, RFC-70 R2, R3, R9, R10): a categorical contest no longer responds to a record: the create path takes `contestedLevelIds`, computes E and S under the species × trait lock, answers 400 `VALIDATION_FAILED` with path `intent` when E \ S is empty and with path `contestedLevelIds` when it differs from E \ S, validates S ∩ E, creates S \ E as contest records with `responds_to_record_id` null, and stores the contest with its contested levels even when it creates no record — the storage, its migration, the relaxed `intent`/`responds_to` check (RFC-63 R2), its place in RFC-64 R12's truncation closure, and turning any categorical contest record written before the migration into a contest naming the level of the record it responds to are this plan's. `openContestSql`, `contestCount`, the summary's `contested` and the contested queue read contests by the levels they name (RFC-63 R8, R14; queue item of RFC-65 R10), and Keep both and Withdraw contest move from the annotations body to `POST /api/contests/:id/resolve` and `…/withdraw` (RFC-65 R3, R15, R16; `resolve` on the annotations route answers 400 path `kind`). Where task bodies assume a contest responds to one record's level, the amended rules win.

## Global Constraints

- English everywhere: code, comments, docs, UI and commits.
- RFC first. 13a amends RFC-31, 61, 63, 64, 65, 66, 69, 70, 71, 72, 73 and 80. The RFCs this plan changes that 13a does not touch are RFC-30 (Task 2), RFC-33, RFC-52, RFC-60 and RFC-74 (Task 1). Every exported symbol keeps or gains a JSDoc `@rfc` tag, and `pnpm rfc:check` passes. Tests name the rule, for example `describe('RFC-65 R3 …')`. The tag table in Task 1 maps each spec rule to the RFC rule id this plan cites.
- TDD: write the failing test first, run it, see it fail for the stated reason, then write the minimum code. No database mocks. Integration tests use the real Postgres and Redis from testcontainers.
- Integration tests assert only on their own fixtures: their own species, traits, references and users, created per test. They never assert on a global count or on the position of a row on page one (memory: shared-resource assertions break on merge). Dashboard, digest and health numbers are asserted as deltas.
- Every route is guarded and meta-tested (`routes-guarded.integration.test.ts`). Every route behind a dataset-reading permission resolves `visibilityOf` (`routes-visibility.integration.test.ts`). Both lists are edited in Task 7.
- Minimal diff: reuse `itemQuery`/`toItem`, `reviewStatusSql`, `resolveSourceRef`, `usePagedList`, `useRecordWrite`, `ConfirmDialog`, `FILTER_CHECK` and `FilterGroup`. Delete what this change makes dead: `CONTEST_NOTE`, `CONTEST_WITHDRAWN_NOTE`, `countDisputed`, `listDisputed`, `disputedRecordSchema`, `listDisputedQuerySchema` and the `?intent` search param.
- Relative imports carry explicit `.ts`/`.tsx` extensions.
- Branch `feat/revision-13g-contest-withdrawal`, cut from `origin/main` after 13e and 13f have merged, in its own worktree. Rebase onto `origin/main` before pushing; never merge `main` in (memory: rebase, do not merge).
- One commit per task. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- The migration number (`00NN`) is assigned by `db:generate` and re-checked at push time (memory: migration numbers are only safe at merge time).
- The permission catalog changes in Task 2. That task runs the **web** suite too, because `RoleDialog.test.tsx` hardcodes the resource-group order (memory: a new permission breaks web tests).
- Between Task 4 and Task 12 a contract change may leave `pnpm typecheck` red in a package the task does not own. Each task fixes the call sites its own contract change breaks, in api *and* web, before it commits. `pnpm --filter @treerepro/api typecheck` and `pnpm --filter @treerepro/web typecheck` are part of every task's final run.

### Verification (this Mac has no Node — everything runs in Docker)

Setup once, from the main checkout:

```sh
git fetch origin
git worktree add ../TreeRepro-13g -b feat/revision-13g-contest-withdrawal origin/main
cd ../TreeRepro-13g
docker image inspect treerepro-verify:base > /dev/null   # built per memory "verify-in-docker-no-node"; build it from there if missing
docker run -d --name treerepro-13g -w /workspace \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
  -e TESTCONTAINERS_RYUK_DISABLED=true \
  treerepro-verify:base sleep infinity
```

**Sync.** Run from the worktree root before every test run. It deletes first (`-exec rm -f {} +`, never `-delete`), sets `COPYFILE_DISABLE` and rebuilds contracts:

```sh
docker exec treerepro-13g sh -c 'cd /workspace && find . -name node_modules -prune -o -type f -exec rm -f {} +' \
&& COPYFILE_DISABLE=1 tar -cf - --exclude='./node_modules' --exclude='*/node_modules' --exclude='./.git' \
    --exclude='./data' --exclude='./.claude' --exclude='*/dist' \
    --exclude='.DS_Store' --exclude='._*' --exclude='*/._*' . \
  | docker exec -i treerepro-13g tar -x -C /workspace \
&& docker exec treerepro-13g sh -c 'cd /workspace && pnpm --filter @treerepro/contracts build'
```

Commands (always after **Sync**; `<file>` is relative to the package):

- contracts: `docker exec treerepro-13g sh -c 'cd /workspace && pnpm --filter @treerepro/contracts exec vitest run <file>'`
- api integration: `docker exec treerepro-13g sh -c 'cd /workspace && pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration <file>'`
- api unit: `docker exec treerepro-13g sh -c 'cd /workspace && pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:unit <file>'`
- web: `docker exec treerepro-13g sh -c 'cd /workspace && pnpm --filter @treerepro/web exec vitest run <file>'`
- typecheck: `docker exec treerepro-13g sh -c 'cd /workspace && pnpm --filter @treerepro/api typecheck && pnpm --filter @treerepro/web typecheck'`
- lint: `docker exec treerepro-13g sh -c 'cd /workspace && pnpm lint'`. Fix findings in the worktree, never with `lint:fix` in the container.

**Migration generation** (Task 2). The container is a copy, so the output is copied back out:

```sh
docker exec treerepro-13g sh -c 'cd /workspace && find . -name "._*" | head'   # must print nothing
docker exec treerepro-13g sh -c 'cd /workspace && pnpm --filter @treerepro/api db:generate --name contest_withdrawal'
docker exec treerepro-13g sh -c 'cd /workspace/apps/api/drizzle && ls -t *.sql | head -1'   # → 00NN_contest_withdrawal.sql
docker cp treerepro-13g:/workspace/apps/api/drizzle/00NN_contest_withdrawal.sql apps/api/drizzle/
docker cp treerepro-13g:/workspace/apps/api/drizzle/meta/00NN_snapshot.json apps/api/drizzle/meta/
docker cp treerepro-13g:/workspace/apps/api/drizzle/meta/_journal.json apps/api/drizzle/meta/
```

E2E cannot run on this machine. The CI `e2e` job validates the one spec edit (Task 12), and every asserted string is checked against the component source.

## File Structure

```
docs/rfc/30-access/30-permission-catalog.md            # T2: records.withdraw_imported; two descriptions
docs/rfc/30-access/33-data-visibility.md               # T1: R1 review flag; R2 live + harmonised
docs/rfc/50-admin/52-platform-health.md                # T1: queues without `disputed`
docs/rfc/60-dataset/60-taxonomy-catalog.md             # T1: R6 contested / unknownLevels / unresolved gate
docs/rfc/70-workspace/74-daily-digest.md               # T1: R3 no disputes, contestedNow
packages/contracts/src/permissions.ts                  # T2
packages/contracts/src/dataset.ts                      # T2 ANNOTATION_KINDS; T4 record/summary; T10 species filters; T11 sort
packages/contracts/src/curation.ts                     # T5 annotate; T6 value/result; T7 level actions; T8 contested queue
packages/contracts/src/contributions.ts                # T12 summary
packages/contracts/src/dashboard.ts, health.ts         # T8 queues
apps/api/src/db/schema/curation.ts, coverage.ts        # T2 note check dropped; unique withdraw index; doc
apps/api/drizzle/00NN_contest_withdrawal.sql (+ meta)  # T2 generated + hand-appended function, trigger, backfill, permission
apps/api/test/helpers/dataset.ts                       # T2 createAnnotation: no default note
apps/api/src/access/visibility.ts (+ test)             # T3 Visibility.review
apps/api/src/dataset/records.ts                        # T3 liveSql/harmonisedFor/recordVisible; T4 counts, openContestSql; T11 sort
apps/api/src/dataset/summary.ts                        # T3 filters; T4 levels + contested
apps/api/src/dataset/taxa.ts                           # T3 counts, unresolvedTaxon; T10 filters
apps/api/src/dataset/trait-page.ts, references.ts      # T3 live filter
apps/api/src/dataset/queues.ts                         # T3 PENDING live; T8 listContested/countContested
apps/api/src/dataset/curation.ts                       # T5 annotateRecord/mayWithdraw; T6 createRecords; T7 validateLevel/withdrawLevel
apps/api/src/dataset/contributions.ts                  # T12
apps/api/src/workspace/dashboard.ts                    # T3 awaiting; T8 queues
apps/api/src/admin/health.ts                           # T8 queues
apps/api/src/jobs/digest.ts, mail/templates.ts         # T8
apps/api/src/http/routes/dataset/records.ts, species.ts# T5–T8, T10, T11
apps/api/src/routes-guarded.integration.test.ts        # T7
apps/api/src/routes-visibility.integration.test.ts     # T7
apps/api/src/dataset/*.integration.test.ts             # new: withdraw-counters, live-records, contests; edits elsewhere
apps/web/src/api/curation.ts, dataset.ts               # T5–T8, T10
apps/web/src/components/curation/RecordActions.tsx     # T5
apps/web/src/components/dataset/RecordDrawer.tsx       # T5 onClose threaded to RecordActions
apps/web/src/components/curation/AddEntriesDialog.tsx, ContestDialog.tsx, ValueField.tsx  # T6
apps/web/src/pages/curation/DisputedPage.tsx, components/curation/DisputedTable.tsx, routes/app/curation/disputed.tsx  # T9
apps/web/src/components/shell/nav.ts, components/workspace/CurationCards.tsx, pages/admin/HealthPage.tsx  # T8/T9
apps/web/src/components/dataset/SpeciesSearchForm.tsx, SpeciesList.tsx, pages/dataset/SpeciesSearchPage.tsx, routes/app/species/index.tsx  # T3, T10
apps/web/src/pages/WorkspacePage.tsx, pages/workspace/ContributionsPage.tsx  # T12
apps/web/src/test/dataset-fixtures.ts, health-fixtures.ts  # fixtures follow each contract change
apps/e2e/tests/contributions.spec.ts                   # T12
README.md, docs/gotchas/dataset.md                     # T13
```

---

### Task 1: RFC amendments outside 13a's set, and the tag table

**Files:** `docs/rfc/30-access/33-data-visibility.md`, `docs/rfc/50-admin/52-platform-health.md`, `docs/rfc/60-dataset/60-taxonomy-catalog.md`, `docs/rfc/70-workspace/74-daily-digest.md`.

**Interfaces:** Produces rule text only. Consumes 13a's amendments.

- [ ] **Step 1: Confirm the tag table against 13a.** Run `grep -n "R-3\|R-6\|R-7\|R-8\|R-9\|R-10\|R-11\|R-12\|R-13\|R-14\|R-15\|contest\|withdraw" docs/rfc/60-dataset/63-trait-records.md docs/rfc/60-dataset/65-curation.md docs/rfc/60-dataset/69-coverage-summary.md docs/rfc/70-workspace/70-contribution-workflow.md docs/rfc/70-workspace/71-my-contributions.md docs/rfc/70-workspace/72-workspace-dashboard.md`. Find the rule that carries each spec rule below. Where 13a put a spec rule under a **new** rule number, replace that row's tag in the table and in every `@rfc`/`describe` string of this plan before you start Task 2. Where 13a amended the listed rule in place, keep the tag.

| Spec rule | Tag cited in this plan | Where it is used |
|---|---|---|
| R-3, R-7 (create, dedupe) | `RFC-70 R2, R3` | `createRecords`, `POST /api/records` |
| R-6 (validate), R-11 (no neutral/dispute) | `RFC-70 R4` | annotation body, `annotateRecord`, `validateLevel` |
| R-8, R-9 (contest, contested) | `RFC-63 R6, R8, R10`; `RFC-65 R10` | helpers, record item, summary, queue |
| R-10 (resolve, Withdraw level) | `RFC-65 R10`; `RFC-70 R5` | `resolve`, `withdrawLevel`, queue page |
| R-12 (withdraw permissions) | `RFC-65 R4` | `mayWithdraw`, routes, `RecordActions` |
| R-13 (withdrawn leaves the dataset) | `RFC-63 R6`; `RFC-69 R2`; `RFC-61 R4, R9` | `liveSql`, reads, trigger |
| R-14 (reviewer-only records and badge) | `RFC-33 R1, R2` (Task 1 here) | `Visibility.review`, `recordVisible` |
| R-15 (species filters) | `RFC-60 R6` (Task 1 here) | `speciesListConditions`, `SpeciesSearchForm` |
| records list sort | `RFC-63 R9` | `listRecords` |
| queue counts | `RFC-72 R1`; `RFC-52 R1`; `RFC-74 R3` | dashboard, health, digest |
| contributions | `RFC-71 R2, R3, R4` | `contributions.ts` |
| permission | `RFC-30 R1, R3` | catalog, migration |

- [ ] **Step 2: RFC-33.** In R1, replace ``Visibility` is the value `{ inactive: boolean, plotIds: string[] | null }`: `inactive` is true when the viewer holds `dataset.read_inactive`;`` with:

  ``Visibility` is the value `{ inactive: boolean, plotIds: string[] | null, review?: boolean }`: `inactive` is true when the viewer holds `dataset.read_inactive`; `review` is true when the viewer holds `records.review` (absent means false);``

  In R2, replace `A record is visible when its species and its trait are visible.` with:

  `A record is visible when its species and its trait are visible, no `withdraw` annotation exists for it (a withdrawn record leaves every read, RFC-63 R6), and its harmonisation is `harmonised` unless `visibility.review`. The unresolved-taxon flag of a species (RFC-60 R3) is shown only when `visibility.review`.`

  Changelog: `- 2026-09-25 — R1 `review`; R2 withdrawn and non-harmonised records (spec R-13, R-14; plan 13g).`
- [ ] **Step 3: RFC-52.** In R1, replace `queues: { pendingGroups, disputed, contested, proposals }` with `queues: { pendingGroups, contested, proposals }`. After it, add the sentence: `` `queues.contested` counts open contests, the rows of the contested queue (RFC-65 R10). `` Changelog: `- 2026-09-25 — R1 `queues.disputed` removed; `contested` is the open-contest count (spec R-9, R-11; plan 13g).`
- [ ] **Step 4: RFC-60.** In R6, replace `&unresolved=&status=` with `&unresolved=&contested=&unknownLevels=&status=`. Append to R6:

  `` `contested=true` keeps species with an open contest (RFC-65 R10) on a visible trait, for every viewer. `unknownLevels=true` keeps species with a visible `unknown_level` record. `unresolved=true` keeps unresolved taxa. Those two are applied only for a holder of `records.review` and ignored otherwise, as `status` is for a restricted viewer. `unresolvedTaxon` is `false` for a viewer without `records.review` (RFC-33 R2). ``

  Changelog: `- 2026-09-25 — R6 contested and unknownLevels filters; reviewer-only unresolved (spec R-14, R-15; plan 13g).`
- [ ] **Step 5: RFC-74.** In R3, replace `` `disputes` (`dispute` annotations with `generated = false`), `` with nothing. Replace `` `disputedNow` (current, RFC-65 R10), plus the 10 newest contests and 10 newest disputes `` with `` `contestedNow` (current open contests, RFC-65 R10), plus the 10 newest contests that are not withdrawn ``. Append: `Records counted are those not withdrawn at the time of the run (RFC-63 R6).` Changelog: `- 2026-09-25 — R3 disputes removed, contestedNow (spec R-11, R-13; plan 13g).`
- [ ] **Step 6: Commit**

```sh
git add docs/rfc/30-access/33-data-visibility.md docs/rfc/50-admin/52-platform-health.md docs/rfc/60-dataset/60-taxonomy-catalog.md docs/rfc/70-workspace/74-daily-digest.md docs/plans/2026-09-25-revision-13g-contest-withdrawal.md
git commit -m "docs(rfc): RFC-33 review flag, RFC-52/74 contested queue, RFC-60 R6 filters (plan 13g)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Permission, the `resolve` kind, and counters that step back

**Files:**
- Modify: `docs/rfc/30-access/30-permission-catalog.md`, `packages/contracts/src/permissions.ts`, `packages/contracts/src/dataset.ts` (`ANNOTATION_KINDS`), `apps/api/src/db/schema/curation.ts`, `apps/api/src/db/schema/coverage.ts` (doc comment), `apps/api/test/helpers/dataset.ts` (`createAnnotation`), `apps/web/src/components/dataset/RecordDrawer.tsx`, `apps/web/src/components/workspace/AnnotationTable.tsx`, `apps/web/src/components/admin/RoleDialog.test.tsx`.
- Create: `apps/api/drizzle/00NN_contest_withdrawal.sql` (+ `meta/00NN_snapshot.json`, `_journal.json`) and `apps/api/src/dataset/withdraw-counters.integration.test.ts`.

**Interfaces:**
- Produces:
  - `PERMISSIONS['records.withdraw_imported'] = 'Withdraw any imported record'`.
  - `ANNOTATION_KINDS = ['confirm', 'dispute', 'neutral', 'withdraw', 'resolve']`. `dispute` and `neutral` stay so old rows still parse (R-11).
  - The DB function `trait_records_uncount(ids uuid[])`.
  - The trigger `record_annotations_withdraw_counters`.
  - The unique index `record_annotations_withdraw_idx`.
- Consumes 13f's `record_references` and its trigger `record_references_usage()` (13f plan, migration). That trigger adds one to `bibliographic_references.primary_count`, and one to `reference_traits.record_count` for the record's trait, per `record_references` row, as a count of its own rather than inside the DISTINCT-triple union of 0027. The decrement below mirrors it the same way.

- [ ] **Step 1: Failing tests**

`packages/contracts/src/permissions.test.ts` needs no edit: it compares the RFC-30 table with `PERMISSIONS`. The DB parity test in `apps/api/src/access/permissions.integration.test.ts` compares the table rows. Both go red as soon as one side changes.

Create `apps/api/src/dataset/withdraw-counters.integration.test.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createAnnotation,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { unwrapDbError, useTestDb, withRollback } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import type { DbExecutor } from '../db/client.ts';
import { speciesTraitCoverage } from '../db/schema/coverage.ts';
import { referenceTraits } from '../db/schema/reference-traits.ts';
import { recordReferences } from '../db/schema/records.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { species } from '../db/schema/taxa.ts';

async function counters(db: DbExecutor, speciesId: string, traitId: string, refIds: string[]) {
  const [cell] = await db
    .select({ recordCount: speciesTraitCoverage.recordCount, harmonisedCount: speciesTraitCoverage.harmonisedCount })
    .from(speciesTraitCoverage)
    .where(and(eq(speciesTraitCoverage.speciesId, speciesId), eq(speciesTraitCoverage.traitId, traitId)));
  const [sp] = await db.select({ traitCount: species.traitCount }).from(species).where(eq(species.id, speciesId));
  const refs = [];
  for (const id of refIds) {
    const [r] = await db
      .select({ primary: bibliographicReferences.primaryCount, secondary: bibliographicReferences.secondaryCount })
      .from(bibliographicReferences)
      .where(eq(bibliographicReferences.id, id));
    const [rt] = await db
      .select({ n: referenceTraits.recordCount })
      .from(referenceTraits)
      .where(and(eq(referenceTraits.referenceId, id), eq(referenceTraits.traitId, traitId)));
    refs.push({ ...r, byTrait: rt?.n ?? null });
  }
  return { cell: cell ?? null, traitCount: sp?.traitCount, refs };
}

describe('RFC-69 R2, RFC-61 R4, R9 a withdrawal takes its record out of every counter (spec R-13)', () => {
  const t = useTestDb();

  it('decrements coverage, trait_count, reference usage and reference_traits; the last record empties the cell', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      const refA = await createReference(tx);
      const refB = await createReference(tx);
      const refC = await createReference(tx);
      const trait = await createTrait(tx, { levels: ['a', 'b'] });
      const sp = await createSpecies(tx);
      const [la, lb] = trait.levels as [{ id: string }, { id: string }];
      const r1 = await createRecord(tx, {
        speciesId: sp.id, traitId: trait.id, valueText: 'a', levelId: la.id,
        primaryReferenceId: refA.id, secondaryReferenceId: refB.id, origin: 'manual', createdBy: user.id,
      });
      await tx.insert(recordReferences).values({ recordId: r1.id, referenceId: refC.id });
      const r2 = await createRecord(tx, {
        speciesId: sp.id, traitId: trait.id, valueText: 'b', levelId: lb.id,
        primaryReferenceId: refA.id, origin: 'manual', createdBy: user.id,
      });
      const ids = [refA.id, refB.id, refC.id];

      expect(await counters(tx, sp.id, trait.id, ids)).toEqual({
        cell: { recordCount: 2, harmonisedCount: 2 },
        traitCount: 1,
        refs: [
          { primary: 2, secondary: 0, byTrait: 2 },
          { primary: 0, secondary: 1, byTrait: 1 },
          { primary: 1, secondary: 0, byTrait: 1 },
        ],
      });

      await createAnnotation(tx, { recordId: r1.id, actorId: user.id, kind: 'withdraw' });
      expect(await counters(tx, sp.id, trait.id, ids)).toEqual({
        cell: { recordCount: 1, harmonisedCount: 1 },
        traitCount: 1,
        refs: [
          { primary: 1, secondary: 0, byTrait: 1 },
          { primary: 0, secondary: 0, byTrait: null },
          { primary: 0, secondary: 0, byTrait: null },
        ],
      });

      await createAnnotation(tx, { recordId: r2.id, actorId: user.id, kind: 'withdraw' });
      expect(await counters(tx, sp.id, trait.id, ids)).toEqual({
        cell: null,
        traitCount: 0,
        refs: [
          { primary: 0, secondary: 0, byTrait: null },
          { primary: 0, secondary: 0, byTrait: null },
          { primary: 0, secondary: 0, byTrait: null },
        ],
      });
    });
  });

  it('refuses a second withdraw of one record, so nothing is decremented twice', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      const ref = await createReference(tx);
      const trait = await createTrait(tx, { levels: ['a'] });
      const sp = await createSpecies(tx);
      const rec = await createRecord(tx, {
        speciesId: sp.id, traitId: trait.id, valueText: 'a', levelId: trait.levels[0]?.id,
        primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id,
      });
      await createAnnotation(tx, { recordId: rec.id, actorId: user.id, kind: 'withdraw' });
      await expect(
        unwrapDbError(tx.transaction((sp2) => createAnnotation(sp2, { recordId: rec.id, actorId: user.id, kind: 'withdraw' }))),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('RFC-63 R7 a withdraw and a resolve carry no note', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      const ref = await createReference(tx);
      const trait = await createTrait(tx, { levels: ['a'] });
      const sp = await createSpecies(tx);
      const rec = await createRecord(tx, {
        speciesId: sp.id, traitId: trait.id, valueText: 'a', levelId: trait.levels[0]?.id,
        primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id,
      });
      await expect(createAnnotation(tx, { recordId: rec.id, actorId: user.id, kind: 'resolve' })).resolves.toBeDefined();
      await expect(createAnnotation(tx, { recordId: rec.id, actorId: user.id, kind: 'withdraw' })).resolves.toBeDefined();
    });
  });
});
```

(`recordReferences` is 13f's export from `apps/api/src/db/schema/records.ts`. If 13f put it in its own schema file, import it from there.)

In `apps/web/src/components/admin/RoleDialog.test.tsx`, add inside `it('groups the catalog by resource prefix …')`, after the `not.toContain('users.delete')` line:

```ts
    expect(groups.find((g) => g.resource === 'records')?.entries.map((e) => e.key)).toContain(
      'records.withdraw_imported',
    );
```

- [ ] **Step 2: Run the tests and watch them fail**

After **Sync**:
- api integration `src/dataset/withdraw-counters.integration.test.ts`. Expected: the first test fails at the second `expect` (`recordCount` is still 2), the second fails because the duplicate insert succeeds, and the third fails with `23514` (`record_annotations_note_check`).
- web `src/components/admin/RoleDialog.test.tsx`. Expected: FAIL, `records.withdraw_imported` is not in the list.

- [ ] **Step 3: Catalog, kinds, schema**

`docs/rfc/30-access/30-permission-catalog.md`, catalog table:
- after the `records.withdraw` row, add `| \`records.withdraw_imported\` | Withdraw any imported record |`;
- change the `records.annotate` description to `Validate and contest records`;
- change the `records.review` description to `Work the harmonisation and contested queues; resolve contests and withdraw levels`;
- Changelog: `- 2026-09-25 — records.withdraw_imported (admin only, spec R-12); records.annotate and records.review descriptions (spec R-10, R-11; plan 13g).`

`packages/contracts/src/permissions.ts`:

```ts
  'records.annotate': 'Validate and contest records',
  'records.withdraw': 'Withdraw any manual record',
  'records.withdraw_imported': 'Withdraw any imported record',
```

and

```ts
  'records.review':
    'Work the harmonisation and contested queues; resolve contests and withdraw levels',
```

`packages/contracts/src/dataset.ts`:

```ts
/**
 * `dispute` and `neutral` are no longer written (spec R-11); old rows keep
 * them and are ignored by every derivation. `resolve` is Keep both (R-10).
 * @rfc RFC-63 R7
 */
export const ANNOTATION_KINDS = ['confirm', 'dispute', 'neutral', 'withdraw', 'resolve'] as const;
```

Web maps keyed by `AnnotationKind`: add `resolve: 'neutral',` to `ANNOTATION_TONES` in `RecordDrawer.tsx` and to `TONES` in `AnnotationTable.tsx`.

`apps/api/src/db/schema/curation.ts`:
- add `uniqueIndex` to the `drizzle-orm/pg-core` import;
- delete the `check('record_annotations_note_check', …)` entry;
- add to the index list:

```ts
    /** One withdrawal per record (spec R-13): the counter trigger decrements once. */
    uniqueIndex('record_annotations_withdraw_idx')
      .on(t.recordId)
      .where(sql`${t.kind} = 'withdraw'`),
```

`apps/api/src/db/schema/coverage.ts`: in the doc comment, replace `records are append-only (RFC-63 R4), so nothing ever decrements, and withdrawn records still count: coverage answers "is there a record", not "is there a good record".` with `a withdrawal decrements it through the `record_annotations_withdraw_counters` trigger (spec R-13), and a cell whose last record is withdrawn is deleted.`

`apps/api/test/helpers/dataset.ts`, `createAnnotation`: change the `note:` line to `note: input.note ?? null,`.

- [ ] **Step 4: Migration.** Run **Sync**, then the generation block of the Global Constraints. The generated SQL drops `record_annotations_note_check` and creates `record_annotations_withdraw_idx`. Append this to the copied-out `apps/api/drizzle/00NN_contest_withdrawal.sql`:

```sql
--> statement-breakpoint
-- RFC-30 R3: the catalog row of spec R-12. Admin only: the admin system role
-- holds every permission by name (RFC-31 R2), so no role_permissions row.
INSERT INTO permissions (key, description) VALUES
  ('records.withdraw_imported', 'Withdraw any imported record')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
UPDATE permissions SET description = 'Validate and contest records' WHERE key = 'records.annotate';
--> statement-breakpoint
UPDATE permissions SET description = 'Work the harmonisation and contested queues; resolve contests and withdraw levels' WHERE key = 'records.review';
--> statement-breakpoint
-- Spec R-13: a withdrawn record leaves every counter its insert fed. The
-- mirror of trait_records_reference_usage (0015/0022/0027, and 13f's
-- record_references trigger). SECURITY DEFINER with the pg_temp-last
-- search_path of 0022 (see its header), owned by the migrator, which owns
-- every counter table; the app role can only read them. Called by the
-- statement trigger below and once by this migration's backfill. The unique
-- index record_annotations_withdraw_idx guarantees one call per record.
CREATE FUNCTION trait_records_uncount(ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF cardinality(ids) = 0 THEN RETURN; END IF;
  UPDATE bibliographic_references b SET primary_count = b.primary_count - u.n
  FROM (SELECT primary_reference_id AS id, count(*) AS n FROM trait_records
        WHERE id = ANY(ids) AND primary_reference_id IS NOT NULL GROUP BY 1) u
  WHERE b.id = u.id;
  UPDATE bibliographic_references b SET secondary_count = b.secondary_count - u.n
  FROM (SELECT secondary_reference_id AS id, count(*) AS n FROM trait_records
        WHERE id = ANY(ids) AND secondary_reference_id IS NOT NULL GROUP BY 1) u
  WHERE b.id = u.id;
  UPDATE bibliographic_references b SET primary_count = b.primary_count - u.n
  FROM (SELECT reference_id AS id, count(*) AS n FROM record_references
        WHERE record_id = ANY(ids) GROUP BY 1) u
  WHERE b.id = u.id;
  UPDATE species_trait_coverage c
  SET record_count = c.record_count - g.n, harmonised_count = c.harmonised_count - g.h
  FROM (SELECT species_id, trait_id, count(*) AS n, count(*) FILTER (WHERE harmonisation = 'harmonised') AS h
        FROM trait_records WHERE id = ANY(ids) GROUP BY 1, 2) g
  WHERE c.species_id = g.species_id AND c.trait_id = g.trait_id;
  -- A separate statement: the UPDATE above must be visible before a cell it
  -- emptied is deleted and its species loses the trait.
  WITH emptied AS (
    DELETE FROM species_trait_coverage c
    USING (SELECT DISTINCT species_id, trait_id FROM trait_records WHERE id = ANY(ids)) g
    WHERE c.species_id = g.species_id AND c.trait_id = g.trait_id AND c.record_count = 0
    RETURNING c.species_id)
  UPDATE species s SET trait_count = s.trait_count - e.n
  FROM (SELECT species_id, count(*) AS n FROM emptied GROUP BY 1) e
  WHERE s.id = e.species_id;
  -- The same DISTINCT-triple UNION as 0027 (a reference in two roles counts once).
  UPDATE reference_traits rt SET record_count = rt.record_count - u.n
  FROM (SELECT reference_id, trait_id, count(*) AS n FROM (
          SELECT DISTINCT id, primary_reference_id AS reference_id, trait_id FROM trait_records
          WHERE id = ANY(ids) AND primary_reference_id IS NOT NULL
          UNION
          SELECT DISTINCT id, secondary_reference_id, trait_id FROM trait_records
          WHERE id = ANY(ids) AND secondary_reference_id IS NOT NULL
        ) x GROUP BY 1, 2) u
  WHERE rt.reference_id = u.reference_id AND rt.trait_id = u.trait_id;
  -- 13f's record_references_usage() counts each record_references row on its
  -- own (not in the union above), so it is uncounted on its own too.
  UPDATE reference_traits rt SET record_count = rt.record_count - u.n
  FROM (SELECT rr.reference_id, r.trait_id, count(*) AS n FROM record_references rr
        JOIN trait_records r ON r.id = rr.record_id WHERE rr.record_id = ANY(ids) GROUP BY 1, 2) u
  WHERE rt.reference_id = u.reference_id AND rt.trait_id = u.trait_id;
  DELETE FROM reference_traits WHERE record_count = 0;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION trait_records_uncount(uuid[]) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION record_annotations_withdraw_counters() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM trait_records_uncount(ARRAY(SELECT record_id FROM inserted WHERE kind = 'withdraw'));
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION record_annotations_withdraw_counters() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER record_annotations_withdraw_counters AFTER INSERT ON record_annotations
REFERENCING NEW TABLE AS inserted
FOR EACH STATEMENT EXECUTE FUNCTION record_annotations_withdraw_counters();
--> statement-breakpoint
-- Backfill: the records withdrawn before this migration were never
-- decremented. The unique index above already refused any duplicate.
SELECT trait_records_uncount(ARRAY(SELECT record_id FROM record_annotations WHERE kind = 'withdraw'));
```

Sync again and re-run `db:generate` in the container. It must report `No schema changes, nothing to migrate`.

- [ ] **Step 5: Run the tests and watch them pass.** After **Sync**, run:
  - api integration: `src/dataset/withdraw-counters.integration.test.ts`, `src/access/permissions.integration.test.ts` and `src/db/schema/access.integration.test.ts`;
  - contracts: `src/permissions.test.ts`;
  - web: the **whole** suite (`pnpm --filter @treerepro/web test`);
  - typecheck.

  Expected: PASS. Also run the full api integration project once: `grep -rn "kind: 'withdraw'" apps/api/src --include='*.test.ts'`. Any test that relied on the default `'test'` note still passes, because the check is gone.
- [ ] **Step 6: Commit**

```sh
git add docs/rfc/30-access/30-permission-catalog.md packages/contracts/src/permissions.ts packages/contracts/src/dataset.ts apps/api/src/db/schema/curation.ts apps/api/src/db/schema/coverage.ts apps/api/test/helpers/dataset.ts apps/api/drizzle apps/api/src/dataset/withdraw-counters.integration.test.ts apps/web/src/components/dataset/RecordDrawer.tsx apps/web/src/components/workspace/AnnotationTable.tsx apps/web/src/components/admin/RoleDialog.test.tsx
git commit -m "feat(db): records.withdraw_imported, resolve kind, counters decrement on withdrawal (RFC-30, RFC-69 R2, spec R-12, R-13)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: A withdrawn record leaves every read; non-harmonised records are for reviewers

**Files:**
- Modify:
  - `apps/api/src/access/visibility.ts` (+ `visibility.integration.test.ts`);
  - in `apps/api/src/dataset/`: `records.ts`, `summary.ts`, `taxa.ts`, `trait-page.ts`, `references.ts` and `queues.ts`;
  - `apps/api/src/workspace/dashboard.ts`;
  - `apps/web/src/components/dataset/SpeciesList.tsx`.
- Create: `apps/api/src/dataset/live-records.integration.test.ts`.

**Interfaces:**
- Produces:

```ts
// visibility.ts
export interface Visibility { inactive: boolean; plotIds: string[] | null; review?: boolean }
export const UNRESTRICTED: Visibility  // { inactive: true, plotIds: null, review: true }
// records.ts
export function liveSql(recordId: SQL | typeof traitRecords.id): SQL
export function harmonisedFor(v: Visibility, harmonisation?: SQL | typeof traitRecords.harmonisation): SQL
export function recordVisible(v: Visibility, recordId?: SQL | typeof traitRecords.id, harmonisation?: SQL | typeof traitRecords.harmonisation): SQL
```

- Consumes: `speciesVisible`, `traitVisible` and `reviewStatusSql`.

- [ ] **Step 1: Failing tests.** Create `apps/api/src/dataset/live-records.integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createAnnotation,
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED } from '../../test/helpers/visibility.ts';
import type { Visibility } from '../access/visibility.ts';
import { getReference } from './references.ts';
import { getRecord, listRecords } from './records.ts';
import { speciesTraitSummary } from './summary.ts';
import { getSpecies, searchSpecies } from './taxa.ts';
import { pendingTraits } from './queues.ts';

const REVIEWER: Visibility = { inactive: false, plotIds: null, review: true };

async function fixture(db: Parameters<typeof createUser>[0]) {
  const { user } = await createUser(db);
  const ref = await createReference(db);
  const trait = await createTrait(db, { levels: ['a'] });
  const sp = await createSpecies(db, { nameSource: 'original' });
  const kept = await createRecord(db, {
    speciesId: sp.id, traitId: trait.id, valueText: 'a', levelId: trait.levels[0]?.id,
    primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id,
  });
  const gone = await createRecord(db, {
    speciesId: sp.id, traitId: trait.id, valueText: 'a', levelId: trait.levels[0]?.id,
    primaryReferenceId: ref.id, rawValue: 'second', origin: 'manual', createdBy: user.id,
  });
  const batch = await createImportBatch(db);
  const pending = await createRecord(db, {
    speciesId: sp.id, traitId: trait.id, valueText: 'zzz', primaryReferenceId: ref.id, importBatchId: batch.id,
  });
  await createAnnotation(db, { recordId: gone.id, actorId: user.id, kind: 'withdraw' });
  return { user, ref, trait, sp, kept, gone, pending };
}

describe('RFC-63 R6 a withdrawn record leaves every read (spec R-13)', () => {
  const t = useTestDb();

  it('lists, detail, summary, species counts and reference count skip it', async () => {
    const f = await fixture(t.db);
    const list = await listRecords(t.db, REVIEWER, { speciesId: f.sp.id, traitId: f.trait.id, limit: 50 });
    expect(list.data.map((r) => r.id).sort()).toEqual([f.kept.id, f.pending.id].sort());
    expect(await getRecord(t.db, REVIEWER, f.gone.id)).toBeNull();
    const summary = await speciesTraitSummary(t.db, REVIEWER, f.sp.id);
    const trait = summary?.flatMap((c) => c.traits).find((x) => x.trait.id === f.trait.id);
    expect(trait?.recordCount).toBe(2);
    expect(trait?.levels).toEqual([expect.objectContaining({ key: 'a', count: 1 })]);
    expect((await getSpecies(t.db, REVIEWER, f.sp.id))?.recordCount).toBe(2);
    expect((await getReference(t.db, REVIEWER, f.ref.id))?.recordCount).toBe(2);
  });

  it('a withdrawn pending record leaves the harmonisation queue', async () => {
    const f = await fixture(t.db);
    await createAnnotation(t.db, { recordId: f.pending.id, actorId: f.user.id, kind: 'withdraw' });
    const traits = await pendingTraits(t.db, REVIEWER);
    expect(traits.find((x) => x.trait.id === f.trait.id)).toBeUndefined();
  });
});

describe('RFC-33 R1, R2 non-harmonised records and the unresolved flag are for records.review (spec R-14)', () => {
  const t = useTestDb();

  it('a contributor sees neither the pending record nor the unresolved flag; a reviewer sees both', async () => {
    const f = await fixture(t.db);
    const mine = await listRecords(t.db, RESTRICTED, { speciesId: f.sp.id, traitId: f.trait.id, limit: 50 });
    expect(mine.data.map((r) => r.id)).toEqual([f.kept.id]);
    expect(await getRecord(t.db, RESTRICTED, f.pending.id)).toBeNull();
    const summary = await speciesTraitSummary(t.db, RESTRICTED, f.sp.id);
    const trait = summary?.flatMap((c) => c.traits).find((x) => x.trait.id === f.trait.id);
    expect(trait?.recordCount).toBe(1);
    expect(trait?.harmonisationCounts.unknownLevel).toBe(0);
    expect((await getSpecies(t.db, RESTRICTED, f.sp.id))?.unresolvedTaxon).toBe(false);
    expect((await getSpecies(t.db, REVIEWER, f.sp.id))?.unresolvedTaxon).toBe(true);
    const page = await searchSpecies(t.db, RESTRICTED, { q: f.sp.canonicalName, limit: 5 });
    expect(page.data.find((s) => s.id === f.sp.id)?.unresolvedTaxon).toBe(false);
  });
});
```

(Use the real export name of the reference detail reader in `references.ts`, where `recordCount` is computed at line ~188. If `createSpecies` has no `nameSource` option, insert the species with `nameSource: 'original'` through `db.insert(species)` exactly as `createSpecies` does.)

In `apps/api/src/access/visibility.integration.test.ts`, change the three `toEqual` expectations of `visibilityFor` to carry `review: false`, and add:

```ts
    expect(visibilityFor(new Set(['dataset.read', 'records.review']))).toEqual({
      inactive: false,
      plotIds: null,
      review: true,
    });
```

- [ ] **Step 2: Run the tests and watch them fail.** Run api integration on `src/dataset/live-records.integration.test.ts` and `src/access/visibility.integration.test.ts`. Expected failures: the list holds `gone`; `getRecord(gone)` is not null; the contributor's list holds `pending`; `unresolvedTaxon` is true for `RESTRICTED`; `visibilityFor` has no `review`.

- [ ] **Step 3: Implement**

`visibility.ts`:

```ts
/**
 * What one viewer may see (RFC-33 R1). `review`: the viewer holds
 * `records.review`, so non-harmonised records and the unresolved-taxon flag
 * are theirs to see (spec R-14); absent means false.
 * @rfc RFC-33 R1
 */
export interface Visibility {
  inactive: boolean;
  plotIds: string[] | null;
  review?: boolean;
}

/** A viewer who sees everything: CLI commands, migrations, admin-only services. @rfc RFC-33 R1 */
export const UNRESTRICTED: Visibility = { inactive: true, plotIds: null, review: true };
```

In `visibilityFor`, return `{ inactive: …, plotIds: …, review: permissions.has('records.review') }`.

`records.ts`: add `import type { Visibility }` next to the existing visibility import, and add the following after `reviewStatusSql`:

```ts
/**
 * No `withdraw` annotation exists for the record (spec R-13): the one
 * definition of "still in the dataset". `recordId` is wrapped for the reason
 * given on {@link reviewStatusSql}.
 * @rfc RFC-63 R6
 */
export function liveSql(recordId: SQL | typeof traitRecords.id): SQL {
  return sql`not exists (select 1 from ${recordAnnotations} lw
    where lw.record_id = ${sql`${recordId}`} and lw.kind = 'withdraw')`;
}

/** Harmonised, unless the viewer reviews (spec R-14). @rfc RFC-33 R2 */
export function harmonisedFor(
  v: Visibility,
  harmonisation: SQL | typeof traitRecords.harmonisation = traitRecords.harmonisation,
): SQL {
  return v.review ? sql`true` : sql`${harmonisation} = 'harmonised'`;
}

/** A record the viewer reads: live and, for a non-reviewer, harmonised (RFC-33 R2). @rfc RFC-33 R2 */
export function recordVisible(
  v: Visibility,
  recordId: SQL | typeof traitRecords.id = traitRecords.id,
  harmonisation: SQL | typeof traitRecords.harmonisation = traitRecords.harmonisation,
): SQL {
  return sql`${liveSql(recordId)} and ${harmonisedFor(v, harmonisation)}`;
}
```

`listRecords`: change the first line to `const conditions: SQL[] = [speciesVisible(visibility), traitVisible(visibility), recordVisible(visibility)];`. `getRecord`: `.where(and(eq(traitRecords.id, id), speciesVisible(visibility), traitVisible(visibility), recordVisible(visibility)))`.

`summary.ts`: import `recordVisible` from `./records.ts`. In **both** the aggregates query and the levels query, add this line after the `speciesVisible(…)` line of the `where`:

```ts
        and ${recordVisible(visibility, sql`r.id`, sql`r.harmonisation`)}
```

`taxa.ts`:
- import `recordVisible` from `./records.ts`;
- `function toListItem(r: SpeciesJoinedRow, review: boolean)`, with `unresolvedTaxon: review && (r.nameSource !== 'wcvp' || r.genusId === null || r.familyId === null),`;
- in `searchSpecies`, `page.map((r) => toListItem(r, visibility.review === true))`;
- in `getSpecies`, `toListItem({ … }, visibility.review === true)`, and the counts query becomes `.where(and(eq(traitRecords.speciesId, id), recordVisible(visibility)))`.

`trait-page.ts`: import `liveSql` from `./records.ts`. Add `and ${liveSql(sql`r.id`)}` to the `where` of the four `from trait_records r` queries: the numeric distribution, the level distribution, and both per-species enrichment queries.

`references.ts`: at the `recordCount` count (line ~188), wrap the condition as `.where(and(or(eq(traitRecords.primaryReferenceId, id), eq(traitRecords.secondaryReferenceId, id)), liveSql(traitRecords.id)))`, importing `and` and `liveSql`.

`queues.ts`:
- delete the private `notWithdrawn` function;
- import `liveSql` from `./records.ts`;
- replace every `notWithdrawn(x)` with `liveSql(x)`;
- extend `PENDING`:

```ts
const PENDING = sql`r.harmonisation <> 'harmonised'
  and r.harmonisation in ('unknown_level', 'multi_value', 'not_numeric')
  and not exists (select 1 from trait_records c where c.supersedes_record_id = r.id)
  and not exists (select 1 from record_annotations pw where pw.record_id = r.id and pw.kind = 'withdraw')`;
```

`dashboard.ts` `awaitingValidation`: import `harmonisedFor` from `../dataset/records.ts` and add `harmonisedFor(visibility, traitRecords.harmonisation),` as the last argument of the `and(…)` that builds `where`.

`apps/web/src/components/dataset/SpeciesList.tsx`: `{species.unresolvedTaxon ? <Badge tone="amber">unresolved</Badge> : null}`. The API now decides who sees it.

- [ ] **Step 4: Run to pass.** Run the api integration files of Step 1, plus `src/dataset/records.integration.test.ts`, `summary.integration.test.ts`, `taxa.integration.test.ts`, `trait-page.integration.test.ts`, `queues.integration.test.ts`, `src/workspace/dashboard.integration.test.ts` and `src/access/visibility.integration.test.ts`. Run the web suite on `src/components/dataset/SpeciesList.test.tsx`, then typecheck. Expected: PASS.
  - A test that read `unresolvedTaxon: true` through a `RESTRICTED` viewer now gets `false`. Change its viewer to one with `review: true`; the rule changed, not the test's intent.
  - A test that counted an `unknown_level` record for `RESTRICTED` changes the same way.
- [ ] **Step 5: Commit**

```sh
git add apps/api/src apps/web/src/components/dataset/SpeciesList.tsx
git commit -m "feat(api): withdrawn records leave every read; non-harmonised records and unresolved flag for reviewers (RFC-33 R1-R2, RFC-63 R6)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Contested, derived; counts on the record item and the trait summary

**Files:**
- Modify:
  - `packages/contracts/src/dataset.ts`: `recordSchema`, `traitSummarySchema`, and `reviewStatusSql`'s documented states;
  - `apps/api/src/dataset/records.ts` and `apps/api/src/dataset/summary.ts`;
  - `apps/web/src/test/dataset-fixtures.ts`.
- Create: `apps/api/src/dataset/contests.integration.test.ts`.

**Interfaces:**
- Produces:

```ts
// contracts: record item
validationCount: number /* int ≥ 0, distinct users */, contestCount: number /* distinct contest authors */, contested: boolean
// contracts: trait summary
levels: Array<{ levelId: string; key: string; count: number; validationCount: number; contested: boolean }> | null
contested: boolean
// records.ts
export function openContestSql(c: string): SQL   // `c` is a code-constant alias of trait_records
```

- Consumes: `liveSql` (Task 3) and the `resolve` kind (Task 2).

- [ ] **Step 1: Failing tests.** Create `apps/api/src/dataset/contests.integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createAnnotation,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { listRecords } from './records.ts';
import { speciesTraitSummary } from './summary.ts';

async function colours(db: Parameters<typeof createUser>[0]) {
  const { user: ana } = await createUser(db);
  const { user: bo } = await createUser(db);
  const { user: cy } = await createUser(db);
  const ref = await createReference(db);
  const ref2 = await createReference(db);
  const trait = await createTrait(db, { levels: ['red', 'blue', 'orange'] });
  const sp = await createSpecies(db);
  const level = (k: string) => trait.levels.find((l) => l.key === k)?.id as string;
  const rec = (key: string, by: string, primary = ref.id) =>
    createRecord(db, {
      speciesId: sp.id, traitId: trait.id, valueText: key, levelId: level(key),
      primaryReferenceId: primary, origin: 'manual', createdBy: by,
    });
  const red = await rec('red', ana.id);
  const blue1 = await rec('blue', ana.id);
  const blue2 = await rec('blue', bo.id, ref2.id);
  const orange = await rec('orange', bo.id);
  return { ana, bo, cy, ref, ref2, trait, sp, level, red, blue1, blue2, orange };
}

describe('RFC-63 R6, R8 contested is derived from contest records (spec R-8, R-9)', () => {
  const t = useTestDb();

  it('a contest on one blue record contests every blue record and nothing else; counts are distinct users', async () => {
    const f = await colours(t.db);
    await createAnnotation(t.db, { recordId: f.blue1.id, actorId: f.bo.id, kind: 'confirm' });
    await createAnnotation(t.db, { recordId: f.blue1.id, actorId: f.bo.id, kind: 'confirm', referenceId: f.ref2.id });
    await createAnnotation(t.db, { recordId: f.blue1.id, actorId: f.cy.id, kind: 'confirm' });
    const contest = await createRecord(t.db, {
      speciesId: f.sp.id, traitId: f.trait.id, valueText: 'red', levelId: f.level('red'),
      primaryReferenceId: f.ref2.id, origin: 'manual', createdBy: f.cy.id,
      intent: 'contest', respondsToRecordId: f.blue1.id,
    });
    const { data } = await listRecords(t.db, UNRESTRICTED, { speciesId: f.sp.id, traitId: f.trait.id, limit: 50 });
    const byId = new Map(data.map((r) => [r.id, r]));
    expect(byId.get(f.blue1.id)).toMatchObject({ validationCount: 2, contestCount: 1, contested: true });
    expect(byId.get(f.blue2.id)).toMatchObject({ validationCount: 0, contestCount: 1, contested: true });
    expect(byId.get(f.red.id)).toMatchObject({ contested: false, contestCount: 0 });
    expect(byId.get(f.orange.id)).toMatchObject({ contested: false });
    expect(byId.get(contest.id)).toMatchObject({ contested: false });

    const summary = await speciesTraitSummary(t.db, UNRESTRICTED, f.sp.id);
    const trait = summary?.flatMap((c) => c.traits).find((x) => x.trait.id === f.trait.id);
    expect(trait?.contested).toBe(true);
    expect(trait?.levels).toEqual(
      expect.arrayContaining([
        { levelId: f.level('blue'), key: 'blue', count: 2, validationCount: 2, contested: true },
        { levelId: f.level('red'), key: 'red', count: 2, validationCount: 0, contested: false },
        { levelId: f.level('orange'), key: 'orange', count: 1, validationCount: 0, contested: false },
      ]),
    );
  });

  it('RFC-65 R10 resolving, withdrawing the contest or withdrawing the level clears the flag', async () => {
    for (const end of ['resolve', 'withdraw contest', 'withdraw level'] as const) {
      const f = await colours(t.db);
      const contest = await createRecord(t.db, {
        speciesId: f.sp.id, traitId: f.trait.id, valueText: 'orange', levelId: f.level('orange'),
        primaryReferenceId: f.ref2.id, origin: 'manual', createdBy: f.cy.id,
        intent: 'contest', respondsToRecordId: f.blue1.id,
      });
      if (end === 'resolve') await createAnnotation(t.db, { recordId: contest.id, actorId: f.ana.id, kind: 'resolve' });
      if (end === 'withdraw contest') await createAnnotation(t.db, { recordId: contest.id, actorId: f.cy.id, kind: 'withdraw' });
      if (end === 'withdraw level') {
        await createAnnotation(t.db, { recordId: f.blue1.id, actorId: f.ana.id, kind: 'withdraw' });
        await createAnnotation(t.db, { recordId: f.blue2.id, actorId: f.ana.id, kind: 'withdraw' });
      }
      const summary = await speciesTraitSummary(t.db, UNRESTRICTED, f.sp.id);
      const trait = summary?.flatMap((c) => c.traits).find((x) => x.trait.id === f.trait.id);
      expect(trait?.contested, end).toBe(false);
    }
  });

  it('a quantitative contest contests the one record it responds to', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { valueType: 'quantitative' });
    const sp = await createSpecies(t.db);
    const a = await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: '1', numericValue: 1, primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id });
    const b = await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: '2', numericValue: 2, primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id });
    await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: '3', numericValue: 3, primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id, intent: 'contest', respondsToRecordId: a.id });
    const { data } = await listRecords(t.db, UNRESTRICTED, { speciesId: sp.id, traitId: trait.id, limit: 50 });
    expect(data.find((r) => r.id === a.id)?.contested).toBe(true);
    expect(data.find((r) => r.id === b.id)?.contested).toBe(false);
  });
});
```

- [ ] **Step 2: Run to fail.** Run api integration on `src/dataset/contests.integration.test.ts`. Expected: FAIL, `validationCount` is undefined.

- [ ] **Step 3: Implement**

Contracts (`dataset.ts`). In `recordSchema`, after `respondsTo`:

```ts
  validationCount: z.number().int().nonnegative(),
  contestCount: z.number().int().nonnegative(),
  contested: z.boolean(),
```

In `traitSummarySchema`, the level item gains `validationCount: z.number().int().nonnegative(), contested: z.boolean()`, and the object gains `contested: z.boolean(),`. Update the `@rfc` doc of `recordSchema` to say "`validationCount` and `contestCount` count distinct users; `contested` is spec R-9". Run a contracts build.

`records.ts`, after `recordVisible`:

```ts
const contestAlive = (c: string) =>
  sql.raw(`${c}.responds_to_record_id is not null and ${c}.intent = 'contest'
    and not exists (select 1 from record_annotations cw where cw.record_id = ${c}.id and cw.kind = 'withdraw')`);
const unresolved = (c: string) =>
  sql.raw(`not exists (select 1 from record_annotations cr where cr.record_id = ${c}.id and cr.kind = 'resolve')`);

/**
 * An open contest (spec R-9) over the `trait_records` alias `c`, a code
 * constant and never input. The contest is not withdrawn and not resolved,
 * and what it contests is still in the dataset: a live record of the
 * contested level, or for a quantitative trait the contested record itself.
 * Withdraw level (R-10) therefore clears the flag without touching the
 * contest.
 * @rfc RFC-63 R6
 * @rfc RFC-65 R10
 */
export function openContestSql(c: string): SQL {
  return sql`${contestAlive(c)} and ${unresolved(c)} and exists (
    select 1 from trait_records ctgt
    join trait_records clive on clive.species_id = ctgt.species_id and clive.trait_id = ctgt.trait_id
      and (clive.id = ctgt.id or (ctgt.level_id is not null and clive.level_id = ctgt.level_id))
    where ctgt.id = ${sql.raw(c)}.responds_to_record_id
      and not exists (select 1 from record_annotations lw where lw.record_id = clive.id and lw.kind = 'withdraw'))`;
}

// The contests (not withdrawn) that apply to the outer `trait_records` row:
// to it, or to any record of its level (spec R-8).
const APPLIES_TO_ROW = sql`from trait_records c join trait_records tgt on tgt.id = c.responds_to_record_id
  where ${contestAlive('c')} and tgt.species_id = ${traitRecords.speciesId} and tgt.trait_id = ${traitRecords.traitId}
    and (tgt.id = ${traitRecords.id} or (tgt.level_id is not null and tgt.level_id = ${traitRecords.levelId}))`;
```

In `reviewStatusSql`, drop the dispute derivation (spec R-11). Replace the function body with:

```ts
  const id = sql`${recordId}`;
  return sql<ReviewStatus>`case
    when exists (select 1 from ${recordAnnotations} w where w.record_id = ${id} and w.kind = 'withdraw') then 'withdrawn'
    when exists (select 1 from ${recordAnnotations} v where v.record_id = ${id} and v.kind = 'confirm') then 'confirmed'
    else 'unreviewed' end`;
```

Update its doc to read "withdrawn > confirmed > unreviewed; `dispute` and `neutral` rows are ignored (spec R-11); a validation cannot be undone (R-6)".

`itemQuery`'s select becomes:

```ts
    .select({
      ...itemColumns,
      review: reviewStatusSql(traitRecords.id).as('review'),
      validationCount: sql<number>`(select count(distinct v.actor_id) from record_annotations v
        where v.record_id = ${traitRecords.id} and v.kind = 'confirm')::int`.as('validation_count'),
      contestCount: sql<number>`(select count(distinct c.created_by) ${APPLIES_TO_ROW})::int`.as('contest_count'),
      contested: sql<boolean>`exists (select 1 ${APPLIES_TO_ROW} and ${unresolved('c')})`.as('contested'),
    })
```

`ItemRow` gains `validationCount: number; contestCount: number; contested: boolean;`. `toItem` adds, after `respondsTo`: `validationCount: r.validationCount, contestCount: r.contestCount, contested: r.contested,`.

`summary.ts`. Import `openContestSql`. Replace the levels query with:

```ts
    db.execute(sql`
      select r.trait_id, l.id as level_id, l.key as level_key, count(*)::int as count,
        (select count(distinct v.actor_id) from record_annotations v
          join trait_records vr on vr.id = v.record_id
          where v.kind = 'confirm' and vr.species_id = ${speciesId} and vr.trait_id = r.trait_id
            and vr.level_id = l.id
            and not exists (select 1 from record_annotations vw where vw.record_id = vr.id and vw.kind = 'withdraw'))::int
          as validation_count,
        exists (select 1 from trait_records c join trait_records tgt on tgt.id = c.responds_to_record_id
          where ${openContestSql('c')} and tgt.species_id = ${speciesId} and tgt.trait_id = r.trait_id
            and tgt.level_id = l.id) as contested
      from trait_records r
      join trait_levels l on l.id = r.level_id
      join traits t on t.id = r.trait_id
      join species s on s.id = r.species_id
      where r.species_id = ${speciesId}
        and ${traitVisible(visibility, sql`t.active`)}
        and ${speciesVisible(visibility, sql`s.active`, sql`s.id`)}
        and ${recordVisible(visibility, sql`r.id`, sql`r.harmonisation`)}
      group by r.trait_id, l.id, l.key
      order by count desc, l.key`) as unknown as Promise<LevelAggregate[]>,
```

`LevelAggregate` gains `validation_count: number; contested: boolean`. The map push becomes `{ levelId: l.level_id, key: l.level_key, count: l.count, validationCount: l.validation_count, contested: l.contested }`. Add a fourth query to the `Promise.all`:

```ts
    db.execute(sql`
      select distinct c.trait_id from trait_records c
      join traits t on t.id = c.trait_id
      where c.species_id = ${speciesId} and ${openContestSql('c')}
        and ${traitVisible(visibility, sql`t.active`)}`) as unknown as Promise<{ trait_id: string }[]>,
```

Destructure it as `contestedRows`. Build `const contestedTraits = new Set(contestedRows.map((r) => r.trait_id));` and add `contested: contestedTraits.has(trait.id),` to the object `summaryOf` returns. Nothing caps `levels`. This function never had a cap, and the web's five-bar cap is plan 13h's.

`apps/web/src/test/dataset-fixtures.ts`:
- `RECORD` gains `validationCount: 1, contestCount: 0, contested: false,`;
- `PENDING_RECORD` gains `validationCount: 0, contestCount: 0, contested: false,`;
- every `TraitSummary` literal gains `contested: false,`;
- every level entry in `SEXUAL_SYSTEM_SUMMARY` and `POLLINATION_MODE_SUMMARY` gains `validationCount: 0, contested: false`.

Then run the web typecheck. For every remaining literal it names (`RecordItem`, `RecordDetail`, `TraitSummary`, in fixtures or test files), add the same fields with `0`/`false`.

- [ ] **Step 4: Run to pass.** Run api integration on `src/dataset/contests.integration.test.ts`, `records.integration.test.ts`, `summary.integration.test.ts`, `contributions.integration.test.ts` and `queues.integration.test.ts`; the contracts suite; the web suite; typecheck. Expected: PASS. A queue or records test that asserted `review: 'disputed'` from a `dispute` annotation now reads `unreviewed` or `confirmed`. Update that expectation, since R-11 changed the rule.
- [ ] **Step 5: Commit**

```sh
git add packages/contracts/src/dataset.ts apps/api/src/dataset apps/web/src
git commit -m "feat(api): contested derived from contest records; validation and contest counts on records and levels (RFC-63 R6, R8, R10, RFC-65 R10)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The annotations endpoint (confirm, withdraw, resolve)

**Files:**
- Modify:
  - `packages/contracts/src/curation.ts` (+ `curation.test.ts`);
  - `apps/api/src/dataset/curation.ts` (+ `curation.integration.test.ts`);
  - `apps/api/src/http/routes/dataset/records.ts` (+ `records.integration.test.ts`);
  - in `apps/web/src/`: `api/curation.ts`, `components/curation/RecordActions.tsx` (+ test), `components/dataset/RecordDrawer.tsx`.

**Interfaces:**
- Produces:

```ts
// contracts
export const annotateRecordBodySchema /* { kind: 'confirm'; referenceSource?: SourceRef } | { kind: 'withdraw' } | { kind: 'resolve' } */
// api
export interface AnnotateRecordInput { recordId: string; actorId: string; kind: 'confirm' | 'withdraw' | 'resolve'; referenceId?: string; canWithdrawAny: boolean; canWithdrawImported: boolean; canReview: boolean }
export async function annotateRecord(db: DbExecutor, visibility: Visibility, input: AnnotateRecordInput): Promise<RecordDetail | null>  // null after a withdraw
export function mayWithdraw(rec: { origin: RecordOrigin; createdBy: string | null }, who: { actorId: string; canWithdrawAny: boolean; canWithdrawImported: boolean }): boolean
// web
export async function annotateRecord(id: string, body: AnnotateRecordBody): Promise<RecordDetail | null>
```

- Consumes: `resolveSourceRef` (`sources.ts`), `getRecord`, `reviewStatusSql` and `harmonisedFor`.

- [ ] **Step 1: Failing tests**

`packages/contracts/src/curation.test.ts`, appended:

```ts
describe('RFC-70 R4 annotateRecordBodySchema (spec R-6, R-11, R-12)', () => {
  it('takes confirm (with an optional source), withdraw and resolve; no note; neutral and dispute are gone', () => {
    expect(annotateRecordBodySchema.safeParse({ kind: 'confirm' }).success).toBe(true);
    expect(annotateRecordBodySchema.safeParse({ kind: 'confirm', referenceSource: { doi: '10.1111/geb.13000' } }).success).toBe(true);
    expect(annotateRecordBodySchema.safeParse({ kind: 'withdraw' }).success).toBe(true);
    expect(annotateRecordBodySchema.safeParse({ kind: 'resolve' }).success).toBe(true);
    for (const bad of [
      { kind: 'neutral' },
      { kind: 'dispute', note: 'x' },
      { kind: 'withdraw', note: 'x' },
      { kind: 'resolve', referenceSource: { doi: '10.1111/geb.13000' } },
      { kind: 'confirm', reference: { doi: '10.1111/geb.13000' } },
    ]) {
      expect(annotateRecordBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
```

In `apps/api/src/dataset/curation.integration.test.ts`:
- **delete** every `it`/`describe` that asserts the contest's generated dispute or the withdrawal's generated neutral, a `neutral` or `dispute` annotation, a withdraw `note`, or `RECORD_NOT_WITHDRAWABLE`. Find them with `grep -n "CONTEST_NOTE\|CONTEST_WITHDRAWN_NOTE\|'neutral'\|'dispute'\|note: \|RECORD_NOT_WITHDRAWABLE" apps/api/src/dataset/curation.integration.test.ts`;
- remove `CONTEST_NOTE`, `CONTEST_WITHDRAWN_NOTE`, `listDisputed` and 13e's leftovers from the import list if present;
- then append:

```ts
describe('RFC-70 R4, RFC-65 R4 annotateRecord (spec R-6, R-10, R-12)', () => {
  const t = useTestDb();
  const base = { canWithdrawAny: false, canWithdrawImported: false, canReview: false };

  async function setup() {
    const { user: author } = await createUser(t.db);
    const { user: other } = await createUser(t.db);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const sp = await createSpecies(t.db);
    const manual = await createRecord(t.db, {
      speciesId: sp.id, traitId: trait.id, valueText: 'a', levelId: trait.levels[0]?.id,
      primaryReferenceId: ref.id, origin: 'manual', createdBy: author.id,
    });
    const batch = await createImportBatch(t.db);
    const imported = await createRecord(t.db, {
      speciesId: sp.id, traitId: trait.id, valueText: 'b', levelId: trait.levels[1]?.id,
      primaryReferenceId: ref.id, importBatchId: batch.id,
    });
    return { author, other, ref, trait, sp, manual, imported };
  }

  it('a confirm on your own record is refused; on another, it counts once per user', async () => {
    const f = await setup();
    await expect(
      annotateRecord(t.db, UNRESTRICTED, { ...base, recordId: f.manual.id, actorId: f.author.id, kind: 'confirm' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await annotateRecord(t.db, UNRESTRICTED, { ...base, recordId: f.manual.id, actorId: f.other.id, kind: 'confirm' });
    const after = await annotateRecord(t.db, UNRESTRICTED, { ...base, recordId: f.manual.id, actorId: f.other.id, kind: 'confirm', referenceId: f.ref.id });
    expect(after).toMatchObject({ validationCount: 1, review: 'confirmed' });
  });

  it('withdraw: the author, records.withdraw for manual, records.withdraw_imported for imported; answers null', async () => {
    const f = await setup();
    await expect(
      annotateRecord(t.db, UNRESTRICTED, { ...base, canWithdrawAny: true, recordId: f.imported.id, actorId: f.other.id, kind: 'withdraw' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      annotateRecord(t.db, UNRESTRICTED, { ...base, canWithdrawImported: true, recordId: f.manual.id, actorId: f.other.id, kind: 'withdraw' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(
      await annotateRecord(t.db, UNRESTRICTED, { ...base, canWithdrawImported: true, recordId: f.imported.id, actorId: f.other.id, kind: 'withdraw' }),
    ).toBeNull();
    expect(
      await annotateRecord(t.db, UNRESTRICTED, { ...base, recordId: f.manual.id, actorId: f.author.id, kind: 'withdraw' }),
    ).toBeNull();
    await expect(
      annotateRecord(t.db, UNRESTRICTED, { ...base, recordId: f.manual.id, actorId: f.other.id, kind: 'confirm' }),
    ).rejects.toMatchObject({ code: 'RECORD_WITHDRAWN' });
  });

  it('resolve needs records.review and a contest record; nothing is generated on the contested record', async () => {
    const f = await setup();
    const contest = await createRecord(t.db, {
      speciesId: f.sp.id, traitId: f.trait.id, valueText: 'b', levelId: f.trait.levels[1]?.id,
      primaryReferenceId: f.ref.id, rawValue: 'c', origin: 'manual', createdBy: f.other.id,
      intent: 'contest', respondsToRecordId: f.manual.id,
    });
    await expect(
      annotateRecord(t.db, UNRESTRICTED, { ...base, recordId: contest.id, actorId: f.author.id, kind: 'resolve' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      annotateRecord(t.db, UNRESTRICTED, { ...base, canReview: true, recordId: f.manual.id, actorId: f.author.id, kind: 'resolve' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'kind', message: 'Only a contest can be resolved' }] });
    const resolved = await annotateRecord(t.db, UNRESTRICTED, { ...base, canReview: true, recordId: contest.id, actorId: f.author.id, kind: 'resolve' });
    expect(resolved?.annotations.map((a) => a.kind)).toEqual(['resolve']);
    await annotateRecord(t.db, UNRESTRICTED, { ...base, recordId: contest.id, actorId: f.other.id, kind: 'withdraw' });
    expect((await getRecord(t.db, UNRESTRICTED, f.manual.id))?.annotations).toEqual([]);
  });
});
```

(Add `createImportBatch` to the helper import list.)

`apps/api/src/http/routes/dataset/records.integration.test.ts`, appended:

```ts
describe('RFC-70 R4, RFC-65 R4 POST /api/records/:id/annotations', () => {
  const t = useTestApp();

  it('neutral and dispute answer 400; the manager withdraws manual but not imported; admin withdraws imported', async () => {
    const { user: manager } = await createUser(t.db, { roles: [await systemRoleId(t.db, 'manager')] });
    const { user: admin } = await createUser(t.db, { roles: [await systemRoleId(t.db, 'admin')] });
    const m = await loginAs(t, manager);
    const a = await loginAs(t, admin);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const sp = await createSpecies(t.db);
    const batch = await createImportBatch(t.db);
    const imported = await createRecord(t.db, {
      speciesId: sp.id, traitId: trait.id, valueText: 'a', levelId: trait.levels[0]?.id,
      primaryReferenceId: ref.id, importBatchId: batch.id,
    });
    for (const body of [{ kind: 'neutral' }, { kind: 'dispute', note: 'x' }]) {
      const res = await call(t.app, 'POST', `/api/records/${imported.id}/annotations`, { body, cookie: m.cookie });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const refused = await call(t.app, 'POST', `/api/records/${imported.id}/annotations`, { body: { kind: 'withdraw' }, cookie: m.cookie });
    expect(refused.status).toBe(403);
    const ok = await call(t.app, 'POST', `/api/records/${imported.id}/annotations`, { body: { kind: 'withdraw' }, cookie: a.cookie });
    expect(ok.status).toBe(201);
    expect((await ok.json()).data).toBeNull();
    const gone = await call(t.app, 'GET', `/api/records/${imported.id}`, { cookie: a.cookie });
    expect(gone.status).toBe(404);
  });
});
```

Web `apps/web/src/components/curation/RecordActions.test.tsx`:
- **delete** the `it` blocks titled `'adds Neutral and Dispute for a reviewer, after the two decisions'`, `'steps back with one click; disputing needs a note'` and `'offers Withdraw to the author or a records.withdraw holder, on manual records only'`;
- delete every other `it` that types into `/why is this record withdrawn/i` or `/why do you dispute/i`. List them with `grep -n "why is this record withdrawn\|why do you dispute\|'Neutral'\|'Dispute'" apps/web/src/components/curation/RecordActions.test.tsx`;
- replace `reference: { doi` with `referenceSource: { doi` everywhere in the file, and `'reference.doi'` with `'referenceSource.doi'`;
- append:

```tsx
describe('RFC-70 R4, RFC-65 R4 RecordActions after spec R-11 and R-12', () => {
  it('a reviewer gets the two decisions and no Neutral or Dispute', () => {
    renderWithProviders(<RecordActions record={THEIRS} />, { me: REVIEWER });
    expect(screen.getByRole('button', { name: VALIDATE })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Neutral' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dispute' })).not.toBeInTheDocument();
  });

  it('Withdraw asks for confirmation only, sends no note, and closes the drawer', async () => {
    curation.annotateRecord.mockResolvedValue(null);
    const onGone = vi.fn();
    renderWithProviders(<RecordActions record={MINE} onGone={onGone} />, { me: perms('records.annotate') });
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw this record?' });
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(curation.annotateRecord).toHaveBeenCalledWith(MINE.id, { kind: 'withdraw' }));
    await waitFor(() => expect(onGone).toHaveBeenCalled());
  });

  it('an imported record offers Withdraw only with records.withdraw_imported', () => {
    const imported: RecordDetail = { ...THEIRS, origin: 'import', createdBy: null };
    const first = renderWithProviders(<RecordActions record={imported} />, { me: perms('records.annotate', 'records.withdraw') });
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    first.unmount();
    renderWithProviders(<RecordActions record={imported} />, { me: perms('records.annotate', 'records.withdraw_imported') });
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });

  it('a manual record by someone else offers Withdraw with records.withdraw', () => {
    renderWithProviders(<RecordActions record={THEIRS} />, { me: perms('records.annotate', 'records.withdraw') });
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to fail.** Run the contracts `src/curation.test.ts`, the api integration `src/dataset/curation.integration.test.ts` and `src/http/routes/dataset/records.integration.test.ts`, and the web `src/components/curation/RecordActions.test.tsx`. Expected failures: `{ kind: 'neutral' }` parses; the own confirm succeeds; `canWithdrawImported` is unknown; the web still renders a Neutral button and the note form.

- [ ] **Step 3: Implement**

Contracts (`curation.ts`), replacing `annotateRecordBodySchema`:

```ts
/**
 * A validation (with an optional supporting source), a withdrawal or Keep
 * both. No note on any of them; `neutral` and `dispute` no longer exist
 * (spec R-6, R-10, R-11, R-12).
 * @rfc RFC-70 R4
 * @rfc RFC-65 R3, R4, R10
 */
export const annotateRecordBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('confirm'), referenceSource: sourceRefSchema.optional() }),
  z.strictObject({ kind: z.literal('withdraw') }),
  z.strictObject({ kind: z.literal('resolve') }),
]);
```

`apps/api/src/dataset/curation.ts`:
- delete `CONTEST_NOTE` and `CONTEST_WITHDRAWN_NOTE`;
- import `harmonisedFor` from `./records.ts` and `type RecordOrigin` from `@treerepro/contracts`;
- replace `AnnotateRecordInput` and `annotateRecord` with the code below. It is written against the post-13e function, which no longer reads `currentAccepted`.

```ts
export interface AnnotateRecordInput {
  recordId: string;
  actorId: string;
  kind: 'confirm' | 'withdraw' | 'resolve';
  referenceId?: string;
  /** `records.withdraw`: any manual record (spec R-12). */
  canWithdrawAny: boolean;
  /** `records.withdraw_imported`: any imported record (spec R-12). */
  canWithdrawImported: boolean;
  /** `records.review`: Keep both (spec R-10). */
  canReview: boolean;
}

/**
 * Who may withdraw a record (spec R-12): its author, else `records.withdraw`
 * for a manual record and `records.withdraw_imported` for an imported one.
 * @rfc RFC-65 R4
 */
export function mayWithdraw(
  rec: { origin: RecordOrigin; createdBy: string | null },
  who: { actorId: string; canWithdrawAny: boolean; canWithdrawImported: boolean },
): boolean {
  if (rec.createdBy === who.actorId) return true;
  return rec.origin === 'manual' ? who.canWithdrawAny : who.canWithdrawImported;
}

/**
 * One annotation. A confirmation is refused on the actor's own record (R-6).
 * `resolve` is Keep both, on a contest record only (R-10). A withdrawal takes
 * the record out of the dataset (R-13), so the answer is `null`. Nothing is
 * generated on any other record: contested is derived (R-11). The advisory
 * lock on the record id serialises a withdrawal against a concurrent
 * annotation of the same record.
 * @rfc RFC-70 R4
 * @rfc RFC-65 R3, R4, R10
 * @rfc RFC-33 R2
 */
export async function annotateRecord(
  db: DbExecutor,
  visibility: Visibility,
  input: AnnotateRecordInput,
): Promise<RecordDetail | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.recordId}, 0))`);
    const [rec] = await tx
      .select({
        id: traitRecords.id,
        origin: traitRecords.origin,
        createdBy: traitRecords.createdBy,
        intent: traitRecords.intent,
        review: reviewStatusSql(traitRecords.id).as('review'),
      })
      .from(traitRecords)
      .innerJoin(species, eq(species.id, traitRecords.speciesId))
      .innerJoin(traits, eq(traits.id, traitRecords.traitId))
      .where(
        and(
          eq(traitRecords.id, input.recordId),
          speciesVisible(visibility),
          traitVisible(visibility),
          harmonisedFor(visibility),
        ),
      )
      .limit(1);
    if (!rec) throw new AppError('RECORD_NOT_FOUND', 'Record not found');
    if (rec.review === 'withdrawn') throw new AppError('RECORD_WITHDRAWN', 'This record is withdrawn');
    if (input.kind === 'confirm' && rec.createdBy === input.actorId) {
      throw new AppError('PERMISSION_DENIED', 'You cannot validate your own record');
    }
    if (input.kind === 'resolve') {
      if (!input.canReview) throw new AppError('PERMISSION_DENIED', 'You do not have permission to resolve contests');
      if (rec.intent !== 'contest') throw validation('kind', 'Only a contest can be resolved');
    }
    if (input.kind === 'withdraw' && !mayWithdraw(rec, input)) {
      throw new AppError('PERMISSION_DENIED', 'You may not withdraw this record');
    }
    await tx.insert(recordAnnotations).values({
      recordId: rec.id,
      actorId: input.actorId,
      kind: input.kind,
      referenceId: input.referenceId ?? null,
    });
    return input.kind === 'withdraw' ? null : getRecord(tx, visibility, rec.id);
  });
}
```

Route (`records.ts`), the `/:id/annotations` handler body:

```ts
        const body = c.req.valid('json');
        const actor = currentUser(c);
        const permissions = currentPermissions(c);
        const visibility = await visibilityOf(ctx, c);
        const referenceId =
          body.kind === 'confirm' && body.referenceSource
            ? await resolveSourceRef({ db: ctx.db, doi: ctx.doi }, actor.id, body.referenceSource, 'referenceSource')
            : undefined;
        const record = await annotateRecord(ctx.db, visibility, {
          recordId: c.req.valid('param').id,
          kind: body.kind,
          referenceId,
          actorId: actor.id,
          canWithdrawAny: permissions.has('records.withdraw'),
          canWithdrawImported: permissions.has('records.withdraw_imported'),
          canReview: permissions.has('records.review'),
        });
        await forgetCachedBestEffort(c.get('logger'), ctx.redis, `dashboard:${actor.id}`, { actorId: actor.id });
        return c.json({ data: record }, 201);
```

(If 13d gave `resolveSourceRef` another context shape, keep 13d's call shape and change only the source and path arguments.)

Web `api/curation.ts`: `annotateRecord` returns `Promise<RecordDetail | null>` and parses with `dataEnvelopeSchema(recordDetailSchema.nullable())`.

Web `RecordActions.tsx`, minimal edits:
1. Delete `NoteMode`, `NOTE_LABELS`, the `noteId`, `mode`, `note` and `noteError` state, `openMode`, `submitNote`, the `canReview` constant, the whole `{canReview ? (…Neutral…Dispute…) : null}` block and the whole `{mode ? (<form …>) : null}` block. Drop `Textarea`, `Field` and `FormEvent` from the imports if nothing else uses them. Import `ConfirmDialog` from `../ui/index.ts`.
2. Add a prop `onGone?: () => void` ("Called once a withdrawal has taken the record out of the dataset: the drawer closes") and state `const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);`.
3. `annotate`: in `onWritten`, write `if (detail) queryClient.setQueryData(datasetKeys.record(record.id), detail);` and drop the `setMode`/`setNote`/`setNoteError` lines. Add `onInvalidated: (detail) => { if (detail === null) { setConfirmingWithdraw(false); onGone?.(); } },`. The type parameter becomes `useRecordWrite<AnnotateRecordBody, RecordDetail | null>`.
4. `canWithdraw`:

```tsx
  const canWithdraw =
    canAnnotate &&
    (isAuthor ||
      (record.origin === 'manual'
        ? hasPermission(me, 'records.withdraw')
        : hasPermission(me, 'records.withdraw_imported')));
```

5. `validated`: `const validated = record.annotations.some((a) => a.actor.id === me.user.id && a.kind === 'confirm');` (a validation cannot be undone, R-6). Delete the `stance` constant and its comment.
6. `validate()` sends `{ kind: 'confirm', ...(supporting ? { referenceSource: { doi: supporting } } : {}) }`. `doiDetail` reads `details['referenceSource.doi'] ?? details['referenceSource.id'] ?? details.referenceSource`. The `noteDetail` and `bound` lines become `const bound = doiDetail !== undefined;`.
7. The Withdraw button becomes `onClick={() => setConfirmingWithdraw(true)}`, with no `aria-pressed`. Before the closing `</DrawerSection>`, add:

```tsx
      {confirmingWithdraw ? (
        <ConfirmDialog
          title="Withdraw this record?"
          message="The record leaves the dataset for everyone. This cannot be undone."
          confirmLabel="Withdraw"
          danger
          pending={annotate.isPending}
          error={annotate.error ? actionErrorMessage(annotate.error) : null}
          onConfirm={() => annotate.mutate({ kind: 'withdraw' })}
          onClose={() => {
            annotate.reset();
            setConfirmingWithdraw(false);
          }}
        />
      ) : null}
```

8. Update the component doc: remove the Neutral/Dispute sentence and say "Withdraw (spec R-12: author, `records.withdraw` for manual, `records.withdraw_imported` for imported records) asks for confirmation only."

`RecordDrawer.tsx`: thread `onClose` to the actions. `RecordLoader` and `RecordBody` gain a prop `onClose?: () => void`; `RecordDrawer` passes `onClose={onClose}` to `RecordLoader`, which passes it to `RecordBody`, which renders `<RecordActions record={record} onOpenRecord={onOpenRecord} onGone={onClose} />`.

- [ ] **Step 4: Run to pass.** Run the four files of Step 2, the web suite and typecheck. Expected: PASS. Any other web test that mocks `annotateRecord` or reads `reference:` on the body, found with `grep -rn "annotateRecord\|reference: { doi" apps/web/src --include='*.test.tsx'`, gets the same rename.
- [ ] **Step 5: Commit**

```sh
git add packages/contracts/src/curation.ts packages/contracts/src/curation.test.ts apps/api/src apps/web/src
git commit -m "feat: annotations are confirm, withdraw or resolve; no note; withdrawal by author, manager or admin (RFC-70 R4, RFC-65 R3-R4, R10)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Create path: one record per level; a match becomes a validation

**Files:**
- Modify:
  - `packages/contracts/src/curation.ts` (+ test);
  - `apps/api/src/dataset/curation.ts` (+ `curation.integration.test.ts`);
  - `apps/api/src/http/routes/dataset/records.ts` (+ `records.integration.test.ts`);
  - in `apps/web/src/components/curation/`: `ValueField.tsx`, `AddEntriesDialog.tsx`, `ContestDialog.tsx` and their tests;
  - `apps/web/src/pages/dataset/SpeciesPage.tsx` (only if the typecheck names it).

**Interfaces:**
- Produces:

```ts
// contracts
export const recordCodeRefSchema  // { recordId: uuid, recordCode: string }
recordValueSchema               // { levelIds: uuid[] (1–20, distinct) } | { quantitative: QuantitativeValue }   (13f owns the second member)
export const createRecordsResultSchema  // { created: RecordItem[]; validated: RecordCodeRef[]; duplicates: RecordCodeRef[] }
// api
export type SingleValue = { levelId: string } | Exclude<RecordValue, { levelIds: string[] }>
export async function resolveLevel(db: DbExecutor, visibility: Visibility, trait: Pick<TraitBrief, 'id' | 'valueType'>, levelId: string, path: string): Promise<{ levelId: string; levelKey: string }>
export async function createRecords(db: DbExecutor, visibility: Visibility, input: CreateRecordsInput): Promise<CreateRecordsResult>
```

- Consumes: 13f's `resolveValue` quantitative branch, `record_references`/`recordReferences`, `nextRecordCodes(tx, count): Promise<string[]>`, and the columns `record_code`, `min_value`, `max_value`, `mean_value`, `sd_value` and `n`.

**Starting point.** 13f leaves `apps/api/src/dataset/curation.ts` with:
- `ResolvedValue = { levelId: string; levelKey: string; quantitative: null } | { levelId: null; levelKey: null; quantitative: QuantitativeValue }`;
- `quantitativeText(q)` and `nextRecordCodes(db, count)`;
- a `createRecords` that inserts one row (primary = the first reference) and its `record_references` rows.

Step 3 moves that insert into `insertClaim`, with `record_code` now explicit, and replaces the rest of `createRecords`.

- [ ] **Step 1: Failing tests**

`packages/contracts/src/curation.test.ts`, appended:

```ts
describe('RFC-70 R2 recordValueSchema (spec R-3)', () => {
  it('takes one to twenty distinct levels; a single levelId is gone', () => {
    const id = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d20';
    expect(recordValueSchema.safeParse({ levelIds: [id] }).success).toBe(true);
    expect(recordValueSchema.safeParse({ levelIds: [] }).success).toBe(false);
    expect(recordValueSchema.safeParse({ levelIds: [id, id] }).success).toBe(false);
    expect(recordValueSchema.safeParse({ levelId: id }).success).toBe(false);
  });
});
```

`apps/api/src/dataset/curation.integration.test.ts`:
- delete the `createRecords` cases that expect one record per reference, a `duplicates[].referenceId`, or a 409 when every claim exists (`grep -n "referenceId: \|RECORD_DUPLICATE\|value: { levelId" …`);
- change every remaining `value: { levelId: X }` to `value: { levelIds: [X] }`;
- then append:

```ts
describe('RFC-70 R2, R3 createRecords (spec R-3, R-7, R-8)', () => {
  const t = useTestDb();

  async function setup() {
    const { user: me } = await createUser(t.db);
    const { user: other } = await createUser(t.db);
    const ref = await createReference(t.db);
    const ref2 = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['red', 'blue', 'orange'] });
    const sp = await createSpecies(t.db);
    const level = (k: string) => trait.levels.find((l) => l.key === k)?.id as string;
    return { me, other, ref, ref2, trait, sp, level };
  }
  const input = (f: Awaited<ReturnType<typeof setup>>, levels: string[], extra: Partial<Parameters<typeof createRecords>[2]> = {}) => ({
    actorId: f.me.id, speciesId: f.sp.id, traitId: f.trait.id,
    value: { levelIds: levels.map(f.level) }, referenceIds: [f.ref.id], ...extra,
  });

  it('creates one record per level, in input order, sharing one code number with letter suffixes (spec R-2)', async () => {
    const f = await setup();
    const result = await createRecords(t.db, UNRESTRICTED, input(f, ['orange', 'red']));
    expect(result.created.map((r) => r.level?.key)).toEqual(['orange', 'red']);
    expect(result.validated).toEqual([]);
    expect(result.duplicates).toEqual([]);
    const [a, b] = result.created.map((r) => r.recordCode);
    const n = a?.match(/^TR_(\d+)a$/)?.[1];
    expect(n).toBeDefined();
    expect(b).toBe(`TR_${n}b`);
    const single = await createRecords(t.db, UNRESTRICTED, input(f, ['blue']));
    expect(single.created[0]?.recordCode).toMatch(/^TR_\d+$/);
  });

  it('a level that became a validation consumes no code: the one created record keeps the bare number', async () => {
    const f = await setup();
    await createRecord(t.db, {
      speciesId: f.sp.id, traitId: f.trait.id, valueText: 'blue', levelId: f.level('blue'),
      primaryReferenceId: f.ref2.id, origin: 'manual', createdBy: f.other.id,
    });
    const result = await createRecords(t.db, UNRESTRICTED, input(f, ['blue', 'red']));
    expect(result.validated).toHaveLength(1);
    expect(result.created.map((r) => r.recordCode)).toEqual([expect.stringMatching(/^TR_\d+$/)]);
  });

  it("a level matching someone else's live record becomes one validation per reference; the new level creates", async () => {
    const f = await setup();
    const existing = await createRecord(t.db, {
      speciesId: f.sp.id, traitId: f.trait.id, valueText: 'blue', levelId: f.level('blue'),
      primaryReferenceId: f.ref2.id, origin: 'manual', createdBy: f.other.id,
    });
    const result = await createRecords(t.db, UNRESTRICTED, input(f, ['blue', 'red'], { referenceIds: [f.ref.id, f.ref2.id] }));
    expect(result.created.map((r) => r.level?.key)).toEqual(['red']);
    expect(result.validated).toEqual([{ recordId: existing.id, recordCode: expect.any(String) }]);
    const detail = await getRecord(t.db, UNRESTRICTED, existing.id);
    expect(detail?.annotations.map((a) => [a.kind, a.actor.id, a.reference?.id]).sort()).toEqual(
      [['confirm', f.me.id, f.ref.id], ['confirm', f.me.id, f.ref2.id]].sort(),
    );
    expect(detail?.validationCount).toBe(1);
  });

  it('a personal observation validates with one confirm and no reference', async () => {
    const f = await setup();
    const existing = await createRecord(t.db, {
      speciesId: f.sp.id, traitId: f.trait.id, valueText: 'blue', levelId: f.level('blue'),
      primaryReferenceId: f.ref2.id, origin: 'manual', createdBy: f.other.id,
    });
    const po = await ensurePersonalObservation(t.db, f.me.id);
    await createRecords(t.db, UNRESTRICTED, input(f, ['blue'], { referenceIds: [po.id] }));
    const detail = await getRecord(t.db, UNRESTRICTED, existing.id);
    expect(detail?.annotations.map((a) => [a.kind, a.reference])).toEqual([['confirm', null]]);
  });

  it('a match on your own record only reports the duplicate', async () => {
    const f = await setup();
    const mine = await createRecord(t.db, {
      speciesId: f.sp.id, traitId: f.trait.id, valueText: 'blue', levelId: f.level('blue'),
      primaryReferenceId: f.ref2.id, origin: 'manual', createdBy: f.me.id,
    });
    const result = await createRecords(t.db, UNRESTRICTED, input(f, ['blue']));
    expect(result).toEqual({ created: [], validated: [], duplicates: [{ recordId: mine.id, recordCode: expect.any(String) }] });
    expect((await getRecord(t.db, UNRESTRICTED, mine.id))?.annotations).toEqual([]);
  });

  it('a withdrawn record is no match', async () => {
    const f = await setup();
    const gone = await createRecord(t.db, {
      speciesId: f.sp.id, traitId: f.trait.id, valueText: 'blue', levelId: f.level('blue'),
      primaryReferenceId: f.ref2.id, origin: 'manual', createdBy: f.other.id,
    });
    await createAnnotation(t.db, { recordId: gone.id, actorId: f.other.id, kind: 'withdraw' });
    const result = await createRecords(t.db, UNRESTRICTED, input(f, ['blue']));
    expect(result.created).toHaveLength(1);
  });

  it('a contest carries a different level, is never deduplicated, and generates nothing on the contested record', async () => {
    const f = await setup();
    const blue = await createRecord(t.db, {
      speciesId: f.sp.id, traitId: f.trait.id, valueText: 'blue', levelId: f.level('blue'),
      primaryReferenceId: f.ref2.id, origin: 'manual', createdBy: f.other.id,
    });
    await createRecord(t.db, {
      speciesId: f.sp.id, traitId: f.trait.id, valueText: 'red', levelId: f.level('red'),
      primaryReferenceId: f.ref2.id, origin: 'manual', createdBy: f.other.id,
    });
    await expect(
      createRecords(t.db, UNRESTRICTED, input(f, ['blue'], { intent: 'contest', respondsToRecordId: blue.id })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'value', message: 'A contest carries a different value' }] });
    const result = await createRecords(t.db, UNRESTRICTED, input(f, ['red'], { intent: 'contest', respondsToRecordId: blue.id }));
    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toMatchObject({ intent: 'contest', respondsTo: { id: blue.id } });
    const contested = await getRecord(t.db, UNRESTRICTED, blue.id);
    expect(contested?.annotations).toEqual([]);
    expect(contested?.contested).toBe(true);
  });

  it('quantitative: all six fields identical is a match; any difference creates', async () => {
    const f = await setup();
    const qt = await createTrait(t.db, { valueType: 'quantitative' });
    const q = { single: 2, min: 1, max: 3, mean: 2, sd: 0.5, n: 4 };
    const first = await createRecords(t.db, UNRESTRICTED, {
      actorId: f.other.id, speciesId: f.sp.id, traitId: qt.id, value: { quantitative: q }, referenceIds: [f.ref2.id],
    });
    const same = await createRecords(t.db, UNRESTRICTED, {
      actorId: f.me.id, speciesId: f.sp.id, traitId: qt.id, value: { quantitative: q }, referenceIds: [f.ref.id],
    });
    expect(same.validated.map((v) => v.recordId)).toEqual([first.created[0]?.id]);
    const other = await createRecords(t.db, UNRESTRICTED, {
      actorId: f.me.id, speciesId: f.sp.id, traitId: qt.id, value: { quantitative: { ...q, n: 5 } }, referenceIds: [f.ref.id],
    });
    expect(other.created).toHaveLength(1);
  });
});
```

(Import `ensurePersonalObservation` from `./references.ts`.)

In `apps/api/src/http/routes/dataset/records.integration.test.ts`, change every `value: { levelId: X }` to `value: { levelIds: [X] }`, then append:

```ts
describe('RFC-70 R3 POST /api/records answers created, validated and duplicates', () => {
  const t = useTestApp();

  it('201 when something was created, 200 when every level matched', async () => {
    const { user } = await createUser(t.db, { roles: [await systemRoleId(t.db, 'contributor')] });
    const { user: other } = await createUser(t.db);
    const { cookie } = await loginAs(t, user);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const sp = await createSpecies(t.db);
    const [la, lb] = trait.levels as [{ id: string }, { id: string }];
    await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: 'a', levelId: la.id, primaryReferenceId: ref.id, origin: 'manual', createdBy: other.id });
    const both = await call(t.app, 'POST', '/api/records', {
      cookie, body: { speciesId: sp.id, traitId: trait.id, value: { levelIds: [la.id, lb.id] }, sources: { personalObservation: true } },
    });
    expect(both.status).toBe(201);
    const body = (await both.json()).data;
    expect(body.created).toHaveLength(1);
    expect(body.validated).toHaveLength(1);
    const again = await call(t.app, 'POST', '/api/records', {
      cookie, body: { speciesId: sp.id, traitId: trait.id, value: { levelIds: [lb.id] }, sources: { personalObservation: true } },
    });
    expect(again.status).toBe(200);
    expect((await again.json()).data).toMatchObject({ created: [], validated: [], duplicates: [{ recordCode: expect.any(String) }] });
  });
});
```

(If 13d changed the personal-observation source shape, write `sources` the way 13d's contract takes it.)

- [ ] **Step 2: Run to fail.** Run the contracts `src/curation.test.ts` and the api integration files of Step 1. Expected: FAIL, `levelIds` is refused by the schema, and `validated` is undefined.

- [ ] **Step 3: Implement**

Contracts (`curation.ts`). In `recordValueSchema`, replace the `z.strictObject({ levelId: z.uuid() })` member with:

```ts
  z.strictObject({
    levelIds: z
      .array(z.uuid())
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'Levels must be distinct' }),
  }),
```

Its doc becomes "One level per record: several levels create one record each (spec R-3); or 13f's quantitative value. @rfc RFC-65 R1 @rfc RFC-70 R2". Replace `createRecordsResultSchema` with:

```ts
/** A record named by id and code. @rfc RFC-70 R3 */
export const recordCodeRefSchema = z.strictObject({ recordId: z.uuid(), recordCode: z.string() });

/**
 * `created`: the new records. `validated`: existing records the entry matched,
 * now carrying the actor's validation. `duplicates`: matches that are the
 * actor's own records (spec R-7).
 * @rfc RFC-70 R3
 */
export const createRecordsResultSchema = z.strictObject({
  created: z.array(recordSchema),
  validated: z.array(recordCodeRefSchema),
  duplicates: z.array(recordCodeRefSchema),
});
```

Export `type RecordCodeRef = z.infer<typeof recordCodeRefSchema>;`.

`apps/api/src/dataset/curation.ts`. Split the level branch of `resolveValue` out, so a level error lands on its own index:

```ts
/**
 * One level against its trait: it belongs to the trait, is visible, and is
 * active. `path` is the exact detail path (`value.levelId`,
 * `value.levelIds.2`).
 * @rfc RFC-65 R1
 * @rfc RFC-33 R2, R5
 */
export async function resolveLevel(
  db: DbExecutor,
  visibility: Visibility,
  trait: Pick<TraitBrief, 'id' | 'valueType'>,
  levelId: string,
  path: string,
): Promise<{ levelId: string; levelKey: string }> {
  if (trait.valueType !== 'categorical') throw validation('value', 'A quantitative trait takes a number');
  const [level] = await db
    .select({ id: traitLevels.id, key: traitLevels.key, active: traitLevels.active })
    .from(traitLevels)
    .where(and(eq(traitLevels.id, levelId), eq(traitLevels.traitId, trait.id), levelVisible(visibility)))
    .limit(1);
  if (!level) throw validation(path, 'Level does not belong to this trait');
  if (!level.active) throw validation(path, 'Level is inactive');
  return { levelId: level.id, levelKey: level.key };
}

/** One value of one record: a level, or 13f's quantitative value. @rfc RFC-70 R2 */
export type SingleValue = { levelId: string } | Exclude<RecordValue, { levelIds: string[] }>;
```

`resolveValue`'s parameter type becomes `value: SingleValue`. Its `'levelId' in value` branch becomes `return { ...(await resolveLevel(db, visibility, trait, value.levelId, \`${path}.levelId\`)), quantitative: null };`. `mapPending` is unchanged: it already passes `{ levelId }`.

Replace `CreateRecordsInput`, `CreateRecordsResult` and `createRecords` with:

```ts
export interface CreateRecordsInput {
  actorId: string;
  speciesId: string;
  traitId: string;
  value: RecordValue;
  referenceIds: string[];
  intent?: RecordIntent;
  respondsToRecordId?: string;
  rawValue?: string;
  note?: string;
  secondaryReferenceId?: string;
}

export type CreateRecordsResult = ContractCreateRecordsResult;

interface MatchRow {
  id: string;
  record_code: string;
  created_by: string | null;
}

/** The first live, visible record carrying the same value; the actor's own first (spec R-7). */
async function findMatch(
  tx: DbExecutor,
  visibility: Visibility,
  input: CreateRecordsInput,
  value: SingleValue,
): Promise<MatchRow | undefined> {
  const same =
    'levelId' in value
      ? sql`r.level_id = ${value.levelId}::uuid`
      : sql`r.level_id is null
          and r.numeric_value is not distinct from ${value.quantitative.single ?? null}::numeric
          and r.min_value is not distinct from ${value.quantitative.min ?? null}::numeric
          and r.max_value is not distinct from ${value.quantitative.max ?? null}::numeric
          and r.mean_value is not distinct from ${value.quantitative.mean ?? null}::numeric
          and r.sd_value is not distinct from ${value.quantitative.sd ?? null}::numeric
          and r.n is not distinct from ${value.quantitative.n ?? null}::int`;
  const [row] = (await tx.execute(sql`
    select r.id, r.record_code, r.created_by from trait_records r
    where r.species_id = ${input.speciesId}::uuid and r.trait_id = ${input.traitId}::uuid and ${same}
      and ${recordVisible(visibility, sql`r.id`, sql`r.harmonisation`)}
    order by (r.created_by = ${input.actorId}::uuid) desc nulls last, r.id
    limit 1`)) as unknown as MatchRow[];
  return row;
}

/**
 * The claim rows of one value: the record (primary = the first reference)
 * and its other references (spec R-4). Moved unchanged from 13f's
 * `createRecords`, except that `record_code` is now set explicitly from
 * 13f's `nextRecordCodes` (spec R-2 as amended). `null` when the claim key
 * already holds it.
 */
async function insertClaim(
  tx: DbExecutor,
  input: CreateRecordsInput,
  value: ResolvedValue,
  recordCode: string,
): Promise<{ id: string; recordCode: string } | null> {
  const [primary, ...rest] = input.referenceIds;
  const [row] = await tx
    .insert(traitRecords)
    .values({
      recordCode,
      speciesId: input.speciesId,
      traitId: input.traitId,
      valueText: value.levelKey !== null ? value.levelKey : quantitativeText(value.quantitative),
      levelId: value.levelId,
      numericValue: value.quantitative?.single ?? null,
      minValue: value.quantitative?.min ?? null,
      maxValue: value.quantitative?.max ?? null,
      meanValue: value.quantitative?.mean ?? null,
      sdValue: value.quantitative?.sd ?? null,
      n: value.quantitative?.n ?? null,
      harmonisation: 'harmonised' as const,
      rawValue: input.rawValue ?? null,
      primaryReferenceId: primary,
      secondaryReferenceId: input.secondaryReferenceId ?? null,
      origin: 'manual' as const,
      createdBy: input.actorId,
      note: input.note ?? null,
      intent: input.intent ?? null,
      respondsToRecordId: input.respondsToRecordId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: traitRecords.id, recordCode: traitRecords.recordCode });
  if (!row) return null;
  if (rest.length > 0) {
    await tx.insert(recordReferences).values(rest.map((referenceId) => ({ recordId: row.id, referenceId })));
  }
  return row;
}

/**
 * `POST /api/records`. One record per level (spec R-3). A value matching a
 * live record the viewer can see becomes a validation of it (R-7), except
 * in a contest, which is always a record of its own (R-8). A contest carries
 * a value different from the one it contests, and nothing is written on the
 * contested record (R-11). The advisory lock on the species and trait makes
 * the match-then-insert atomic against a concurrent entry.
 * @rfc RFC-70 R2, R3
 * @rfc RFC-33 R2, R5
 */
export async function createRecords(
  db: DbExecutor,
  visibility: Visibility,
  input: CreateRecordsInput,
): Promise<CreateRecordsResult> {
  await requireSpecies(db, visibility, input.speciesId);
  const trait = await requireTrait(db, visibility, input.traitId);
  if (!trait.active) throw validation('traitId', 'Trait is inactive');
  if (input.secondaryReferenceId !== undefined) {
    await requireReference(db, input.secondaryReferenceId, 'secondaryReferenceId');
  }
  const singles: SingleValue[] =
    'levelIds' in input.value ? input.value.levelIds.map((levelId) => ({ levelId })) : [input.value];
  const resolved: ResolvedValue[] = [];
  for (const [i, single] of singles.entries()) {
    resolved.push(
      'levelId' in single
        ? { ...(await resolveLevel(db, visibility, trait, single.levelId, `value.levelIds.${i}`)), quantitative: null }
        : await resolveValue(db, visibility, trait, single),
    );
  }

  if (input.respondsToRecordId) {
    const [target] = (await db.execute(sql`
      select r.species_id, r.trait_id, r.level_id,
        r.numeric_value::float8 as single, r.min_value::float8 as min, r.max_value::float8 as max,
        r.mean_value::float8 as mean, r.sd_value::float8 as sd, r.n,
        (${liveSql(sql`r.id`)}) as live
      from trait_records r
      join species s on s.id = r.species_id
      join traits t on t.id = r.trait_id
      where r.id = ${input.respondsToRecordId}::uuid
        and ${speciesVisible(visibility, sql`s.active`, sql`s.id`)}
        and ${traitVisible(visibility, sql`t.active`)}
        and ${harmonisedFor(visibility, sql`r.harmonisation`)}`)) as unknown as TargetRow[];
    if (!target) throw new AppError('RECORD_NOT_FOUND', 'Record not found');
    if (target.species_id !== input.speciesId || target.trait_id !== input.traitId) {
      throw validation('respondsToRecordId', 'A response must share the species and trait of the record it responds to');
    }
    if (!target.live) throw new AppError('RECORD_WITHDRAWN', 'This record is withdrawn');
    if (input.intent === 'contest') {
      const same = singles.some((v) =>
        'levelId' in v
          ? v.levelId === target.level_id
          : (v.quantitative.single ?? null) === target.single &&
            (v.quantitative.min ?? null) === target.min &&
            (v.quantitative.max ?? null) === target.max &&
            (v.quantitative.mean ?? null) === target.mean &&
            (v.quantitative.sd ?? null) === target.sd &&
            (v.quantitative.n ?? null) === target.n,
      );
      if (same) throw validation('value', 'A contest carries a different value');
    }
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${input.speciesId}:${input.traitId}`}, 0))`,
    );
    const kinds = await tx
      .select({ id: bibliographicReferences.id, kind: bibliographicReferences.kind })
      .from(bibliographicReferences)
      .where(inArray(bibliographicReferences.id, input.referenceIds));
    // A personal observation is no supporting reference: its validation carries none (R-7).
    const supporting = input.referenceIds.filter(
      (id) => kinds.find((k) => k.id === id)?.kind !== 'personal_observation',
    );
    const validated: CreateRecordsResult['validated'] = [];
    const duplicates: CreateRecordsResult['duplicates'] = [];
    // First pass: which values match (validation or duplicate) and which
    // create. Only created records consume a code (spec R-2 as amended).
    const toCreate: number[] = [];
    for (const [i, single] of singles.entries()) {
      const match = input.intent === 'contest' ? undefined : await findMatch(tx, visibility, input, single);
      if (!match) {
        toCreate.push(i);
        continue;
      }
      const ref = { recordId: match.id, recordCode: match.record_code };
      if (match.created_by === input.actorId) {
        duplicates.push(ref);
        continue;
      }
      await tx.insert(recordAnnotations).values(
        (supporting.length > 0 ? supporting : [null]).map((referenceId) => ({
          recordId: match.id,
          actorId: input.actorId,
          kind: 'confirm' as const,
          referenceId,
        })),
      );
      validated.push(ref);
    }
    // One sequence number for the whole form: ['TR_7'] for one record,
    // ['TR_7a', 'TR_7b', …] for several (13f's helper).
    const codes = toCreate.length === 0 ? [] : await nextRecordCodes(tx, toCreate.length);
    const createdIds: string[] = [];
    for (const [k, i] of toCreate.entries()) {
      const single = singles[i] as SingleValue;
      const row = await insertClaim(tx, input, resolved[i] as ResolvedValue, codes[k] as string);
      if (!row) {
        throw new AppError('RECORD_DUPLICATE', 'This claim already exists', [
          { path: 'levelId' in single ? `value.levelIds.${i}` : 'value', message: 'This claim already exists' },
        ]);
      }
      createdIds.push(row.id);
    }
    const items =
      createdIds.length === 0 ? [] : await itemQuery(tx).where(inArray(traitRecords.id, createdIds));
    const byId = new Map(items.map((r) => [r.record.id, toItem(r)]));
    const created = createdIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
    return { created, validated, duplicates };
  });
}
```

Supporting declarations, near the top of the file:
- `nextRecordCodes(db, count): Promise<string[]>` and `quantitativeText(q)` are already in this file (13f plan, Task "curation.ts"): `['TR_7']` for 1, and `['TR_7a', 'TR_7b']` for 2, going on to `aa`, `ab`, … after `z`. No import is needed;
- `import { inArray } from 'drizzle-orm'`;
- `import { recordReferences } from '../db/schema/records.ts'`, or 13f's file;
- `import type { CreateRecordsResult as ContractCreateRecordsResult, RecordValue } from '@treerepro/contracts'`;
- `import { harmonisedFor, itemQuery, liveSql, recordVisible, toItem } from './records.ts'`;
- `interface TargetRow { species_id: string; trait_id: string; level_id: string | null; single: number | null; min: number | null; max: number | null; mean: number | null; sd: number | null; n: number | null; live: boolean }`;

Route `POST /api/records`: after `createRecords`, `return c.json({ data: result }, result.created.length > 0 ? 201 : 200);`.

Web:
- `ValueField.tsx`: the level error line becomes `const error = errors['value.levelIds.0'] ?? errors['value.levelId'] ?? errors.value;`.
- `AddEntriesDialog.tsx` and `ContestDialog.tsx`: the value literal becomes `{ levelIds: [levelId] }` in place of `{ levelId }`. Keep 13f's quantitative branch as it is.
- In both, the "partial" condition becomes `result.duplicates.length > 0 || result.validated.length > 0`: `AddEntriesDialog`'s `onInvalidated` and `ContestDialog`'s `onInvalidated`/`answered` check. The info alert adds, when `validated.length > 0`, the sentence `Matches an existing record — counted as your validation.` and links `validated.map((v) => v.recordId)` with the same `existingRecordLinks`/button list used for `duplicates`.
- In `RecordActions.tsx` and `SpeciesPage.tsx`, `result.created[0]?.id` still reads an item's `id`; no change.
- Tests: in `AddEntriesDialog.test.tsx` and `ContestDialog.test.tsx`, replace every `value: { levelId: X }` with `value: { levelIds: [X] }`, and add `validated: []` to every mocked `createRecords` result (`grep -n "duplicates:" …`). Add to `AddEntriesDialog.test.tsx`:

```tsx
  it('RFC-70 R3 a matched level says it counted as a validation', async () => {
    curation.createRecords.mockResolvedValue({
      created: [],
      validated: [{ recordId: RECORD.id, recordCode: 'EB_1' }],
      duplicates: [],
    });
    // Open the dialog on a fixed trait, choose a level and submit, exactly as the file's
    // existing "creates one record" test does, then:
    expect(await screen.findByText('Matches an existing record — counted as your validation.')).toBeInTheDocument();
  });
```

Build the body of this test by copying the open-choose-submit steps of the file's existing success test verbatim; only the mock and the final assertion differ.

- [ ] **Step 4: Run to pass.** Run the contracts `src/curation.test.ts`; the api integration `src/dataset/curation.integration.test.ts`, `src/http/routes/dataset/records.integration.test.ts` and `src/dataset/sources.integration.test.ts`; the web suite; typecheck. Expected: PASS.
- [ ] **Step 5: Commit**

```sh
git add packages/contracts/src apps/api/src apps/web/src
git commit -m "feat: one record per level; a matching entry becomes a validation; contests never deduplicated (RFC-70 R2, R3, spec R-3, R-7, R-8)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Level actions: validate a level, withdraw a level

**Files:**
- Modify:
  - `packages/contracts/src/curation.ts`;
  - `apps/api/src/dataset/curation.ts` (+ `curation.integration.test.ts`);
  - `apps/api/src/http/routes/dataset/species.ts` (+ `species.integration.test.ts`);
  - `apps/api/src/routes-guarded.integration.test.ts` and `apps/api/src/routes-visibility.integration.test.ts`;
  - `apps/web/src/api/curation.ts`.

**Interfaces:**
- Produces:

```ts
// contracts
export const levelActionParamSchema   // { id: uuid; traitId: uuid; levelId: uuid }
export const validateLevelBodySchema  // { referenceSource?: SourceRef }
export const validateLevelResultSchema  // { validated: RecordCodeRef[] }
export const withdrawLevelResultSchema  // { withdrawn: RecordCodeRef[] }
// api
export async function validateLevel(db: DbExecutor, visibility: Visibility, input: { speciesId: string; traitId: string; levelId: string; actorId: string; referenceId?: string }): Promise<{ validated: RecordCodeRef[] }>
export async function withdrawLevel(db: DbExecutor, visibility: Visibility, input: { speciesId: string; traitId: string; levelId: string; actorId: string; canWithdrawAny: boolean; canWithdrawImported: boolean }): Promise<{ withdrawn: RecordCodeRef[] }>
// routes
POST /api/species/:id/traits/:traitId/levels/:levelId/validate   (records.annotate)  → 200 { data: { validated } }
POST /api/species/:id/traits/:traitId/levels/:levelId/withdraw   (records.review)    → 200 { data: { withdrawn } }
// web
export async function withdrawLevel(speciesId: string, traitId: string, levelId: string): Promise<{ withdrawn: RecordCodeRef[] }>
```

- Consumes: `mayWithdraw` (Task 5), `recordVisible`, `resolveSourceRef`, `requireSpecies`, `requireTrait` and `resolveLevel` (Task 6).

- [ ] **Step 1: Failing tests.** Append to `apps/api/src/dataset/curation.integration.test.ts`:

```ts
describe('RFC-70 R4, RFC-65 R4, R10 level actions (spec R-6, R-10)', () => {
  const t = useTestDb();

  async function blueLevel() {
    const { user: me } = await createUser(t.db);
    const { user: other } = await createUser(t.db);
    const ref = await createReference(t.db);
    const ref2 = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['blue', 'red'] });
    const sp = await createSpecies(t.db);
    const blue = trait.levels[0]?.id as string;
    const theirs = await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: 'blue', levelId: blue, primaryReferenceId: ref.id, origin: 'manual', createdBy: other.id });
    const mine = await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: 'blue', levelId: blue, primaryReferenceId: ref2.id, origin: 'manual', createdBy: me.id });
    const batch = await createImportBatch(t.db);
    const imported = await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: 'blue', levelId: blue, primaryReferenceId: ref.id, importBatchId: batch.id });
    return { me, other, ref, trait, sp, blue, theirs, mine, imported };
  }

  it('validateLevel confirms every record of the level except your own, once', async () => {
    const f = await blueLevel();
    const first = await validateLevel(t.db, UNRESTRICTED, { speciesId: f.sp.id, traitId: f.trait.id, levelId: f.blue, actorId: f.me.id, referenceId: f.ref.id });
    expect(first.validated.map((v) => v.recordId).sort()).toEqual([f.theirs.id, f.imported.id].sort());
    const again = await validateLevel(t.db, UNRESTRICTED, { speciesId: f.sp.id, traitId: f.trait.id, levelId: f.blue, actorId: f.me.id });
    expect(again.validated).toEqual([]);
    expect((await getRecord(t.db, UNRESTRICTED, f.mine.id))?.annotations).toEqual([]);
  });

  it('validateLevel on a level holding only your own records is refused', async () => {
    const f = await blueLevel();
    await expect(
      validateLevel(t.db, UNRESTRICTED, { speciesId: f.sp.id, traitId: f.trait.id, levelId: f.trait.levels[1]?.id as string, actorId: f.me.id }),
    ).resolves.toEqual({ validated: [] });
    await createRecord(t.db, { speciesId: f.sp.id, traitId: f.trait.id, valueText: 'red', levelId: f.trait.levels[1]?.id, primaryReferenceId: f.ref.id, origin: 'manual', createdBy: f.me.id });
    await expect(
      validateLevel(t.db, UNRESTRICTED, { speciesId: f.sp.id, traitId: f.trait.id, levelId: f.trait.levels[1]?.id as string, actorId: f.me.id }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('withdrawLevel withdraws only what the actor may withdraw', async () => {
    const f = await blueLevel();
    const { user: manager } = await createUser(t.db);
    const out = await withdrawLevel(t.db, UNRESTRICTED, { speciesId: f.sp.id, traitId: f.trait.id, levelId: f.blue, actorId: manager.id, canWithdrawAny: true, canWithdrawImported: false });
    expect(out.withdrawn.map((w) => w.recordId).sort()).toEqual([f.theirs.id, f.mine.id].sort());
    expect(await getRecord(t.db, UNRESTRICTED, f.imported.id)).not.toBeNull();
    const admin = await withdrawLevel(t.db, UNRESTRICTED, { speciesId: f.sp.id, traitId: f.trait.id, levelId: f.blue, actorId: manager.id, canWithdrawAny: true, canWithdrawImported: true });
    expect(admin.withdrawn.map((w) => w.recordId)).toEqual([f.imported.id]);
  });

  it('a level of another trait is 404', async () => {
    const f = await blueLevel();
    const otherTrait = await createTrait(t.db, { levels: ['x'] });
    await expect(
      withdrawLevel(t.db, UNRESTRICTED, { speciesId: f.sp.id, traitId: f.trait.id, levelId: otherTrait.levels[0]?.id as string, actorId: f.me.id, canWithdrawAny: true, canWithdrawImported: true }),
    ).rejects.toMatchObject({ code: 'LEVEL_NOT_FOUND' });
  });
});
```

Append to `apps/api/src/http/routes/dataset/species.integration.test.ts`:

```ts
describe('RFC-65 R3, R4 level routes', () => {
  const t = useTestApp();

  it('validate needs records.annotate and takes a referenceSource; withdraw needs records.review', async () => {
    const { user: contributor } = await createUser(t.db, { roles: [await systemRoleId(t.db, 'contributor')] });
    const { user: manager } = await createUser(t.db, { roles: [await systemRoleId(t.db, 'manager')] });
    const { user: author } = await createUser(t.db);
    const c = await loginAs(t, contributor);
    const m = await loginAs(t, manager);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['blue'] });
    const sp = await createSpecies(t.db);
    const blue = trait.levels[0]?.id as string;
    await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: 'blue', levelId: blue, primaryReferenceId: ref.id, origin: 'manual', createdBy: author.id });
    const base = `/api/species/${sp.id}/traits/${trait.id}/levels/${blue}`;
    const v = await call(t.app, 'POST', `${base}/validate`, { cookie: c.cookie, body: { referenceSource: { id: ref.id } } });
    expect(v.status).toBe(200);
    expect((await v.json()).data.validated).toHaveLength(1);
    const refused = await call(t.app, 'POST', `${base}/withdraw`, { cookie: c.cookie, body: {} });
    expect(refused.status).toBe(403);
    const w = await call(t.app, 'POST', `${base}/withdraw`, { cookie: m.cookie, body: {} });
    expect(w.status).toBe(200);
    expect((await w.json()).data.withdrawn).toHaveLength(1);
  });
});
```

Meta-tests:
- `routes-guarded.integration.test.ts`: add `'POST /api/species/:id/traits/:traitId/levels/:levelId/validate'` and `'POST /api/species/:id/traits/:traitId/levels/:levelId/withdraw'` to the sorted route list, and `'POST /api/species/:id/traits/:traitId/levels/:levelId/validate'` to `withBody`.
- `routes-visibility.integration.test.ts`: after `const level = …`, add a level no record uses, so the withdraw call touches nothing the sweep reads later:

```ts
    const [emptyLevel] = await t.db
      .insert(traitLevels)
      .values({ traitId: fx.activeTrait.id, key: `empty-${Date.now()}`, sortOrder: 99 })
      .returning({ id: traitLevels.id });
```

  In `concrete`, add `.replace(':levelId', emptyLevel?.id ?? '')` before `.replace(':id', …)`, and import `traitLevels` from `./db/schema/dictionary.ts`.

- [ ] **Step 2: Run to fail.** Run the api integration `src/dataset/curation.integration.test.ts`, `src/http/routes/dataset/species.integration.test.ts`, `src/routes-guarded.integration.test.ts` and `src/routes-visibility.integration.test.ts`. Expected: FAIL, `validateLevel` is not exported, and the route list lacks the two routes.

- [ ] **Step 3: Implement**

Contracts (`curation.ts`):

```ts
/** @rfc RFC-65 R3, R4 */
export const levelActionParamSchema = z.strictObject({ id: z.uuid(), traitId: z.uuid(), levelId: z.uuid() });
/** Validate every record of a level (spec §2, R-6). @rfc RFC-70 R4 */
export const validateLevelBodySchema = z.strictObject({ referenceSource: sourceRefSchema.optional() });
/** @rfc RFC-70 R4 */
export const validateLevelResultSchema = z.strictObject({ validated: z.array(recordCodeRefSchema) });
/** Withdraw level (spec R-10). @rfc RFC-65 R4, R10 */
export const withdrawLevelResultSchema = z.strictObject({ withdrawn: z.array(recordCodeRefSchema) });
```

Add the `z.infer` types `ValidateLevelBody`, `ValidateLevelResult` and `WithdrawLevelResult`.

`apps/api/src/dataset/curation.ts`:

```ts
interface LevelRecordRow {
  id: string;
  recordCode: string;
  origin: RecordOrigin;
  createdBy: string | null;
}

/** The live, visible records of one level of one species × trait; 404 on a foreign level. */
async function levelRecords(
  tx: DbExecutor,
  visibility: Visibility,
  input: { speciesId: string; traitId: string; levelId: string },
): Promise<LevelRecordRow[]> {
  await requireSpecies(tx, visibility, input.speciesId);
  const trait = await requireTrait(tx, visibility, input.traitId);
  const [level] = await tx
    .select({ id: traitLevels.id })
    .from(traitLevels)
    .where(and(eq(traitLevels.id, input.levelId), eq(traitLevels.traitId, trait.id), levelVisible(visibility)))
    .limit(1);
  if (!level) throw new AppError('LEVEL_NOT_FOUND', 'Level not found');
  return tx
    .select({
      id: traitRecords.id,
      recordCode: traitRecords.recordCode,
      origin: traitRecords.origin,
      createdBy: traitRecords.createdBy,
    })
    .from(traitRecords)
    .where(
      and(
        eq(traitRecords.speciesId, input.speciesId),
        eq(traitRecords.traitId, input.traitId),
        eq(traitRecords.levelId, input.levelId),
        recordVisible(visibility),
      ),
    );
}

/**
 * 👍 on a level (spec §2): one `confirm` on every record of the level that
 * is not the actor's own and that the actor has not validated yet. Refused
 * when every record of the level is the actor's (R-6).
 * @rfc RFC-70 R4
 * @rfc RFC-33 R2
 */
export async function validateLevel(
  db: DbExecutor,
  visibility: Visibility,
  input: { speciesId: string; traitId: string; levelId: string; actorId: string; referenceId?: string },
): Promise<{ validated: { recordId: string; recordCode: string }[] }> {
  return db.transaction(async (tx) => {
    const rows = await levelRecords(tx, visibility, input);
    if (rows.length === 0) return { validated: [] };
    const others = rows.filter((r) => r.createdBy !== input.actorId);
    if (others.length === 0) throw new AppError('PERMISSION_DENIED', 'You cannot validate your own record');
    const done = await tx
      .select({ recordId: recordAnnotations.recordId })
      .from(recordAnnotations)
      .where(
        and(
          eq(recordAnnotations.actorId, input.actorId),
          eq(recordAnnotations.kind, 'confirm'),
          inArray(recordAnnotations.recordId, others.map((r) => r.id)),
        ),
      );
    const already = new Set(done.map((d) => d.recordId));
    const todo = others.filter((r) => !already.has(r.id));
    if (todo.length > 0) {
      await tx.insert(recordAnnotations).values(
        todo.map((r) => ({ recordId: r.id, actorId: input.actorId, kind: 'confirm' as const, referenceId: input.referenceId ?? null })),
      );
    }
    return { validated: todo.map((r) => ({ recordId: r.id, recordCode: r.recordCode })) };
  });
}

/**
 * Withdraw level (spec R-10): every record of the level the actor may
 * withdraw (R-12). The unique withdraw index turns a concurrent duplicate
 * into a no-op, and only the rows actually inserted are reported.
 * @rfc RFC-65 R4, R10
 * @rfc RFC-33 R2
 */
export async function withdrawLevel(
  db: DbExecutor,
  visibility: Visibility,
  input: { speciesId: string; traitId: string; levelId: string; actorId: string; canWithdrawAny: boolean; canWithdrawImported: boolean },
): Promise<{ withdrawn: { recordId: string; recordCode: string }[] }> {
  return db.transaction(async (tx) => {
    const rows = (await levelRecords(tx, visibility, input)).filter((r) => mayWithdraw(r, input));
    if (rows.length === 0) return { withdrawn: [] };
    const inserted = await tx
      .insert(recordAnnotations)
      .values(rows.map((r) => ({ recordId: r.id, actorId: input.actorId, kind: 'withdraw' as const })))
      .onConflictDoNothing()
      .returning({ recordId: recordAnnotations.recordId });
    const ids = new Set(inserted.map((i) => i.recordId));
    return { withdrawn: rows.filter((r) => ids.has(r.id)).map((r) => ({ recordId: r.id, recordCode: r.recordCode })) };
  });
}
```

Route (`species.ts`). Add the imports `levelActionParamSchema` and `validateLevelBodySchema` from contracts, `validateLevel` and `withdrawLevel` from `../../../dataset/curation.ts`, `resolveSourceRef` from `../../../dataset/sources.ts`, and `forgetCachedBestEffort` from `../../invalidate-cache.ts`. Append to the chain:

```ts
    .post(
      '/:id/traits/:traitId/levels/:levelId/validate',
      requirePermission(ctx, 'records.annotate'),
      validate('param', levelActionParamSchema),
      validate('json', validateLevelBodySchema),
      async (c) => {
        const { id, traitId, levelId } = c.req.valid('param');
        const body = c.req.valid('json');
        const actor = currentUser(c);
        const visibility = await visibilityOf(ctx, c);
        const referenceId = body.referenceSource
          ? await resolveSourceRef({ db: ctx.db, doi: ctx.doi }, actor.id, body.referenceSource, 'referenceSource')
          : undefined;
        const data = await validateLevel(ctx.db, visibility, { speciesId: id, traitId, levelId, actorId: actor.id, referenceId });
        await forgetCachedBestEffort(c.get('logger'), ctx.redis, `dashboard:${actor.id}`, { actorId: actor.id });
        return c.json({ data });
      },
    )
    .post(
      '/:id/traits/:traitId/levels/:levelId/withdraw',
      requirePermission(ctx, 'records.review'),
      validate('param', levelActionParamSchema),
      async (c) => {
        const { id, traitId, levelId } = c.req.valid('param');
        const actor = currentUser(c);
        const permissions = currentPermissions(c);
        const visibility = await visibilityOf(ctx, c);
        const data = await withdrawLevel(ctx.db, visibility, {
          speciesId: id, traitId, levelId, actorId: actor.id,
          canWithdrawAny: permissions.has('records.withdraw'),
          canWithdrawImported: permissions.has('records.withdraw_imported'),
        });
        await forgetCachedBestEffort(c.get('logger'), ctx.redis, `dashboard:${actor.id}`, { actorId: actor.id });
        return c.json({ data });
      },
    );
```

Add `@rfc RFC-65 R3, R4, R10` and `@rfc RFC-70 R4` to `speciesRoutes`' JSDoc.

Web `api/curation.ts`:

```ts
/** Withdraw level (spec R-10). @rfc RFC-65 R4, R10 */
export async function withdrawLevel(speciesId: string, traitId: string, levelId: string): Promise<WithdrawLevelResult> {
  return (
    await apiFetch(
      `/species/${speciesId}/traits/${traitId}/levels/${levelId}/withdraw`,
      dataEnvelopeSchema(withdrawLevelResultSchema),
      { method: 'POST', json: {} },
    )
  ).data;
}
```

- [ ] **Step 4: Run to pass.** Run the four api files of Step 2, the contracts suite and typecheck. Expected: PASS.
- [ ] **Step 5: Commit**

```sh
git add packages/contracts/src/curation.ts apps/api/src apps/web/src/api/curation.ts
git commit -m "feat(api): validate a level and withdraw a level (RFC-70 R4, RFC-65 R4, R10)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The contested queue, and the counts that read it

**Files:**
- Modify:
  - `packages/contracts/src/curation.ts`, `dashboard.ts` and `health.ts` (+ tests);
  - `apps/api/src/dataset/queues.ts` (+ `queues.integration.test.ts`);
  - `apps/api/src/http/routes/dataset/records.ts`;
  - `apps/api/src/workspace/dashboard.ts` (+ test);
  - `apps/api/src/admin/health.ts` (+ test);
  - `apps/api/src/jobs/digest.ts` (+ `digest.test.ts`, `digest.integration.test.ts`);
  - `apps/api/src/mail/templates.ts` (+ `templates.test.ts`);
  - in `apps/web/src/`: `test/dataset-fixtures.ts`, `test/health-fixtures.ts`, `components/workspace/CurationCards.tsx` (+ test) and `pages/admin/HealthPage.tsx` (+ test).

**Interfaces:**
- Produces:

```ts
// contracts
export const contestedRecordSchema  // recordSchema.extend({ target: { id: uuid; valueText: string; level: { id; key } | null } })
export type ContestedRecord
dashboard.curation.queues: { pendingGroups, contested, proposals }   // `disputed` removed
health.queues: { pendingGroups, contested, proposals }                // `disputed` removed
// api
export async function listContested(db: DbExecutor, visibility: Visibility, input: { cursor?: string; limit: number }): Promise<{ data: ContestedRecord[]; nextCursor: string | null }>
export async function countContested(db: DbExecutor, visibility: Visibility): Promise<number>
GET /api/records/disputed (records.review) → one row per open contest, newest first   // path kept (Spec note 10)
// digest
DigestCounts: { records, contests, complements, validations, withdrawals, proposals, pendingGroups, contestedNow }; Digest: { window, counts, contests }
```

- Consumes: `openContestSql`, `liveSql`, `itemQuery` and `toItem`.

- [ ] **Step 1: Failing tests**

In `apps/api/src/dataset/queues.integration.test.ts`, delete every `describe`/`it` that exercises `listDisputed`, `countDisputed` or the old `countContested` (`grep -n "listDisputed\|countDisputed\|countContested" …`), then append:

```ts
describe('RFC-65 R10 the contested queue (spec R-9, R-10)', () => {
  const t = useTestDb();

  it('lists open contests newest first with the contested value; resolved, withdrawn or emptied ones leave', async () => {
    const { user: ana } = await createUser(t.db);
    const { user: bo } = await createUser(t.db);
    const ref = await createReference(t.db);
    const ref2 = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['red', 'blue', 'orange'] });
    const sp = await createSpecies(t.db);
    const level = (k: string) => trait.levels.find((l) => l.key === k)?.id as string;
    const blue = await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: 'blue', levelId: level('blue'), primaryReferenceId: ref.id, origin: 'manual', createdBy: ana.id });
    const c1 = await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: 'red', levelId: level('red'), primaryReferenceId: ref2.id, origin: 'manual', createdBy: bo.id, intent: 'contest', respondsToRecordId: blue.id });
    const c2 = await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: 'orange', levelId: level('orange'), primaryReferenceId: ref2.id, origin: 'manual', createdBy: bo.id, intent: 'contest', respondsToRecordId: blue.id });
    const mine = (rows: { id: string }[]) => rows.filter((r) => r.id === c1.id || r.id === c2.id).map((r) => r.id);

    const before = await countContested(t.db, UNRESTRICTED);
    const page = await listContested(t.db, UNRESTRICTED, { limit: 200 });
    expect(mine(page.data)).toEqual([c2.id, c1.id]);
    expect(page.data.find((r) => r.id === c1.id)?.target).toEqual({ id: blue.id, valueText: 'blue', level: { id: level('blue'), key: 'blue' } });

    await createAnnotation(t.db, { recordId: c1.id, actorId: ana.id, kind: 'resolve' });
    expect(mine((await listContested(t.db, UNRESTRICTED, { limit: 200 })).data)).toEqual([c2.id]);
    expect(await countContested(t.db, UNRESTRICTED)).toBe(before - 1);

    await createAnnotation(t.db, { recordId: blue.id, actorId: ana.id, kind: 'withdraw' });
    expect(mine((await listContested(t.db, UNRESTRICTED, { limit: 200 })).data)).toEqual([]);
    expect(await countContested(t.db, UNRESTRICTED)).toBe(before - 2);
  });
});
```

In the digest tests:
- `apps/api/src/jobs/digest.test.ts` and `apps/api/src/mail/templates.test.ts`: in every `DigestCounts` literal, rename `disputedNow` to `contestedNow` and delete `disputes`; in every `Digest` literal, delete `disputes: …`; change `it.each(['pendingGroups', 'disputedNow'] …)` to `it.each(['pendingGroups', 'contestedNow'] …)`.
- In `templates.test.ts`, assert `expect(mail.text).toContain('Open contests: 2')` and `expect(mail.text).not.toContain('Disputes')`, replacing the old `Disputed records` assertion.
- `apps/api/src/jobs/digest.integration.test.ts`: delete the `it` blocks that seed a `dispute` annotation (`grep -n "'dispute'" …`), rename `disputedNow` to `contestedNow`, and add to the counts test: `a withdrawn contest is not listed` (seed a contest in the window, withdraw it, assert `digest.contests.map((c) => c.recordId)` does not contain it).

In the dashboard and health tests (`apps/api/src/workspace/dashboard.integration.test.ts`, `apps/api/src/http/routes/admin/health.integration.test.ts`, `packages/contracts/src/dashboard.test.ts`, `packages/contracts/src/health.test.ts`), delete `disputed` from every `queues` literal and expectation (`grep -rn "disputed" …`).

- [ ] **Step 2: Run to fail.** Run the api integration `src/dataset/queues.integration.test.ts`. Expected: FAIL, `listContested` is not exported.

- [ ] **Step 3: Implement**

Contracts (`curation.ts`). Delete `listDisputedQuerySchema`, `disputedRecordSchema`, `DisputedRecord` and `ListDisputedQuery`, then add:

```ts
/**
 * One open contest (spec R-9) of the contested queue: the contest record,
 * and the value it contests.
 * @rfc RFC-65 R10
 */
export const contestedRecordSchema = recordSchema.extend({
  target: z.strictObject({
    id: z.uuid(),
    valueText: z.string(),
    level: z.strictObject({ id: z.uuid(), key: z.string() }).nullable(),
  }),
});
export type ContestedRecord = z.infer<typeof contestedRecordSchema>;
```

`dashboard.ts` and `health.ts`: delete the `disputed` key from the `queues` objects.

`queues.ts`:
- delete `DisputeRow`, `noDecisionAfter` if 13e left it, `disputedQuery`, `countDisputed`, `listDisputed` and the old `countContested`;
- import `openContestSql` from `./records.ts`;
- import `type ContestedRecord` in place of `DisputedRecord`;
- add:

```ts
/**
 * The open contests (spec R-9) the viewer may see, as the `trait_records c`
 * rows the queue pages through and the count counts, so the tile and the
 * page can never disagree.
 * @rfc RFC-65 R10
 * @rfc RFC-33 R2, R3
 */
function openContests(visibility: Visibility): SQL {
  return sql`from trait_records c
    join species sp on sp.id = c.species_id
    join traits tr on tr.id = c.trait_id
    where ${openContestSql('c')}
      and ${speciesVisible(visibility, sql`sp.active`, sql`sp.id`)}
      and ${traitVisible(visibility, sql`tr.active`)}`;
}

/**
 * How many contests are open, for the dashboard, the health page and the
 * digest (RFC-72 R1, RFC-52 R1, RFC-74 R3).
 * @rfc RFC-65 R10
 * @rfc RFC-72 R1
 * @rfc RFC-33 R2, R3
 */
export async function countContested(db: DbExecutor, visibility: Visibility): Promise<number> {
  const [row] = (await db.execute(sql`select count(*)::int as count ${openContests(visibility)}`)) as unknown as [
    { count: number } | undefined,
  ];
  return row?.count ?? 0;
}

/**
 * One page of open contests, newest first (keyset on the contest id, a
 * uuidv7). Two further queries, never one per row: the contest items and
 * the contested records, both through the shared item join.
 * @rfc RFC-65 R10
 * @rfc RFC-33 R2, R3
 */
export async function listContested(
  db: DbExecutor,
  visibility: Visibility,
  input: { cursor?: string; limit: number },
): Promise<{ data: ContestedRecord[]; nextCursor: string | null }> {
  const after = input.cursor ? decodeCursor(input.cursor) : null;
  const rows = (await db.execute(sql`select c.id, c.responds_to_record_id as target_id ${openContests(visibility)}
      and (${after}::uuid is null or c.id < ${after}::uuid)
    order by c.id desc
    limit ${input.limit + 1}`)) as unknown as { id: string; target_id: string }[];
  const { page, nextCursor } = pageOf(rows, input.limit, (r) => encodeCursor(r.id));
  if (page.length === 0) return { data: [], nextCursor };
  const items = await itemQuery(db).where(
    inArray(traitRecords.id, [...new Set(page.flatMap((r) => [r.id, r.target_id]))]),
  );
  const byId = new Map(items.map((i) => [i.record.id, toItem(i)]));
  const data = page.flatMap((r) => {
    const contest = byId.get(r.id);
    const target = byId.get(r.target_id);
    if (!contest || !target) return [];
    return [{ ...contest, target: { id: target.id, valueText: target.valueText, level: target.level } }];
  });
  return { data, nextCursor };
}
```

Route (`records.ts`): the `/disputed` handler validates `cursorQuerySchema` (import it from `@treerepro/contracts`) and calls `listContested(ctx.db, visibility, { cursor: q.cursor, limit: q.limit })`. Drop the `listDisputed` and `listDisputedQuerySchema` imports.

`dashboard.ts` `curationSection`: drop `countDisputed` from the import and the `Promise.all`, and return `{ coverage, queues: { pendingGroups, contested, proposals } }`.

`health.ts`: delete `disputedP`, its `await` and its entry in the `Promise.all`, and return `queues: { pendingGroups, contested, proposals: openProposals }`.

`digest.ts`:
- `DigestCounts` loses `disputes`, and `disputedNow` becomes `contestedNow`; `Digest` loses `disputes`; `hasActivity` loses `counts.disputes +`; `AnnotationCountRow` loses `disputes`;
- the annotation count query drops the `disputes` line;
- the dispute list query and `disputeRows` are deleted;
- `countDisputed(db, UNRESTRICTED)` becomes `countContested(db, UNRESTRICTED)` → `contestedNow`;
- the record counts query and the contest list query both gain `and not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')`;
- the actor ids come from `contestRows` alone;
- update the doc comments to say "contests" where they said "contests and disputes".

`templates.ts` `digestEmail`:
- `const { counts, window, contests } = input.digest;`;
- delete the `Disputes:` line and the `digestSection('Disputes', …)` line;
- `Disputed records: ${counts.disputedNow}` becomes `` `Open contests: ${counts.contestedNow}` ``.

Web:
- `test/dataset-fixtures.ts`: in the dashboard fixture, `queues: { pendingGroups: 3, contested: 1, proposals: 0 }`. Replace `DISPUTED_RECORD` with:

```ts
/** An open contest: Grace answers {@link RECORD} (dioecious) with monoecious. @rfc RFC-65 R10 */
export const CONTESTED_RECORD: ContestedRecord = {
  ...RECORD,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d56',
  valueText: 'monoecious',
  level: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d21', key: 'monoecious' },
  origin: 'manual',
  createdAt: '2026-09-03T12:00:00.000Z',
  createdBy: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9f', name: 'Grace' },
  intent: 'contest',
  respondsTo: { id: RECORD.id },
  validationCount: 0,
  contested: false,
  target: { id: RECORD.id, valueText: 'dioecious', level: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d20', key: 'dioecious' } },
};
```

  Swap `DisputedRecord` for `ContestedRecord` in the import list.
- `test/health-fixtures.ts`: `queues: { pendingGroups: 4, contested: 1, proposals: 5 }`.
- `CurationCards.tsx`: delete the Disputed `<li>`, and the Contested tile loses its `search` prop: `<QueueTile label="Contested" value={queues.contested} to="/app/curation/disputed" />`. In `CurationCards.test.tsx`, the tile test becomes `'links the queue tiles to pending and contested'`. It asserts the `/^Pending/` link to `/app/curation/pending`, and a `/^Contested/` link whose pathname is `/app/curation/disputed` with no `intent` param (`expect(contested.searchParams.get('intent')).toBeNull()`). Delete the `/^Disputed/` assertion.
- `HealthPage.tsx`: delete the `Disputed` `StatTile`. In `HealthPage.test.tsx`, delete the assertion on the `Disputed` tile.

- [ ] **Step 4: Run to pass.** Run the api integration `src/dataset/queues.integration.test.ts`, `src/workspace/dashboard.integration.test.ts`, `src/http/routes/admin/health.integration.test.ts` and `src/jobs/digest.integration.test.ts`; the api unit `src/jobs/digest.test.ts` and `src/mail/templates.test.ts`; the contracts suite; the web suite. The web suite still names `fetchDisputed` in `DisputedPage.test.tsx` and `api/curation.test.ts`, and Task 9 rewrites both. For this task, change only their imports of `DISPUTED_RECORD` to `CONTESTED_RECORD` and `disputedRecordSchema` to `contestedRecordSchema`, and in `api/curation.ts` rename nothing yet. Then typecheck. Expected: PASS, except the two page tests Task 9 replaces. Record their failure count in the commit body.
- [ ] **Step 5: Commit**

```sh
git add packages/contracts/src apps/api/src apps/web/src
git commit -m "feat(api): contested queue and counts from open contests; disputes leave dashboard, health and digest (RFC-65 R10, RFC-72 R1, RFC-52 R1, RFC-74 R3)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The contested queue page

**Files:**
- Modify:
  - in `apps/web/src/`: `api/curation.ts` (+ `api/curation.test.ts`), `pages/curation/DisputedPage.tsx` (+ test), `components/curation/DisputedTable.tsx`, `routes/app/curation/disputed.tsx`, `components/shell/nav.ts`, `components/shell/AppShell.test.tsx`;
  - `apps/web/src/routeTree.gen.ts`, regenerated by the build only if it changes.

**Interfaces:**
- Produces:

```ts
export const curationKeys.contested: readonly ['records', 'contested']
export function fetchContested(params: { cursor?: string; limit?: number }): Promise<ListEnvelope<ContestedRecord>>
export function DisputedPage(): JSX.Element
export function DisputedTable(props: { records: ContestedRecord[]; onSelect(record: ContestedRecord): void; onAction(action: ContestAction, record: ContestedRecord): void }): JSX.Element
export type ContestAction = 'keep' | 'withdrawContest' | 'withdrawTarget'
```

- Consumes: `annotateRecord` (Task 5), `withdrawLevel` (Task 7), `useRecordWrite`, `ConfirmDialog` and `actionErrorMessage` (`RecordActions.tsx`).

- [ ] **Step 1: Failing test.** Replace the body of `apps/web/src/pages/curation/DisputedPage.test.tsx` below the mocks. Rename `fetchDisputed` to `fetchContested` in the hoisted `curation` mock, and add `annotateRecord: vi.fn(), withdrawLevel: vi.fn(), invalidateAfterRecordWrite: vi.fn(async () => undefined)` to it. Import `CONTESTED_RECORD` in place of `DISPUTED_RECORD`.

```tsx
beforeEach(() => {
  auth.fetchMe.mockReset().mockResolvedValue({ ...ME, permissions: ['dataset.read', 'records.review', 'records.withdraw'] });
  dataset.fetchRecord.mockReset().mockResolvedValue(CURATED_RECORD_DETAIL);
  curation.fetchContested.mockReset().mockResolvedValue({ data: [CONTESTED_RECORD], meta: { nextCursor: null } });
  curation.annotateRecord.mockReset().mockResolvedValue(null);
  curation.withdrawLevel.mockReset().mockResolvedValue({ withdrawn: [] });
});

describe('RFC-65 R10 DisputedPage is the contested queue (spec R-9, R-10)', () => {
  it('lists the open contest: species, trait, contested value, contest value, author and date', async () => {
    renderAt('/app/curation/disputed');
    expect(await screen.findByRole('heading', { name: 'Contested records' })).toBeInTheDocument();
    const row = (await screen.findAllByRole('row'))[1] as HTMLElement;
    expect(within(row).getByRole('link', { name: /Adenanthera pavonina/ })).toHaveAttribute('href', `/app/species/${CONTESTED_RECORD.speciesId}`);
    expect(row).toHaveTextContent('sexual system');
    expect(row).toHaveTextContent('dioecious');
    expect(row).toHaveTextContent('Grace');
    expect(row).toHaveTextContent('2026-09-03');
    await userEvent.click(within(row).getByRole('button', { name: 'monoecious' }));
    expect(await screen.findByRole('dialog', { name: 'Record' })).toBeInTheDocument();
    expect(dataset.fetchRecord).toHaveBeenCalledWith(CONTESTED_RECORD.id);
  });

  it('Keep both resolves the contest after confirmation', async () => {
    curation.annotateRecord.mockResolvedValue(CURATED_RECORD_DETAIL);
    renderAt('/app/curation/disputed');
    await userEvent.click(await screen.findByRole('button', { name: 'Keep both' }));
    const dialog = await screen.findByRole('dialog', { name: 'Keep both values?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep both' }));
    await waitFor(() => expect(curation.annotateRecord).toHaveBeenCalledWith(CONTESTED_RECORD.id, { kind: 'resolve' }));
  });

  it('Withdraw contest withdraws the contest record after confirmation', async () => {
    renderAt('/app/curation/disputed');
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw contest' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw the contest?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(curation.annotateRecord).toHaveBeenCalledWith(CONTESTED_RECORD.id, { kind: 'withdraw' }));
  });

  it('Withdraw level withdraws the contested level; a refusal stays in the dialog', async () => {
    curation.withdrawLevel.mockRejectedValueOnce(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    renderAt('/app/curation/disputed');
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw level' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw every "dioecious" record?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You do not have permission to do this.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() =>
      expect(curation.withdrawLevel).toHaveBeenLastCalledWith(CONTESTED_RECORD.speciesId, CONTESTED_RECORD.trait.id, CONTESTED_RECORD.target.level?.id),
    );
  });

  it('a quantitative contest offers Withdraw record on the contested record', async () => {
    curation.fetchContested.mockResolvedValue({ data: [{ ...CONTESTED_RECORD, target: { ...CONTESTED_RECORD.target, level: null, valueText: '3' } }], meta: { nextCursor: null } });
    renderAt('/app/curation/disputed');
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw record' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw the contested record?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(curation.annotateRecord).toHaveBeenCalledWith(CONTESTED_RECORD.target.id, { kind: 'withdraw' }));
  });

  it('shows the empty state', async () => {
    curation.fetchContested.mockResolvedValue({ data: [], meta: { nextCursor: null } });
    renderAt('/app/curation/disputed');
    expect(await screen.findByText('No open contests.')).toBeInTheDocument();
  });

  it('RFC-13 R8 a 401 on the list ends the session and returns to /', async () => {
    curation.fetchContested.mockRejectedValue(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'Authentication required'));
    const { router } = renderAt('/app/curation/disputed');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
```

(If `actionErrorMessage` maps `PERMISSION_DENIED` through `contributionErrorMessage` to another sentence, assert that sentence instead. Read `components/curation/errors.ts`.)

In `api/curation.test.ts`, the disputed-list case becomes `fetchContested({ limit: 50 })`, requesting `/api/records/disputed?limit=50` and parsing a `CONTESTED_RECORD`. In `AppShell.test.tsx`, the nav link name `'Disputed'` becomes `'Contested'`.

- [ ] **Step 2: Run to fail.** Run the web `src/pages/curation/DisputedPage.test.tsx`, `src/api/curation.test.ts` and `src/components/shell/AppShell.test.tsx`. Expected: FAIL, `fetchContested` is not a function, and there is no Keep both button.

- [ ] **Step 3: Implement**

`api/curation.ts`: `curationKeys.disputed` becomes `contested: ['records', 'contested'] as const`, and `fetchDisputed` becomes:

```ts
/** The open contests (spec R-9), newest first. @rfc RFC-65 R10 */
export function fetchContested(params: { cursor?: string; limit?: number }) {
  return apiFetch(withQuery('/records/disputed', params), listEnvelopeSchema(contestedRecordSchema));
}
```

`routes/app/curation/disputed.tsx`: delete `INTENT_FILTERS`, `oneOf` and `validateSearch`, and render `<DisputedPage />`:

```tsx
/**
 * @rfc RFC-13 R2
 * @rfc RFC-65 R10
 */
export const Route = createFileRoute('/app/curation/disputed')({ component: DisputedPage });
```

`components/curation/DisputedTable.tsx`, the whole file:

```tsx
import { Link } from '@tanstack/react-router';
import type { ContestedRecord } from '@treerepro/contracts';
import { humaniseKey, isoDate } from '../../lib/format.ts';
import { Button, Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';

/** What a manager can do with an open contest (spec R-10). */
export type ContestAction = 'keep' | 'withdrawContest' | 'withdrawTarget';

/**
 * Open contests as rows: species (linked), trait, the contested value, the
 * contest's value (a button that opens the contest record), who contested,
 * when, and the three resolutions.
 * @rfc RFC-65 R10
 */
export function DisputedTable({
  records,
  onSelect,
  onAction,
}: {
  records: ContestedRecord[];
  onSelect: (record: ContestedRecord) => void;
  onAction: (action: ContestAction, record: ContestedRecord) => void;
}) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Species</Th>
          <Th>Trait</Th>
          <Th>Contested value</Th>
          <Th>Contest</Th>
          <Th>By</Th>
          <Th>Date</Th>
          <Th>Actions</Th>
        </Tr>
      </Thead>
      <Tbody>
        {records.map((record) => (
          <Tr key={record.id} className="transition-colors hover:bg-mist-50">
            <Td>
              <Link
                to="/app/species/$id"
                params={{ id: record.species.id }}
                className="font-medium italic text-canopy-900 underline-offset-2 hover:underline"
              >
                {record.species.canonicalName}
              </Link>
            </Td>
            <Td>{humaniseKey(record.trait.key)}</Td>
            <Td>{record.target.level?.key ?? record.target.valueText}</Td>
            <Td>
              <button
                type="button"
                onClick={() => onSelect(record)}
                className="text-left font-medium text-canopy-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
              >
                {record.level?.key ?? record.valueText}
              </button>
            </Td>
            <Td>{record.createdBy?.name ?? ''}</Td>
            <Td className="whitespace-nowrap tabular-nums">
              <time dateTime={record.createdAt}>{isoDate(record.createdAt)}</time>
            </Td>
            <Td>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => onAction('keep', record)}>
                  Keep both
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onAction('withdrawContest', record)}>
                  Withdraw contest
                </Button>
                <Button size="sm" variant="danger" onClick={() => onAction('withdrawTarget', record)}>
                  {record.target.level ? 'Withdraw level' : 'Withdraw record'}
                </Button>
              </div>
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
```

`pages/curation/DisputedPage.tsx`, the whole file:

```tsx
import type { ContestedRecord } from '@treerepro/contracts';
import { useState } from 'react';
import { annotateRecord, curationKeys, fetchContested, withdrawLevel } from '../../api/curation.ts';
import { RecordActions } from '../../components/curation/RecordActions.tsx';
import { type ContestAction, DisputedTable } from '../../components/curation/DisputedTable.tsx';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import { RecordDrawer } from '../../components/dataset/RecordDrawer.tsx';
import { Alert, ConfirmDialog, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';
import { useRecordWrite } from '../../lib/use-record-write.ts';

type Pending = { action: ContestAction; record: ContestedRecord };

function question({ action, record }: Pending): { title: string; message: string; confirmLabel: string; danger: boolean } {
  if (action === 'keep') {
    return { title: 'Keep both values?', message: 'The contest closes and both records stay in the dataset.', confirmLabel: 'Keep both', danger: false };
  }
  if (action === 'withdrawContest') {
    return { title: 'Withdraw the contest?', message: 'The contest record leaves the dataset. This cannot be undone.', confirmLabel: 'Withdraw', danger: true };
  }
  return record.target.level
    ? { title: `Withdraw every "${record.target.level.key}" record?`, message: 'Every record of this level that you may withdraw leaves the dataset. This cannot be undone.', confirmLabel: 'Withdraw', danger: true }
    : { title: 'Withdraw the contested record?', message: 'The contested record leaves the dataset. This cannot be undone.', confirmLabel: 'Withdraw', danger: true };
}

function run({ action, record }: Pending): Promise<unknown> {
  if (action === 'keep') return annotateRecord(record.id, { kind: 'resolve' });
  if (action === 'withdrawContest') return annotateRecord(record.id, { kind: 'withdraw' });
  return record.target.level
    ? withdrawLevel(record.speciesId, record.trait.id, record.target.level.id)
    : annotateRecord(record.target.id, { kind: 'withdraw' });
}

/**
 * The contested queue (RFC-65 R10, spec R-9, R-10): one row per open
 * contest, newest first. A manager keeps both values, withdraws the
 * contest, or withdraws the contested level (the contested record, for a
 * quantitative trait). Every choice asks for confirmation. After it the
 * queue and the species are invalidated (`useRecordWrite`), so the row
 * leaves.
 * @rfc RFC-13 R2, R5
 * @rfc RFC-65 R10
 */
export function DisputedPage() {
  const list = usePagedList(curationKeys.contested, (cursor, limit) => fetchContested({ cursor, limit }));
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const act = useRecordWrite<Pending, unknown>({
    write: run,
    onInvalidated: () => setPending(null),
  });
  return (
    <>
      <PageHeader
        title="Contested records"
        description="Values a scientist has contested with a different value. Keep both, withdraw the contest, or withdraw the contested level."
      />
      <div className="flex flex-col gap-4">
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading ? <p className="text-body text-mist-500">Loading…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? <EmptyState title="No open contests." /> : null}
        {list.items.length > 0 ? (
          <DisputedTable
            records={list.items}
            onSelect={(record) => setOpen(record.id)}
            onAction={(action, record) => {
              act.reset();
              setPending({ action, record });
            }}
          />
        ) : null}
        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>
      {pending ? (
        <ConfirmDialog
          {...question(pending)}
          pending={act.isPending}
          error={act.error ? actionErrorMessage(act.error) : null}
          onConfirm={() => act.mutate(pending)}
          onClose={() => setPending(null)}
        />
      ) : null}
      <RecordDrawer recordId={open} onClose={() => setOpen(null)} onOpenRecord={setOpen} />
    </>
  );
}
```

The first import line of `RecordActions.tsx` is for `actionErrorMessage`: import `{ actionErrorMessage }` from `'../../components/curation/RecordActions.tsx'` rather than `RecordActions` itself (fix the import to `import { actionErrorMessage } from …`).

`nav.ts`: the `/app/curation/disputed` entry's `label: 'Disputed'` becomes `label: 'Contested'`.

Build the web in the container (`pnpm --filter @treerepro/web build`) and `docker cp` `apps/web/src/routeTree.gen.ts` back out. Keep the regenerated file only if it differs (the route lost its `validateSearch`).

- [ ] **Step 4: Run to pass.** Run the web suite and typecheck. Expected: PASS.
- [ ] **Step 5: Commit**

```sh
git add apps/web/src
git commit -m "feat(web): the contested queue with Keep both, Withdraw contest and Withdraw level (RFC-65 R10, spec R-10)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Species list filters

**Files:**
- Modify:
  - `packages/contracts/src/dataset.ts` (`listSpeciesQuerySchema`);
  - `apps/api/src/dataset/taxa.ts` (+ `taxa.integration.test.ts`);
  - `apps/api/src/http/routes/dataset/species.ts`;
  - in `apps/web/src/`: `api/dataset.ts`, `components/dataset/SpeciesSearchForm.tsx` (+ test), `pages/dataset/SpeciesSearchPage.tsx` (+ test), `routes/app/species/index.tsx`.

**Interfaces:**
- Produces: `GET /api/species?contested=true&unknownLevels=true&unresolved=true`; `SpeciesListFilters.contested?: boolean` and `unknownLevels?: boolean`; `SpeciesSearchValue.contested: boolean` and `unknownLevels: boolean`.
- Consumes: `openContestSql`, `liveSql` and `Visibility.review`.

- [ ] **Step 1: Failing tests.** Append to `apps/api/src/dataset/taxa.integration.test.ts`:

```ts
describe('RFC-60 R6 contested, unknownLevels and unresolved filters (spec R-15)', () => {
  const t = useTestDb();
  const REVIEWER: Visibility = { inactive: false, plotIds: null, review: true };

  it('contested for everyone; unknownLevels and unresolved only for a reviewer', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const tag = `Filtrum ${Date.now()}`;
    const contested = await createSpecies(t.db, { canonicalName: `${tag} contested` });
    const unknown = await createSpecies(t.db, { canonicalName: `${tag} unknown` });
    const plain = await createSpecies(t.db, { canonicalName: `${tag} plain` });
    const [la, lb] = trait.levels as [{ id: string }, { id: string }];
    const target = await createRecord(t.db, { speciesId: contested.id, traitId: trait.id, valueText: 'a', levelId: la.id, primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id });
    await createRecord(t.db, { speciesId: contested.id, traitId: trait.id, valueText: 'b', levelId: lb.id, primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id, intent: 'contest', respondsToRecordId: target.id });
    const batch = await createImportBatch(t.db);
    await createRecord(t.db, { speciesId: unknown.id, traitId: trait.id, valueText: 'zzz', harmonisation: 'unknown_level', primaryReferenceId: ref.id, importBatchId: batch.id });
    await createRecord(t.db, { speciesId: plain.id, traitId: trait.id, valueText: 'a', levelId: la.id, primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id });
    const names = async (v: Visibility, f: object) =>
      (await searchSpecies(t.db, v, { q: tag, limit: 50, ...f })).data.map((s) => s.canonicalName).sort();

    expect(await names(RESTRICTED, { contested: true })).toEqual([`${tag} contested`]);
    expect(await names(REVIEWER, { unknownLevels: true })).toEqual([`${tag} unknown`]);
    expect(await names(RESTRICTED, { unknownLevels: true })).toHaveLength(3);
    expect(await names(RESTRICTED, { unresolved: true })).toHaveLength(3);
  });
});
```

(Import `Visibility`, `createImportBatch` and `RESTRICTED`. If `createSpecies` takes no `canonicalName`, name the species through the option it does take. The tag keeps the query to this test's own rows.)

In `apps/web/src/components/dataset/SpeciesSearchForm.test.tsx`, add `contested: false, unknownLevels: false` to every `SpeciesSearchValue` literal, then append:

```tsx
  it('RFC-60 R6 Contested only for everyone; Has unknown levels and Unresolved taxa only for records.review', async () => {
    const onChange = vi.fn();
    const value = { q: '', unresolved: false, contested: false, unknownLevels: false };
    const first = renderWithProviders(<SpeciesSearchForm value={value} onChange={onChange} />, { me: { ...ME, permissions: ['dataset.read'] } as never });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Contested only' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ contested: true }));
    expect(screen.queryByRole('checkbox', { name: 'Has unknown levels' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Unresolved taxa only' })).not.toBeInTheDocument();
    first.unmount();
    renderWithProviders(<SpeciesSearchForm value={value} onChange={onChange} />, { me: { ...ME, permissions: ['dataset.read', 'records.review'] } as never });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Has unknown levels' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ unknownLevels: true }));
    expect(screen.getByRole('checkbox', { name: 'Unresolved taxa only' })).toBeInTheDocument();
  });
```

(Match the file's existing render helper and `me` shape.)

- [ ] **Step 2: Run to fail.** Run the api integration `src/dataset/taxa.integration.test.ts` and the web `src/components/dataset/SpeciesSearchForm.test.tsx`. Expected: FAIL, `contested` is ignored and there is no checkbox.

- [ ] **Step 3: Implement**

Contracts: `listSpeciesQuerySchema` gains `contested: z.enum(['true', 'false']).optional(), unknownLevels: z.enum(['true', 'false']).optional(),`, placed after `unresolved`.

`taxa.ts`:
- `SpeciesListFilters` gains `contested?: boolean; unknownLevels?: boolean;`;
- import `liveSql` and `openContestSql` from `./records.ts`;
- in `speciesListConditions`, replace the `if (filters.unresolved) {` guard with `if (filters.unresolved && visibility.review) {`;
- after that block, add:

```ts
  // Spec R-15: Contested for everyone; unknown levels for reviewers only,
  // like `unresolved` above (ignored otherwise, as `status` is).
  if (filters.contested) {
    conditions.push(
      sql`exists (select 1 from trait_records c join ${traits} ct on ct.id = c.trait_id
        where c.species_id = ${species.id} and ${openContestSql('c')} and ${traitVisible(visibility, sql`ct.active`)})`,
    );
  }
  if (filters.unknownLevels && visibility.review) {
    conditions.push(
      sql`exists (select 1 from trait_records u join ${traits} ut on ut.id = u.trait_id
        where u.species_id = ${species.id} and u.harmonisation <> 'harmonised' and u.harmonisation = 'unknown_level'
          and ${liveSql(sql`u.id`)} and ${traitVisible(visibility, sql`ut.active`)})`,
    );
  }
```

Add the `@rfc RFC-60 R6` wording to the doc if needed (it is already tagged).

Route (`species.ts` `GET /`): pass `contested: q.contested === 'true', unknownLevels: q.unknownLevels === 'true',`.

Web:
- `api/dataset.ts` `searchSpecies` params gain `contested?: boolean; unknownLevels?: boolean;`.
- `routes/app/species/index.tsx` `validateSearch` gains the two lines below, and its doc mentions them:

```ts
    contested: search.contested === true || search.contested === 'true' ? true : undefined,
    unknownLevels: search.unknownLevels === true || search.unknownLevels === 'true' ? true : undefined,
```

- `SpeciesSearchPage.tsx`:
  - `SpeciesSearch` gains `contested?: boolean; unknownLevels?: boolean;`;
  - `toValue` gains `contested: search.contested === true, unknownLevels: search.unknownLevels === true,`;
  - `toSearch` gains `contested: value.contested ? true : undefined, unknownLevels: value.unknownLevels ? true : undefined,`;
  - `searchKey` appends `value.contested, value.unknownLevels`;
  - `params` gains `contested: form.contested, unknownLevels: form.unknownLevels,`.
- `SpeciesSearchForm.tsx`:
  - `SpeciesSearchValue` gains `contested: boolean; unknownLevels: boolean;`;
  - add `const canReview = hasPermission(me, 'records.review');`;
  - `<TaxonomyFilters showUnresolved={canReview} …>`;
  - the Scope group renders always: replace `{showScopeGroup || canReadInactive ? (` … `) : null}` with the group itself;
  - append inside it, after the outside-plots checkbox:

```tsx
          <label className={FILTER_CHECK}>
            <input
              type="checkbox"
              className="size-5 accent-canopy-700"
              checked={value.contested}
              onChange={(event) => onChange({ ...value, contested: event.target.checked })}
            />
            Contested only
          </label>
          {canReview ? (
            <label className={FILTER_CHECK}>
              <input
                type="checkbox"
                className="size-5 accent-canopy-700"
                checked={value.unknownLevels}
                onChange={(event) => onChange({ ...value, unknownLevels: event.target.checked })}
              />
              Has unknown levels
            </label>
          ) : null}
```

  Update the form's doc: "**Scope** — … plus **Contested only** for everyone and **Has unknown levels** with `records.review` (spec R-15); the unresolved toggle of the Taxonomy group is shown with `records.review` only".
- Fix every other `SpeciesSearchValue`/`SpeciesSearch` literal the web typecheck names (`SpeciesSearchPage.test.tsx`) by adding the two fields.

- [ ] **Step 4: Run to pass.** Run the api integration `src/dataset/taxa.integration.test.ts` and `src/http/routes/dataset/species.integration.test.ts`, the web suite and typecheck. Expected: PASS.
- [ ] **Step 5: Commit**

```sh
git add packages/contracts/src/dataset.ts apps/api/src apps/web/src
git commit -m "feat: species filters Contested, Has unknown levels and reviewer-only Unresolved (RFC-60 R6, spec R-15)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Sortable records list

**Files:** `packages/contracts/src/dataset.ts`, `apps/api/src/dataset/records.ts` (+ `records.integration.test.ts`) and `apps/api/src/http/routes/dataset/records.ts`.

**Interfaces:**
- Produces:

```ts
export const RECORD_SORTS = ['value', 'references', 'origin', 'added'] as const
export const SORT_ORDERS = ['asc', 'desc'] as const
listRecordsQuerySchema: + sort?: RecordSort; order?: SortOrder
listRecords(db, visibility, input: { …; sort?: RecordSort; order?: SortOrder })
```

- Default `added desc`: a keyset on the id, and the same cursor as today. Any other sort pages by offset, with the composite cursor `[offset]` (Spec note 14).

- [ ] **Step 1: Failing test.** Append to `apps/api/src/dataset/records.integration.test.ts`:

```ts
describe('RFC-63 R9 records list sort (spec §2)', () => {
  const t = useTestDb();

  it('sorts by value, references, origin and added in both orders, and pages every order', async () => {
    const { user } = await createUser(t.db);
    const refZ = await createReference(t.db, { citationKey: `zeta-${Date.now()}` });
    const refA = await createReference(t.db, { citationKey: `alpha-${Date.now()}` });
    const trait = await createTrait(t.db, { valueType: 'quantitative' });
    const sp = await createSpecies(t.db);
    const batch = await createImportBatch(t.db);
    const r10 = await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: '10', numericValue: 10, primaryReferenceId: refA.id, origin: 'manual', createdBy: user.id });
    const r9 = await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: '9', numericValue: 9, primaryReferenceId: refZ.id, importBatchId: batch.id });
    const r2 = await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: '2', numericValue: 2, primaryReferenceId: refZ.id, origin: 'manual', createdBy: user.id });
    const ids = async (sort?: 'value' | 'references' | 'origin' | 'added', order?: 'asc' | 'desc') =>
      (await listRecords(t.db, UNRESTRICTED, { speciesId: sp.id, traitId: trait.id, limit: 50, sort, order })).data.map((r) => r.id);

    expect(await ids()).toEqual([r2.id, r9.id, r10.id]);
    expect(await ids('added', 'asc')).toEqual([r10.id, r9.id, r2.id]);
    expect(await ids('value', 'asc')).toEqual([r2.id, r9.id, r10.id]);
    expect(await ids('value', 'desc')).toEqual([r10.id, r9.id, r2.id]);
    expect((await ids('references', 'asc'))[0]).toBe(r10.id);
    expect((await ids('origin', 'asc'))[0]).toBe(r9.id);

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listRecords(t.db, UNRESTRICTED, { speciesId: sp.id, traitId: trait.id, limit: 1, sort: 'value', order: 'asc', cursor });
      seen.push(...page.data.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual([r2.id, r9.id, r10.id]);
  });

  it('a cursor of another order is refused', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { valueType: 'quantitative' });
    const sp = await createSpecies(t.db);
    for (const n of [1, 2]) {
      await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: String(n), numericValue: n, primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id });
    }
    const first = await listRecords(t.db, UNRESTRICTED, { speciesId: sp.id, traitId: trait.id, limit: 1 });
    await expect(
      listRecords(t.db, UNRESTRICTED, { speciesId: sp.id, traitId: trait.id, limit: 1, sort: 'value', cursor: first.nextCursor ?? '' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
```

(Use `createReference`'s real option for the citation key. If it has none, sort the expectation on whatever key the helper generates.)

In `packages/contracts/src/dataset.test.ts`: `listRecordsQuerySchema` accepts `sort=value&order=asc` and refuses `sort=species`.

- [ ] **Step 2: Run to fail.** Run the api integration `src/dataset/records.integration.test.ts`. Expected: FAIL, `sort` is ignored.

- [ ] **Step 3: Implement.** Contracts:

```ts
/** Sortable columns of the record panel (spec §2). @rfc RFC-63 R9 */
export const RECORD_SORTS = ['value', 'references', 'origin', 'added'] as const;
export type RecordSort = (typeof RECORD_SORTS)[number];
/** @rfc RFC-63 R9 */
export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];
```

`listRecordsQuerySchema`'s `.extend` gains `sort: z.enum(RECORD_SORTS).optional(), order: z.enum(SORT_ORDERS).optional(),`.

`records.ts`. Import `asc` and `gt` from drizzle, `decodeCompositeCursor`, `encodeCompositeCursor` and `isDigits` from `../http/cursor.ts`, and `type RecordSort, type SortOrder` from contracts. Add:

```ts
// Offset-ordered sorts: a value, a citation or an origin is shared by many
// records, so these page by position rather than by keyset (Spec note 14).
const SORT_KEYS: Record<Exclude<RecordSort, 'added'>, SQL[]> = {
  value: [
    sql`coalesce(${traitRecords.numericValue}, "trait_records"."mean_value", "trait_records"."min_value", "trait_records"."max_value")`,
    sql`${traitRecords.valueText}`,
  ],
  references: [sql`lower(coalesce(${primaryRef.shortCitation}, ${primaryRef.citationKey}))`],
  origin: [sql`${traitRecords.origin}`],
};
```

In `listRecords`, the `input` type gains `sort?: RecordSort; order?: SortOrder;`. Replace the cursor, query and pageOf tail with:

```ts
  const sort = input.sort ?? 'added';
  const dir = input.order === 'asc' ? asc : desc;
  if (sort === 'added') {
    if (input.cursor) {
      const after = decodeCursor(input.cursor);
      conditions.push(input.order === 'asc' ? gt(traitRecords.id, after) : lt(traitRecords.id, after));
    }
    const rows = await itemQuery(db).where(and(...conditions)).orderBy(dir(traitRecords.id)).limit(input.limit + 1);
    const { page, nextCursor } = pageOf(rows, input.limit, (r) => encodeCursor(r.record.id));
    return { data: page.map(toItem), nextCursor };
  }
  const [offsetText] = input.cursor ? decodeCompositeCursor(input.cursor, 1, [isDigits]) : ['0'];
  const offset = Number(offsetText);
  const rows = await itemQuery(db)
    .where(and(...conditions))
    .orderBy(...SORT_KEYS[sort].map((k) => dir(k)), dir(traitRecords.id))
    .limit(input.limit + 1)
    .offset(offset);
  const { page, nextCursor } = pageOf(rows, input.limit, () => encodeCompositeCursor([String(offset + input.limit)]));
  return { data: page.map(toItem), nextCursor };
```

A keyset cursor decoded as a composite, or a composite decoded as a uuid, fails its validator and answers 400. Update the doc: "`sort` / `order` (spec §2); `added` keeps the keyset cursor on the id, the other sorts page by offset".

Route: pass `sort: q.sort, order: q.order`.

- [ ] **Step 4: Run to pass.** Run the api integration `src/dataset/records.integration.test.ts` and `src/http/routes/dataset/records.integration.test.ts`, the contracts suite and typecheck. Expected: PASS.
- [ ] **Step 5: Commit**

```sh
git add packages/contracts/src/dataset.ts packages/contracts/src/dataset.test.ts apps/api/src
git commit -m "feat(api): records list sort by value, references, origin or added (RFC-63 R9)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: My contributions after contests and withdrawal

**Files:**
- Modify:
  - `packages/contracts/src/contributions.ts`;
  - `apps/api/src/dataset/contributions.ts` (+ `contributions.integration.test.ts`);
  - in `apps/web/src/`: `pages/WorkspacePage.tsx`, `pages/workspace/ContributionsPage.tsx` (+ test), `test/dataset-fixtures.ts`;
  - `apps/e2e/tests/contributions.spec.ts`.

**Interfaces:**
- Produces: `contributionSummarySchema` without `disputes` and `withdrawn`. The record list skips withdrawn records. The annotation list shows `confirm` and `resolve` on live records only. `records`, `contests`, `complements` and `validations` count live records.
- Consumes: `liveSql`.

- [ ] **Step 1: Failing test.** In `apps/api/src/dataset/contributions.integration.test.ts`, delete the expectations on `disputes` and `withdrawn` (`grep -n "disputes\|withdrawn" …`), then append:

```ts
describe('RFC-71 R2, R3, R4 contributions after spec R-11 and R-13', () => {
  const t = useTestDb();

  it('a withdrawn record and its annotations leave the lists and the counts; old disputes are not listed', async () => {
    const { user: me } = await createUser(t.db);
    const { user: other } = await createUser(t.db);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const sp = await createSpecies(t.db);
    const kept = await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: 'a', levelId: trait.levels[0]?.id, primaryReferenceId: ref.id, origin: 'manual', createdBy: me.id });
    const gone = await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: 'b', levelId: trait.levels[1]?.id, primaryReferenceId: ref.id, origin: 'manual', createdBy: me.id });
    const theirs = await createRecord(t.db, { speciesId: sp.id, traitId: trait.id, valueText: 'b', levelId: trait.levels[1]?.id, primaryReferenceId: ref.id, rawValue: 'x', origin: 'manual', createdBy: other.id });
    await createAnnotation(t.db, { recordId: theirs.id, actorId: me.id, kind: 'confirm' });
    await createAnnotation(t.db, { recordId: theirs.id, actorId: me.id, kind: 'dispute', note: 'old' });
    await createAnnotation(t.db, { recordId: gone.id, actorId: me.id, kind: 'withdraw' });

    const records = await listContributions(t.db, UNRESTRICTED, me.id, { kind: 'records', limit: 50 });
    expect(records.data.map((r) => r.id)).toEqual([kept.id]);
    const annotations = await listContributions(t.db, UNRESTRICTED, me.id, { kind: 'annotations', limit: 50 });
    expect(annotations.data.map((a) => a.kind)).toEqual(['confirm']);
    const summary = await contributionSummary(t.db, me.id);
    expect(summary).toMatchObject({ records: 1, validations: 1 });
    expect(summary).not.toHaveProperty('disputes');
    expect(summary).not.toHaveProperty('withdrawn');
  });
});
```

- [ ] **Step 2: Run to fail.** Run the api integration `src/dataset/contributions.integration.test.ts`. Expected: FAIL, `gone` is listed and `disputes` is present.

- [ ] **Step 3: Implement.**
  - Contracts: delete `disputes` and `withdrawn` from `contributionSummarySchema`.
  - `contributions.ts`:
    - import `liveSql`;
    - delete `withdrawnSql`;
    - `listRecordContributions`' `conditions` gains `liveSql(traitRecords.id)`;
    - `listAnnotationContributions`' `conditions` gains `liveSql(traitRecords.id), inArray(recordAnnotations.kind, ['confirm', 'resolve'])`;
    - in `contributionSummary`:
      - `mine` becomes `and(eq(traitRecords.createdBy, userId), eq(traitRecords.origin, 'manual'), liveSql(sql`${traitRecords.id}`)) as SQL`;
      - `annotations` takes only `'confirm'`, and its where gains `sql`exists (select 1 from trait_records ar where ar.id = ${recordAnnotations.recordId} and ${liveSql(sql`ar.id`)})``;
      - delete the `disputes` and `withdrawn` entries from the `Promise.all`, the destructuring and the returned object.
    - Leave whatever 13e left for `accepted` or `validated` untouched.
  - Web:
    - delete the `{ label: 'Disputes', … }` and `{ label: 'Withdrawn', … }` tiles in `WorkspacePage.tsx` and `ContributionsPage.tsx`;
    - delete `'Disputes1'` and `'Withdrawn1'` from `ContributionsPage.test.tsx`'s expected tile list;
    - delete `disputes` and `withdrawn` from both `ContributionSummary` fixtures in `dataset-fixtures.ts`;
    - in `StatTiles.test.tsx`, the tile label `'Disputes'` may stay: it is a free label.
  - E2E `apps/e2e/tests/contributions.spec.ts`. The contest no longer generates a dispute, and the seeded record keeps the contributor's validation:
    - in the block comment above the contest, replace the RFC-70 R3 dispute sentence with: "Since spec R-11 a contest writes nothing on the record it contests, so the contributor ends this step with one manual record (the contest) and one `confirm` annotation (the validation)";
    - delete `await tileShows('Disputes', '1');` and `await tileShows('Withdrawn', '0');`;
    - `await expect(annotationRows).toHaveCount(2);` becomes `toHaveCount(1)`;
    - delete the `generatedDispute` lines;
    - the reopened-record block asserts `await expect(reopened.getByText('You validated this record')).toBeVisible();` in place of `'disputed'`, with its comment rewritten: "A validation cannot be undone (spec R-6), so the drawer still says the contributor validated it."

    Check every string against `RecordActions.tsx`. 13e also edits this spec (the Accepted tile): when rebasing, keep both edits.

- [ ] **Step 4: Run to pass.** Run the api integration `src/dataset/contributions.integration.test.ts` and `src/http/routes/workspace/*.integration.test.ts` (whichever files cover `/api/me/contributions`), the contracts suite, the web suite and typecheck. Expected: PASS.
- [ ] **Step 5: Commit**

```sh
git add packages/contracts/src/contributions.ts apps/api/src apps/web/src apps/e2e/tests/contributions.spec.ts
git commit -m "feat: contributions skip withdrawn records and old disputes (RFC-71 R2-R4, spec R-11, R-13)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Docs, the full pipeline, the pull request

**Files:** `README.md`, `docs/gotchas/dataset.md` and `docs/specs/2026-09-25-record-model-revision-design.md` (status line only).

- [ ] **Step 1: README.**
  - In the Layout paragraph, replace `and on the record drawer, confirm / dispute / withdraw / set as accepted` (or whatever 13e left of it) with `and on the record drawer, validate / withdraw`.
  - Replace `and Neutral and Dispute stay behind `records.review`` with `and a withdrawal asks for confirmation only`.
  - Replace `and `/app/curation/disputed`` with `and `/app/curation/disputed` (the contested queue: Keep both, Withdraw contest, Withdraw level)`.
  - In the Commands paragraph, replace `(manual records, confirm/dispute/withdraw annotations,` with `(manual records, one per level; confirm/withdraw/resolve annotations; level validate and withdraw;`.
  - `manager` adds `records.review (work the harmonisation and contested queues)`. Also add `` `records.withdraw_imported` is admin only``.
- [ ] **Step 2: Gotcha.** Append to `docs/gotchas/dataset.md`:

  `- A withdrawal decrements `species_trait_coverage`, `species.trait_count`, the reference counters and `reference_traits` through the `record_annotations_withdraw_counters` trigger (`trait_records_uncount`). `record_annotations_withdraw_idx` allows one withdraw per record, so insert withdrawals with `onConflictDoNothing()` when a race is possible. `first_record_at`/`last_record_at` are not recomputed.`
- [ ] **Step 3: Rebase and re-check.**

```sh
git fetch origin && git rebase origin/main
ls apps/api/drizzle/*.sql | tail -3   # renumber 00NN if taken; rename .sql + snapshot, fix _journal idx/tag, re-chain prevId, copy upstream objects into the snapshot (memory)
grep -rn "sourceRefSchema\|DisputedRecord\|fetchDisputed\|countDisputed\|disputedNow\|value: { levelId" apps packages --include='*.ts' --include='*.tsx' | grep -v node_modules
```

Every hit of the last grep is a sibling's new call site on the old shape. Fix it.
- [ ] **Step 4: Full pipeline** (after **Sync**): `docker exec treerepro-13g sh -c 'cd /workspace && pnpm lint && pnpm typecheck && pnpm rfc:check && pnpm build && pnpm test'`, and `db:generate` in the container, which must print `No schema changes, nothing to migrate`. Copy `apps/web/src/routeTree.gen.ts` out after the build and diff it against the worktree.
- [ ] **Step 5: Commit, review, PR.**

```sh
git add README.md docs/gotchas/dataset.md docs/specs/2026-09-25-record-model-revision-design.md
git commit -m "docs: contest and withdrawal model (plan 13g)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Run CodeRabbit locally on the branch (`coderabbit:code-review`, one run). Then push with `git -c http.version=HTTP/1.1 push -u origin feat/revision-13g-contest-withdrawal` and open the PR `feat: contest and withdrawal model (plan 13g)`. Its body lists the spec rules covered, the migration, and the Spec notes below, and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Spec notes (ambiguities resolved to the minimal reading)

1. **RFC tags.** 13a is written in parallel, so its rule numbers for R-3 and R-6 to R-15 are unknown here. This plan cites the existing rules 13a amends (table in Task 1). Task 1 Step 1 swaps them for 13a's numbers if 13a created new rules.
2. **RFCs outside 13a's list.** RFC-33 (R-14), RFC-52 (health queues), RFC-60 (R-15) and RFC-74 (digest) are amended here in Task 1. RFC-30 (the permission) is amended in Task 2, because RFC-30 R3 makes it one change set with `PERMISSIONS` and the migration. The descriptions of `records.annotate` and `records.review` also change, because they named dispute and neutralise.
3. **A contest is never deduplicated.** R-7 would otherwise turn "contest blue with red" into a validation of an existing red record, leaving no contest (R-8: "a contest without one does not exist"). R-7 applies to complements and plain entries.
4. **Which record a match validates.** If one of the matching live records is the actor's own, the entry is a duplicate (R-7's "own" case). Otherwise the oldest match (lowest id) gets the validations. **Superseded — see Cross-review amendment 1.**
5. **Personal observation.** A matched entry sourced as a personal observation writes one `confirm` with no reference (R-7's "single confirm without a reference"). Supporting references are the entry's references minus the personal-observation one.
6. **Claim-key conflict.** An insert that hits `trait_records_claim_key` answers 409 `RECORD_DUPLICATE` at `value.levelIds.<i>`, and the whole request rolls back. After dedupe, this can only happen against a withdrawn or invisible record, or a contest repeating an existing claim.
7. **Old `dispute`/`neutral` rows** stay in `ANNOTATION_KINDS` so the record detail still parses its history. They are ignored by `reviewStatusSql`, so a record is `withdrawn`, `confirmed` or `unreviewed`. `REVIEW_STATUSES` keeps `disputed` (never produced now) to avoid web churn that plan 13h replaces anyway.
8. **A withdrawal answers `{ data: null }`**, because the record left the dataset and `GET /api/records/:id` is 404 for it. The drawer closes (`onGone`).
9. **Level validate** skips the actor's own records and records they already validated. It is 403 only when every record of the level is theirs, and 200 always otherwise (possibly an empty list). Level withdraw is 200 with the records actually withdrawn: possibly none, and never the ones the actor may not withdraw (R-12).
10. **Paths kept.** `GET /api/records/disputed` and `/app/curation/disputed` keep their paths, now serving the contested queue: renaming both would churn the meta-tests, the nav, the E2E suite and the help links for no behaviour. The nav label and page title become **Contested**, and `?intent=contest` is gone.
11. **`disputed` leaves the dashboard and health contracts**, and the digest's `disputedNow` becomes `contestedNow`. `contested` now counts open contests, the same rows as the queue. The old note explaining why the tile and the queue could differ no longer applies.
12. **R-14 scope.** R-14 is applied to record-level reads: lists, detail, the species summary, species record counts, the create path's matching and the unknown-levels filter. The dataset-wide counters (`species_trait_coverage`, `trait_count`, trait page distribution) stay viewer-blind aggregates. They answer "how complete is the dataset", which memory "plot restriction is about trait data" settles as open.
13. **Coverage dates.** `first_record_at`/`last_record_at` are not recomputed on withdrawal; only the counts decrement. A cell is deleted when its last record goes.
14. **Records sort.** `added` keeps the keyset cursor; `value`, `references` and `origin` page by offset through a composite cursor `[offset]`. The panel lists one species × trait, or one reference, so offsets stay small. A keyset over nullable, shared sort keys was not worth its size.
15. **`unresolved` and `unknownLevels` for non-reviewers** are ignored, not 403, just as `status` is for a restricted viewer (RFC-60 R6 precedent).
16. **`RECORD_NOT_WITHDRAWABLE`** is no longer thrown: an imported record without `records.withdraw_imported` is 403 `PERMISSION_DENIED`. The code stays in the catalog; retiring it is 13a's call.
17. **`record_references` counters.** The decrement mirrors 13f's `record_references_usage()` trigger exactly. That trigger counts each `record_references` row in `primary_count` and in `reference_traits`, apart from the 0027 DISTINCT-triple union.
18. **One withdraw per record** is a partial unique index. If production already held a duplicate withdraw (the API never wrote one), the migration fails loudly instead of double-decrementing.
19. **Contest counts.** `contestCount` counts distinct authors of non-withdrawn contests, resolved ones included. `contested` needs one that is also unresolved. This matches 13i's `n_contests`/`contested` export columns.
20. **Web scope.** `RecordActions` loses only Neutral, Dispute and the note. It does not hide Validate on the viewer's own record: the API answers 403 and the alert shows it, and plan 13h redesigns the buttons. The existing dialogs only switch to `{ levelIds: [id] }` and show the new `validated` answer.
21. **Record codes of a form (spec R-2 as amended by the owner).** The create path decides first which levels match (validation or duplicate) and which create. It then calls 13f's `nextRecordCodes(tx, created)` once, with the number of records actually created, and sets `record_code` explicitly. One created record gets the bare `TR_n`; several get `TR_na`, `TR_nb`, …. A level that became a validation or a duplicate consumes no code. A claim-key conflict rolls back the transaction, so the codes it drew leave a gap (gaps are accepted, R-2).
22. **Caches.** The trait page (10 min) and the dashboard entries may show a withdrawn record's count until their TTL, exactly as they do today after a new record.

## Self-review

- Spec coverage:
  - R-3 → Task 6;
  - R-6 → Tasks 5 and 7;
  - R-7 → Task 6;
  - R-8 and R-9 → Task 4 (derivation), Tasks 6 and 8;
  - R-10 → Tasks 5, 7, 8 and 9;
  - R-11 → Tasks 4, 5, 8 and 12;
  - R-12 → Tasks 2, 5 and 7;
  - R-13 → Tasks 2, 3, 8 and 12;
  - R-14 → Tasks 1 and 3;
  - R-15 → Tasks 1 and 10;
  - §2 sort → Task 11;
  - §6 rows 13g → Tasks 5 (annotations), 7 (level actions), 6 (create response), 4 (record item counts, trait summary levels), 10 (filters), 2 (permission) and 11 (sort).
- Names used across tasks:
  - `liveSql`, `harmonisedFor` and `recordVisible` (Task 3) are used in Tasks 4, 6, 7, 8, 10 and 12.
  - `openContestSql` (Task 4) is used in Tasks 8 and 10.
  - `mayWithdraw` (Task 5) is used in Task 7.
  - `resolveLevel`/`SingleValue` (Task 6) are used in Task 7's `levelRecords` only through `levelVisible`; no cross-use.
  - `recordCodeRefSchema` (Task 6) is used in Task 7.
  - `ContestedRecord`/`CONTESTED_RECORD` (Task 8) are used in Task 9.
  - `withdrawLevel` (web, Task 7) is used in Task 9.
- The web keeps compiling after every task: each contract change lists the fixtures and call sites it breaks, and each task ends on the web typecheck.
