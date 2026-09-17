# Workspace 11c — Coverage Metrics Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`).

**Goal:** `GET /api/coverage?familyId=&categoryKey=&plotId=` and `GET /api/coverage/top?mode=` under `coverage.read`; the page `/app/curation/coverage` with filters, headline meters, a category → trait table and the top-gaps list.

**Architecture:** `coverageMetrics` in `apps/api/src/dataset/coverage.ts` generalises plan 11b's `coverageTotals` with a species selection (`family`, `plot`) and a trait selection (`category`), grouped by category and trait in two queries over `species_trait_coverage` plus one over the current accepted values; cached per filter combination.

**Spec:** `docs/specs/2026-09-17-workspace-design.md` §5–§7. Depends on plan 11b.

## Global Constraints

Same as plan 08a. Branch `feat/workspace-11c` in worktree `../Elisa-11c`.

## File structure (end state)

```
docs/rfc/60-dataset/69-coverage-summary.md               # R5 amended (filters); R6, R7 new
docs/rfc/30-access/30-permission-catalog.md, 31-roles.md # coverage.read
docs/rfc/10-platform/13-presentation-layer.md            # route
apps/api/drizzle/0027_permissions_coverage.sql           # custom
apps/api/src/dataset/coverage.ts (+ test)                # coverageMetrics, coverageTop
apps/api/src/http/routes/coverage.ts (+ test), app.ts
packages/contracts/src/coverage.ts (+ test), index.ts, permissions.ts
apps/web/src/api/coverage.ts
apps/web/src/pages/curation/CoveragePage.tsx (+ test)
apps/web/src/components/curation/CoverageTable.tsx, CoverageFilters.tsx, TopGaps.tsx (+ tests)
apps/web/src/routes/app/curation/coverage.tsx
apps/web/src/components/shell/nav.ts
```

---

### Task 1: RFCs, permission, contracts

- [ ] RFC-69 R5 (filters, response shape), R6 (cache key), R7 (`top`) verbatim from the spec §5; RFC-30 `coverage.read` "View coverage metrics"; RFC-31 R10 manager += `coverage.read`; RFC-13 route. Migration `0027_permissions_coverage.sql` (permission + manager row). Contracts:

```ts
const n = z.number().int().nonnegative();
const pct = z.number().int().min(0).max(100);
export const coverageQuerySchema = z.strictObject({ familyId: z.uuid().optional(), categoryKey: z.string().trim().min(1).max(100).optional(), plotId: z.uuid().optional() });
export const coverageRowSchema = z.strictObject({ cells: n, withData: n, accepted: n, percentWithData: pct, percentAccepted: pct });
export const coverageTraitRowSchema = coverageRowSchema.extend({ trait: traitRefSchema, category: z.strictObject({ key: z.string(), label: z.string() }), species: n });
export const coverageSchema = coverageRowSchema.extend({
  species: n, traits: n,
  byCategory: z.array(coverageRowSchema.extend({ category: z.strictObject({ key: z.string(), label: z.string() }), traits: n })),
  byTrait: z.array(coverageTraitRowSchema),
  computedAt: z.iso.datetime(),
});
export const coverageTopQuerySchema = z.strictObject({ mode: z.enum(['missing', 'least_accepted']).optional(), limit: z.coerce.number().int().min(1).max(50).optional() });
```

Commit — `docs+feat(contracts): coverage metrics (RFC-69 R5-R7)`.

---

### Task 2: Service and routes

**Interfaces:** `coverageMetrics(ctx, visibility, filters: CoverageQuery & { viewerPlotIds: string[] }): Promise<Coverage>`; `coverageTop(ctx, visibility, { mode, limit }): Promise<CoverageTraitRow[]>`; routes `GET /api/coverage`, `GET /api/coverage/top` (`coverage.read`); meta-test list.

- [ ] **Step 1: Failing tests** — fixture: family F with species S1, S2 (S2 inactive), family G with S3; category C with traits T1, T2 (T2 inactive), category D with T3; coverage: S1×T1, S1×T3, S3×T1; accepted: S1×T1. Unrestricted, no filter: species 3, traits 3, cells 9, withData 3, accepted 1; `byCategory` C: traits 2, cells 6, withData 2; `byTrait` T1: species 2, accepted 1, percentAccepted 50. Restricted: species 2, traits 2, cells 4, withData 2. `familyId F` (unrestricted): species 2 (S1, S2), withData 2. `categoryKey C`: traits 2. `plotId` with S3 only: species 1. Unknown family → 404 `FAMILY_NOT_FOUND`; a plot-bound viewer asking another plot → 403. `top: missing` ranks T2 (0 with data of 3) before T3 (1 of 3); `least_accepted` ranks by `percentAccepted` asc. Cache: the same filters twice → equal `computedAt`.
- [ ] **Step 2: Implement** — one CTE `sel_species` (visible active species ∩ filters), `sel_traits` (visible active traits ∩ category); `withData` = `count(*) from species_trait_coverage c join sel_species join sel_traits`; `accepted` = `count(*) from (select distinct on (species_id, trait_id) … from accepted_values order by species_id, trait_id, id desc) a join … where a.decision = 'accepted'`; group the same joins by category and by trait. Cache key `coverage:<u|r>:<familyId ?? '-'>:<categoryKey ?? '-'>:<plotId ?? '-'>`, 600 s.
- [ ] **Step 3: Commit** — `feat(api): coverage metrics with filters and top gaps (RFC-69 R5-R7)`.

---

### Task 3: Web

- [ ] **Step 1: Failing tests** — nav entry "Coverage" under Curation with `coverage.read`; page: filters (family select over `fetchFamilies`, category select from the dictionary, plot select over `listPlots` — hidden when the viewer holds no `plots.manage` and has no plots) as URL params; headline tiles with two `Meter`s; `CoverageTable` rows per category with a chevron expanding trait rows (each with two meters and links to `/app/traits/$id` and `/app/species?traitId=…&traitData=missing`); `TopGaps` list with a mode toggle; breadcrumb `Curation › Coverage`; `NoPermission` otherwise.
- [ ] **Step 2: Implement; commit** — `feat(web): coverage page (RFC-69 R5-R7)`.

---

### Task 4: Close-out

- [ ] RFC-69 → accepted (all rules); spec status; full checks; PR `feat: coverage metrics dashboard (plan 11c)`; one CodeRabbit run.

## Self-review

- Spec §5 R5 → Task 2; R6 → Task 2 (cache); R7 → Task 2; web → Task 3; permission → Task 1.
