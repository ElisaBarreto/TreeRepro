# Browsing 10a — Coverage Table, Species Trait Filters, Completeness Order, Hierarchical Breadcrumb — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`).

**Goal:** `species_trait_coverage` and `species.trait_count` maintained by the `trait_records` insert trigger and backfilled; `GET /api/species` filters by trait category / trait / with-or-missing data and orders by completeness; the species search form gains the Traits group and the Order select, all in the URL; the shell breadcrumb becomes hierarchical.

**Architecture:** One migration adds the table, the column, extends the existing statement trigger function `trait_records_reference_usage` (renamed `trait_records_after_insert` to say what it now does) and backfills. `searchSpecies` gains `categoryKey`, `traitId`, `traitData`, `sort` with a three-key keyset for completeness. The web shell gets a `BreadcrumbContext`; pages register trailing crumbs with `useBreadcrumb`.

**Tech Stack:** unchanged. No new dependencies.

**Spec:** `docs/specs/2026-09-17-browsing-design.md` §3, §4, §9, §11. Depends on plans 08a, 08b (scope group in the same form) and 09b (search params on the species detail route).

## Global Constraints

Same as plan 08a. Branch `feat/browsing-10a` in worktree `../Elisa-10a`.

## File structure (end state)

```
docs/rfc/60-dataset/69-coverage-summary.md                # new (R1–R4; R5–R7 come with plan 11c)
docs/rfc/60-dataset/60-taxonomy-catalog.md                # R1 trait_count; R6 filters, sort, item fields
docs/rfc/10-platform/13-presentation-layer.md             # R3 breadcrumb
docs/rfc/README.md
apps/api/drizzle/0022_coverage.sql                        # generated + trigger + backfill (hand-appended)
apps/api/src/db/schema/coverage.ts                        # speciesTraitCoverage
apps/api/src/db/schema/taxa.ts                            # traitCount
apps/api/src/db/schema/coverage.integration.test.ts       # trigger behaviour
apps/api/src/dataset/taxa.ts (+ test)                     # filters, sort, item fields
apps/api/src/http/routes/dataset/species.ts (+ test)
packages/contracts/src/dataset.ts (+ test)                # query fields; item fields
apps/web/src/components/shell/Breadcrumb.tsx (+ test)     # context, provider, useBreadcrumb
apps/web/src/components/shell/AppShell.tsx                # renders the crumbs
apps/web/src/components/dataset/SpeciesSearchForm.tsx (+ test)
apps/web/src/components/dataset/SpeciesList.tsx (+ test)
apps/web/src/pages/dataset/SpeciesSearchPage.tsx (+ test), SpeciesPage.tsx (+ test), ReferencePage.tsx
apps/web/src/pages/admin/PlotPage.tsx                     # crumbs retrofit
apps/web/src/routes/app/species/index.tsx                 # validateSearch for every filter
apps/web/src/test/dataset-fixtures.ts
docs/gotchas/postgres.md                                  # backfill duration note
```

---

### Task 1: RFC-69 and the amendments

- [ ] **Step 1: RFC-69** — `docs/rfc/60-dataset/69-coverage-summary.md`, `draft`, category dataset; Context: "Lists that filter or sort by 'has data for this trait' cannot aggregate eight million records per request; this table is the maintained answer"; R1–R4 verbatim from the spec §3 (R2 names the trigger function `trait_records_after_insert`).
- [ ] **Step 2: RFC-60** — R1 `species` gains `trait_count integer not null default 0` (RFC-69 R1); R6: the query gains `categoryKey=&traitId=&traitData=&sort=` with the rules of the spec §4 (bullets 1–4 verbatim), the item gains `traitCount` and `traitRecordCount`; the cursor for `sort=completeness` is `[trait_count, canonical_name, id]`. Changelog line.
- [ ] **Step 3: RFC-13 R3** — append: "The breadcrumb reads `Group › Entry › crumbs…`, where the trailing crumbs are registered by the page through `useBreadcrumb`; the last crumb is text, the others link." Changelog line.
- [ ] **Step 4: README row RFC-69 draft; commit** — `docs(rfc): RFC-69 coverage summary; RFC-60 trait filters and completeness; RFC-13 breadcrumb (plan 10a)`.

---

### Task 2: Contracts

**Files:** `packages/contracts/src/dataset.ts` (+ test)

**Interfaces (produces):**

