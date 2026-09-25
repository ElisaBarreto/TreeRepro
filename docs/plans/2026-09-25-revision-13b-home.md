# Revision 13b — Home Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec R-18 on the workspace home. The intro text takes the full width of its card and quotes the live number of primary references, secondary references, records and species. The quick actions become **Browse species**, **Browse traits** and **Browse references**. "Top traits missing data" becomes **Top traits with data**: the ten traits with the most species holding data, each linking to `/app/traits/$id`. The Getting started card loses its opening sentence.

**Architecture:** `computeDatasetStats` gains two `count(*) filter (…)` columns over `bibliographic_references`, so the numbers still come from stored counters (RFC-72 context) and stay behind the hourly `stats:dataset` entry. `traitsWithData` replaces `missingTraitCounts`. It reads the cached `speciesCountsByTrait` map (RFC-62 R5), which does not depend on the viewer's plots, joins it to the visible traits and ranks them. A plot-bound viewer gets the same dataset-wide ranking, because statistics about the whole dataset are open to them. The web changes are limited to four components, the copy module and the page.

**Tech Stack:** unchanged (TypeScript 7, Hono 4, Zod 4, Drizzle + PostgreSQL 18, Redis 8, React 19, TanStack Router/Query, Tailwind 4, Vitest 5 + testcontainers, Playwright). No new dependencies, no migration.

**Spec:** `docs/specs/2026-09-25-record-model-revision-design.md` — R-18 (§1.8), §6 row "13b dashboard contract".

**Depends on:** 13a (merged first). It amends RFC-72 R1 (the dashboard contract) and R3 (the copy) for spec R-18. This plan cites those rules by their existing ids, RFC-72 R1 and R3, as amended by 13a (see Spec notes).

## Global Constraints

- English everywhere: code, comments, docs, UI, commits.
- RFC first. RFC-72 R1/R3 come from 13a, so this plan writes no RFC text. Every exported symbol keeps or gains a JSDoc `@rfc` tag, and `pnpm rfc:check` must pass. Tests name the rule: `describe('RFC-72 R1 …')` / `it('RFC-72 R3 …')`.
- TDD: write the failing test first, run it and see it fail for the expected reason, then write the minimum code. No database mocks. Integration tests use the real Postgres and Redis from testcontainers.
- Integration tests assert only on their own fixtures. `stats:dataset` and `dictionary:species-counts:<u|r>` are fixed keys shared by the whole run (memory: shared-resource assertions break on merge). Dataset numbers are asserted as deltas inside a frozen snapshot, and a ranking is asserted on a Redis logical database private to the suite.
- Minimal diff: reuse `speciesCountsByTrait`, `ButtonLink`, `EmptyState`, `humaniseKey` and `formatNumber`. Delete what the change makes dead (`missingTraitCounts`, `MissingTrait`, `MissingTraitsList`, `TOP_MISSING_TRAITS`, the `hasPlots` plumbing).
- Relative imports carry explicit `.ts`/`.tsx` extensions.
- Branch `feat/revision-13b-home`, cut from `origin/main` *after 13a has merged*, in its own worktree. Rebase onto `origin/main` before pushing; never merge `main` in.
- One commit per task. Every commit message ends with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Between Task 1 and Task 6, `pnpm typecheck` is red for `apps/api` and `apps/web`: they still name `topMissingTraits` until their own task lands. Vitest does not typecheck, so each task's own tests run anyway. Per-task checks are the named test file plus `pnpm lint`. The full pipeline, typecheck included, runs in Task 7.

### Verification (this Mac has no Node — everything runs in Docker)

Setup once, from the worktree root:

```sh
git fetch origin
git worktree add ../TreeRepro-13b -b feat/revision-13b-home origin/main
cd ../TreeRepro-13b
docker image inspect treerepro-verify:base > /dev/null   # built per memory "verify-in-docker-no-node"; build it from there if missing
docker run -d --name treerepro-13b -w /workspace \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
  -e TESTCONTAINERS_RYUK_DISABLED=true \
  treerepro-verify:base sleep infinity
```

**Sync.** Run this from the worktree root before every test run in this plan. It deletes first, sets `COPYFILE_DISABLE`, and rebuilds contracts, because api and web typecheck against its `dist`:

```sh
docker exec treerepro-13b sh -c 'cd /workspace && find . -name node_modules -prune -o -type f -exec rm -f {} +' \
&& COPYFILE_DISABLE=1 tar -cf - --exclude='./node_modules' --exclude='*/node_modules' --exclude='./.git' \
    --exclude='./data' --exclude='./.claude' --exclude='*/dist' \
    --exclude='.DS_Store' --exclude='._*' --exclude='*/._*' . \
  | docker exec -i treerepro-13b tar -x -C /workspace \
&& docker exec treerepro-13b sh -c 'cd /workspace && pnpm --filter @treerepro/contracts build'
```

Test commands used below (always after **Sync**):

- contracts: `docker exec treerepro-13b sh -c 'cd /workspace && pnpm --filter @treerepro/contracts exec vitest run src/dashboard.test.ts'`
- api integration: `docker exec treerepro-13b sh -c 'cd /workspace && pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/workspace/dashboard.integration.test.ts'`
- web, one file: `docker exec treerepro-13b sh -c 'cd /workspace && pnpm --filter @treerepro/web exec vitest run <path under apps/web>'`
- lint: `docker exec treerepro-13b sh -c 'cd /workspace && pnpm lint'`. Findings are fixed in the worktree, never with `lint:fix` in the container.

E2E cannot run on this machine. The CI `e2e` job validates Task 7's spec edit, and every asserted string is checked against the component source.

## File Structure

```
packages/contracts/src/dashboard.ts (+ .test.ts)          # dataset.primary/secondaryReferenceCount; contributor.topTraitsWithData
apps/api/src/workspace/dashboard.ts                       # computeDatasetStats counts; traitsWithData replaces missingTraitCounts
apps/api/src/workspace/dashboard.integration.test.ts
apps/api/src/dataset/dictionary.ts                        # docstring of speciesCountsByTrait only
apps/api/src/http/routes/dashboard.integration.test.ts    # one comment
apps/web/src/content/project.ts (+ .test.ts)              # R-18 copy
apps/web/src/components/workspace/IntroCard.tsx (+ test)  # full width
apps/web/src/components/workspace/QuickActions.tsx (+ test)
apps/web/src/components/workspace/TraitsWithDataList.tsx (+ test)   # replaces MissingTraitsList.tsx (+ test), deleted
apps/web/src/components/workspace/GettingStartedCard.tsx (+ test)
apps/web/src/pages/WorkspacePage.tsx (+ test)
apps/web/src/test/dataset-fixtures.ts                     # DASHBOARD.dataset, TOP_TRAITS_WITH_DATA
apps/e2e/tests/dashboard.spec.ts                          # the renamed section
```

