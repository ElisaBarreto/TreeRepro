# Browsing 10b — Synonyms and Common Names, Three-Tier Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`).

**Goal:** `species_names` carries `name_type` (`gbif` | `synonym` | `common`), `language` and a free-text `source`; `import:synonyms` loads the owner's file; the species search answers an exact canonical match alone, else today's substring search over canonical and alternative names, with `matchedNameType`; the web app shows "found as" badges, grouped names on the species header and a richer Add name dialog.

**Architecture:** One generated migration widens `species_names`. `searchSpecies` computes the tier once (one cheap `exists` for tier 1) and encodes it into the cursor so pages never mix tiers; tier 2 is today's search (canonical or alternative substring), so nothing that matches today stops matching. The predicates extend `speciesListConditions` (plan 10c) so the trait page inherits the tiers. The import is the fourth supplementary kind on the plan 08a framework.

**Tech Stack:** unchanged.

**Spec:** `docs/specs/2026-09-17-browsing-design.md` §5, §11. Depends on plans 08a (import framework), 10a (search parameters) and 10c (`speciesListConditions`, which the tiers extend).

## Global Constraints

Same as plan 08a. Branch `feat/browsing-10b` in worktree `../Elisa-10b`.

## File structure (end state)

```
docs/rfc/60-dataset/60-taxonomy-catalog.md              # R1, R4, R6, R7, R9 amended
docs/rfc/60-dataset/68-supplementary-imports.md         # R12 synonyms
apps/api/drizzle/0023_species_names.sql                 # generated
apps/api/src/db/schema/taxa.ts                          # speciesNames columns + checks
apps/api/src/dataset/taxa.ts (+ test)                   # tiers, matchedNameType, names on detail
apps/api/src/dataset/catalog.ts (+ test)                # addSpeciesName fields
apps/api/src/dataset/imports/synonyms.ts (+ test), cli/import-synonyms.ts, package.json
apps/api/src/http/routes/dataset/species.ts (+ test)
packages/contracts/src/dataset.ts, curation.ts (+ tests)
apps/web/src/components/dataset/SpeciesList.tsx (+ test)          # found-as badge
apps/web/src/pages/dataset/SpeciesPage.tsx (+ test)               # grouped names
apps/web/src/components/catalog/AddNameDialog.tsx (+ test)
apps/web/src/test/dataset-fixtures.ts
README.md
```

---

### Task 1: RFC amendments

