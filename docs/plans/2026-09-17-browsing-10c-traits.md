# Browsing 10c — Traits Tab Filters, Level Chips, Trait Page (Species With / Missing Data) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`).

**Goal:** `GET /api/traits/:id` (trait detail with counts and the level / numeric distribution across species) and `GET /api/traits/:id/species?mode=with|missing` (paginated species with their record count, accepted value and per-species summary, or the species lacking the trait); the Traits page gains filters, species counts, chips for levels and links to the new `/app/traits/$id` page with two tabs and the hierarchical breadcrumb.

**Architecture:** `apps/api/src/dataset/trait-page.ts` holds the two reads; the distribution query runs over `trait_records` for one trait (bounded) and is cached in Redis for 10 minutes; the species lists reuse `searchSpecies` predicates through a shared `speciesListQuery` builder extracted from `taxa.ts` (so visibility, scope, taxonomy filters and cursors are one implementation). The web adds a `Chip` primitive, `TraitPage`, and tabs.

**Tech Stack:** unchanged; Redis through `ctx.redis` and `cachedJson` (both from plan 10a, Task 4b).

**Spec:** `docs/specs/2026-09-17-browsing-design.md` §6, §11. Depends on plan 10a (coverage table, breadcrumb, URL-backed search form, `cachedJson`, `ctx.redis`).

## Global Constraints

Same as plan 08a. Branch `feat/browsing-10c` in worktree `../Elisa-10c`.

## File structure (end state)

```
docs/rfc/60-dataset/62-trait-dictionary.md               # R5 amended; R7, R8 new
docs/rfc/10-platform/13-presentation-layer.md            # route /app/traits/$id
apps/api/src/dataset/trait-page.ts (+ .integration.test.ts)
apps/api/src/dataset/taxa.ts                             # speciesListQuery extraction; speciesCount per trait in dictionary
apps/api/src/dataset/dictionary.ts                       # speciesCount, filters
apps/api/src/http/routes/dataset/traits.ts (+ test)      # GET /:id, GET /:id/species, query filters
packages/contracts/src/dataset.ts (+ test)
apps/web/src/components/ui/Chip.tsx (+ test), ui/index.ts
apps/web/src/api/dataset.ts                              # fetchTrait, fetchTraitSpecies, fetchDictionary(params)
apps/web/src/pages/dataset/TraitsPage.tsx (+ test)
apps/web/src/pages/dataset/TraitPage.tsx (+ test)
apps/web/src/components/dataset/TraitSpeciesTable.tsx (+ test)
apps/web/src/components/dataset/TaxonomyFilters.tsx      # extracted from SpeciesSearchForm (reused by the trait page)
apps/web/src/routes/app/traits.tsx → routes/app/traits/index.tsx, $id.tsx
apps/web/src/components/shell/nav.ts                     # unchanged path
apps/web/src/test/dataset-fixtures.ts
```

---

### Task 1: RFC-62 amendments

- [ ] R5: `GET /api/traits?categoryKey=&valueType=&q=` and `speciesCount` on the trait entry (spec §6 R5). R7 and R8 verbatim from the spec §6. RFC-13 R2 route. Changelog. Commit — `docs(rfc): trait detail and trait species routes (RFC-62 R7, R8; plan 10c)`.

---

### Task 2: Contracts

**Interfaces (produces):**