---

### Task 1: Dashboard contract

**Files:** `packages/contracts/src/dashboard.ts`, `packages/contracts/src/dashboard.test.ts`

**Interfaces:**
- Produces (§6, verbatim): `Dashboard['dataset']` gains `primaryReferenceCount: number` and `secondaryReferenceCount: number`. `Dashboard['contributor']['topTraitsWithData']: Array<{ trait: TraitRef; category: { key: string; label: string }; speciesCount: number }>` replaces `topMissingTraits`. `referenceCount` stays, because the intro card's tiles still show it.

- [ ] **Step 1: Write the failing test.** In `packages/contracts/src/dashboard.test.ts`, replace the `topMissingTrait` constant with the one below and add the two counts to `dashboard.dataset`:

```ts
const topTraitWithData = {
  trait: { id: uuid, key: 'flower_color', valueType: 'categorical', unit: null },
  category: { key: 'flower', label: 'Flower' },
  speciesCount: 7,
};

const dashboard = {
  dataset: {
    speciesCount: 120,
    referenceCount: 40,
    primaryReferenceCount: 35,
    secondaryReferenceCount: 9,
    recordCount: 900,
    computedAt: '2026-09-18T00:00:00.000Z',
  },
  scope: {
    plots: [scopePlot],
    speciesCount: 12,
    restricted: false,
  },
  contributor: {
    missingCells: 5,
    awaitingValidation: { count: 1, records: [record] },
    topTraitsWithData: [topTraitWithData],
    summary,
  },
  curation: {
    coverage: { cells: 100, withData: 60, accepted: 40, percentWithData: 60, percentAccepted: 40 },
    queues: { pendingGroups: 2, disputed: 1, contested: 0, proposals: 0 },
  },
};
```

Add two cases at the end of `describe('RFC-72 R1 dashboardSchema', …)`:

```ts
  it('requires the primary and the secondary reference counts', () => {
    for (const field of ['primaryReferenceCount', 'secondaryReferenceCount']) {
      expect(
        dashboardSchema.safeParse({
          ...dashboard,
          dataset: { ...dashboard.dataset, [field]: undefined },
        }).success,
      ).toBe(false);
    }
  });

  it('rejects the retired topMissingTraits key', () => {
    expect(
      dashboardSchema.safeParse({
        ...dashboard,
        contributor: { ...dashboard.contributor, topMissingTraits: [] },
      }).success,
    ).toBe(false);
  });
```

Replace the two `contributor.topMissingTraits…` entries of `NESTED_STRICT_OBJECT_CASES` with:

```ts
  [
    'contributor.topTraitsWithData.0',
    () => ({
      ...dashboard,
      contributor: {
        ...dashboard.contributor,
        topTraitsWithData: [{ ...topTraitWithData, extra: 1 }],
      },
    }),
  ],
  [
    'contributor.topTraitsWithData.0.category',
    () => ({
      ...dashboard,
      contributor: {
        ...dashboard.contributor,
        topTraitsWithData: [
          { ...topTraitWithData, category: { ...topTraitWithData.category, extra: 1 } },
        ],
      },
    }),
  ],
```

- [ ] **Step 2: Run it.** Run **Sync**, then the contracts command. Expected: FAIL. `parses a full valid dashboard payload` rejects the unrecognized keys `primaryReferenceCount`, `secondaryReferenceCount` and `topTraitsWithData`, and the two `topTraitsWithData` strict-path cases fail.

- [ ] **Step 3: Implement.** In `packages/contracts/src/dashboard.ts`:

```ts
  dataset: z.strictObject({
    speciesCount: z.number().int().nonnegative(),
    referenceCount: z.number().int().nonnegative(),
    primaryReferenceCount: z.number().int().nonnegative(),
    secondaryReferenceCount: z.number().int().nonnegative(),
    recordCount: z.number().int().nonnegative(),
    computedAt: z.iso.datetime(),
  }),
```

and in `contributor`, replace `topMissingTraits` with:

```ts
    topTraitsWithData: z.array(
      z.strictObject({
        trait: traitRefSchema,
        category: z.strictObject({ key: z.string(), label: z.string() }),
        speciesCount: z.number().int().nonnegative(),
      }),
    ),
```

- [ ] **Step 4: Run to pass.** Run **Sync**, the contracts command, and lint. Expected: PASS.

- [ ] **Step 5: Commit.**

```sh
git add packages/contracts/src/dashboard.ts packages/contracts/src/dashboard.test.ts
git commit -m "feat(contracts): dashboard reference roles and top traits with data (RFC-72 R1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Primary and secondary reference counts

**Files:** `apps/api/src/workspace/dashboard.ts` (lines 40–86), `apps/api/src/workspace/dashboard.integration.test.ts`

**Interfaces:**
- Consumes: `bibliographic_references.primary_count`, `.secondary_count`. These are existing counters, maintained by the `trait_records_reference_usage` trigger.
- Produces: `computeDatasetStats(db: DbExecutor): Promise<DatasetStats>`, where `DatasetStats = { speciesCount; referenceCount; primaryReferenceCount; secondaryReferenceCount; recordCount }`. `datasetStats(ctx)` is unchanged and spreads the new fields into `Dashboard['dataset']`.

- [ ] **Step 1: Write the failing test.** In `describe('RFC-72 R1 the dataset counts', …)`, replace the body of `it('counts active species only, and every reference and record, as a delta of its own rows', …)` and rename the test:

```ts
  it('counts active species only, every reference, the references cited as primary and as secondary, and every record, as a delta of its own rows', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      // The counts are dataset-wide: only the delta around this fixture can be
      // asserted, and the frozen snapshot keeps a sibling's commits out of it.
      const before = await computeDatasetStats(tx);
      const { user } = await createUser(tx);
      const reference = await createReference(tx);
      const secondary = await createReference(tx);
      // Cited by nothing: a reference, but neither a primary nor a secondary one.
      await createReference(tx);
      const trait = await createTrait(tx, { levels: ['alpha'] });
      const active = await createSpecies(tx);
      const inactive = await createSpecies(tx);
      await tx.update(species).set({ active: false }).where(eq(species.id, inactive.id));
      for (const speciesId of [active.id, inactive.id]) {
        await createRecord(tx, {
          speciesId,
          traitId: trait.id,
          valueText: 'alpha',
          levelId: trait.levels[0]?.id,
          primaryReferenceId: reference.id,
          secondaryReferenceId: secondary.id,
          origin: 'manual',
          createdBy: user.id,
        });
      }

      const after = await computeDatasetStats(tx);
      expect(after.speciesCount - before.speciesCount).toBe(1);
      expect(after.referenceCount - before.referenceCount).toBe(3);
      // Spec R-18: a reference counts once per role it holds, however many
      // records cite it in that role.
      expect(after.primaryReferenceCount - before.primaryReferenceCount).toBe(1);
      expect(after.secondaryReferenceCount - before.secondaryReferenceCount).toBe(1);
      expect(after.recordCount - before.recordCount).toBe(2);
    });
  });
