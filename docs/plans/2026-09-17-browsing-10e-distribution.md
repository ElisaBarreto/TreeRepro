# Browsing 10e — Species Distribution by Country and State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`).

> **Blocked until** the owner confirms the distribution dataset and its resolution (country only, or country + state). The contract below is fixed so the work can start the day the file exists; if the file carries a different geography (e.g. biome or ecoregion), amend RFC-60 R11 first.

**Goal:** `species_distribution(species_id, country, state, source)`; `import:distribution`; `GET /api/species?country=&state=`; `GET /api/distribution/countries` and `/states`; `distribution` on the species detail; a Geography filter group and country / state chips on the species header; an "Add distribution" dialog for `taxa.manage`.

**Architecture:** ISO 3166-1 alpha-2 codes stored; a code → English name table in `packages/contracts/src/countries.ts` (249 entries, generated once from the ISO list and committed — the table is data, not a dependency); the import accepts codes or names. Dropdown lists are cached 10 minutes with `cachedJson`.

**Spec:** `docs/specs/2026-09-17-browsing-design.md` §8, §11. Depends on plans 08a (import framework), 10a (URL-backed search form), 10c (`cachedJson`, `Chip`).

## Global Constraints

Same as plan 08a. Branch `feat/browsing-10e` in worktree `../Elisa-10e`.

## File structure (end state)

```
docs/rfc/60-dataset/60-taxonomy-catalog.md               # R7 distribution; R11, R12 new
docs/rfc/60-dataset/68-supplementary-imports.md          # R14 distribution
docs/rfc/10-platform/12-error-codes.md                   # DISTRIBUTION_EXISTS
apps/api/drizzle/0025_distribution.sql                   # generated
apps/api/src/db/schema/distribution.ts
apps/api/src/dataset/distribution.ts (+ test)            # countries, states, addDistribution
apps/api/src/dataset/taxa.ts                             # country/state predicates; distribution on detail
apps/api/src/dataset/imports/distribution.ts (+ test), cli/import-distribution.ts, package.json
apps/api/src/http/routes/dataset/distribution.ts (+ test), species.ts (+ test), index.ts
packages/contracts/src/countries.ts (+ test), dataset.ts, curation.ts
apps/web/src/components/dataset/GeographyFilters.tsx (+ test), SpeciesSearchForm.tsx
apps/web/src/pages/dataset/SpeciesPage.tsx (+ test)
apps/web/src/components/catalog/AddDistributionDialog.tsx (+ test)
apps/web/src/api/dataset.ts
README.md
```

---

### Task 1: RFCs and contracts

- [ ] **Step 1:** RFC-60 R11, R12 verbatim from the spec §8; R7 gains `distribution: [{ country, state }]`; RFC-68 R14; RFC-12 `DISTRIBUTION_EXISTS` 409 "The species already has this country and state (RFC-60 R11)". Changelog lines. Commit — `docs(rfc): species distribution (RFC-60 R11-R12, RFC-68 R14; plan 10e)`.
- [ ] **Step 2: Contracts** — `countries.ts`: `export const COUNTRIES: Record<string, string>` (alpha-2 → English short name; `isCountryCode(s)`; `countryCodeFromName(name)` case-insensitive over names); `dataset.ts`: `listSpeciesQuerySchema += country: z.string().length(2).toUpperCase().optional(), state: z.string().trim().min(1).max(100).optional()` with `.refine(state ⇒ country)`; `speciesSchema += distribution: z.array(z.strictObject({ country: z.string().length(2), state: z.string().nullable() }))`; `countryEntrySchema = { code, name, speciesCount }`, `stateEntrySchema = { state, speciesCount }`; `curation.ts`: `addDistributionBodySchema = { country: z.string().length(2).toUpperCase(), state: z.string().trim().min(1).max(100).optional() }`. Tests (`countryCodeFromName('brazil') === 'BR'`; the state-without-country refinement). Fixtures (`distribution: []`). Build; commit — `feat(contracts): countries table, distribution filters and fields`.