```ts
export const TRAIT_DATA_MODES = ['with', 'missing'] as const;
export const SPECIES_SORTS = ['name', 'completeness'] as const;
export const listSpeciesQuerySchema = cursorQuerySchema.extend({
  q, familyId, genusId, unresolved, status, scope, plotId,                     // existing
  categoryKey: z.string().trim().min(1).max(100).optional(),
  traitId: z.uuid().optional(),
  traitData: z.enum(TRAIT_DATA_MODES).optional(),
  sort: z.enum(SPECIES_SORTS).optional(),
});
export const speciesListItemSchema = … .extend({ traitCount: z.number().int().nonnegative(), traitRecordCount: z.number().int().nonnegative().nullable() });
```

- [ ] **Step 1: Failing test** — `traitData` without `traitId` or `categoryKey` is accepted by the schema (the API decides); the item requires `traitCount` and `traitRecordCount`.
- [ ] **Step 2: Implement; update web fixtures (`traitCount: 3, traitRecordCount: null`); build; commit** — `feat(contracts): species trait filters, sort, coverage fields (RFC-60 R6)`.

---

### Task 3: Schema, trigger, backfill

**Files:** `apps/api/src/db/schema/coverage.ts`, `taxa.ts`, `index.ts`, `0022_coverage.sql`, `coverage.integration.test.ts`

- [ ] **Step 1: Failing trigger test**

```ts
describe('RFC-69 R1, R2 species_trait_coverage', () => {
  const t = useTestDb();

  it('a first record creates the pair and bumps trait_count; more records only add counts', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const sp1 = await createSpecies(t.db);
    const level = (i: number) => trait.levels[i]?.id as string;
    await createRecord(t.db, { speciesId: sp1.id, traitId: trait.id, valueText: 'a', levelId: level(0), primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id });
    const row = async () => (await t.db.select().from(speciesTraitCoverage).where(and(eq(speciesTraitCoverage.speciesId, sp1.id), eq(speciesTraitCoverage.traitId, trait.id))))[0];
    const count = async () => (await t.db.select({ n: species.traitCount }).from(species).where(eq(species.id, sp1.id)))[0]?.n;
    expect(await row()).toMatchObject({ recordCount: 1, harmonisedCount: 1 });
    expect(await count()).toBe(1);
    await createRecord(t.db, { speciesId: sp1.id, traitId: trait.id, valueText: 'zzz', harmonisation: 'unknown_level', primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id });
    expect(await row()).toMatchObject({ recordCount: 2, harmonisedCount: 1 });
    expect(await count()).toBe(1);
    const other = await createTrait(t.db);
    await createRecord(t.db, { speciesId: sp1.id, traitId: other.id, valueText: 'alpha', levelId: other.levels[0]?.id, primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id });
    expect(await count()).toBe(2);
  });

  it('a multi-row insert counts pairs once', async () => {
    const { user } = await createUser(t.db);
    const ref1 = await createReference(t.db);
    const ref2 = await createReference(t.db);
    const trait = await createTrait(t.db);
    const sp1 = await createSpecies(t.db);
    await t.db.insert(traitRecords).values([ref1, ref2].map((r) => ({ speciesId: sp1.id, traitId: trait.id, valueText: 'alpha', levelId: trait.levels[0]?.id, harmonisation: 'harmonised' as const, origin: 'manual' as const, createdBy: user.id, primaryReferenceId: r.id })));
    const [c] = await t.db.select({ n: species.traitCount }).from(species).where(eq(species.id, sp1.id));
    expect(c?.n).toBe(1);
    const [row] = await t.db.select().from(speciesTraitCoverage).where(eq(speciesTraitCoverage.speciesId, sp1.id));
    expect(row?.recordCount).toBe(2);
  });

  it('the app role cannot write the table directly', async () => {
    await expect(unwrapDbError(t.db.insert(speciesTraitCoverage).values({ speciesId: '00000000-0000-7000-8000-000000000000', traitId: '00000000-0000-7000-8000-000000000001', recordCount: 1, harmonisedCount: 1, firstRecordAt: new Date(), lastRecordAt: new Date() }))).rejects.toMatchObject({ code: '42501' });
  });
});
```

- [ ] **Step 2: Schema**

```ts
// coverage.ts
/** Maintained by the trait_records insert trigger; read-only for the app role. @rfc RFC-69 R1, R2 */
export const speciesTraitCoverage = pgTable(
  'species_trait_coverage',
  {
    speciesId: uuid('species_id').notNull().references(() => species.id, { onDelete: 'restrict' }),
    traitId: uuid('trait_id').notNull().references(() => traits.id, { onDelete: 'restrict' }),
    recordCount: integer('record_count').notNull(),
    harmonisedCount: integer('harmonised_count').notNull(),
    firstRecordAt: ts('first_record_at').notNull(),
    lastRecordAt: ts('last_record_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.speciesId, t.traitId] }), index('species_trait_coverage_trait_idx').on(t.traitId, t.speciesId)],
);
```