```

- [ ] **Step 2: Run it.** Run **Sync**, then the api integration command. Expected: FAIL on `primaryReferenceCount`, because `undefined - undefined` is `NaN` where `1` is expected.

- [ ] **Step 3: Implement.** In `apps/api/src/workspace/dashboard.ts`, replace `DatasetStats`, `StatsRow` and `computeDatasetStats`'s docstring head and body:

```ts
/** The global counts of RFC-72 R1, without the `computedAt` of their entry. */
export interface DatasetStats {
  speciesCount: number;
  referenceCount: number;
  primaryReferenceCount: number;
  secondaryReferenceCount: number;
  recordCount: number;
}

interface StatsRow {
  species_count: number;
  reference_count: number;
  primary_reference_count: number;
  secondary_reference_count: number;
  record_count: number;
}

/**
 * The global counts, uncached: active species (RFC-72 R1 counts only
 * those), every bibliographic reference, the references cited at least once
 * as a primary and as a secondary reference (`primary_count > 0`,
 * `secondary_count > 0`, the stored counters of RFC-61 — spec R-18), and
 * every record.
```

Keep the rest of the docstring as it is, from "The record count is `sum(record_count)`…" through `@rfc RFC-72 R1`. Then:

```ts
export async function computeDatasetStats(db: DbExecutor): Promise<DatasetStats> {
  const [row] = (await db.execute(sql`
    select
      (select count(*)::int from species s where s.active) as species_count,
      (select count(*)::int from bibliographic_references) as reference_count,
      (select (count(*) filter (where r.primary_count > 0))::int
        from bibliographic_references r) as primary_reference_count,
      (select (count(*) filter (where r.secondary_count > 0))::int
        from bibliographic_references r) as secondary_reference_count,
      (select coalesce(sum(c.record_count), 0)::int from species_trait_coverage c)
        as record_count`)) as unknown as [StatsRow | undefined];
  return {
    speciesCount: row?.species_count ?? 0,
    referenceCount: row?.reference_count ?? 0,
    primaryReferenceCount: row?.primary_reference_count ?? 0,
    secondaryReferenceCount: row?.secondary_reference_count ?? 0,
    recordCount: row?.record_count ?? 0,
  };
}
```

In `datasetStats`'s docstring, change "the same three numbers the project description quotes" to "the numbers the project description quotes".

- [ ] **Step 4: Run to pass.** Run **Sync**, the api integration command, and lint. Expected: the dataset-count tests PASS. The file's ranking tests still reference `missingTraitCounts` and pass until Task 3 changes them.

- [ ] **Step 5: Commit.**

```sh
git add apps/api/src/workspace/dashboard.ts apps/api/src/workspace/dashboard.integration.test.ts
git commit -m "feat(api): count primary and secondary references on the dashboard (RFC-72 R1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Top traits with data

**Files:** `apps/api/src/workspace/dashboard.ts` (lines 1–20, 37–38, 251–389), `apps/api/src/workspace/dashboard.integration.test.ts`, `apps/api/src/dataset/dictionary.ts` (docstring lines 128–137), `apps/api/src/http/routes/dashboard.integration.test.ts` (comment lines 103–108)

**Interfaces:**
- Consumes: `speciesCountsByTrait(ctx: { db; redis }, visibility): Promise<Map<string, number>>` (`apps/api/src/dataset/dictionary.ts:140`) and `traitVisible(visibility, activeCol)`.
- Produces: `export type TraitWithData = Dashboard['contributor']['topTraitsWithData'][number]` and `export async function traitsWithData(ctx: DashboardContext, visibility: Visibility): Promise<TraitWithData[]>`. The full ranking is ordered by `speciesCount` descending with ties broken by trait key, and traits with no species are left out. `getDashboard` answers its first ten as `contributor.topTraitsWithData`.
- Removes: `missingTraitCounts`, `MissingTrait`, `RankRow.missing` and `toMissingTrait`. A grep confirms their only users are this file and its test.

- [ ] **Step 1: Write the failing test.** In `apps/api/src/workspace/dashboard.integration.test.ts`:

1. Imports: add `beforeEach` to the `vitest` import, and replace `missingTraitCounts` with `traitsWithData` in the `./dashboard.ts` import.
2. Delete the `PLOT_CASE_MISSING` constant and its docstring. Nothing uses it any more.
3. In `describe('RFC-72 R1 getDashboard over the viewer plots', …)`, replace the `beforeAll` and add a `beforeEach`:

```ts
  beforeAll(async () => {
    // A Redis logical database of this suite's own. Every test below calls
    // `getDashboard` inside a frozen, rolled-back transaction, and
    // `getDashboard` fills fixed keys every suite shares —
    // `dictionary:species-counts:r` (read by `traitsWithData` for every
    // viewer), `stats:dataset`. On database 0 those fills would publish rows
    // that are never committed to every other suite for up to an hour. On
    // database 1, flushed before each test, they reach no one, and each test
    // reads counts of its own snapshot.
    redis = createRedis(`${inject('redisUrl')}/1`);
    await redis.connect();
  });
  beforeEach(async () => {
    await redis.flushdb();
  });
```

4. Replace `it('ranks the traits by the plot species that still miss them, and skips inactive traits', …)` with:

```ts
  it('ranks the traits by the species holding data, dataset-wide, and skips inactive traits', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const f = await plotFixture(tx);

      // The ranking without the ten-entry cut: the dashboard's own top ten is
      // filled by whatever the run's other suites have committed, so the
      // fixture's own traits are asserted on the full list (RFC-72 R1).
      const ranking = await traitsWithData({ db: tx, redis }, f.visibility);
      const at = (traitId: string) => ranking.findIndex((r) => r.trait.id === traitId);
      const countOf = (traitId: string) =>
        ranking.find((r) => r.trait.id === traitId)?.speciesCount;

      // A is held by `one` and by `outside`, a species in none of the
      // viewer's plots: the ranking is a dataset-wide statistic, open to a
      // plot-bound viewer (spec R-18 names `speciesCountsByTrait`).
      expect(countOf(f.traitA.id)).toBe(2);
      // B's second record is withdrawn but shares `awaiting`'s cell.
      expect(countOf(f.traitB.id)).toBe(1);
      expect(at(f.traitA.id)).toBeLessThan(at(f.traitB.id));
      // C has no data and the inactive trait is invisible: neither is ranked.
      expect(at(f.traitC.id)).toBe(-1);
      expect(at(f.traitOff.id)).toBe(-1);
      expect(ranking.every((r) => r.speciesCount > 0)).toBe(true);
      expect(ranking.map((r) => r.speciesCount)).toEqual(
        [...ranking.map((r) => r.speciesCount)].sort((a, b) => b - a),
      );
      expect(ranking.find((r) => r.trait.id === f.traitA.id)).toEqual({
        trait: {
          id: f.traitA.id,
          key: f.traitA.key,
          valueType: f.traitA.valueType,
          unit: f.traitA.unit,
        },
        category: expect.objectContaining({ key: expect.any(String), label: expect.any(String) }),
        speciesCount: 2,
      });

      const dashboard = await getDashboard({ db: tx, redis }, f.visibility, f.viewerScope);
      expect(dashboard.contributor.topTraitsWithData.length).toBeLessThanOrEqual(10);
      expect(dashboard.contributor.topTraitsWithData).toEqual(ranking.slice(0, 10));
    });
  });
```

5. In `describe('RFC-72 R1 getDashboard without plots', …)`, rename the test to `'has no scope, no missing cells and no validation queue, and ranks the traits with data'`. Keep its fixture. Replace everything after `expect(dashboard.contributor.awaitingValidation).toBeNull();` with:

```ts
    // The ranking reads the shared `dictionary:species-counts:r` entry
    // (committed rows only, see above), so only its shape is this test's to
    // assert: at most ten, every entry holding data, most data first.
    const top = dashboard.contributor.topTraitsWithData;
    expect(top.length).toBeLessThanOrEqual(10);
    expect(top.every((r) => r.speciesCount > 0)).toBe(true);
    expect(top.map((r) => r.speciesCount)).toEqual(
      [...top.map((r) => r.speciesCount)].sort((a, b) => b - a),
    );
  });
```

- [ ] **Step 2: Run it.** Run **Sync**, then the api integration command. Expected: FAIL. `traitsWithData` is not exported (`traitsWithData is not a function`), and `topTraitsWithData` is `undefined`.

- [ ] **Step 3: Implement.** In `apps/api/src/workspace/dashboard.ts`:

- Imports: remove `globalSpeciesVisible` from the `../access/visibility.ts` import, since its only user was `missingTraitCounts`.
- Replace the `MissingTrait` type (lines 37–38) with:

```ts
/** One entry of the traits-with-data ranking. @rfc RFC-72 R1 */
export type TraitWithData = Dashboard['contributor']['topTraitsWithData'][number];
```

- Replace `RankRow`, `toMissingTrait` and `missingTraitCounts` (lines 251–356) with:

```ts
interface TraitRow {
  trait_id: string;
  trait_key: string;
  value_type: TraitWithData['trait']['valueType'];
  unit: string | null;
  category_key: string;
  category_label: string;
}

