# Revision 13a — RFC Amendments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`, local CLI).

**Goal:** Write every business rule of the record model revision (spec R-1…R-18, the species-page rules of §2 and the contractual names of §6) into the RFCs, so that plans 13b–13j each code against a numbered rule. Docs only: no code, no migration, no test changes.

**Architecture:** Each spec rule lands in the RFC that already owns its subject. A rule whose subject survives is amended in place and keeps its number. A rule whose subject disappears is retired in place (RFC-00 R3: `- **Rn** (retired) reason`), so every existing `@rfc` tag still resolves and `pnpm rfc:check` stays green while the tagged code waits for its plan. New subjects get the next free number in their RFC. Tables mirrored by tests (the RFC-30 permission catalog, the RFC-12 error codes, the RFC-41 actions) are **not** touched here: their rows change in the same commit as the code that mirrors them. The section "Rows owed by later plans" gives the exact rows. Every amended RFC goes to `draft` (RFC-00 R6), and the plan named in the "Status flips" table sets it back to `accepted`.

**Tech Stack:** Markdown under `docs/rfc/`. Verification: `tools/rfc-lint` (`pnpm rfc:check` and its Vitest suite), plus the three mirror tests that parse RFC files (`packages/contracts/src/permissions.test.ts`, `packages/contracts/src/error-codes.test.ts`, `apps/api/src/audit/actions.test.ts`). All of it runs in a Docker container: this Mac has no Node.

**Spec:** `docs/specs/2026-09-25-record-model-revision-design.md` (§1 R-1…R-18, §2, §5, §6).

**Depends on:** the spec branch `docs/record-model-revision` being merged into `main`, because the changelog lines cite the spec path. Every other plan of the revision (13b–13j) depends on this one.

## Global Constraints