`taxa.ts` `species`: `traitCount: integer('trait_count').notNull().default(0)` and `index('species_trait_count_idx').on(t.traitCount, t.canonicalName, t.id)`.

- [ ] **Step 3: Migration** — `db:generate --name coverage`, then append:

```sql
--> statement-breakpoint
-- RFC-69 R2: the statement trigger of 0015 now also maintains coverage.
CREATE OR REPLACE FUNCTION trait_records_reference_usage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE bibliographic_references r SET primary_count = r.primary_count + u.n
  FROM (SELECT primary_reference_id AS id, count(*) AS n FROM inserted WHERE primary_reference_id IS NOT NULL GROUP BY 1) u
  WHERE r.id = u.id;
  UPDATE bibliographic_references r SET secondary_count = r.secondary_count + u.n
  FROM (SELECT secondary_reference_id AS id, count(*) AS n FROM inserted WHERE secondary_reference_id IS NOT NULL GROUP BY 1) u
  WHERE r.id = u.id;
  WITH agg AS (
    SELECT species_id, trait_id, count(*) AS n, count(*) FILTER (WHERE harmonisation = 'harmonised') AS h,
           min(created_at) AS first_at, max(created_at) AS last_at
    FROM inserted GROUP BY 1, 2
  ), upserted AS (
    INSERT INTO species_trait_coverage (species_id, trait_id, record_count, harmonised_count, first_record_at, last_record_at)
    SELECT species_id, trait_id, n, h, first_at, last_at FROM agg
    ON CONFLICT (species_id, trait_id) DO UPDATE SET
      record_count = species_trait_coverage.record_count + EXCLUDED.record_count,
      harmonised_count = species_trait_coverage.harmonised_count + EXCLUDED.harmonised_count,
      last_record_at = greatest(species_trait_coverage.last_record_at, EXCLUDED.last_record_at)
    RETURNING species_id, (xmax = 0) AS inserted_new
  )
  UPDATE species s SET trait_count = s.trait_count + c.n
  FROM (SELECT species_id, count(*) AS n FROM upserted WHERE inserted_new GROUP BY 1) c
  WHERE s.id = c.species_id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION trait_records_reference_usage() FROM PUBLIC;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON species_trait_coverage FROM treerepro_app;
--> statement-breakpoint
GRANT SELECT ON species_trait_coverage TO treerepro_app;
--> statement-breakpoint
-- RFC-69 R3 backfill (minutes on the full dataset; the migrator's statement timeout is unlimited).
INSERT INTO species_trait_coverage (species_id, trait_id, record_count, harmonised_count, first_record_at, last_record_at)
SELECT species_id, trait_id, count(*), count(*) FILTER (WHERE harmonisation = 'harmonised'), min(created_at), max(created_at)
FROM trait_records GROUP BY 1, 2
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE species s SET trait_count = c.n
FROM (SELECT species_id, count(*) AS n FROM species_trait_coverage GROUP BY 1) c
WHERE s.id = c.species_id;
```