/**
 * The visible traits ranked by how many species hold data for them, most
 * first and ties broken by trait key so the ranking is stable between calls
 * (spec R-18). A trait no species holds is left out: this answers "where is
 * the data", and a trait without any is not an answer to it.
 *
 * The per-trait counts are `speciesCountsByTrait` — the entry the dictionary
 * page already computes and caches (RFC-62 R5), read rather than recomputed,
 * because two producers writing one Redis key corrupt it the moment they
 * diverge. That entry is plot-blind: a dataset-wide statistic is open to a
 * plot-bound viewer, whose own slice is the trait lists, not this ranking.
 *
 * It is exported so a test can assert the full ranking: `getDashboard` cuts
 * it to ten, and which traits make that cut depends on every species and
 * trait in the database.
 * @rfc RFC-72 R1, R2
 * @rfc RFC-62 R5
 */
export async function traitsWithData(
  ctx: DashboardContext,
  visibility: Visibility,
): Promise<TraitWithData[]> {
  const [counts, rows] = await Promise.all([
    speciesCountsByTrait(ctx, visibility),
    ctx.db.execute(sql`
      select t.id as trait_id, t.key as trait_key, t.value_type as value_type, t.unit as unit,
             tc.key as category_key, tc.label as category_label
      from traits t
      join trait_categories tc on tc.key = t.category_key
      where ${traitVisible(visibility, sql`t.active`)}`) as unknown as Promise<TraitRow[]>,
  ]);
  return rows
    .map((r) => ({
      trait: { id: r.trait_id, key: r.trait_key, valueType: r.value_type, unit: r.unit },
      category: { key: r.category_key, label: r.category_label },
      speciesCount: counts.get(r.trait_id) ?? 0,
    }))
    .filter((r) => r.speciesCount > 0)
    .sort((a, b) => b.speciesCount - a.speciesCount || a.trait.key.localeCompare(b.trait.key));
}
```

- In `contributorSection`:

```ts
  const [missingCells, awaiting, withData, summary] = await Promise.all([
    plotIds.length === 0 ? null : missingCellCount(ctx.db, visibility, plotIds),
    plotIds.length === 0 ? null : awaitingValidation(ctx.db, visibility, plotIds),
    traitsWithData(ctx, visibility),
    contributionSummary(ctx.db, viewer.id),
  ]);
  return {
    missingCells,
    awaitingValidation: awaiting,
    topTraitsWithData: withData.slice(0, 10),
    summary,
  };
```

- In `apps/api/src/dataset/dictionary.ts`, in the `speciesCountsByTrait` docstring, replace the paragraph "Exported for the workspace dashboard (RFC-72 R1), whose `topMissingTraits` subtracts these same counts from the visible species count: one producer writes this key, …" with:

```ts
 * Exported for the workspace dashboard (RFC-72 R1), whose `topTraitsWithData`
 * ranks the traits by these same counts: one producer writes this key,
 * because two that diverge on the visibility predicate or the stored shape
 * would corrupt the dictionary page with nothing to point at.