---

### Task 2: Schema, service, routes

- [ ] **Step 1: Failing schema test** — unique on `(species_id, country, coalesce(state, ''))` (two rows with null state collide; a row with a state coexists); `country` must be two uppercase letters (check `country ~ '^[A-Z]{2}$'`).
- [ ] **Step 2: Schema**

```ts
export const speciesDistribution = pgTable('species_distribution', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  speciesId: uuid('species_id').notNull().references(() => species.id, { onDelete: 'restrict' }),
  country: char('country', { length: 2 }).notNull(),
  state: text('state'),
  source: text('source'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('species_distribution_key_idx').on(t.speciesId, t.country, sql`coalesce(${t.state}, '')`),
  index('species_distribution_place_idx').on(t.country, t.state),
  check('species_distribution_country_check', sql`${t.country} ~ '^[A-Z]{2}$'`),
]);
```

- [ ] **Step 3: Failing service/route tests** — `searchSpecies({ country: 'BR' })` keeps species with a BR row; `{ country: 'BR', state: 'Bahia' }` narrows; `listCountries(ctx, visibility)` answers `[{ code, name, speciesCount }]` for countries with visible species (an inactive species does not count for `RESTRICTED`), by name; `listStates(ctx, visibility, 'BR')`; `getSpecies` `distribution` ordered; `addDistribution(db, { speciesId, country, state, actorId })` audits `taxa.updated` `fields: ['distribution']` and refuses a duplicate with `DISTRIBUTION_EXISTS`; routes `GET /api/distribution/countries`, `GET /api/distribution/states?country=` (`dataset.read`), `POST /api/species/:id/distribution` (`taxa.manage`, 201 → species detail); meta-test list.
- [ ] **Step 4: Implement** (`cachedJson` keys `distribution:countries:<u|r>` and `distribution:states:<code>:<u|r>`, 600 s; `addDistribution` deletes nothing and clears nothing — a 10-minute lag is fine).
- [ ] **Step 5: Commit** — `feat(api): species distribution table, filters, country and state lists (RFC-60 R11, R12)`.

---

### Task 3: `import:distribution`

- [ ] Failing test — header `wcvp_species,country,state`; `country` as `BR` or `Brazil` (both → `BR`), `Narnia` → `invalid_value`; unknown species → `unknown_species`; empty state → null; duplicate triple → duplicate; `source` stored as `'import'`. The name → code mapping happens inside `apply`, after staging the file untouched: `update import_staging s set country_code = v.code from (values …) as v(name_lower, code) where lower(trim(s.country)) = v.name_lower or upper(trim(s.country)) = v.code` with the 249 pairs of `COUNTRIES` passed through `sql.join` (no temporary file — plan 08b's `user_plots` uses the same shape for e-mail hashes). Implement; CLI + script; commit — `feat(api): import:distribution (RFC-68 R14)`.

---

### Task 4: Web

- [ ] Failing tests — `GeographyFilters`: Country select from `fetchCountries` ("Brazil (1,234)"), State select from `fetchStates(country)` enabled once a country is chosen, URL params `country`, `state`; `SpeciesSearchForm` renders the Geography group; `SpeciesPage` header shows chips `BR · Bahia`, `AR`; `AddDistributionDialog` (`taxa.manage`) posts `{ country, state }` and maps `DISTRIBUTION_EXISTS`. Implement; commit — `feat(web): geography filters and species distribution (RFC-60 R11, R12)`.

---

### Task 5: Close-out

- [ ] README command `import:distribution`; spec status; full checks; PR `feat: species distribution (plan 10e)`; one CodeRabbit run.

## Self-review

- Spec §8 R11 → Task 2; R12 → Task 2; RFC-68 R14 → Task 3; web → Task 4.