(`xmax = 0` in `RETURNING` is the standard way to tell an inserted row from an updated one in an upsert; the migrator runs as the table owner, so `SECURITY DEFINER` makes the function write the table the app role can only read. Check whether `trait_records_reference_usage` is already `SECURITY DEFINER` in 0015; if the app role is the owner of `species_trait_coverage` through the migrator's role, adjust the `REVOKE` to the actual runtime role name in `infra/postgres/init/01-roles.sh`.)

- [ ] **Step 4: Run; commit** — `feat(db): species_trait_coverage and species.trait_count maintained by the insert trigger, backfilled (RFC-69 R1-R3)`.

---

### Task 4: `searchSpecies` filters and completeness order

**Files:** `apps/api/src/dataset/taxa.ts` (+ test), `http/routes/dataset/species.ts` (+ test)

- [ ] **Step 1: Failing tests**

```ts
describe('RFC-60 R6 trait filters and completeness', () => {
  const t = useTestDb();
  it('filters with/missing by trait and by category; orders by completeness with a stable cursor', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const cat = `cat_${rand()}`;
    await t.db.insert(traitCategories).values({ key: cat, label: 'Cat', sortOrder: 99 });
    const tA = await createTrait(t.db, { categoryKey: cat });
    const tB = await createTrait(t.db, { categoryKey: cat });
    const prefix = `Cov ${rand()}`;
    const s0 = await createSpecies(t.db, { canonicalName: `${prefix} zero` });
    const s1 = await createSpecies(t.db, { canonicalName: `${prefix} one` });
    const s2 = await createSpecies(t.db, { canonicalName: `${prefix} two` });
    const rec = (sp: { id: string }, tr: typeof tA) => createRecord(t.db, { speciesId: sp.id, traitId: tr.id, valueText: 'alpha', levelId: tr.levels[0]?.id, primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id });
    await rec(s1, tA); await rec(s2, tA); await rec(s2, tB);
    const ids = (r: { data: { id: string }[] }) => r.data.map((x) => x.id);
    expect(ids(await searchSpecies(t.db, UNRESTRICTED, { q: prefix, traitId: tA.id, limit: 10 })).sort()).toEqual([s1.id, s2.id].sort());
    expect(ids(await searchSpecies(t.db, UNRESTRICTED, { q: prefix, traitId: tA.id, traitData: 'missing', limit: 10 }))).toEqual([s0.id]);
    expect(ids(await searchSpecies(t.db, UNRESTRICTED, { q: prefix, categoryKey: cat, traitData: 'missing', limit: 10 }))).toEqual([s0.id]);
    const byCompleteness = await searchSpecies(t.db, UNRESTRICTED, { q: prefix, sort: 'completeness', limit: 2 });
    expect(ids(byCompleteness)).toEqual([s0.id, s1.id]);
    expect(byCompleteness.data[1]?.traitCount).toBe(1);
    const next = await searchSpecies(t.db, UNRESTRICTED, { q: prefix, sort: 'completeness', limit: 2, cursor: byCompleteness.nextCursor ?? undefined });
    expect(ids(next)).toEqual([s2.id]);
    const withCount = await searchSpecies(t.db, UNRESTRICTED, { q: prefix, traitId: tA.id, limit: 10 });
    expect(withCount.data.find((x) => x.id === s2.id)?.traitRecordCount).toBe(1);
  });
  it('an invisible trait id answers TRAIT_NOT_FOUND; a category mismatch answers 400', async () => {
    const off = await createTrait(t.db, { active: false });
    await expect(searchSpecies(t.db, RESTRICTED, { traitId: off.id, limit: 10 })).rejects.toMatchObject({ code: 'TRAIT_NOT_FOUND' });
    const tr = await createTrait(t.db);
    await expect(searchSpecies(t.db, UNRESTRICTED, { traitId: tr.id, categoryKey: 'nope', limit: 10 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
```

- [ ] **Step 2: Implement** — in `searchSpecies`: resolve `traitId` through `requireTrait(db, visibility, id)` (import from `curation.ts`; it applies `traitVisible`); when `categoryKey` is given without `traitId`, check the category exists (400 path `categoryKey`); with both, the trait's `categoryKey` must equal (400). Predicates:

```ts
const coverageExists = (traitFilter: SQL) =>
  sql`exists (select 1 from ${speciesTraitCoverage} c join ${traits} t on t.id = c.trait_id where c.species_id = ${species.id} and ${traitFilter} and ${traitVisible(visibility, sql`t.active`)})`;
if (input.traitId) {
  const e = coverageExists(sql`c.trait_id = ${input.traitId}`);
  conditions.push(input.traitData === 'missing' ? sql`not ${e}` : e);
} else if (input.categoryKey) {
  const e = coverageExists(sql`t.category_key = ${input.categoryKey}`);
  conditions.push(input.traitData === 'missing' ? sql`not ${e}` : e);
}
```

Sort: `sort === 'completeness'` → `orderBy(asc(species.traitCount), asc(species.canonicalName), asc(species.id))`, cursor `encodeCompositeCursor([String(r.traitCount), r.canonicalName, r.id])` and the after-predicate `(trait_count, canonical_name, id) > ($1::int, $2, $3::uuid)` (decode with `isDigits` for the first key). Item: `traitCount: species.traitCount`; `traitRecordCount` = a correlated `(select record_count from species_trait_coverage where species_id = species.id and trait_id = $traitId)` when `traitId` is given (0 when null and missing mode), else `null`.

- [ ] **Step 3: Route** — the query schema already carries the fields; pass them through; route test: `?traitId=&traitData=missing` and `?sort=completeness` round-trip.
- [ ] **Step 4: Run; commit** — `feat(api): species trait filters, missing mode and completeness order (RFC-60 R6, RFC-69 R4)`.

---

### Task 5: Breadcrumb context

**Files:** `apps/web/src/components/shell/Breadcrumb.tsx` (+ test), `AppShell.tsx` (+ test)

**Interfaces (produces):**

```ts
export interface Crumb { label: ReactNode; to?: string; search?: Record<string, unknown> }
export function BreadcrumbProvider({ children }: { children: ReactNode })
export function useBreadcrumb(crumbs: Crumb[]): void      // registers in an effect; deps = JSON of labels/links; clears on unmount
export function useCrumbs(): Crumb[]                       // read by AppShell
```

- [ ] **Step 1: Failing tests** — `AppShell.test.tsx`: a child that calls `useBreadcrumb([{ label: 'Anathallis funerea' }])` under `/app/species/<id>` renders `Data › Species › Anathallis funerea` with the first two as links and the last as text (`aria-current="page"` on the last); unmounting the child removes the crumb.
- [ ] **Step 2: Implement** — a context holding `[crumbs, setCrumbs]`; `useBreadcrumb` sets on mount / change and resets to `[]` on unmount; `AppShell` wraps `<main>` content with the provider (the provider must sit **above** the header that renders the crumbs — wrap the whole shell body) and renders `crumbGroup › current.label (link when crumbs.length > 0) › crumbs`. Labels may be `<em>` elements (species names).
- [ ] **Step 3: Commit** — `feat(web): hierarchical breadcrumb through a shell context (RFC-13 R3)`.

---

### Task 6: Species search form, list and pages

**Files:** `SpeciesSearchForm.tsx` (+ test), `SpeciesList.tsx` (+ test), `SpeciesSearchPage.tsx` (+ test), `routes/app/species/index.tsx`, `SpeciesPage.tsx`, `ReferencePage.tsx`, `PlotPage.tsx`, `api/dataset.ts`

- [ ] **Step 1: Failing tests**
  - Form: groups titled Taxonomy / Traits / Scope; the Traits group has Category (from the dictionary), Trait (disabled until a category; filtered), radio "Has data" / "Missing data" (disabled until a trait or category); an Order by select (Name / Most incomplete first); every change reaches `onChange` with `categoryKey`, `traitId`, `traitData`, `sort`.
  - Page: mounting with the URL `?traitId=…&traitData=missing&sort=completeness` seeds the form and calls `searchSpecies` with those params; changing a filter navigates (`navigate({ search })`) so the URL mirrors the form (use the router test helper `renderAt` and read `window.location.search` or the router state).
  - List: a "Traits" column with `traitCount`; a "Records" column with `traitRecordCount` when a trait filter is set (pass `showTraitRecords` prop).
  - Species page and reference page and plot page: `useBreadcrumb` called with the entity name (assert the crumb renders in the page test through the real `AppShell` — `renderAt` already mounts the shell).
- [ ] **Step 2: Implement** — `SpeciesSearchValue` gains `categoryKey?`, `traitId?`, `traitData?: 'with' | 'missing'`, `sort?: 'name' | 'completeness'`; the page derives its initial value from `Route.useSearch()` and pushes changes with `navigate({ to: '/app/species', search, replace: true })`; `validateSearch` validates every key (uuid pattern for ids; enums for the rest; drop unknown); `datasetKeys.species(params)` includes the new params; `searchSpecies` passes them.
- [ ] **Step 3: Commit** — `feat(web): trait filters, completeness order and URL-backed species search; entity breadcrumbs (RFC-60 R6, RFC-13 R3)`.

---

### Task 7: Docs, close-out

- [ ] **Step 1:** RFC-69 → `accepted` (R1–R4); RFC-60 changelog already; `docs/gotchas/postgres.md`: "Migration 0022 backfills coverage over every record — on the production dataset it runs for minutes; do not interrupt the migrator"; spec status line.
- [ ] **Step 2:** E2E: extend `apps/e2e/tests/critical-flow.spec.ts` (or a new `browsing.spec.ts`): filter species by a trait in missing mode and open one; the breadcrumb shows the species name.
- [ ] **Step 3:** full checks; commit; push; PR `feat: coverage table, species trait filters and completeness, hierarchical breadcrumb (plan 10a)`; one CodeRabbit run.

## Self-review

- Spec §3 R1–R4 → Task 3; §4 API → Task 4; §4 web → Task 6; §9 breadcrumb → Tasks 5–6; §11 trigger/search/web tests → Tasks 3, 4, 6.
- Names: `speciesTraitCoverage` (Task 3) used in Task 4; `useBreadcrumb` (Task 5) used in Task 6; `SpeciesSearchValue` fields (Task 6) match the query schema (Task 2).