```

- In `apps/api/src/http/routes/dashboard.integration.test.ts`, change the comment line "actor's own `awaitingValidation` and moves `missingCells`," / "`topMissingTraits` and the contribution summary." to "actor's own `awaitingValidation` and moves `missingCells` and the contribution summary."

- [ ] **Step 4: Run to pass.** Run **Sync**, then:

```sh
docker exec treerepro-13b sh -c 'cd /workspace && grep -rn "missingTraitCounts\|MissingTrait\b\|topMissingTraits\|missingSpeciesCount" apps/api packages || echo clean'
docker exec treerepro-13b sh -c 'cd /workspace && pnpm --filter @treerepro/api exec vitest run --config ../../vitest.config.ts --project api:integration src/workspace/dashboard.integration.test.ts src/http/routes/dashboard.integration.test.ts src/dataset/dictionary.integration.test.ts'
docker exec treerepro-13b sh -c 'cd /workspace && pnpm --filter @treerepro/api typecheck && pnpm lint && pnpm rfc:check'
```

Expected: `clean`; all three files PASS; api typecheck, lint and rfc:check are green.

- [ ] **Step 5: Commit.**

```sh
git add apps/api/src/workspace/dashboard.ts apps/api/src/workspace/dashboard.integration.test.ts apps/api/src/dataset/dictionary.ts apps/api/src/http/routes/dashboard.integration.test.ts
git commit -m "feat(api): top traits with data replaces top traits missing data (RFC-72 R1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Intro text — reference roles and full width

**Files:** `apps/web/src/content/project.ts` (+ `project.test.ts`), `apps/web/src/components/workspace/IntroCard.tsx` (+ `IntroCard.test.tsx`), `apps/web/src/test/dataset-fixtures.ts` (the `DASHBOARD` constant, ~line 1004), `apps/web/src/pages/WorkspacePage.test.tsx` (lines 71–75)

**Interfaces:**
- Consumes: `Dashboard['dataset']` from Task 1.
- Produces: `interface ProjectCounts { primaryReferenceCount: number; secondaryReferenceCount: number; recordCount: number; speciesCount: number }` and `projectDescription(counts: ProjectCounts): string`, which returns the spec R-18 text verbatim. `IntroCard({ dataset })` keeps its signature.

- [ ] **Step 1: Write the failing tests.**

`apps/web/src/content/project.test.ts`, whole file:

```ts
import { describe, expect, it } from 'vitest';
import { CONTACT_EMAIL, projectDescription } from './project.ts';

const COUNTS = {
  primaryReferenceCount: 38,
  secondaryReferenceCount: 12,
  recordCount: 980,
  speciesCount: 120,
};

describe('RFC-72 R3 projectDescription', () => {
  it('reproduces the fixed copy character for character with the counts substituted', () => {
    expect(projectDescription(COUNTS)).toBe(
      'TreeRepro is a collective data assembly of reproductive trait data for trees, ' +
        'covering traits across all reproductive stages — flower, fruits, and seeds. ' +
        'Its core data comes from open-source papers and data repositories spanning ' +
        '38 primary references, 12 secondary references and 980 records over 120 species. ' +
        'It is shared here with a community of specialists to fill gaps and ' +
        'validate existing records. ' +
        'For questions, contact elisabpereira@gmail.com.',
    );
  });

  it('substitutes a different set of counts the same way', () => {
    expect(
      projectDescription({
        primaryReferenceCount: 1,
        secondaryReferenceCount: 2,
        recordCount: 3,
        speciesCount: 4,
      }),
    ).toContain('spanning 1 primary references, 2 secondary references and 3 records over 4 species.');
  });

  it('CONTACT_EMAIL is the address embedded in the paragraph', () => {
    expect(
      projectDescription({
        primaryReferenceCount: 0,
        secondaryReferenceCount: 0,
        recordCount: 0,
        speciesCount: 0,
      }),
    ).toContain(CONTACT_EMAIL);
  });
});
```

`apps/web/src/test/dataset-fixtures.ts`: in `DASHBOARD.dataset`, add two fields after `referenceCount: 45,`:

```ts
    primaryReferenceCount: 38,
    secondaryReferenceCount: 12,
```

`apps/web/src/components/workspace/IntroCard.test.tsx`: replace the first test's expected substring and add a width test:

```ts
  it('renders the description with the dataset counts substituted and the contact e-mail as a link', () => {
    render(<IntroCard dataset={DASHBOARD.dataset} />);
    expect(
      screen.getByText(/TreeRepro is a collective data assembly of reproductive trait data/),
    ).toHaveTextContent(
      `spanning ${DASHBOARD.dataset.primaryReferenceCount} primary references, ${DASHBOARD.dataset.secondaryReferenceCount} secondary references and ${DASHBOARD.dataset.recordCount} records over ${DASHBOARD.dataset.speciesCount} species`,
    );
    const link = screen.getByRole('link', { name: 'elisabpereira@gmail.com' });
    expect(link).toHaveAttribute('href', 'mailto:elisabpereira@gmail.com');
  });

  it('lets the description take the full width of its card', () => {
    render(<IntroCard dataset={DASHBOARD.dataset} />);
    expect(screen.getByText(/TreeRepro is a collective data assembly/)).not.toHaveClass(
      'max-w-3xl',
    );
  });
```

`apps/web/src/pages/WorkspacePage.test.tsx`, lines 73–75: the expected substring becomes

```ts
    ).toHaveTextContent(
      `spanning ${DASHBOARD.dataset.primaryReferenceCount} primary references, ${DASHBOARD.dataset.secondaryReferenceCount} secondary references and ${DASHBOARD.dataset.recordCount} records over ${DASHBOARD.dataset.speciesCount} species`,
    );
```

- [ ] **Step 2: Run them.** Run **Sync**, then the web command with `src/content/project.test.ts src/components/workspace/IntroCard.test.tsx src/pages/WorkspacePage.test.tsx`. Expected: FAIL. The copy still reads "45 references and…" and "specialist scientists", and the paragraph still carries `max-w-3xl`.

- [ ] **Step 3: Implement.** In `apps/web/src/content/project.ts`, replace `ProjectCounts` and `projectDescription`:

```ts
/**
 * The dataset counts {@link projectDescription} substitutes into the fixed
 * copy: the numbers `WorkspacePage` reads off `dashboard.dataset`
 * (RFC-72 R1).
 */
export interface ProjectCounts {
  primaryReferenceCount: number;
  secondaryReferenceCount: number;
  recordCount: number;
  speciesCount: number;
}

/**
 * The project's introduction, reproduced character for character from
 * RFC-72 R3 (spec R-18) with the dataset's live counts substituted in. The
 * copy lives here, on its own, so the project owner can edit it without
 * touching a component; the contact e-mail is rendered as a link by the
 * caller, not by this module, which carries only the words.
 * @rfc RFC-72 R3
 */
export function projectDescription(counts: ProjectCounts): string {
  return (
    'TreeRepro is a collective data assembly of reproductive trait data for trees, ' +
    'covering traits across all reproductive stages — flower, fruits, and seeds. ' +
    'Its core data comes from open-source papers and data repositories spanning ' +
    `${counts.primaryReferenceCount} primary references, ` +
    `${counts.secondaryReferenceCount} secondary references and ` +
    `${counts.recordCount} records over ${counts.speciesCount} species. ` +
    'It is shared here with a community of specialists to fill gaps and ' +
    'validate existing records. ' +
    `For questions, contact ${CONTACT_EMAIL}.`
  );
}
```