- English everywhere. Changelog lines are dated `2026-09-25`. If the work lands on a later day, use that day.
- RFC-00 governs: rules are `- **Rn** text`, ids never change, a retired rule keeps its number as `- **Rn** (retired) reason`, and every amended RFC gets a changelog line and the status `draft`. RFC-70 and RFC-80 carry a YAML front matter `status:` instead of a header table. Edit that field.
- Do **not** edit the table in `docs/rfc/30-access/30-permission-catalog.md`, the table in `docs/rfc/10-platform/12-error-codes.md` or the Actions table in `docs/rfc/40-data-protection/41-audit-log.md`. Tests compare each of them with code, and the code changes only in plans 13d–13i.
- Do not edit `README.md`, the spec or any file outside `docs/rfc/`. The README handbook lines about the accepted value, disputes and `accepted.csv` change with the plans that change that behaviour.
- The texts below are exact. "Replace A with B" means one literal occurrence (each A was checked to appear exactly once in its file on 2026-09-25). "Replace the line starting `- **Rn**`" means the whole list item on that one line.
- Branch `docs/revision-13a-rules` from `origin/main` in a worktree. Before pushing, rebase on `origin/main`, never merge it in (epic #85 rule 1). Push with `git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push`.
- One commit per task. Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Sync block.** Every task's verify step runs these commands from the worktree root:

```bash
cd "/Users/elisabarreto/Library/CloudStorage/OneDrive-Personal/Documentos/Academia/PostDoc/TREE_CHANGE/TreeRepro-13a"
docker exec treerepro-13a sh -c 'cd /workspace && find . -name node_modules -prune -o -type f -exec rm -f {} +'
COPYFILE_DISABLE=1 tar -cf - --exclude='./node_modules' --exclude='*/node_modules' --exclude='./.git' \
    --exclude='./data' --exclude='./.claude' --exclude='*/dist' \
    --exclude='.DS_Store' --exclude='._*' --exclude='*/._*' . \
  | docker exec -i treerepro-13a tar -x -C /workspace
docker exec treerepro-13a pnpm rfc:check
```

  Expected last line: `rfc-lint: ok`.

## File Structure

```
docs/rfc/README.md                                   # index: 17 statuses → draft
docs/rfc/30-access/31-roles.md                       # R10
docs/rfc/30-access/33-data-visibility.md             # R2, R3, R4, R5
docs/rfc/50-admin/52-platform-health.md              # R1
docs/rfc/60-dataset/60-taxonomy-catalog.md           # R6
docs/rfc/60-dataset/61-bibliographic-references.md   # R1, R3, R4, R6, R9; R10 new
docs/rfc/60-dataset/62-trait-dictionary.md           # R7, R8
docs/rfc/60-dataset/63-trait-records.md              # Context, R1, R4–R10; R11–R16 new
docs/rfc/60-dataset/64-bulk-import.md                # R2, R6, R7, R8, R12
docs/rfc/60-dataset/65-curation.md                   # Context, R1, R3, R4, R10–R12; R2, R5, R6 retired; R13–R15 new
docs/rfc/60-dataset/66-dataset-export.md             # Context, R1–R7; R8 new (interim)
docs/rfc/60-dataset/69-coverage-summary.md           # R2, R5, R7
docs/rfc/70-workspace/70-contribution-workflow.md    # Context, R1–R4, R6, R7; R5 retired; R9–R11 new
docs/rfc/70-workspace/71-my-contributions.md         # Context, R2, R3, R4
docs/rfc/70-workspace/72-workspace-dashboard.md      # R1, R3
docs/rfc/70-workspace/73-help-and-onboarding.md      # R1, R3
docs/rfc/70-workspace/74-daily-digest.md             # Context, R3, R4
docs/rfc/80-integrations/80-doi-resolution.md        # R5
```

## Rule mapping (the contract for plans 13b–13j)

When another plan cites "the RFC rule mapped from R-n in plan 13a", this table is the answer. **Primary** is the rule a test names (`describe('RFC-NN Rn …')`) and the code tags. **Also** lists the rules whose text the same change touches. **Implemented by** is the plan that writes the test and code, and retags or removes what its rules replace.

| Spec | Primary | Also | Implemented by |
|---|---|---|---|
| R-1 no accepted value; "validated" | RFC-63 R11 (new) | RFC-63 R4, R6, R7, R10 (`validated`); RFC-65 R6 (retired), R11, R12; RFC-62 R7 (`validatedCount`), R8 (`validated`); RFC-69 R5, R7 (`validated`, `percentValidated`, `least_validated`); RFC-71 R2, R4 (`isAccepted`, `accepted` gone); RFC-72 R1 (`curation.coverage`); RFC-52 R1 (`validatedCells`); RFC-33 R3, R4; RFC-64 R12 (`accepted_values` out of the wipe); RFC-30 row `accepted.manage` (owed) | 13e |
| R-2 record ID | RFC-63 R12 (new) | RFC-63 R1; RFC-64 R2 (`ID` column), R6, R7 (`invalid_record_id`, `duplicate_record_id`), R8 | 13f |
| R-3 one level per record | RFC-70 R3 | RFC-65 R1 (`{ levelIds }`) | 13g |
| R-4 several references | RFC-63 R16 (new) | RFC-61 R3, R4, R9; RFC-70 R3; RFC-64 R12 (`record_references` in the wipe) | 13f |
| R-5 quantitative value | RFC-63 R15 (new) | RFC-63 R1, R5, R10 (`numeric: { min, max, mean, count }`); RFC-65 R1 (`{ quantitative }`); RFC-64 R6 | 13f |
| R-6 validate | RFC-65 R3 (`confirm`) | RFC-65 R13 (new, validate a level); RFC-70 R4 | 13g |
| R-7 duplicate means validation | RFC-70 R3 | RFC-65 R1 (answer), R2 (retired) | 13g |
| R-8 contest a level | RFC-70 R2 | RFC-63 R14 (new) | 13g |
| R-9 contested | RFC-63 R14 (new) | RFC-63 R6, R8, R10 | 13g |
| R-10 resolve | RFC-65 R15 (new) | RFC-65 R14 (new, withdraw a level), R10 (contested queue) | 13g |
| R-11 no neutral, no dispute | RFC-65 R3 | RFC-65 R5 (retired); RFC-63 R6, R7; RFC-70 R4, R5 (retired); RFC-74 R3, R4 | 13g |
| R-12 withdrawal rights, no note | RFC-65 R4 | RFC-31 R10; RFC-70 R4; RFC-30 row `records.withdraw_imported` (owed) | 13g |
| R-13 withdrawn leaves the dataset | RFC-63 R13 (new) | RFC-33 R2, R3; RFC-69 R2; RFC-61 R4, R9; RFC-71 R2, R3, R4; RFC-62 R7 | 13g |
| R-14 reviewer-only data | RFC-33 R2 | RFC-60 R6 (`unresolvedTaxon`) | 13g |
| R-15 species filters | RFC-60 R6 | — | 13g (API), 13h (UI) |
| R-16 book references | RFC-61 R10 (new) | RFC-61 R1, R4, R6; RFC-70 R1, R2; RFC-80 R5; RFC-12 row `REFERENCE_ISBN_TAKEN` (owed) | 13d |
| R-17 full export | RFC-66 R1–R7 | RFC-66 R8 (new, interim `records.csv`); RFC-33 R3 | 13i (R8: written by 13e, retired by 13i) |
| R-18 home page | RFC-72 R3 | RFC-72 R1 (`dataset.primaryReferenceCount`, `secondaryReferenceCount`, `contributor.topTraitsWithData`); RFC-73 R3 (Getting started opening sentence) | 13b |
| §2 legend, 👍 👎 ＋ per level / per row | RFC-70 R9 (new) | RFC-65 R13 | 13h |
| §2 entry dialog | RFC-70 R10 (new) | RFC-70 R1, R3 | 13h |
| §2 record panel | RFC-70 R11 (new) | RFC-63 R8, R9 (`sort`) | 13h (UI), 13g (`sort`) |
| §2 larger `?` tip | none: styling only, RFC-13 R11 unchanged | — | 13c |
| 13j help pages | RFC-73 R1 | RFC-73 R5 | 13j |

§6 names → rules:

| §6 name | Rule |
|---|---|
| `trait_records.record_code`, `record_code_tr_seq` | RFC-63 R12 |
| `min_value`, `max_value`, `mean_value`, `sd_value`, `n` | RFC-63 R15 (columns listed in R1) |
| `record_references` | RFC-63 R16 |
| contracts `quantitativeValueSchema`; manual record value `{ levelIds } \| { quantitative }` | RFC-65 R1, RFC-63 R15 |
| trait summary `numeric: { min, max, mean, count } \| null` | RFC-63 R10 |
| record item `recordCode`, `quantitative`, `references` | RFC-63 R8 |
| record item `validationCount`, `contestCount`, `contested` | RFC-63 R8 |
| trait summary levels `[{ levelId, key, count, validationCount, contested }]`, trait `contested` | RFC-63 R10 |
| `bibliographic_references.isbn`, kind `book` | RFC-61 R1, R10 |
| source input `{ personalObservation: true } \| Array<{ id } \| { doi } \| { isbn, citation }>` | RFC-70 R1 |
| `isValidIsbn(input): string \| null` | RFC-61 R10 |
| `validated` / `validatedCount` / `percentValidated`, `/top?mode=missing\|least_validated` | RFC-63 R10, RFC-62 R7, R8, RFC-69 R5, R7 |
| `GET /api/export/records.csv` (interim) | RFC-66 R8 |
| `GET /api/export/dataset.zip` | RFC-66 R1–R7 |
| `POST /api/records/:id/annotations` bodies | RFC-65 R3 |
| `POST …/levels/:levelId/validate` | RFC-65 R13 |
| `POST …/levels/:levelId/withdraw` | RFC-65 R14 |
| create response `{ created, validated, duplicates }` | RFC-70 R3 |
| species filters `contested`, `unknownLevels`, `unresolved` | RFC-60 R6 |
| permission `records.withdraw_imported` | RFC-65 R4, RFC-31 R10 (catalog row owed by 13g) |
| records list `sort`, `order` | RFC-63 R9 |
| dashboard `primaryReferenceCount`, `secondaryReferenceCount`, `topTraitsWithData` | RFC-72 R1 |

### New rule numbers (next free per RFC)

| RFC | Before | New numbers |
|---|---|---|
| RFC-61 | R1–R9 | R10 |
| RFC-63 | R1–R10 | R11, R12, R13, R14, R15, R16 |
| RFC-65 | R1–R12 | R13, R14, R15 |
| RFC-66 | R1–R7 | R8 (interim) |
| RFC-70 | R1–R8 | R9, R10, R11 |

### Retired rules and the code that still carries their tags

Retired rules keep their ids, so the tags below keep passing `rfc:check`. The named plan removes the code or retags it to the replacing rule. When that plan merges, no tag in `apps/*/src` or `packages/*/src` may cite a retired rule.

| Retired rule | Replaced by | Tagged code on 2026-09-25 | Removed or retagged by |
|---|---|---|---|
| RFC-65 R2 | RFC-70 R3 | `apps/api/src/http/routes/dataset/records.ts` (`@rfc RFC-65 R1, R2, R3, R4`) | 13g |
| RFC-65 R5 | RFC-63 R14 | none | 13g |
| RFC-65 R6 | RFC-63 R11 | `apps/api/src/dataset/curation.ts`, `apps/api/src/http/routes/dataset/species.ts`, `apps/web/src/api/curation.ts`, `components/curation/AcceptedSection.tsx`, `RecordActions.tsx`, `components/dataset/RecordDrawer.tsx`, `RecordTable.tsx`, `TraitPanel.tsx`, `lib/use-record-write.ts`, `pages/dataset/SpeciesPage.tsx`, `packages/contracts/src/curation.ts` | 13e |
| RFC-70 R5 | RFC-63 R14, RFC-65 R4 | `apps/api/src/dataset/curation.ts` (`RFC-70 R4, R5`; `RFC-70 R5`), `apps/api/src/http/routes/dataset/records.ts` (`RFC-70 R1-R6`) | 13g |
| RFC-66 R8 (created now, interim) | RFC-66 R1–R7 | tagged by 13e | retired by 13i: `- **R8** (retired) The interim single-file export is replaced by `dataset.zip` (R1–R7).` |

### Rows owed by later plans (mirror-tested tables 13a must not touch)

| Table | Row change | Plan |
|---|---|---|
| RFC-30 catalog | `accepted.manage` → description `Set and clear the accepted value per species and trait (retired)`. The key stays (RFC-30 R1). Its `role_permissions` rows are deleted. | 13e |
| RFC-30 catalog | `dataset.export` → `Download the dataset` | 13e |
| RFC-30 catalog | new row `records.withdraw_imported` \| `Withdraw any imported record`, directly after `records.withdraw` | 13g |
| RFC-30 catalog | `records.annotate` → `Validate records and withdraw one's own` | 13g |
| RFC-30 catalog | `records.review` → `Work the harmonisation and contested queues; resolve contests; see pending records and unresolved taxa` | 13g |
| RFC-12 codes | `RECORD_IS_ACCEPTED`, `RECORD_NOT_HARMONISED` → description suffixed `(retired)` | 13e |
| RFC-12 codes | `RECORD_DUPLICATE`, `RECORD_NOT_WITHDRAWABLE`, `RECORD_WITHDRAWN` → description suffixed `(retired)`. A withdrawn record is invisible (404), and a refused withdrawal is 403. | 13g |
| RFC-12 codes | new `REFERENCE_ISBN_TAKEN` \| 409 \| `Another reference has this ISBN (RFC-61 R6, R10).` | 13d |
| RFC-41 actions | `dataset.exported` → description `Dataset downloaded as a file (RFC-66 R6, R8).` (key unchanged) | 13e |

### Status flips (who sets each RFC back to `accepted`)

Once the last plan touching an RFC has merged, that RFC is back to `accepted`. The flipping plan also edits the RFC's row in `docs/rfc/README.md`.

| RFC | Flipped by |
|---|---|
| RFC-31, RFC-52, RFC-60, RFC-61, RFC-63, RFC-65, RFC-69, RFC-71, RFC-72, RFC-74 | 13g |
| RFC-62 | 13e |
| RFC-64 | whichever of 13e and 13f merges second |
| RFC-80 | 13d |
| RFC-70 | 13h |
| RFC-33, RFC-66 | 13i |
| RFC-73 | 13j |

---

### Task 0: Claim, worktree, container

**Files:** none.

**Interfaces:** Consumes the spec; produces the issue number `N` used in the PR.

- [ ] **Step 1: Open and claim the issue** (README rule 7)

```bash
cd "/Users/elisabarreto/Library/CloudStorage/OneDrive-Personal/Documentos/Academia/PostDoc/TREE_CHANGE/TreeRepro"
N=$(gh issue create --title "Plan 13a — RFC amendments for the record model revision" \
  --label plan --label docs --label in-progress --assignee @me \
  --body "Writes R-1…R-18 of docs/specs/2026-09-25-record-model-revision-design.md into the RFCs. Plan: docs/plans/2026-09-25-revision-13a-rules.md. Docs only." | sed 's#.*/##')
echo "$N"
```

Expected: a number is printed.

- [ ] **Step 2: Worktree**

```bash
git fetch origin
git worktree add ../TreeRepro-13a -b docs/revision-13a-rules origin/main
test -f ../TreeRepro-13a/docs/specs/2026-09-25-record-model-revision-design.md && echo spec-present
```

Expected: `spec-present`. If it is missing, the spec branch has not merged yet. Stop and wait for it.

- [ ] **Step 3: Container**

```bash
docker image inspect treerepro-verify:base >/dev/null 2>&1 || {
  docker run -d --name treerepro-verify -w /workspace -v /var/run/docker.sock:/var/run/docker.sock \
    -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal -e TESTCONTAINERS_RYUK_DISABLED=true \
    node:24.21.0-alpine sleep infinity
  docker exec treerepro-verify sh -c "corepack enable && corepack prepare pnpm@12.4.1 --activate"
  docker commit treerepro-verify treerepro-verify:base
  docker rm -f treerepro-verify
}
docker run -d --name treerepro-13a -w /workspace -v /var/run/docker.sock:/var/run/docker.sock \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal -e TESTCONTAINERS_RYUK_DISABLED=true \
  treerepro-verify:base sleep infinity
```

Then run the Sync block, followed by:

```bash
docker exec treerepro-13a sh -c "corepack enable && pnpm install --frozen-lockfile"
docker exec treerepro-13a pnpm rfc:check
docker exec treerepro-13a find /workspace -name '._*' -not -path '*/node_modules/*'
```

Expected: `rfc-lint: ok` (the baseline) and no `._*` path.

---

### Task 1: RFC-63 — the record (R-1, R-2, R-4, R-5, R-9, R-11, R-13)

**Files:** Modify `docs/rfc/60-dataset/63-trait-records.md` (header line 5, Context line 11, rules lines 15–24, changelog end).

**Interfaces:** Produces RFC-63 R11 (no accepted value / validated), R12 (record ID), R13 (withdrawn leaves the dataset), R14 (contested), R15 (quantitative value), R16 (several references). It also amends R1, R4–R10.

- [ ] **Step 1: Failing check**

```bash
cd "/Users/elisabarreto/Library/CloudStorage/OneDrive-Personal/Documentos/Academia/PostDoc/TREE_CHANGE/TreeRepro-13a"
grep -c '^- \*\*R1[1-6]\*\*' docs/rfc/60-dataset/63-trait-records.md
```

Expected: `0`.

- [ ] **Step 2: Header and Context.** Replace `| Status | accepted |` with `| Status | draft |`. Replace `Records are therefore insert-only; a correction is a new record plus a dispute of the old one (RFC-65), never an edit.` with:

```markdown
Records are therefore insert-only; a correction is a new record contesting the old one (R14), never an edit. The platform stores every claim and never picks one (R11).
```

- [ ] **Step 3: Replace the line starting `- **R1**`** with:

```markdown
- **R1** A trait record has `record_code`, `intent`, `responds_to_record_id`, `species_id`, `trait_id`, `level_id`, `numeric_value`, `min_value`, `max_value`, `mean_value`, `sd_value`, `n`, `value_text`, `harmonisation`, `raw_value`, `original_trait_name`, `original_species_name`, `secondary_source_species_name`, `raw_category`, `primary_reference_id`, `secondary_reference_id`, `origin`, `import_batch_id`, `import_row_no`, `created_by`, `note`, `supersedes_record_id`, `created_at`. `record_code` is R12; `numeric_value` is the *single* value and `min_value` … `n` are R15; a manual record's further references are rows of `record_references` (R16).
```

- [ ] **Step 4: R4 and R5.** In R4, replace `never succeed on `trait_records`, `record_annotations` and `accepted_values`:` with `never succeed on `trait_records` and `record_annotations`:`. In R5, replace `or quantitative with a `numeric_value`)` with `or quantitative with at least one of `numeric_value`, `min_value`, `max_value` and `mean_value`, R15)`.

- [ ] **Step 5: Replace the lines starting `- **R6**`, `- **R7**` and `- **R8**`** with:

```markdown
- **R6** Review state, derived when a record is read, one of: `contested` when the record, or the level it carries, is contested (R14); else `validated` when the record has at least one `confirm` annotation (RFC-65 R3); else `unvalidated`. A record with a `withdraw` annotation has left the dataset (R13) and has no review state for any viewer.
- **R7** A record has many `record_annotations` (with `reference_id` and `generated`), written by RFC-65 and read here. The kinds in use are `confirm` (a validation, RFC-65 R3), `withdraw` (RFC-65 R4) and `resolve` (RFC-65 R15). `dispute` and `neutral` rows written before plan 13g stay in the table and every rule ignores them.
- **R8** `GET /api/records/:id` The item exposes `recordCode`, `intent`, `respondsTo`, `quantitative: { single, min, max, mean, sd, n } | null` (R15; null for a categorical record), `references: [reference ref…]` (the primary reference first, then the `record_references` rows of R16), `validationCount` (distinct actors with a `confirm` on the record), `contestCount` (distinct authors of the contests that are not withdrawn and contest the record's level, or the record itself for a quantitative trait, R14) and `contested: boolean` (R14). The detail exposes `responses`. An annotation exposes `reference`, `generated`.
```

- [ ] **Step 6: R9.** Replace `Order `id` descending; keyset cursor on `id`.` with:

```markdown
`sort` is `value`, `references`, `origin` or `added` and `order` is `asc` or `desc` (default `added desc`; any other value answers 400 `VALIDATION_FAILED` with path `sort` or `order`): `added` orders by `id`, `value` by the level key (categorical) or by `coalesce(numeric_value, mean_value, min_value, max_value)` (quantitative), `references` by the primary reference's `short_citation` then `citation_key`, `origin` by `origin`, each with `id` as the tiebreaker, under the composite keyset cursor `[sort key, id]` (RFC-11 R6). Only visible records are listed (RFC-33 R2).
```

- [ ] **Step 7: Replace the line starting `- **R10**`** with:

```markdown
- **R10** `GET /api/species/:id/traits` supports `includeMissing`. It answers `[{ category: { key, label }, traits: [{ trait, recordCount, harmonisationCounts: { harmonised, unknownLevel, multiValue, notNumeric, empty }, levels: [{ levelId, key, count, validationCount, contested }] | null, numeric: { min, max, mean, count } | null, validated: boolean, contested: boolean }] }]` over the visible records (RFC-33 R2) — categories in dictionary order, traits by key, only traits with at least one visible record. `levels` is set for categorical traits: every level among the harmonised records, with no cap, `count` descending then key; `validationCount` counts the distinct actors who validated at least one record of the level, and `contested` follows R14. `numeric` is set for quantitative traits, over the harmonised records (null when there are none): `min` is the smallest of every single, min, max and mean value, `max` the largest, `mean` the mean over the records of the single value — or of the mean value for a record without a single value — (null when no record has either), and `count` the number of records. `validated` follows R11; `contested` is true when a level or record of the trait is contested (R14). Unknown species answers 404 `SPECIES_NOT_FOUND`.
```

- [ ] **Step 8: Append after the R10 line** (before the blank line and `## Open questions`):

```markdown
- **R11** No accepted value. The platform stores every claim and never picks one. There is no accepted value, no route that sets one and no permission that decides one (`accepted_values` and `accepted.manage` are removed by plan 13e; RFC-65 R6 is retired). A species × trait is *validated* when at least one of its visible records (RFC-33 R2) has a `confirm` annotation (RFC-65 R3). Every count that counted accepted pairs counts validated pairs instead (RFC-62 R7, RFC-69 R5, R7, RFC-72 R1, RFC-52 R1).
- **R12** Record ID. `record_code` is `text not null unique`. An imported record takes the file's `ID` column (RFC-64 R2, R7). When a row is split into several records (RFC-64 R6), each part gets the ID plus a letter suffix in part order (`EB_1a`, `EB_1b`, …; after `z`, `aa`, `ab`, …). A record created on the platform (RFC-65 R1, R9, RFC-70 R3) takes `'TR_' || nextval('record_code_tr_seq')`; a form that creates several levels takes one sequence number and suffixes it the same way (`TR_7a`, `TR_7b`, …). A single-level entry keeps the bare code. Stored codes match `^(EB|TR)_[0-9]+([a-z]+)?$`. Gaps in the `TR_` sequence are accepted. A code never changes and is never reused (R4).
- **R13** A withdrawn record leaves the dataset. A record with a `withdraw` annotation (RFC-65 R4) is visible to no viewer (RFC-33 R2): it disappears from lists, counts, trait cards, coverage, filters, queues, contributions and the export, and no strikethrough stays behind. It stays in `trait_records` for audit only. The stored counters — `species_trait_coverage` and `species.trait_count` (RFC-69 R2), a reference's `primary_count` and `secondary_count` (RFC-61 R4) and `reference_traits.record_count` (RFC-61 R9) — decrement in the transaction that inserts the `withdraw` annotation, so each counts the records that are not withdrawn.
- **R14** Contested. A contest is a record with `intent = 'contest'` (RFC-70 R2). For a categorical trait it contests the *level* of the record it responds to: every visible record of that species, trait and level. Contesting `blue` among {`red`, `blue`, `orange`} touches only `blue`. For a quantitative trait it contests the one record it responds to. A contest is *standing* while it is not withdrawn, carries no `resolve` annotation (RFC-65 R15) and what it contests still has a visible record. A level, or a quantitative record, is *contested* while a standing contest contests it. A species × trait is contested when one of its levels or records is. Contested is the only status the platform shows, and every viewer sees it. It is derived from contest records alone, never from `dispute` annotations.
- **R15** Quantitative value. `numeric_value` is the *single* value. `min_value`, `max_value`, `mean_value` and `sd_value` are nullable `numeric`, and `n` is a nullable `integer`. Database checks enforce `min_value <= max_value` when both are present, `sd_value >= 0` and `n >= 1`. A manual quantitative record has at least one of single, min, max and mean (RFC-65 R1). The import fills only the single value (RFC-64 R6). The `value_text` of a quantitative record is the single value as PostgreSQL prints `numeric` when it is the only field present. Otherwise it lists the present fields as `<name>=<value>`, joined by `;` in the order `single`, `min`, `max`, `mean`, `sd`, `n` (`min=2;max=5;n=12`), so two records that differ in any field never collide under R3.
- **R16** Several references. A manual record's first reference is `primary_reference_id`. Its further references are rows of `record_references(record_id uuid references trait_records, reference_id uuid references bibliographic_references, primary key (record_id, reference_id))`, written in the record's transaction and never changed. Imported records have no `record_references` rows. Screens and the export list a record's references primary first, joined by `; `. A `record_references` row counts as a primary usage of its reference (RFC-61 R4, R9).
```

- [ ] **Step 9: Changelog.** Append as the last line of the file:

```markdown
- 2026-09-25 — Context, R1, R4–R10 amended; R11–R16 added: no accepted value, record ID, withdrawn records leave the dataset, contested levels, quantitative value, several references (record model revision, `docs/specs/2026-09-25-record-model-revision-design.md` R-1, R-2, R-4, R-5, R-8, R-9, R-11, R-13; plan 13a). `draft` until plan 13g.
```

- [ ] **Step 10: Check passes.** `grep -c '^- \*\*R1[1-6]\*\*' docs/rfc/60-dataset/63-trait-records.md` → `6`. `grep -c 'accepted_values' docs/rfc/60-dataset/63-trait-records.md` → `1` (the R11 sentence). Run the Sync block → `rfc-lint: ok`.

- [ ] **Step 11: Commit**

```bash
git add docs/rfc/60-dataset/63-trait-records.md
git commit -m "docs(rfc-63): record ID, quantitative value, several references, contested, withdrawal; no accepted value (plan 13a)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: RFC-65 — curation (R-1, R-3, R-5, R-6, R-7, R-10, R-11, R-12)

**Files:** Modify `docs/rfc/60-dataset/65-curation.md` (header line 5, Context line 11, rules lines 15–26, changelog end).

**Interfaces:** Consumes RFC-63 R11–R16. Produces RFC-65 R13 (validate a level), R14 (withdraw a level) and R15 (resolve). Amends R1, R3, R4, R10, R11 and R12, and retires R2, R5 and R6.

- [ ] **Step 1: Failing check.** `grep -c '^- \*\*R1[3-5]\*\*\|(retired)' docs/rfc/60-dataset/65-curation.md` → `0`.

- [ ] **Step 2: Header and Context.** Replace `| Status | accepted |` with `| Status | draft |`. Replace the whole Context paragraph (line 11, starting `Specialist scientists add trait values`) with:

```markdown
Specialist scientists add trait values with their bibliographic references, validate and contest existing claims, and harmonise the rows the import could not. The platform never picks a value among the claims (RFC-63 R11). Records stay immutable (RFC-63 R4): every step here is an insert into `trait_records`, `record_annotations` or `record_references`, and each row carries its actor and time. No free text enters a value: a manual value is an active level of the trait or numbers in the trait's unit, and the source's wording is kept apart as `raw_value`.
```

- [ ] **Step 3: Replace the lines starting `- **R1**` through `- **R6**`** (six lines) with:

```markdown
- **R1** `POST /api/records` takes the body and source resolution of RFC-70 R1–R3; the value checks below still apply. `value` is `{ levelIds }` (1–20 distinct level ids) for a categorical trait, or `{ quantitative: { single?, min?, max?, mean?, sd?, n? } }` for a quantitative one: at least one of single, min, max and mean; `min ≤ max`; `sd ≥ 0`; `n` an integer ≥ 1 (RFC-63 R15). `rawValue` and `note` are 1–2,000 characters, trimmed. Checks, in order: species (404 `SPECIES_NOT_FOUND`); trait (404 `TRAIT_NOT_FOUND`; inactive → 400 `VALIDATION_FAILED`, path `traitId`); the shape of `value` against `value_type` (400, path `value`); each level belonging to the trait and active (400, path `value.levelIds.<i>`); each number per RFC-64 R6 and the comparisons of RFC-63 R15 (400, path `value.quantitative.<field>`); then the sources per RFC-70 R2 (404 `REFERENCE_NOT_FOUND` or 409 `REFERENCE_IS_PERSONAL`, the detail path naming `sources.<i>`, RFC-61 R7). Each record is stored with `origin = 'manual'`, `harmonisation = 'harmonised'`, `created_by` = the actor, `level_id` or the quantitative columns, `record_code` from its default (RFC-63 R12), and `value_text` = the level key or the text of RFC-63 R15, a number printed as PostgreSQL prints `numeric` (`1e3` is stored as `1000`). Answers 201 with `{ created, validated, duplicates }` per RFC-70 R3.
- **R2** (retired) An entry that matches an existing record is no longer an error: it becomes a validation or a reported duplicate (RFC-70 R3), and `RECORD_DUPLICATE` is no longer answered. Plan 13g retags or removes the code tagged with this rule.
- **R3** `POST /api/records/:id/annotations` appends one of `{ kind: 'confirm', referenceSource? }`, `{ kind: 'withdraw' }` or `{ kind: 'resolve' }`. There is no `note`. `neutral` and `dispute` answer 400 `VALIDATION_FAILED` with path `kind`. `confirm` is a validation. `referenceSource` is an optional supporting reference — one source entry of RFC-70 R1 (`{ id }`, `{ doi }` or `{ isbn, citation }`) — resolved per RFC-80 R5 or RFC-61 R10 and stored in `reference_id`. The record's author cannot validate it (403 `PERMISSION_DENIED`). A `confirm` the actor has already given on the record, with the same reference or with none, inserts nothing and gets the same answer as the first. An actor counts once per record however many references they give (RFC-63 R8). A validation is never undone. `withdraw` is R4 and `resolve` is R15. The permission split is RFC-70 R4. An unknown or invisible record answers 404 `RECORD_NOT_FOUND`. A withdrawn record is invisible (RFC-63 R13), so it answers 404 too. `confirm` and `resolve` answer 201 with the record detail; `withdraw` answers 200 `{ data: null }`.
- **R4** Withdrawal carries no note: the web app asks only for a confirmation (RFC-70 R9). A record's `created_by` may withdraw their own records. A holder of `records.withdraw` may withdraw any record with `origin = 'manual'`, and a holder of `records.withdraw_imported` any record with `origin = 'import'`. Anyone else answers 403 `PERMISSION_DENIED`. The withdrawn record leaves the dataset (RFC-63 R13), and withdrawing a contest ends it (RFC-63 R14).
- **R5** (retired) Disputes are removed (RFC-63 R7). A record's standing is its contested flag (RFC-63 R14), which no actor sets by hand. Plan 13g removes the code tagged with this rule.
- **R6** (retired) There is no accepted value (RFC-63 R11). `GET` and `PUT /api/species/:id/traits/:traitId/accepted` go away with `accepted_values` and `accepted.manage`. Plan 13e removes the code tagged with this rule.
```

- [ ] **Step 4: Replace the lines starting `- **R10**` and `- **R11**`** with:

```markdown
- **R10** `GET /api/records/disputed?cursor=&limit=` (`records.review`) lists the standing contests (RFC-63 R14), newest first, with a keyset cursor on the contest record's `id`. Item: the contest's record item (RFC-63 R8) plus `contested: <record item>`, the record it responds to. For a categorical trait the contest applies to that record's whole level. From an item, a reviewer resolves the contest per R15.
- **R11** Representations. The record detail (RFC-63 R8) adds `supersedes: { id } | null` and `supersededBy: [{ id }]`. Map result: `{ created, skipped }`. Pending trait and pending group: as in R8. Nullable fields are `null`, never omitted. The record detail answered to a creator (R1) or annotator (R3) carries user names (RFC-63 R8); `records.create` and `records.annotate` are expected to be granted together with `dataset.read`.
```

- [ ] **Step 5: R12.** Replace `Record, annotation and accepted-value writes emit` with `Record and annotation writes emit`.

- [ ] **Step 6: Append after the R12 line:**

```markdown
- **R13** Validate a level. `POST /api/species/:id/traits/:traitId/levels/:levelId/validate` (`records.annotate`) takes `{ referenceSource? }` as in R3. In one transaction it writes a `confirm` on every visible record of that species, trait and level that the actor did not create and has not yet validated. An unknown or invisible species or trait answers 404 `SPECIES_NOT_FOUND` or `TRAIT_NOT_FOUND`. A level that is not the trait's answers 400 `VALIDATION_FAILED` with path `levelId`. A level with no visible record for the species answers 404 `RECORD_NOT_FOUND`. A level whose visible records are all the actor's own answers 403 `PERMISSION_DENIED`. Answers 201 `{ validated: [{ recordId, recordCode }] }`, which is empty when the actor had already validated every record.
- **R14** Withdraw a level. `POST /api/species/:id/traits/:traitId/levels/:levelId/withdraw` (`records.review`) writes, in one transaction, a `withdraw` annotation on every visible record of that species, trait and level that the actor may withdraw (R4), and on no other record. The errors are those of R13, without the 403. Answers 201 `{ withdrawn: [{ recordId, recordCode }] }`. Records the actor may not withdraw stay in the dataset.
- **R15** Resolve. A holder of `records.review` resolves a standing contest (RFC-63 R14) in one of two ways: by withdrawing one side — the contest record (R4) or the contested level (R14) — or by **Keep both**, a `resolve` annotation on the contest record (R3). A `resolve` on a record that is not a contest answers 400 `VALIDATION_FAILED` with path `kind`. On a contest that is already resolved it inserts nothing and gets the same answer as the first. Either way the contested flag clears. A resolution is never undone.
```

- [ ] **Step 7: Changelog.** Append as the last line:

```markdown
- 2026-09-25 — Context, R1, R3, R4, R10–R12 amended; R2, R5, R6 retired; R13–R15 added: validation without undo, no note, no neutral or dispute, withdrawal rights, the contested queue, level actions, Keep both (record model revision R-1, R-3, R-5–R-7, R-10–R-12; plan 13a). `draft` until plan 13g.
```

- [ ] **Step 8: Check passes.** `grep -c '^- \*\*R1[3-5]\*\*' docs/rfc/60-dataset/65-curation.md` → `3`. `grep -c '(retired)' docs/rfc/60-dataset/65-curation.md` → `3`. `grep -c 'accepted' docs/rfc/60-dataset/65-curation.md` → `1` (the retired R6 line). Run the Sync block → `rfc-lint: ok`.

- [ ] **Step 9: Commit**

```bash
git add docs/rfc/60-dataset/65-curation.md
git commit -m "docs(rfc-65): validate and resolve, withdrawal rights, level actions; retire duplicates, disputes and the accepted value (plan 13a)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: RFC-70 — contribution workflow and the species page (R-3, R-4, R-7, R-8, R-11, R-16, §2)

**Files:** Modify `docs/rfc/70-workspace/70-contribution-workflow.md` (front matter line 2, Context line 9, rules lines 12–19, then add sections).

**Interfaces:** Consumes RFC-63 R8, R14–R16 and RFC-65 R1, R3, R4, R13. Produces RFC-70 R9 (species page buttons), R10 (entry dialog) and R11 (record panel). Amends R1–R4, R6 and R7, and retires R5.

- [ ] **Step 1: Failing check.** `grep -c '^- \*\*R9\*\*\|^- \*\*R1[01]\*\*\|^## Changelog' docs/rfc/70-workspace/70-contribution-workflow.md` → `0`.

- [ ] **Step 2: Front matter and Context.** Replace `status: accepted` with `status: draft`. Replace the Context paragraph (the line starting `When an expert contributes a claim`) with:

```markdown
When an expert contributes a claim (a value for a trait of a species), they provide references (DOIs, books by ISBN, or a personal observation) and say how the claim relates to existing data: independent, complementary or contesting. The system creates one record per level from these sources. An entry that repeats an existing record becomes a validation of it instead. A contest marks the contested level until a reviewer resolves it.
```

- [ ] **Step 3: Replace the lines starting `- **R1**` through `- **R7**`** (seven lines; keep R8 as it is) with:

```markdown
- **R1** `POST /api/records` (`records.create`) body: `{ speciesId, traitId, value, sources, intent?, respondsToRecordId?, rawValue?, note?, secondaryReferenceId? }`. `sources` is `{ personalObservation: true }` or an array of 1–10 entries, each `{ id }`, `{ doi }` or `{ isbn, citation }` (RFC-61 R10), distinct after normalisation. `value` is RFC-65 R1. `intent` and `respondsToRecordId` come together or not at all (400 `VALIDATION_FAILED`, path `intent`). Visibility (RFC-33 R5) applies to the species, the trait and the responded record.
- **R2** Resolution: first the species, trait, value and level checks of RFC-65 R1. Then `responds_to`: the record must exist and be visible (404 `RECORD_NOT_FOUND`; a withdrawn record is not visible, RFC-63 R13) and belong to the species and trait (400, path `respondsToRecordId`). A `contest` (RFC-63 R14) always carries a value: every level of `value.levelIds` must differ from the responded record's level, and a quantitative value must differ from the responded record's in at least one of the six fields (400 `VALIDATION_FAILED`, path `value`, "A contest carries a different value"). A complement may repeat the value under another reference. Then the sources resolve to reference ids: RFC-80 R5 for a DOI, RFC-61 R10 for an ISBN, and RFC-61 R7 for a personal observation. A reference named by `id` must not be a personal observation: naming one answers 409 `REFERENCE_IS_PERSONAL` (RFC-61 R7).
- **R3** Insert, in one transaction. A form creates one record per level (categorical) or one record (quantitative). Every record carries all the resolved references — the first as `primary_reference_id`, the rest as `record_references` rows (RFC-63 R16) — and otherwise identical columns (`origin = 'manual'`, `harmonisation = 'harmonised'`, `created_by = actor`, `intent`, `responds_to_record_id`, `raw_value`, `note`, `secondary_reference_id`). Before inserting, each entry — a level, or the quantitative value — is matched against the visible records of the species and trait. A categorical entry matches the records of the same level; a quantitative one matches a record whose six fields are all identical. A matched entry creates no record. Each matching record the actor did not create gets the actor's references as validations — one `confirm` per reference, or a single `confirm` without a reference for a personal observation (RFC-65 R3) — and is reported in `validated`. A matching record that is the actor's own is only reported in `duplicates`. In a form that mixes new and matching levels, the new levels create records and the matching ones become validations. An insert that still collides with `trait_records_claim_key` (RFC-63 R3) is reported in `duplicates` too. Answer 201 `{ created: [record item…], validated: [{ recordId, recordCode }], duplicates: [{ recordId, recordCode }] }` for any mix. No request answers 409 `RECORD_DUPLICATE` (RFC-65 R2, retired).
- **R4** `POST /api/records/:id/annotations` (RFC-65 R3): `confirm` and `withdraw` need `records.annotate`; `resolve` needs `records.review` as well (403 `PERMISSION_DENIED`). Which record an actor may withdraw is RFC-65 R4: the handler passes the actor's `records.withdraw` and `records.withdraw_imported` to the service, as it passes `canWithdrawAny` today. The annotation representation carries `reference: { id, citationKey, kind } | null` and `generated: boolean` (RFC-63 R8).
- **R5** (retired) Withdrawing a contest no longer writes a `neutral` annotation: the contested flag is derived from standing contests (RFC-63 R14), so withdrawing the contest clears it by itself. Plan 13g removes the code tagged with this rule.
- **R6** Representations (RFC-63 R8): the record item carries `intent: 'contest' | 'complement' | null` and `respondsTo: { id } | null`; the detail adds `responses: [{ id, intent, createdBy, createdAt }]` (visible records naming this one, newest first). The reference ref (`{ id, citationKey }`) gains `kind`: `publication`, `book` or `personal_observation`.
- **R7** `GET /api/species/:id/traits?includeMissing=true` (RFC-63 R10): with the flag, the response also lists every trait visible to the viewer (RFC-33 R2) that has no visible record for the species, as `{ trait, recordCount: 0, harmonisationCounts: all zero, numeric: null, validated: false, contested: false }`, with `levels` following the RFC-63 R10 rule — `[]` for a categorical trait and `null` for a quantitative one, so `levels === null` still means "quantitative" whatever the record count. Traits come in dictionary order, and categories that only have missing traits appear. Without the flag the response is unchanged.
```

- [ ] **Step 4: Append after the R8 line**, then a blank line and the two sections RFC-00 R2 requires:

```markdown
- **R9** Species page. A legend at the top reads 👍 **Validate** · 👎 **Contest** · ＋ **Complement**. A categorical trait card lists every level the species has (RFC-63 R10, no cap), each with the three buttons. A quantitative trait has them on each row of its record panel (R11). 👍 asks "Do you confirm that this record is correct?", with an optional supporting reference (a DOI, or an ISBN with its citation). It then validates every record of the level (RFC-65 R13), or the one record of a quantitative row (RFC-65 R3). 👎 and ＋ open the entry dialog (R10) with Contest or Complement already chosen and the responded record set. Withdrawing asks for a confirmation only (RFC-65 R4). The buttons render per RFC-13 R3, and the API decides (RFC-65 R3, R4, R13).
- **R10** Entry dialog. When the species already has visible records for the trait, the first step is a required choice between **Contest** and **Complement**. Every other field and the submit button stay disabled until the user answers, whether the dialog opened from a card's ＋ or from the page header. From the header, the user also picks the level or record the entry responds to. Levels are chosen with checkboxes, and each checked level becomes one record (R3). A quantitative trait offers six fields: single, min, max, mean, SD and n (RFC-63 R15). Sources accept DOIs, ISBNs with their citation, or neither, which records a personal observation (R1).
- **R11** Record panel. Its columns sort through the server-side `sort` of RFC-63 R9 (value, references, origin, added). A counts column shows ✓ `validationCount` / ✗ `contestCount`, plus a **Contested** badge when `contested` is true (RFC-63 R8). Withdrawn records are not shown (RFC-63 R13).

## Open questions

None.

## Changelog

- 2026-09-25 — Context, R1–R4, R6, R7 amended; R5 retired; R9–R11 added: one record per level, several references per record, ISBN sources, entries matching a record become validations, contests carry a value and contest a level, the species page, entry dialog and record panel (record model revision R-3, R-4, R-7, R-8, R-11, R-16, §2; plan 13a). `draft` until plan 13h.
```

- [ ] **Step 5: Check passes.** `grep -c '^- \*\*R9\*\*\|^- \*\*R1[01]\*\*\|^## Changelog' docs/rfc/70-workspace/70-contribution-workflow.md` → `4`. `grep -c 'neutral' docs/rfc/70-workspace/70-contribution-workflow.md` → `1` (retired R5). Run the Sync block → `rfc-lint: ok`.

- [ ] **Step 6: Commit**

```bash
git add docs/rfc/70-workspace/70-contribution-workflow.md
git commit -m "docs(rfc-70): one record per level, matches become validations, contests carry a value; species page rules (plan 13a)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: RFC-33, RFC-60, RFC-31 — visibility, filters, roles (R-1, R-12, R-13, R-14, R-15, R-17)

**Files:** Modify `docs/rfc/30-access/33-data-visibility.md` (line 5, lines 16–19, changelog), `docs/rfc/60-dataset/60-taxonomy-catalog.md` (line 5, line 20, changelog) and `docs/rfc/30-access/31-roles.md` (line 5, line 25, changelog).

**Interfaces:** Consumes RFC-63 R13, R14 and RFC-65 R4, R13, R14, and RFC-66 R1, R8. Produces the amended RFC-33 R2 (record visibility), RFC-60 R6 (filters, `unresolvedTaxon`) and RFC-31 R10.

- [ ] **Step 1: Failing check.** `grep -c 'records.withdraw_imported' docs/rfc/30-access/31-roles.md; grep -c 'unknownLevels' docs/rfc/60-dataset/60-taxonomy-catalog.md; grep -c 'it is not withdrawn' docs/rfc/30-access/33-data-visibility.md` → `0`, `0`, `0`.

- [ ] **Step 2: RFC-33.** Replace `| Status | accepted |` with `| Status | draft |`. Then:
  - R2: replace `A record is visible when its species and its trait are visible.` with `A record is visible when its species and its trait are visible, it is not withdrawn (RFC-63 R13), and its `harmonisation` is `harmonised` or the viewer holds `records.review` (pending records, unknown levels and the like are reviewer work).`
  - R3: replace `count every record for every viewer` with `count every record that is not withdrawn (RFC-63 R13) for every viewer`.
  - R3: replace ``GET /api/species/:id` and `GET /api/species/:id/traits/:traitId/accepted` (RFC-60)` with ``GET /api/species/:id` (RFC-60)`.
  - R3: replace ``GET /api/me/dashboard` (RFC-72); `GET /api/export/accepted.csv` (RFC-66 R2). Exceptions` with ``GET /api/me/dashboard` (RFC-72); `GET /api/export/dataset.zip` (RFC-66 R2) and, until plan 13i, `GET /api/export/records.csv` (RFC-66 R8). Exceptions`.
  - R4: delete ` `GET /api/species/:id/traits/:traitId/accepted` answers `SPECIES_NOT_FOUND` / `TRAIT_NOT_FOUND` for an invisible species or trait.` (with its leading space).
  - R5: replace ``POST /api/records/:id/annotations` on an invisible record answers 404.` with ``POST /api/records/:id/annotations` on an invisible record answers 404, and so do the level actions of RFC-65 R13 and R14 on an invisible species, trait or level.`
  - Append to the changelog: `- 2026-09-25 — R2: a withdrawn record is visible to no one, and a record that is not harmonised only to `records.review`; R3: counters skip withdrawn records, the accepted route goes, `dataset.zip` and the interim `records.csv` replace `accepted.csv`; R4 accepted sentence removed; R5 level actions (record model revision R-1, R-13, R-14, R-17; plan 13a). `draft` until plan 13i.`

- [ ] **Step 3: RFC-60.** Replace `| Status | accepted |` with `| Status | draft |`. In R6:
  - replace `&genusId=&unresolved=&status=` with `&genusId=&unresolved=&unknownLevels=&contested=&status=`;
  - replace ``unresolved=true` keeps only unresolved taxa and unresolved taxonomy.` with ``unresolved=true` keeps only unresolved taxa and unresolved taxonomy, and `unknownLevels=true` keeps only species with a visible record whose `harmonisation` is `unknown_level`. Both are reviewer filters: they apply for a holder of `records.review` and are ignored for any other viewer, like `status` below. `contested=true`, open to every viewer, keeps only species with a contested species × trait (RFC-63 R14).`;
  - replace ``unresolvedTaxon` is the R3 flag (either kind)` with ``unresolvedTaxon` is the R3 flag (either kind) for a viewer holding `records.review` and `null` for any other viewer (RFC-33 R2: reviewer-only data)`.
  - Append to the changelog: `- 2026-09-25 — R6: `contested` filter for every viewer, `unknownLevels` and `unresolved` for `records.review` only, `unresolvedTaxon` null for other viewers (record model revision R-14, R-15; plan 13a). `draft` until plan 13g.`

- [ ] **Step 4: RFC-31.** Replace `| Status | accepted |` with `| Status | draft |`. In R10 replace `Managers do not hold `traits.manage`: a missing level is escalated to the admin.` with `Managers do not hold `traits.manage`: a missing level is escalated to the admin. No seeded role stores `records.withdraw_imported` (RFC-65 R4): only `admin` withdraws imported records.` Append to the changelog: `- 2026-09-25 — R10: `records.withdraw_imported` is admin-only (record model revision R-12; plan 13a). `draft` until plan 13g.`

- [ ] **Step 5: Check passes.** The three greps of Step 1 → `2`, `2`, `1` (each rule line plus its changelog line). `grep -c 'traitId/accepted' docs/rfc/30-access/33-data-visibility.md` → `0`. Run the Sync block → `rfc-lint: ok`.

- [ ] **Step 6: Commit**

```bash
git add docs/rfc/30-access/33-data-visibility.md docs/rfc/60-dataset/60-taxonomy-catalog.md docs/rfc/30-access/31-roles.md
git commit -m "docs(rfc-33,60,31): withdrawn and unharmonised visibility, species filters, admin-only imported withdrawal (plan 13a)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: RFC-61, RFC-80, RFC-64 — references and import (R-2, R-4, R-5, R-13, R-16)

**Files:** Modify `docs/rfc/60-dataset/61-bibliographic-references.md` (line 5, lines 15–23, changelog), `docs/rfc/80-integrations/80-doi-resolution.md` (line 2, line 16, changelog) and `docs/rfc/60-dataset/64-bulk-import.md` (line 5, lines 16–27, changelog).

**Interfaces:** Consumes RFC-63 R12, R13, R15, R16. Produces RFC-61 R10 (books, `isValidIsbn`, ISBN sources) and amends RFC-61 R1, R3, R4, R6, R9, RFC-80 R5 and RFC-64 R2, R6, R7, R8, R12.

- [ ] **Step 1: Failing check.** `grep -c '^- \*\*R10\*\*' docs/rfc/60-dataset/61-bibliographic-references.md; grep -c 'invalid_record_id' docs/rfc/60-dataset/64-bulk-import.md` → `0`, `0`.

- [ ] **Step 2: RFC-61.** Replace `| Status | accepted |` with `| Status | draft |`. Then:
  - R1: replace `doi text null unique where not null, url text null` with `doi text null unique where not null, isbn text null unique, url text null`; replace `kind text not null default 'publication'` with `kind text not null default 'publication' check in ('publication', 'book', 'personal_observation')`.
  - R3: replace `which inherits the superseded record's references — possibly a secondary reference alone (RFC-63 R2).` with `which inherits the superseded record's references — possibly a secondary reference alone (RFC-63 R2). A manual record may name further references through `record_references` (RFC-63 R16).`
  - R4: replace ``kind` filters by `publication` | `personal_observation` | `all` (default `publication`)` with ``kind` filters by `publication` | `book` | `personal_observation` | `all` (default `publication`)`; replace `doi, url, createdAt, primaryCount` with `doi, isbn, url, createdAt, primaryCount`; replace `where `primaryCount` and `secondaryCount` are the records naming the reference as primary and as secondary (a record naming the same reference in both roles counts once in each). Both counts are stored on the reference row and kept in step by a database trigger on every insert into `trait_records` (records are append-only, so they never decrease);` with `where `primaryCount` and `secondaryCount` are the records that are not withdrawn (RFC-63 R13) naming the reference as primary — through `primary_reference_id` or a `record_references` row (RFC-63 R16) — and as secondary (a record naming the same reference in both roles counts once in each). Both counts are stored on the reference row and kept in step by database triggers: they grow on every insert into `trait_records` and `record_references` and decrease when a record is withdrawn (RFC-63 R13);`; replace `adds `recordCount` (records naming it in either role, counted once)` with `adds `recordCount` (records that are not withdrawn naming it in any role, counted once)`.
  - R6: replace `doi?, url?, shortCitation?, fullCitation? }` with `doi?, isbn?, url?, shortCitation?, fullCitation? }`; replace ``doi` and `url` 1–500,` with ``doi` and `url` 1–500, `isbn` per R10 (given on `POST`, it makes the reference a `book` and requires `fullCitation`; on `PATCH` only a `book` takes it, otherwise 400 `VALIDATION_FAILED` with path `isbn`),`; replace `Codes: 409 `REFERENCE_KEY_TAKEN`, 409 `REFERENCE_DOI_TAKEN`,` with `Codes: 409 `REFERENCE_KEY_TAKEN`, 409 `REFERENCE_DOI_TAKEN`, 409 `REFERENCE_ISBN_TAKEN`,`.
  - R9: replace ``record_count` counts the records naming the reference in either role (primary or secondary) once per record. Maintained by the `trait_records` insert trigger (`trait_records_reference_usage()`)` with ``record_count` counts the records that are not withdrawn naming the reference in any role (primary, secondary or a `record_references` row) once per record. Maintained by the `trait_records` and `record_references` insert triggers (`trait_records_reference_usage()` and its sibling), decremented on withdrawal (RFC-63 R13),`.
  - Append after the R9 line:

```markdown
- **R10** Books. A reference of kind `book` has an `isbn` and a citation. `isValidIsbn(input): string | null` (`packages/contracts`) accepts an ISBN-10 or ISBN-13 with a valid check digit, ignoring spaces and hyphens, and returns it normalised to the 13 digits of ISBN-13: an ISBN-10 gains the `978` prefix and a recomputed check digit. It returns null for anything else, which the API answers with 400 `VALIDATION_FAILED`. `isbn` is unique (409 `REFERENCE_ISBN_TAKEN` on an R6 write). The citation text (authors, year, title; 1–2,000 characters, trimmed) is required and stored in `full_citation`. A `{ isbn, citation }` source (RFC-70 R1, RFC-65 R3) resolves to the reference that holds that ISBN. When none does, it inserts one — `kind = 'book'`, `citation_key = 'isbn:' || isbn`, `full_citation` = the citation, the actor as creator, and the audit entry `references.created` with `source: 'isbn'` — in its own transaction before the record or annotation write, as a DOI does (RFC-80 R5). An existing reference keeps its citation. There is no external lookup, and the ISSN is not supported.
```

  - Append to the changelog: `- 2026-09-25 — R1, R3, R4, R6, R9 amended, R10 added: book references with a normalised unique ISBN, `record_references` usages, counters that decrease on withdrawal (record model revision R-4, R-13, R-16; plan 13a). `draft` until plan 13g.`

- [ ] **Step 3: RFC-80.** Replace `status: accepted` with `status: draft`. In R5 replace `Sources are distinct after resolution — naming a reference by its id and again by its DOI is one source, and the second is a 400 `VALIDATION_FAILED`.` with `Sources are distinct after resolution: naming a reference by its id and again by its DOI or its ISBN (RFC-61 R10) counts as one source, and the second answers 400 `VALIDATION_FAILED`. An ISBN is never looked up: it resolves locally (RFC-61 R10).` Append to the changelog: `- 2026-09-25 — R5: ISBN sources resolve locally and count toward distinctness (record model revision R-16; plan 13a). `draft` until plan 13d.`

- [ ] **Step 4: RFC-64.** Replace `| Status | accepted |` with `| Status | draft |`. Then:
  - R2: replace `equals exactly, in order: `primary_reference, secondary_reference,` with `equals exactly, in order: `ID, primary_reference, secondary_reference,`.
  - R6: replace `Quantitative values are never split; a `;` in one leaves it `not_numeric`.` with `Quantitative values are never split; a `;` in one leaves it `not_numeric`. A quantitative value fills only the single value, `numeric_value` (RFC-63 R15). The records of a split row carry the codes of RFC-63 R12.`
  - R7: replace `'doi_taken', 'invalid_value'), raw_row jsonb` with `'doi_taken', 'invalid_value', 'invalid_record_id', 'duplicate_record_id'), raw_row jsonb`; replace `the reasons `unknown_species`, `unknown_plot`, `unknown_user`, `unknown_reference`, `doi_taken` and `invalid_value` belong to the supplementary kinds of RFC-68 R4. The first applicable reason in that order is recorded.` with ``ID` empty or not matching `^EB_[0-9]+$` (`invalid_record_id`); an `ID` already carried by a stored record — its `record_code`, or the part before `-<n>` for a split row — or by an earlier row of the file (`duplicate_record_id`, RFC-63 R12); the reasons `unknown_species`, `unknown_plot`, `unknown_user`, `unknown_reference`, `doi_taken` and `invalid_value` belong to the supplementary kinds of RFC-68 R4. The first applicable reason in that order is recorded.`
  - R8: replace `with `origin = 'import'`, the batch id and `row_no`.` with `with `origin = 'import'`, the batch id, `row_no` and `record_code` from the row's `ID` (RFC-63 R12).`
  - R12: replace ``accepted_values`, `record_annotations`, `reference_traits`,` with ``record_annotations`, `record_references`, `reference_traits`,`.
  - Append to the changelog: `- 2026-09-25 — R2 `ID` column; R6 single value only, split-row codes; R7 `invalid_record_id`, `duplicate_record_id`; R8 `record_code`; R12 wipes `record_references`, no longer `accepted_values` (record model revision R-1, R-2, R-4, R-5; plan 13a). `draft` until the second of plans 13e and 13f merges.`

- [ ] **Step 5: Check passes.** The Step 1 greps → `1`, `2`. `grep -c 'accepted_values' docs/rfc/60-dataset/64-bulk-import.md` → `1` (the changelog line). Run the Sync block → `rfc-lint: ok`.

- [ ] **Step 6: Commit**

```bash
git add docs/rfc/60-dataset/61-bibliographic-references.md docs/rfc/80-integrations/80-doi-resolution.md docs/rfc/60-dataset/64-bulk-import.md
git commit -m "docs(rfc-61,80,64): book references by ISBN, record_references usages, the import ID column (plan 13a)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: RFC-66 — the full export (R-17) and the interim file (13e)

**Files:** Modify `docs/rfc/60-dataset/66-dataset-export.md` (line 5, Context line 11, rules lines 15–21, changelog).

**Interfaces:** Consumes RFC-33 R2, RFC-63 R8, R12–R16. Amends RFC-66 R1–R7 (the `dataset.zip` of 13i) and produces R8 (the interim `records.csv` of 13e).

- [ ] **Step 1: Failing check.** `grep -c 'dataset.zip' docs/rfc/60-dataset/66-dataset-export.md` → `0`.

- [ ] **Step 2:** Replace `| Status | accepted |` with `| Status | draft |`. Replace the Context paragraph (line starting `Curators need the current accepted values`) with:

```markdown
Curators need the dataset as files for analysis and publication: every record with its references, validations and contests. Handing over the curated dataset as files is a larger grant than browsing it, so the export has its own permission and every download is audited. The permission widens nothing, though: the archive is the viewer's slice of the dataset under RFC-33, not a publication artefact.
```

- [ ] **Step 3: Replace the lines starting `- **R1**` through `- **R6**`** (six lines) with:

```markdown
- **R1** `GET /api/export/dataset.zip` requires `dataset.export`, which no seeded role stores (RFC-31 R10), so only `admin` holds it. It replaces `GET /api/export/accepted.csv`.
- **R2** The archive holds two files, both over the viewer's visibility: the route resolves `visibilityOf(ctx, c)`, and every query carries `speciesVisible`, `traitVisible` and the record visibility of RFC-33 R2, so withdrawn records never appear (RFC-63 R13). `records.csv` has one row per visible record, pending ones included with their raw value. Its columns, in order: `record_code, family, genus, species, name_source, category, trait, unit, level, value_single, value_min, value_max, value_mean, value_sd, value_n, raw_value, references, origin, intent, responds_to, contested, n_validations, n_contests, created_at`. `annotations.csv` has one row per validation (`confirm`) and per contest on a visible record, with the columns `record_code, kind, user_name, date, reference, contest_record_code`; `kind` is `validation` or `contest`. In `records.csv`: `level` is the level key or empty; the value columns print as PostgreSQL prints `numeric`, or are empty; `references` is the record's references, primary first (RFC-63 R16), joined by `; `, each printed as its citation key or as `Personal observation` for a reference of kind `personal_observation`; `responds_to` is the responded record's `record_code`; `contested` is `true` or `false` (RFC-63 R14); `n_validations` and `n_contests` are RFC-63 R8's `validationCount` and `contestCount`, which count distinct users. In `annotations.csv`: a contest row's `record_code` is the record the contest responds to and its `contest_record_code` is the contest's own code; a validation row leaves `contest_record_code` empty; `reference` is the validation's supporting reference as a citation key, or empty; `user_name` is the actor's name. User names only, never an e-mail address (RFC-02 R14, RFC-40). `created_at` and `date` are ISO 8601 UTC.
- **R3** `records.csv` rows are ordered by `family` and `genus` (nulls last), then `species`, then trait key, then `record_code`. `annotations.csv` rows are ordered by `record_code`, then `date`.
- **R4** Each file is RFC 4180 CSV: UTF-8 with a leading byte-order mark, CRLF row terminators, a header row, and a field quoted with `"` (inner quotes doubled) when it contains `"`, `,`, CR or LF. A field starting with `=`, `+`, `-`, `@`, tab or carriage return that is not a plain number is prefixed with `'`, so spreadsheet software never evaluates it as a formula. Response headers: `Content-Type: application/zip`, `Content-Disposition: attachment; filename="treerepro-dataset-<YYYY-MM-DD>.zip"`, `Cache-Control: no-store`.
- **R5** The response streams: rows are read through a server-side cursor in batches and written into the archive as they arrive. The archive uses ZIP64, so `records.csv` may exceed 4 GiB. Neither a file nor the archive is ever held in memory.
- **R6** An audit entry `dataset.exported` with `metadata: { format: 'zip', scope: 'dataset' }` is recorded before the first byte is sent; an interrupted download still counts as an export.
```

- [ ] **Step 4: R7 and R8.** In R7 replace `The CSV body is the documented exception to RFC-11 R2.` with `The file body is the documented exception to RFC-11 R2.` Append after the R7 line:

```markdown
- **R8** (interim: written by plan 13e, retired by plan 13i) `GET /api/export/records.csv` (`dataset.export`) streams a single CSV of every visible record (R2's population). Its columns, in order: `family, genus, species, name_source, category, trait, value, unit, level, numeric_value, raw_value, primary_reference, secondary_reference, origin, intent, created_at, record_id`. `value` is `value_text`, and the references print as in R2. Rows follow R3's order with `record_id` as the last key. The format follows R4 with `Content-Type: text/csv; charset=utf-8` and `filename="treerepro-records-<YYYY-MM-DD>.csv"`, the streaming follows R5, and the audit follows R6 with `metadata: { format: 'csv', scope: 'records' }`. It replaces `GET /api/export/accepted.csv` until `dataset.zip` exists.
```

  Append to the changelog: `- 2026-09-25 — Context, R1–R7 amended: `dataset.zip` with `records.csv` and `annotations.csv` replaces `accepted.csv`; R8 added: the interim single-file export of plan 13e (record model revision R-17; plan 13a). `draft` until plan 13i.`

- [ ] **Step 5: Check passes.** `grep -c 'dataset.zip' docs/rfc/60-dataset/66-dataset-export.md` → `3` (R1, R8, changelog). `grep -c '^- \*\*R8\*\*' docs/rfc/60-dataset/66-dataset-export.md` → `1`. Run the Sync block → `rfc-lint: ok`.

- [ ] **Step 6: Commit**

```bash
git add docs/rfc/60-dataset/66-dataset-export.md
git commit -m "docs(rfc-66): dataset.zip with records and annotations; interim records.csv (plan 13a)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: RFC-62, RFC-69, RFC-52 — derived counts (R-1, R-9, R-13)

**Files:** Modify `docs/rfc/60-dataset/62-trait-dictionary.md` (line 5, lines 24–25, changelog), `docs/rfc/60-dataset/69-coverage-summary.md` (line 5, lines 16–25, changelog) and `docs/rfc/50-admin/52-platform-health.md` (line 5, line 15, changelog).

**Interfaces:** Consumes RFC-63 R11, R13 and RFC-65 R10. Amends RFC-62 R7 (`validatedCount`) and R8 (`validated`), RFC-69 R2 (decrement), R5 and R7 (`validated`, `percentValidated`, `least_validated`), and RFC-52 R1 (`validatedCells`, queues).

- [ ] **Step 1: Failing check.** `grep -c 'validatedCount' docs/rfc/60-dataset/62-trait-dictionary.md; grep -c 'percentValidated' docs/rfc/60-dataset/69-coverage-summary.md; grep -c 'validatedCells' docs/rfc/50-admin/52-platform-health.md` → `0`, `0`, `0`.

- [ ] **Step 2: RFC-62.** Replace `| Status | accepted |` with `| Status | draft |`. In R7: replace ``acceptedCount` (species whose current accepted value is on this trait)` with ``validatedCount` (species with a validated species × trait on this trait, RFC-63 R11)`; replace ``speciesMissing` and `acceptedCount` are global summaries` with ``speciesMissing` and `validatedCount` are global summaries`; replace `a ten-minute lag on a summary is acceptable and the counts are monotonic` with `a ten-minute lag on a summary is acceptable`. In R8: replace ``accepted: { recordId, valueText, reference: { id, citationKey, shortCitation, kind } } | null`` with ``validated: boolean` (RFC-63 R11)`. Append to the changelog: `- 2026-09-25 — R7 `validatedCount` replaces `acceptedCount`, and counts are no longer monotonic (withdrawal); R8 `validated` replaces `accepted` (record model revision R-1, R-13; plan 13a). `draft` until plan 13e.`

- [ ] **Step 3: RFC-69.** Replace `| Status | accepted |` with `| Status | draft |`. Then:
  - R2: replace `and increments `species.trait_count` by the number of pairs newly inserted. Records are append-only (RFC-63 R4), so nothing ever decrements. Withdrawn records still count: coverage answers "is there a record", not "is there a good record".` with `and increments `species.trait_count` by the number of pairs newly inserted. A withdrawal (RFC-63 R13) decrements the pair's `record_count`, and its `harmonised_count` for a harmonised record. A pair whose `record_count` reaches 0 is deleted and `species.trait_count` decremented, so coverage counts the records that are not withdrawn.`
  - R5: replace all 4 occurrences of `withData, accepted, percentWithData, percentAccepted` with `withData, validated, percentWithData, percentValidated`; replace ``accepted` counts species × trait pairs whose current decision is `accepted` (from `accepted_values`, newest row per pair)` with ``validated` counts the species × trait pairs that are validated (RFC-63 R11)`; replace ``percentAccepted = accepted / cells`` with ``percentValidated = validated / cells``.
  - R7: replace `mode=missing|least_accepted&limit=` with `mode=missing|least_validated&limit=`; replace `the lowest accepted share (`mode=least_accepted`)` with `the lowest validated share (`mode=least_validated`)`; replace `a `distinct on` over `accepted_values` and a group-by` with `the validated-pair query and a group-by`; replace `"lowest accepted share" ranks by ascending `percentAccepted`` with `"lowest validated share" ranks by ascending `percentValidated``.
  - Append to the changelog: `- 2026-09-25 — R2: withdrawal decrements coverage; R5, R7: `validated` and `percentValidated` replace `accepted` and `percentAccepted`, `least_validated` replaces `least_accepted` (record model revision R-1, R-13; plan 13a). `draft` until plan 13g.`

- [ ] **Step 4: RFC-52.** Replace `| Status | accepted |` with `| Status | draft |`. In R1: replace `coverageCells, acceptedCells }` with `coverageCells, validatedCells }`; replace `and `dataset.acceptedCells` is the count that have an accepted value, so that `acceptedCells <= coverageCells <= activeSpecies * activeTraits`` with `and `dataset.validatedCells` is the count that are validated (RFC-63 R11), so that `validatedCells <= coverageCells <= activeSpecies * activeTraits``; replace ``coverageCells` and `acceptedCells` count` with ``coverageCells` and `validatedCells` count`; replace `queues: { pendingGroups, disputed, contested, proposals }` with `queues: { pendingGroups, contested, proposals }` (`contested` as RFC-72 R1). Append to the changelog: `- 2026-09-25 — R1: `validatedCells` replaces `acceptedCells`; the queues drop `disputed` (record model revision R-1, R-9, R-11; plan 13a). `draft` until plan 13g (13e does `validatedCells`).`

- [ ] **Step 5: Check passes.** The Step 1 greps → `2`, `4`, `2` (counted per line). `grep -c 'ccepted' docs/rfc/60-dataset/69-coverage-summary.md` → `2`, both changelog lines (`grep -n` shows no hit on a `- **R` line or on line 21). `grep -c 'acceptedCells' docs/rfc/50-admin/52-platform-health.md` → `1` (the new changelog line). Run the Sync block → `rfc-lint: ok`.

- [ ] **Step 6: Commit**

```bash
git add docs/rfc/60-dataset/62-trait-dictionary.md docs/rfc/60-dataset/69-coverage-summary.md docs/rfc/50-admin/52-platform-health.md
git commit -m "docs(rfc-62,69,52): validated replaces accepted in every count; withdrawal decrements coverage (plan 13a)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: RFC-71, RFC-72, RFC-73, RFC-74 — workspace (R-1, R-9, R-11, R-13, R-16, R-18)

**Files:** Modify `docs/rfc/70-workspace/71-my-contributions.md` (line 5, lines 11–18, changelog), `72-workspace-dashboard.md` (line 5, lines 16–21, changelog), `73-help-and-onboarding.md` (line 5, lines 15, 17, changelog) and `74-daily-digest.md` (line 5, Context line 11, lines 17–18, changelog).

**Interfaces:** Consumes RFC-61 R4, RFC-62 R5, RFC-63 R6, R11, R13 and RFC-65 R10. Amends RFC-71 R2–R4, RFC-72 R1 (`primaryReferenceCount`, `secondaryReferenceCount`, `topTraitsWithData`, validated coverage, queues) and R3 (home text), RFC-73 R1 and R3, and RFC-74 R3 and R4.

- [ ] **Step 1: Failing check.** `grep -c 'topTraitsWithData' docs/rfc/70-workspace/72-workspace-dashboard.md; grep -c 'contestedNow' docs/rfc/70-workspace/74-daily-digest.md` → `0`, `0`.

- [ ] **Step 2: RFC-71.** Replace `| Status | accepted |` with `| Status | draft |`. Then:
  - Context: replace `(contests raised, complements added, validations given, disputes raised, withdrawals, and how many of their records are the current accepted value)` with `(contests raised, complements added, validations given)`.
  - R2: replace `manual records with `created_by = viewer`, newest first` with `manual records with `created_by = viewer` that are not withdrawn (RFC-63 R13), newest first`; replace `plus `isAccepted: boolean` (the record is the current accepted value of its species and trait) and `responseCount: number`` with `plus `responseCount: number``.
  - R3: replace `the viewer's `record_annotations` newest first` with `the viewer's `confirm` and `resolve` annotations on visible records, newest first (`withdraw` rows sit on records that have left the dataset, RFC-63 R13; `dispute` and `neutral` rows are ignored, RFC-63 R7),`.
  - R4: replace ``{ records, contests, complements, validations, disputes, withdrawn, accepted }` — counts of the viewer's manual records, those with each intent, their `confirm` annotations, their `dispute` annotations, their records with a `withdraw` annotation, and their records that are the current accepted value.` with ``{ records, contests, complements, validations }` — counts of the viewer's manual records that are not withdrawn (RFC-63 R13), those with each intent, and their `confirm` annotations on records that are not withdrawn.`
  - Append to the changelog: `- 2026-09-25 — R1's `review` takes RFC-63 R6's new states; R2 drops `isAccepted` and withdrawn records; R3 lists validations and resolutions; R4 drops `disputes`, `withdrawn` and `accepted` (record model revision R-1, R-11, R-13; plan 13a). `draft` until plan 13g (13e drops the accepted parts).`

- [ ] **Step 3: RFC-72.** Replace `| Status | accepted |` with `| Status | draft |`. In R1:
  - replace ``dataset: { speciesCount, referenceCount, recordCount, computedAt }` — global counts (active species only for `speciesCount`), cached` with ``dataset: { speciesCount, referenceCount, primaryReferenceCount, secondaryReferenceCount, recordCount, computedAt }` — global counts (active species only for `speciesCount`; `primaryReferenceCount` and `secondaryReferenceCount` count the references whose `primary_count`, and whose `secondary_count`, is above 0, RFC-61 R4), cached`;
  - replace `topMissingTraits: [{ trait: { id, key, valueType, unit }, category: { key, label }, missingSpeciesCount }] (≤ 10, descending; a trait that no visible species misses is left out, so the list is shorter than ten, or empty, once the gaps are filled)` with `topTraitsWithData: [{ trait: { id, key, valueType, unit }, category: { key, label }, speciesCount }] (the ten visible active traits with the most visible species with data — RFC-62 R5's `speciesCount`, from `speciesCountsByTrait` — descending, then by trait key; a trait with no species is left out)`;
  - replace `for a viewer without plots, `missingCells` and `awaitingValidation` are `null` and `topMissingTraits` is computed over every visible active species from the coverage table (`speciesWithData` per trait subtracted from the visible species count).` with `for a viewer without plots, `missingCells` and `awaitingValidation` are `null`; `topTraitsWithData` is the same list for every viewer of a visibility class, plots or not.`;
  - replace ``curation: { coverage: { cells, withData, accepted, percentWithData, percentAccepted }, queues: { pendingGroups, disputed, contested, proposals } } | null`` with ``curation: { coverage: { cells, withData, validated, percentWithData, percentValidated }, queues: { pendingGroups, contested, proposals } } | null``;
  - replace ``pendingGroups` counts RFC-65 R8 groups, `disputed` RFC-65 R10 records, `contested` records with `intent = 'contest'` whose responded record is not withdrawn and has no accepted decision newer than the contest,` with ``pendingGroups` counts RFC-65 R8 groups, `contested` the standing contests of RFC-65 R10,`;
  - delete ` The disputed item (RFC-65 R10 amended by plan 11b) gains `contestedBy: [{ id, valueText, createdBy }]` — the records whose contest generated the standing dispute — so the queue shows the competing value, not only the id in the generated note.` (with its leading space).
  - Replace the line starting `- **R3**` with:

```markdown
- **R3** The web app renders, across the full width of its card, the project description with the `dataset` counts substituted: "TreeRepro is a collective data assembly of reproductive trait data for trees, covering traits across all reproductive stages — flower, fruits, and seeds. Its core data comes from open-source papers and data repositories spanning {primary} primary references, {secondary} secondary references and {records} records over {species} species. It is shared here with a community of specialists to fill gaps and validate existing records. For questions, contact elisabpereira@gmail.com." Here `{primary}` is `primaryReferenceCount`, `{secondary}` is `secondaryReferenceCount`, `{records}` is `recordCount` and `{species}` is `speciesCount`. Below the text are the buttons **Browse species**, **Browse traits** and **Browse references**. The **Top traits with data** card lists `topTraitsWithData`, each trait linking to `/app/traits/$id`. The copy lives in `apps/web/src/content/project.ts` so the owner can edit it in one place.
```

  - Append to the changelog: `- 2026-09-25 — R1: primary and secondary reference counts, `topTraitsWithData` replaces `topMissingTraits`, validated coverage, the queues drop `disputed`; R3: the new home text, buttons and top-traits card (record model revision R-1, R-9, R-18; plan 13a). `draft` until plan 13g (13b does `dataset`, `topTraitsWithData` and R3; 13e the coverage).`

- [ ] **Step 4: RFC-73.** Replace `| Status | accepted |` with `| Status | draft |`. In R1: replace ``workflow` (validate / contest / complement, what each button does and records)` with ``workflow` (validate / contest / complement, what each button does and records, contested levels and how a reviewer resolves them)`; replace ``references` (DOIs, personal observation, several references)` with ``references` (DOIs, books and ISBNs, personal observation, several references)`. In R3: replace `The card never shows for a viewer with any contribution.` with `The card never shows for a viewer with any contribution. It opens directly with the checklist, with no introductory sentence.` Append to the changelog: `- 2026-09-25 — R1 topics cover contested levels and books; R3 Getting started loses its opening sentence (record model revision R-16, R-18; plan 13a). `draft` until plan 13j (13b does R3).`

- [ ] **Step 5: RFC-74.** Replace `| Status | accepted |` with `| Status | draft |`. Context: replace `new contests, disputes and pending groups` with `new contests and pending groups`. R3: replace ``validations` (`confirm` annotations), `disputes` (`dispute` annotations with `generated = false`), `withdrawals`,` with ``validations` (`confirm` annotations), `withdrawals`,`; replace ``disputedNow` (current, RFC-65 R10), plus the 10 newest contests and 10 newest disputes as` with ``contestedNow` (current standing contests, RFC-65 R10), plus the 10 newest contests as`. R4: replace ``records + contests + complements + validations + disputes + withdrawals + proposals`` with ``records + contests + complements + validations + withdrawals + proposals``. R5: replace `the counts, the two lists with links` with `the counts, the list with links`. Append to the changelog: `- 2026-09-25 — Context, R3, R4: disputes leave the digest, `contestedNow` replaces `disputedNow` (record model revision R-9, R-11; plan 13a). `draft` until plan 13g.`

- [ ] **Step 6: Check passes.** The Step 1 greps → `3` (R1, R3, changelog) and `2` (R3, changelog). `grep -c 'topMissingTraits' docs/rfc/70-workspace/72-workspace-dashboard.md` → `2`, both changelog lines. `grep -c 'two lists' docs/rfc/70-workspace/74-daily-digest.md` → `0`. Run the Sync block → `rfc-lint: ok`.

- [ ] **Step 7: Commit**

```bash
git add docs/rfc/70-workspace/71-my-contributions.md docs/rfc/70-workspace/72-workspace-dashboard.md docs/rfc/70-workspace/73-help-and-onboarding.md docs/rfc/70-workspace/74-daily-digest.md
git commit -m "docs(rfc-71,72,73,74): home text and top traits with data, contributions and digest without disputes or accepted (plan 13a)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Index, full verification, review, PR

**Files:** Modify `docs/rfc/README.md` (lines 34–57).

**Interfaces:** Produces the PR that closes issue `N` from Task 0.

- [ ] **Step 1: Index.** In `docs/rfc/README.md`, change the status column from `accepted` to `draft` on the rows of RFC-31, RFC-33, RFC-52, RFC-60, RFC-61, RFC-62, RFC-63, RFC-64, RFC-65, RFC-66, RFC-69, RFC-70, RFC-71, RFC-72, RFC-73, RFC-74 and RFC-80 (17 rows). Check:

```bash
grep -c '| draft |$' docs/rfc/README.md
for f in $(grep -rl '^| Status | draft |\|^status: draft' docs/rfc); do echo "$f"; done | wc -l
```

Expected: `17` and `17`.

- [ ] **Step 2: Every rule the mapping names exists.**

```bash
for p in 60-dataset/61-bibliographic-references.md:10 60-dataset/63-trait-records.md:16 60-dataset/65-curation.md:15 60-dataset/66-dataset-export.md:8 70-workspace/70-contribution-workflow.md:11; do
  f=docs/rfc/${p%%:*}; n=${p##*:}; grep -q "^- \*\*R$n\*\*" "$f" && echo "ok $f R$n" || echo "MISSING $f R$n"
done
```

Expected: five `ok` lines.

- [ ] **Step 3: Full verification in the container.** Run the Sync block (→ `rfc-lint: ok`), then:

```bash
docker exec treerepro-13a pnpm --filter @treerepro/rfc-lint test
docker exec treerepro-13a pnpm --filter @treerepro/contracts exec vitest run src/permissions.test.ts src/error-codes.test.ts
docker exec treerepro-13a pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:unit src/audit/actions.test.ts
```

Expected: every suite passes. `repo.test.ts` proves every `@rfc` tag in the code, including those on retired rules, still resolves. The three mirror tests prove the untouched tables still match their code.

- [ ] **Step 4: Commit the index**

```bash
git add docs/rfc/README.md
git commit -m "docs(rfc): index — the seventeen RFCs amended by the record model revision are draft (plan 13a)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: CodeRabbit (local CLI, once).** Run `coderabbit:code-review` on the branch against `origin/main`. Apply findings that correct a fact (a wrong rule number, a contradiction between two amended rules, a mismatch with the spec). Any finding that would change a spec decision goes into the PR body as a question for the owner instead. Commit fixes as `docs(rfc): CodeRabbit findings on plan 13a`, ending with the Co-Authored-By line.

- [ ] **Step 6: Rebase, re-verify, push, PR**

```bash
git fetch origin
git rebase origin/main
```

Re-run Step 3 on the rebased tree, then:

```bash
git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push -u origin docs/revision-13a-rules
git ls-remote --heads origin docs/revision-13a-rules
gh pr create --title "docs(rfc): record model revision rules (plan 13a)" --body "Closes #$N

Writes R-1…R-18 of docs/specs/2026-09-25-record-model-revision-design.md into seventeen RFCs, all now \`draft\` until the plan named in docs/plans/2026-09-25-revision-13a-rules.md (Status flips) implements them. Docs only.

- Retired in place, ids kept (RFC-00 R3): RFC-65 R2, R5, R6; RFC-70 R5. Tagged code stays green and is removed by 13e/13g.
- New: RFC-61 R10, RFC-63 R11–R16, RFC-65 R13–R15, RFC-66 R8 (interim), RFC-70 R9–R11.
- Not touched on purpose: the RFC-30 catalog, the RFC-12 codes and the RFC-41 actions (mirror-tested); their rows are listed in the plan for 13d/13e/13g/13i.

Verified in Docker: rfc:check, rfc-lint tests, the permission, error-code and audit-action mirror tests.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: `git ls-remote` prints the branch. If it prints nothing, the push failed despite the "Everything up-to-date" message.

- [ ] **Step 7: After merge.** Run `gh issue edit $N --remove-label in-progress`, then `docker rm -f treerepro-13a` and `git worktree remove ../TreeRepro-13a`.

## Self-review

- Every row of the mapping table points at a rule written in Tasks 1–8. Every new number is in the "New rule numbers" table, and Task 9 Step 2 checks they exist.
- No mirror-tested table is edited, so the permission, error-code and action tests cannot break. Retired rules keep `**Rn**`, so `rfc-lint`'s `RULE_RE` still finds every id a tag cites. The only files touched are Markdown under `docs/rfc/`, so no code test can break either.
- The spec says R-1 "removes" `accepted.manage`. RFC-30 R1 forbids removing a key, so the owed row retires it (see Spec notes).

## Spec notes

1. **Mirror-tested tables are out of 13a's reach.** `permissions.test.ts`, `error-codes.test.ts` and `actions.test.ts` compare the RFC-30, RFC-12 and RFC-41 tables with code, so editing a row in 13a would turn `main` red. The exact rows are listed under "Rows owed by later plans", and each changes in the same commit as its code.
2. **`accepted.manage` is retired, not deleted.** RFC-30 R1 says a key is never removed: it keeps its row with "(retired)". This applies the spec's "removed" under RFC-30 R1, the way `users.delete` was retired.
3. **RFC-00 R6 puts 17 RFCs in `draft`.** Each goes back to `accepted` through the plan in "Status flips". RFC-64 has no single owner (13e and 13f both touch it), so whichever of the two merges second flips it.
4. **Split import rows.** A categorical `a;b` row becomes several records (RFC-64 R6), but `record_code` is unique. Letter suffixes (`EB_1a`, `EB_1b`; platform multi-level forms `TR_7a`, `TR_7b`) for the parts of a split entry (RFC-63 R12). **Confirmed by the owner 2026-09-25.**
5. **Position of `ID` in the import header.** The new source file has not arrived yet. 13a puts `ID` first (RFC-64 R2). Plan 13f may amend R2 when the real file arrives.
6. **Quantitative `value_text`.** Without a rule, two records that differ only in min/max/mean/sd/n would collide on `trait_records_claim_key`. 13a fixes a deterministic text (RFC-63 R15).
7. **A match validates every record of the level**, not "the record" (RFC-70 R3). This is consistent with 👍 validating the whole level. As the spec literally reads, a contest whose new value equals an existing level also becomes a validation of that level rather than a contest.
8. **`contestCount` counts every contest that is not withdrawn, resolved ones included.** `contested` counts only standing contests (RFC-63 R8, R14). The spec does not say whether ✗ n drops after Keep both.
9. **Reviewer-only filters are ignored, not refused**, for other viewers (RFC-60 R6), following the `status` precedent. `unresolvedTaxon` is `null` for them.
10. **Error codes reused, no new ones except `REFERENCE_ISBN_TAKEN`.** Validating one's own record → 403 `PERMISSION_DENIED`. A withdrawn record → 404, because it is invisible. `withdraw` answers 200 `{ data: null }`. `RECORD_DUPLICATE`, `RECORD_NOT_WITHDRAWABLE` and `RECORD_WITHDRAWN` are no longer produced (13g retires them).
11. **Outside the spec's §3 file lists:** RFC-52 (health `acceptedCells`, queue `disputed`), RFC-62 (trait page `acceptedCount`) and RFC-74 (digest disputes). They must change, because 13e drops `accepted_values` and 13g drops disputes. Assigned here: RFC-62 and the RFC-52 `validatedCells` to 13e; the RFC-52 queues and RFC-74 to 13g.
12. **`record_references` counts as a primary usage** in `primaryCount` and `reference_traits` (RFC-61 R4, R9, RFC-63 R16).
13. **The references list keeps `kind=publication` as its default**, so books need `kind=book` or `kind=all`. The owner may prefer books shown by default. That would be a one-word change in RFC-61 R4, made by 13d.
14. **The trait card's quantitative `mean` is `null`** when no record has a single or mean value (RFC-63 R10). §6 types it as a number.
15. **Interim export columns (RFC-66 R8)** are fixed here, so 13e can ship without waiting for 13f's `record_code`.
16. **RFC-70 had no Changelog or Open questions section** (RFC-00 R2). 13a adds both.
17. **README handbook lines** (accepted value, dispute, `accepted.csv`) are left to the plans that change the behaviour.