```ts
export const listTraitsQuerySchema = z.strictObject({ categoryKey: z.string().trim().min(1).max(100).optional(), valueType: z.enum(TRAIT_VALUE_TYPES).optional(), q: z.string().trim().min(1).max(100).optional() });
export const traitSchema = … .extend({ speciesCount: z.number().int().nonnegative() });
export const traitDetailSchema = traitSchema.extend({
  category: z.strictObject({ key: z.string(), label: z.string() }),
  speciesWithData: z.number().int().nonnegative(), speciesMissing: z.number().int().nonnegative(), acceptedCount: z.number().int().nonnegative(),
  distribution: z.union([
    z.strictObject({ levels: z.array(z.strictObject({ level: z.strictObject({ id: z.uuid(), key: z.string() }), speciesCount: z.number().int(), recordCount: z.number().int() })) }),
    z.strictObject({ numeric: z.strictObject({ min: z.number(), median: z.number(), max: z.number(), speciesCount: z.number().int() }).nullable() }),
  ]),
  computedAt: z.iso.datetime(),
});
export const TRAIT_SPECIES_MODES = ['with', 'missing'] as const;
export const listTraitSpeciesQuerySchema = cursorQuerySchema.extend({ mode: z.enum(TRAIT_SPECIES_MODES).optional(), q: searchTermSchema.optional(), familyId: z.uuid().optional(), genusId: z.uuid().optional(), scope: z.enum(SPECIES_SCOPES).optional(), plotId: z.uuid().optional() });
export const traitSpeciesItemSchema = speciesListItemSchema.extend({
  recordCount: z.number().int().nonnegative().nullable(),
  accepted: z.strictObject({ recordId: z.uuid(), valueText: z.string(), reference: referenceRefSchema.extend({ shortCitation: z.string().nullable() }) }).nullable(),
  summary: z.union([z.strictObject({ levels: z.array(z.strictObject({ key: z.string(), count: z.number().int() })) }), z.strictObject({ numeric: z.strictObject({ min: z.number(), max: z.number() }) })]).nullable(),
});
```

(`shortCitation` arrives with plan 10d; until then the API answers `null` — add the column to the ref schema now so 10d is additive.)

- [ ] Failing tests for the unions; implement; fixtures (`speciesCount: 0` on every `Trait`); build; commit — `feat(contracts): trait detail, trait species list, trait list filters (RFC-62 R5, R7, R8)`.

---

### Task 4: Trait page reads

**Files:** `apps/api/src/dataset/trait-page.ts` (+ test), `taxa.ts` (extract `speciesListQuery`), `dictionary.ts` (`speciesCount`, filters), `http/routes/dataset/traits.ts` (+ test), meta-test list (`GET /api/traits/:id`, `GET /api/traits/:id/species`).

**Interfaces (produces):**

```ts
export async function getTraitDetail(ctx: { db; redis }, visibility, id: string): Promise<TraitDetail | null>
export async function listTraitSpecies(db, visibility, traitId: string, input: { mode: 'with' | 'missing'; q?; familyId?; genusId?; scope?; plotId?; viewerPlotIds?: string[]; cursor?; limit }): Promise<{ data: TraitSpeciesItem[]; nextCursor }>
// taxa.ts
export interface SpeciesListFilters { q?; familyId?; genusId?; unresolved?; status?; scope?; plotId?; viewerPlotIds?: string[]; categoryKey?; traitId?; traitData?; sort? }
export function speciesListConditions(visibility, filters): Promise<SQL[]>          // every predicate searchSpecies applies today; plan 10b adds the search tiers here
```

- [ ] **Step 1: Failing tests**
  - `getTraitDetail`: a categorical trait with records on three species (two levels) answers `speciesWithData 3`, `speciesMissing = visible species − 3` (assert `speciesMissing >= 0` and that it decreases by one after adding a record to a fourth species and clearing the cache key), `levels` sorted by `speciesCount` desc with the right counts, `acceptedCount` after `createAcceptedValue`; a quantitative trait answers `numeric { min, median, max, speciesCount }`; the second call within the TTL returns the same `computedAt`; `RESTRICTED` gets `null` for an inactive trait and does not count records on inactive species.
  - `listTraitSpecies` `with`: items with `recordCount`, `accepted` (value and reference), `summary.levels`; `missing`: species without a coverage row, `recordCount 0`, `accepted null`, `summary null`; scope: a plot-bound viewer sees only their plot's species in both modes.
  - Routes: 404 on an unknown / invisible id; `mode` default `with`.