In `apps/web/src/components/workspace/IntroCard.tsx` line 13:

```tsx
    <p className="text-body text-mist-500">
```

- [ ] **Step 4: Run to pass.** Run **Sync**, the same web command, and lint. Expected: PASS.

- [ ] **Step 5: Commit.**

```sh
git add apps/web/src/content/project.ts apps/web/src/content/project.test.ts apps/web/src/components/workspace/IntroCard.tsx apps/web/src/components/workspace/IntroCard.test.tsx apps/web/src/test/dataset-fixtures.ts apps/web/src/pages/WorkspacePage.test.tsx
git commit -m "feat(web): intro text quotes primary and secondary references, full width (RFC-72 R3)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Quick actions — Browse species, traits, references

**Files:** `apps/web/src/components/workspace/QuickActions.tsx` (+ `QuickActions.test.tsx`), `apps/web/src/pages/WorkspacePage.tsx` (line 63), `apps/web/src/pages/WorkspacePage.test.tsx` (lines 95–117)

**Interfaces:**
- Produces: `QuickActions(): JSX.Element`, with no props (the `hasPlots` prop goes). It renders exactly three `ButtonLink`s inside `<nav aria-label="Quick actions">`: `Browse species` → `/app/species`, `Browse traits` → `/app/traits`, `Browse references` → `/app/references`.

- [ ] **Step 1: Write the failing tests.** Replace the `describe` block of `apps/web/src/components/workspace/QuickActions.test.tsx`, keeping `renderInRouter`. Delete the `hrefUrl` helper, which is no longer used.

```tsx
describe('RFC-72 R3 QuickActions', () => {
  it.each([
    ['Browse species', '/app/species'],
    ['Browse traits', '/app/traits'],
    ['Browse references', '/app/references'],
  ])('%s goes to %s', async (name, href) => {
    renderInRouter(<QuickActions />);
    expect(await screen.findByRole('link', { name })).toHaveAttribute('href', href);
  });

  it('offers exactly those three links', async () => {
    renderInRouter(<QuickActions />);
    await screen.findByRole('link', { name: 'Browse species' });
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });
});
```

In `apps/web/src/pages/WorkspacePage.test.tsx`, replace `it('quick actions link to their exact URLs', …)` with:

```tsx
  it('quick actions browse the species, the traits and the references', async () => {
    renderAt('/app/');
    const quickActions = await screen.findByRole('navigation', { name: 'Quick actions' });
    // "Browse species" also appears on the scope card, so each link is found
    // within Quick actions specifically.
    for (const [name, href] of [
      ['Browse species', '/app/species'],
      ['Browse traits', '/app/traits'],
      ['Browse references', '/app/references'],
    ] as const) {
      expect(within(quickActions).getByRole('link', { name })).toHaveAttribute('href', href);
    }
    expect(within(quickActions).getAllByRole('link')).toHaveLength(3);
  });
```

- [ ] **Step 2: Run them.** Run **Sync**, then the web command with `src/components/workspace/QuickActions.test.tsx src/pages/WorkspacePage.test.tsx`. Expected: FAIL. No link named "Browse traits" exists, and Quick actions holds the old links.

- [ ] **Step 3: Implement.** `apps/web/src/components/workspace/QuickActions.tsx`, whole file:

```tsx
import { ButtonLink } from '../ui/index.ts';

/**
 * The dashboard's three ways into the dataset (RFC-72 R3, spec R-18): the
 * species list, the trait dictionary and the references, each unfiltered.
 * @rfc RFC-72 R3
 */
export function QuickActions() {
  return (
    <nav aria-label="Quick actions" className="flex flex-wrap gap-3">
      <ButtonLink to="/app/species">Browse species</ButtonLink>
      <ButtonLink to="/app/traits">Browse traits</ButtonLink>
      <ButtonLink to="/app/references">Browse references</ButtonLink>
    </nav>
  );
}
```

In `apps/web/src/pages/WorkspacePage.tsx` line 63, `<QuickActions hasPlots={hasPlots} />` becomes `<QuickActions />`. `hasPlots` is still read by the missing-traits section until Task 6.

- [ ] **Step 4: Run to pass.** Run **Sync**, the same web command, and lint. Expected: PASS.

- [ ] **Step 5: Commit.**

```sh
git add apps/web/src/components/workspace/QuickActions.tsx apps/web/src/components/workspace/QuickActions.test.tsx apps/web/src/pages/WorkspacePage.tsx apps/web/src/pages/WorkspacePage.test.tsx
git commit -m "feat(web): quick actions browse species, traits and references (RFC-72 R3)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Top traits with data on the page

**Files:** `git mv` `apps/web/src/components/workspace/MissingTraitsList.tsx` → `TraitsWithDataList.tsx` and `MissingTraitsList.test.tsx` → `TraitsWithDataList.test.tsx`; `apps/web/src/test/dataset-fixtures.ts` (lines 957–990); `apps/web/src/pages/WorkspacePage.tsx`; `apps/web/src/pages/WorkspacePage.test.tsx` (lines 144–186)

**Interfaces:**
- Consumes: `Dashboard['contributor']['topTraitsWithData']` (Task 1).
- Produces: `TraitsWithDataList({ traits }: { traits: Dashboard['contributor']['topTraitsWithData'] })`, an ordered list in which each trait links to `/app/traits/$id` and carries "N species". Fixture `TOP_TRAITS_WITH_DATA` replaces `TOP_MISSING_TRAITS`. The page section is headed "Top traits with data", and its empty state reads "No trait has data yet."

- [ ] **Step 1: Write the failing tests.**

```sh
git mv apps/web/src/components/workspace/MissingTraitsList.tsx apps/web/src/components/workspace/TraitsWithDataList.tsx
git mv apps/web/src/components/workspace/MissingTraitsList.test.tsx apps/web/src/components/workspace/TraitsWithDataList.test.tsx
```

In `apps/web/src/test/dataset-fixtures.ts`, replace `TOP_MISSING_TRAITS` and rename its two uses in `DASHBOARD_CONTRIBUTOR` and `NO_PLOTS_CONTRIBUTOR` (`topMissingTraits: TOP_MISSING_TRAITS,` → `topTraitsWithData: TOP_TRAITS_WITH_DATA,`):

```ts
/** Ranked traits with data, descending by species count. @rfc RFC-72 R1 */
export const TOP_TRAITS_WITH_DATA: Dashboard['contributor']['topTraitsWithData'] = [
  {
    trait: SEED_MASS,
    category: { key: 'seed', label: 'Seed' },
    speciesCount: 40,
  },
  {
    trait: POLLINATION_MODE,
    category: { key: 'pollination', label: 'Pollination' },
    speciesCount: 12,
  },
];
```