- [ ] **Step 1: RFC-60** — R1 `species_names` line becomes `species_names(id, species_id uuid references species restrict, name text, name_type text not null default 'gbif' check in ('gbif', 'synonym', 'common'), language char(2) null, source text not null default 'gbif', gbif_usage_key text null, created_at; unique (species_id, name); check ((name_type = 'common') = (language is not null)); check (gbif_usage_key is null or name_type = 'gbif'))`; R4, R6 (tiers: 1 exact canonical, 2 today's substring search over canonical and alternative names; `matchedNameType`), R7 (`names` items: `{ name, nameType, language, source, gbifUsageKey }`), R9 (`POST /api/species/:id/names { name, nameType, language?, source?, gbifUsageKey? }`, `source` default `manual`) per the spec §5. Changelog.
- [ ] **Step 2: RFC-68 R12** — verbatim from the spec §5 (kind `synonyms`).
- [ ] **Step 3: Commit** — `docs(rfc): synonyms and common names, three-tier species search, import kind synonyms (plan 10b)`.

---

### Task 2: Contracts

**Interfaces (produces):**

```ts
export const NAME_TYPES = ['gbif', 'synonym', 'common'] as const;
export const speciesNameSchema = z.strictObject({ name: z.string(), nameType: z.enum(NAME_TYPES), language: z.string().length(2).nullable(), source: z.string(), gbifUsageKey: z.string().nullable() });
export const speciesListItemSchema = … .extend({ matchedNameType: z.enum(NAME_TYPES).nullable() });
export const speciesNameBodySchema = z.strictObject({ name: catalogNameSchema, nameType: z.enum(NAME_TYPES), language: z.string().regex(/^[a-z]{2}$/).optional(), source: z.string().trim().min(1).max(200).optional(), gbifUsageKey: z.string().trim().min(1).max(64).optional() })
  .refine((b) => (b.nameType === 'common') === (b.language !== undefined), { path: ['language'], message: 'A common name needs a language; other names take none' })
  .refine((b) => b.gbifUsageKey === undefined || b.nameType === 'gbif', { path: ['gbifUsageKey'], message: 'Only a GBIF name carries a usage key' });
```

- [ ] **Step 1: Failing tests** for the two refinements; **Step 2:** implement, update web fixtures (`names: [{ …, nameType: 'gbif', language: null, source: 'gbif' }]`, items `matchedNameType: null`), build; **Step 3:** commit — `feat(contracts): species name types, matchedNameType (RFC-60 R4, R6, R7, R9)`.

---

### Task 3: Schema and migration

- [ ] **Step 1: Failing schema test** — inserting `nameType: 'common'` without `language` → 23514; `nameType: 'synonym'` with `gbifUsageKey` → 23514; a default insert reads `nameType 'gbif'`, `source 'gbif'`.
- [ ] **Step 2: Schema** — in `speciesNames`: replace `source: text('source', { enum: ['gbif'] }).notNull().default('gbif')` with `source: text('source').notNull().default('gbif')`; add `nameType: text('name_type', { enum: NAME_TYPES }).notNull().default('gbif')`, `language: char('language', { length: 2 })`; checks `species_names_type_check` (`in (...)`), `species_names_language_check`, `species_names_gbif_key_check`. `db:generate --name species_names` (verify it drops nothing but adds the columns and checks).
- [ ] **Step 3: Commit** — `feat(db): species_names name_type, language, free-text source (RFC-60 R1)`.

---

### Task 4: Two-tier search and `matchedNameType`

**Files:** `apps/api/src/dataset/taxa.ts` (+ test), `http/cursor.ts` (nothing new; composite cursor of 3 keys), `catalog.ts` (`addSpeciesName`), route test.

- [ ] **Step 1: Failing tests**

```ts
describe('RFC-60 R6 search tiers', () => {
  const t = useTestDb();
  it('an exact canonical match answers alone (case-insensitive); otherwise canonical and alternative substrings match together, with the type', async () => {
    const stem = `Tier${rand()}`;
    const exact = await createSpecies(t.db, { canonicalName: `${stem} robur` });
    const longer = await createSpecies(t.db, { canonicalName: `${stem} robur var. alba` });
    const bySyn = await createSpecies(t.db, { canonicalName: `Other ${rand()}`, names: [{ name: `${stem} robur old`, nameType: 'synonym' }] });
    const q1 = await searchSpecies(t.db, UNRESTRICTED, { q: `${stem} ROBUR`, limit: 10 });
    expect(q1.data.map((s) => s.id)).toEqual([exact.id]);                       // tier 1: the synonym holder and the longer name are not listed
    const q2 = await searchSpecies(t.db, UNRESTRICTED, { q: `${stem} rob`, limit: 10 });
    expect(q2.data.map((s) => s.id).sort()).toEqual([exact.id, longer.id, bySyn.id].sort());   // tier 2 = today's search
    expect(q2.data.find((s) => s.id === bySyn.id)?.matchedNameType).toBe('synonym');
    const q3 = await searchSpecies(t.db, UNRESTRICTED, { q: `robur old`, limit: 10 });
    expect(q3.data.map((s) => [s.id, s.matchedName, s.matchedNameType])).toEqual([[bySyn.id, `${stem} robur old`, 'synonym']]);
  });
  it('the cursor stays within the tier', async () => {
    const stem = `Page${rand()}`;
    const exact = await createSpecies(t.db, { canonicalName: stem });
    await createSpecies(t.db, { canonicalName: `${stem} b` });
    const p1 = await searchSpecies(t.db, UNRESTRICTED, { q: stem, limit: 1 });
    expect(p1.data.map((s) => s.id)).toEqual([exact.id]);
    expect(p1.nextCursor).toBeNull();   // tier 1 holds one row; the substring match of tier 2 is never paged into
  });
});
```

(`createSpecies` helper: `names` entries gain `nameType?`, `language?`, `source?`.)

- [ ] **Step 2: Implement** — in `searchSpecies`, when `q`:

```ts
const tier = input.cursor ? tierFromCursor(input.cursor) : await firstTier(db, visibility, input.q, baseConditions);
// tier 1: ilike(species.canonicalName, likePattern(q, 'exact'))   — no wildcard: `likePattern` gains an 'exact' mode that only escapes % _ and backslash, so the trigram index serves the case-insensitive equality (a `lower(canonical_name) = …` predicate has no index)
// tier 2: the existing predicate (canonical substring OR alternative-name substring through the UNION semi-join)
```

`firstTier` runs one `exists` for tier 1 with the same base conditions (visibility, family, genus, status, scope, trait filters) and answers 1 or 2. The predicates live in `speciesListConditions` (plan 10c), which `searchSpecies` and `listTraitSpecies` both call, so the trait page pages by tier too. The cursor becomes `[tier, …existing keys]` (`'1'` or `'2'`); `encodeCompositeCursor([String(tier), name, id])` (and `[tier, traitCount, name, id]` for completeness); `decodeCompositeCursor` gains the leading tier key (`isDigits`). Without `q` the tier key is `'0'`. `matchedName` keeps today's rule (null when the canonical name matched, else the first matching alternative name) and adds `matchedNameType` from the same row; tier 1 answers `null, null`.

`getSpecies`: `names` items carry `nameType`, `language`, `source`, `gbifUsageKey`, ordered by type (`gbif`, `synonym`, `common`) then name.

`catalog.ts` `addSpeciesName`: insert the new fields; `source` default `'manual'`.

- [ ] **Step 3: Route test** — `POST /api/species/:id/names { name, nameType: 'common', language: 'pt', source: 'Flora' }` → 200 with the name in `names`; `{ nameType: 'common' }` without language → 400 path `language`.
- [ ] **Step 4: Commit** — `feat(api): three-tier species search with matched name type; typed alternative names (RFC-60 R4, R6, R7, R9)`.

---

### Task 5: `import:synonyms`

**Files:** `apps/api/src/dataset/imports/synonyms.ts` (+ test), `cli/import-synonyms.ts`, `package.json`.

**Interfaces:** `SYNONYMS_HEADER = ['wcvp_canonical_name', 'synonym_or_common_name', 'name_type', 'source'] as const`; `importSynonyms(db, { filePath, runBy })`.

- [ ] **Step 1: Failing test** — rows: a synonym (inserted, `source` from the file), `common_pt` (inserted with `language 'pt'`), `common_xx1` (invalid_value), unknown species (unknown_species), a name equal to the canonical (duplicate), the same synonym again (duplicate), empty source → `'import'`.
- [ ] **Step 2: Implement `apply`** — normalise names; `name_type` parse: `synonym` → (`synonym`, null); `^common_([a-z]{2})$` → (`common`, lang); else `invalid_value`; join `species` on normalised canonical; outcome `duplicate` when the name equals the canonical (case-sensitive per RFC-60 R2) or exists in `species_names` for that species; insert the rest with `on conflict do nothing`; `inserted = insert count`; `duplicate = apply rows − inserted`.
- [ ] **Step 3: CLI + script `import:synonyms`; run; commit** — `feat(api): import:synonyms (RFC-68 R12)`.

---

### Task 6: Web

- [ ] **Step 1: Failing tests** — `SpeciesList`: an item with `matchedName` and `matchedNameType: 'common'` renders "found as: *name*" and a badge `common`; `SpeciesPage`: names grouped as "Also known as" (gbif), "Synonyms", "Common names" with `language` chips (`pt`), empty groups hidden; `AddNameDialog`: Type select (GBIF name / Synonym / Common name), Language input shown for common only, Source input, body per the schema.
- [ ] **Step 2: Implement**; **Step 3:** commit — `feat(web): found-as badges, grouped species names, typed Add name dialog (RFC-60 R4, R7, R9)`.

---

### Task 7: Close-out

- [ ] README command `import:synonyms`; spec status line; full checks; E2E: search by a synonym created through the UI finds the species with the "found as" line; commit; push; PR `feat: synonyms and common names with tiered search (plan 10b)`; one CodeRabbit run.

## Self-review

- Spec §5 R1 → Task 3; R4, R6, R7, R9 → Task 4; RFC-68 R12 → Task 5; web → Task 6; tests → each task.