- [ ] **Step 2: Implement** — `speciesListConditions` extracted from `searchSpecies` (the function keeps its signature and calls it); `listTraitSpecies` = base species select + `exists`/`not exists` on coverage for the trait + per-page enrichment: one query `select species_id, count(*), …` over `trait_records` for the page's species ids (≤ 200) grouped by species and level (categorical) or min/max (quantitative), and one `distinct on (species_id)` over `accepted_values` joined to `trait_records` and `bibliographic_references`. `getTraitDetail`: `getTrait` (visibility) → null; counts from coverage joined to visible species; distribution through `cachedJson(ctx.redis, \`trait:${id}:distribution:${visibility.inactive ? 'u' : 'r'}\`, 600, …)` (two cache entries per trait — the numbers differ by viewer class; plot-bound viewers get the class-`r` numbers, which is a global summary, documented in RFC-62 R7).
- [ ] **Step 3: Commit** — `feat(api): trait detail and trait species lists (RFC-62 R7, R8)`.

---

### Task 5: Dictionary filters and `speciesCount`

- [ ] `getDictionary(db, visibility, filters?)` applies `categoryKey`, `valueType`, `q` (case-insensitive substring of `key` or `description`) and attaches `speciesCount` from `select trait_id, count(*) from species_trait_coverage c join species s … where <speciesVisible on s> group by 1` — a scan of the coverage table, so the map is served through `cachedJson(ctx.redis, \`dictionary:species-counts:${visibility.inactive ? 'u' : 'r'}\`, 600, …)` (RFC-62 R5); route validates `listTraitsQuerySchema`; test; commit — `feat(api): dictionary filters and species counts (RFC-62 R5)`.

---

### Task 6: Web — `Chip`, Traits page, Trait page

- [ ] **Step 1: `Chip`** — `<Chip tone?: 'neutral' | 'muted' | 'amber'; children>`: `inline-flex items-center rounded-full border border-canopy-700/15 bg-mist-50 px-2.5 py-0.5 text-label`; test renders children. Export from `ui/index.ts`.
- [ ] **Step 2: `TaxonomyFilters`** — extract the Taxonomy group (name, genus, family) from `SpeciesSearchForm` into a component both forms render; the species form test still passes.
- [ ] **Step 3: Failing page tests**
  - `TraitsPage`: filter row (Category / Trait / Value type) as URL params; the row shows the species count; expanded levels render as `Chip`s in a wrapping row (no `<Tr>` per level); the `inactive` badge only when `active === false`; the trait name is a link to `/app/traits/$id`.
  - `TraitPage`: header (name, category link to `/app/traits?categoryKey=`, unit, description, value type badge, counts); Distribution section (chips with counts / min · median · max); tabs "Species with data" / "Species missing data" (URL `?mode=`), `TaxonomyFilters` bound to the URL, table columns per the spec (§6 web), "Add the first entry" link to `/app/species/$id?missing=true` in missing mode; breadcrumb `Data › Traits › Category › trait`.
- [ ] **Step 4: Implement** — routes `routes/app/traits/index.tsx` (move the existing `traits.tsx` here; `validateSearch` for the filters) and `$id.tsx`; `api/dataset.ts`: `fetchTrait(id)`, `fetchTraitSpecies(id, params)`, `fetchDictionary(params?)` (key includes params); the pending queue's `?traitId=` link is untouched.
- [ ] **Step 5: Commit** — `feat(web): traits filters, level chips, trait page with species with/missing data (RFC-62 R5, R7, R8)`.

---

### Task 7: Close-out

- [ ] RFC-62 changelog already; spec status; E2E: open a trait page from the Traits list, switch to "Species missing data", click "Add the first entry", land on the species page with the missing toggle on. Full checks; PR `feat: trait page and traits tab redesign (plan 10c)`; one CodeRabbit run.

## Self-review

- Spec §6 R5 → Task 5; R7 → Task 4; R8 → Task 4; web → Task 6; §11 → Tasks 4–6.
- `speciesListConditions` (Task 4) is the shared implementation the spec's "Order and cursor as the species list" relies on; `Chip` (Task 6) is the primitive plan 10d's reference page reuses.