`apps/web/src/components/workspace/TraitsWithDataList.test.tsx`: keep the router helper, drop `hrefUrl`, and replace the imports of the fixture and component and the `describe`:

```tsx
import { TOP_TRAITS_WITH_DATA } from '../../test/dataset-fixtures.ts';
import { TraitsWithDataList } from './TraitsWithDataList.tsx';

// … renderInRouter unchanged …

describe('RFC-72 R3 TraitsWithDataList', () => {
  it('ranks the traits with their species count, each linking to its trait page', async () => {
    renderInRouter(<TraitsWithDataList traits={TOP_TRAITS_WITH_DATA} />);
    const [first, second] = TOP_TRAITS_WITH_DATA;
    if (!first || !second) throw new Error('fixture has fewer than two traits');
    expect(await screen.findByRole('link', { name: 'seed mass' })).toHaveAttribute(
      'href',
      `/app/traits/${first.trait.id}`,
    );
    expect(screen.getByRole('link', { name: 'pollination mode' })).toHaveAttribute(
      'href',
      `/app/traits/${second.trait.id}`,
    );
    expect(screen.getByText('40 species')).toBeInTheDocument();
    expect(screen.getByText('12 species')).toBeInTheDocument();
  });
});
```

In `apps/web/src/pages/WorkspacePage.test.tsx`, add `TOP_TRAITS_WITH_DATA` to the `../test/dataset-fixtures.ts` import. Replace the three tests `'links the top missing traits with scope=plots…'`, `'shows the empty state when no trait is missing data'` and `'shows the empty state without plots when no trait is missing data'` with:

```tsx
  it('lists the top traits with data, each linking to its trait page, with or without plots', async () => {
    const [first] = TOP_TRAITS_WITH_DATA;
    if (!first) throw new Error('fixture has no traits');
    const withPlots = renderAt('/app/');
    expect(await screen.findByRole('heading', { name: 'Top traits with data' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'seed mass' })).toHaveAttribute(
      'href',
      `/app/traits/${first.trait.id}`,
    );
    withPlots.unmount();

    dashboard.fetchDashboard.mockResolvedValue(NO_PLOTS_DASHBOARD);
    renderAt('/app/');
    expect(await screen.findByRole('heading', { name: 'Top traits with data' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'seed mass' })).toHaveAttribute(
      'href',
      `/app/traits/${first.trait.id}`,
    );
  });

  it('shows the empty state when no trait has data', async () => {
    dashboard.fetchDashboard.mockResolvedValue({
      ...DASHBOARD,
      contributor: { ...DASHBOARD.contributor, topTraitsWithData: [] },
    });
    renderAt('/app/');
    expect(await screen.findByText('No trait has data yet.')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them.** Run **Sync**, then the web command with `src/components/workspace/TraitsWithDataList.test.tsx src/pages/WorkspacePage.test.tsx`. Expected: FAIL. `TraitsWithDataList` is not exported by the renamed file, and the page has no "Top traits with data" heading.

- [ ] **Step 3: Implement.** `apps/web/src/components/workspace/TraitsWithDataList.tsx`, whole file:

```tsx
import { Link } from '@tanstack/react-router';
import type { Dashboard } from '@treerepro/contracts';
import { formatNumber, humaniseKey } from '../../lib/format.ts';

/**
 * The traits with the most species holding data, ranked (RFC-72 R3,
 * spec R-18). Each one opens its trait page.
 * @rfc RFC-72 R3
 */
export function TraitsWithDataList({
  traits,
}: {
  traits: Dashboard['contributor']['topTraitsWithData'];
}) {
  return (
    <ol className="flex flex-col divide-y divide-canopy-700/10">
      {traits.map((entry, index) => (
        <li key={entry.trait.id} className="flex items-center justify-between gap-4 py-2.5">
          <span className="flex items-center gap-3">
            <span className="text-meta tabular-nums text-mist-500">{index + 1}</span>
            <Link
              to="/app/traits/$id"
              params={{ id: entry.trait.id }}
              className="font-medium text-canopy-900 underline-offset-2 hover:underline"
            >
              {humaniseKey(entry.trait.key)}
            </Link>
          </span>
          <span className="text-meta tabular-nums text-mist-500">
            {formatNumber(entry.speciesCount)} species
          </span>
        </li>
      ))}
    </ol>
  );
}
```

In `apps/web/src/pages/WorkspacePage.tsx`:
- The import `MissingTraitsList` from `'../components/workspace/MissingTraitsList.tsx'` becomes `import { TraitsWithDataList } from '../components/workspace/TraitsWithDataList.tsx';`.
- Delete `const hasPlots = data ? data.scope !== null : false;`, which has no reader left.
- Replace the `missing-traits-heading` section (lines 82–99) with:

```tsx
          <section aria-labelledby="traits-with-data-heading" className={SECTION_CLASS}>
            <h2 id="traits-with-data-heading" className={HEADING_CLASS}>
              Top traits with data
            </h2>
            {data.contributor.topTraitsWithData.length === 0 ? (
              <EmptyState title="No trait has data yet." />
            ) : (
              <TraitsWithDataList traits={data.contributor.topTraitsWithData} />
            )}
          </section>
```

- In the component docstring, "the traits most missing data" becomes "the traits with the most data", and "every section but \"Top traits missing data\" and" becomes "every section but \"Top traits with data\" and".

- [ ] **Step 4: Run to pass.** Run **Sync**, then:

```sh
docker exec treerepro-13b sh -c 'cd /workspace && grep -rn "topMissingTraits\|TOP_MISSING_TRAITS\|MissingTraitsList\|missingSpeciesCount\|hasPlots=" apps/web/src || echo clean'
docker exec treerepro-13b sh -c 'cd /workspace && pnpm --filter @treerepro/web exec vitest run src/components/workspace src/pages/WorkspacePage.test.tsx src/content/project.test.ts'
docker exec treerepro-13b sh -c 'cd /workspace && pnpm --filter @treerepro/web typecheck && pnpm lint && pnpm rfc:check'
```

Expected: `clean`; PASS; web typecheck, lint and rfc:check are green.

- [ ] **Step 5: Commit.**

```sh
git add -A apps/web/src/components/workspace apps/web/src/test/dataset-fixtures.ts apps/web/src/pages/WorkspacePage.tsx apps/web/src/pages/WorkspacePage.test.tsx
git commit -m "feat(web): top traits with data, linking to the trait page (RFC-72 R3)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Getting started without its opening sentence; E2E; close-out

**Files:** `apps/web/src/components/workspace/GettingStartedCard.tsx` (lines 52–55) (+ `GettingStartedCard.test.tsx`), `apps/e2e/tests/dashboard.spec.ts` (lines 107–116)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test.** Add to `describe('RFC-73 R3 GettingStartedCard', …)` in `GettingStartedCard.test.tsx`:

```tsx
  it('RFC-72 R3 opens straight on the checklist, with no introductory sentence', async () => {
    render(withRouter(<GettingStartedCard summary={ZERO_CONTRIBUTION_SUMMARY} />));
    await screen.findByRole('heading', { name: 'Getting started' });
    expect(screen.queryByText(/A few places to start/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run it.** Run **Sync**, then the web command with `src/components/workspace/GettingStartedCard.test.tsx`. Expected: FAIL, because the sentence is found.

- [ ] **Step 3: Implement.** In `GettingStartedCard.tsx`, delete the paragraph:

```tsx
      <p className="text-body text-mist-500">
        A few places to start now that you have access. Each one opens straight into what it
        describes.
      </p>
```

- [ ] **Step 4: Run to pass.** Run **Sync**, the same command, and lint. Expected: PASS.

- [ ] **Step 5: E2E.** In `apps/e2e/tests/dashboard.spec.ts`, replace the block from `// ── Top traits missing data in your plots:` through `await expect(missingSection.getByText('1 species').first()).toBeVisible();` with the code below. The strings match `WorkspacePage.tsx` and `TraitsWithDataList.tsx` from Task 6.

```ts
      // ── Top traits with data: dataset-wide, read from a ten-minute cache
      // (RFC-62 R5) that other specs may have warmed before any record
      // existed, so either a ranked trait linking to its page or the empty
      // state is accepted — which one is not this test's to pin down. ─────
      const withDataSection = page.getByRole('region', { name: 'Top traits with data' });
      await expect(withDataSection).toBeVisible();
      await expect(
        withDataSection
          .getByRole('link')
          .first()
          .or(withDataSection.getByText('No trait has data yet.')),
      ).toBeVisible();
```

- [ ] **Step 6: Commit.**

```sh
git add apps/web/src/components/workspace/GettingStartedCard.tsx apps/web/src/components/workspace/GettingStartedCard.test.tsx apps/e2e/tests/dashboard.spec.ts
git commit -m "feat(web): getting started opens on its checklist; E2E for top traits with data (RFC-72 R3)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Rebase and run the full pipeline on the rebased tree.** Other wave-1 plans (13d, 13e, 13f) may have merged. In particular, 13e renames `curation.coverage.accepted*` in the same contract file, which is a different block. Then:

```sh
git fetch origin && git rebase origin/main
```

Run **Sync**, then:

```sh
docker exec treerepro-13b sh -c 'cd /workspace && pnpm lint && pnpm typecheck && pnpm rfc:check && pnpm build && pnpm test'
```

Expected: all green. After the rebase, also grep for the other branches' new strings and for the strings this branch removed, in both web and e2e:

```sh
grep -rn "Top traits missing\|Validate records\|Enter new data\|topMissingTraits\|A few places to start" apps/web/src apps/e2e/tests packages apps/api/src || echo clean
```

Expected: `clean`. The one allowed exception is the comment in `apps/e2e/tests/health.spec.ts:22`. Leave it, or change it to "Top traits with data" in the same commit.

- [ ] **Step 8: Review, push, PR.** Run CodeRabbit locally once with `coderabbit review --agent --base main` and triage every finding against RFC-72 and spec R-18. Then:

```sh
git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push -u origin feat/revision-13b-home
gh pr create --title "feat: home page — reference roles, browse actions, top traits with data (plan 13b)" --body "$(cat <<'EOF'
Spec R-18 (docs/specs/2026-09-25-record-model-revision-design.md §1.8, §6 "13b dashboard contract").

- `dataset.primaryReferenceCount` / `secondaryReferenceCount` (`primary_count > 0` / `secondary_count > 0`), in the intro copy.
- Intro text at full card width.
- Quick actions: Browse species / traits / references.
- `contributor.topTraitsWithData` replaces `topMissingTraits` (top ten of `speciesCountsByTrait`, linking to `/app/traits/$id`); `missingTraitCounts` and `MissingTraitsList` deleted.
- Getting started loses its opening sentence.

**Deploy step (required).** Redis is persistent (`appendonly yes`). Entries written by the old code lack the new fields, and the web parses the answer strictly, so drop them right after the deploy or the home page shows an error for up to an hour:

    docker compose exec redis sh -c 'export REDISCLI_AUTH="$(cat /run/secrets/redis_password)"; redis-cli --no-auth-warning DEL stats:dataset; redis-cli --no-auth-warning --scan --pattern "dashboard:*" | xargs -r redis-cli --no-auth-warning DEL'

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Before merging, read the PR's CodeRabbit comments (`gh api repos/ElisaBarreto/TreeRepro/pulls/<n>/comments --paginate`). Do not rely on the green check.

## Spec notes

1. **RFC rule numbers.** 13a amends RFC-72 R1 (contract) and R3 (copy) for spec R-18. The new numbering is unknown when this is written, so tags and test names use the existing ids `RFC-72 R1` / `RFC-72 R3`. If 13a added a new rule instead, re-point the tags in Task 7 Step 7 before the pipeline run.
2. **`referenceCount` stays.** §6 adds the two role counts but does not remove the total, and the intro card's "References" tile still shows it. The minimal reading keeps it.
3. **Top traits with data is dataset-wide for every viewer**, plots or not. Spec R-18 names `speciesCountsByTrait`, which is plot-blind by design (RFC-62 R5), and statistics about the whole dataset are open to plot-bound viewers. The heading therefore has no "in your plots" variant, and the link goes to the trait page, not to a plot-scoped species list.
4. **Cache shape change.** `stats:dataset` (1 h) and `dashboard:<viewer>` (5 min) outlive a deploy in the persistent Redis. The PR carries a required post-deploy `DEL`. The alternative, versioned key names, touches four route files and RFC-72's key names for a one-off.
5. **Test isolation.** `traitsWithData` now runs for every viewer, so the plot-case suite, which calls `getDashboard` inside frozen rolled-back transactions, would fill the shared `dictionary:species-counts:r` entry with rows that are never committed. The suite moves to a Redis logical database of its own (`/1`), flushed before each test. That also removes the older `stats:dataset` hazard the file's header warns about, for that suite.
6. **Getting started.** The spec's "loses its opening sentence" is read as the one `<p>` under the heading. The checklist and the Hide button stay.
7. **E2E.** The dashboard spec accepts either a ranked link or the empty state, because the dataset-wide ranking reads a cache that sibling specs may have warmed. The CI `e2e` job validates it.
