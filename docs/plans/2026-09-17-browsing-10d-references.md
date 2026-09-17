# Browsing 10d — Enriched References, DOI Links, Reference × Trait Filters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`).

**Goal:** `short_citation` and `full_citation` on references, filled by `import:references` (only where null) or by hand, and derived for DOI-created references; a `reference_traits` table maintained by the insert trigger; `GET /api/references?traitId=&categoryKey=`; the reference detail lists its traits; every citation in the web app reads `shortCitation ?? citationKey`, the reference page shows the full citation, a DOI link and trait chips.

**Architecture:** One migration (columns, table, trigger extension, backfill). `referenceLabel(ref)` in `apps/web/src/lib/references.ts` is the single formatting rule. The import is the fifth supplementary kind.

**Tech Stack:** unchanged.

**Spec:** `docs/specs/2026-09-17-browsing-design.md` §7, §11. Depends on plans 08a (import framework), 09a (reference kinds, DOI-created references), 10a (trigger function shape), 10c (`Chip`).

## Global Constraints

Same as plan 08a. Branch `feat/browsing-10d` in worktree `../Elisa-10d`.

## File structure (end state)

```
docs/rfc/60-dataset/61-bibliographic-references.md      # R1, R4, R6, R8 amended; R9 new
docs/rfc/60-dataset/68-supplementary-imports.md         # R13 references
apps/api/drizzle/0024_references_enriched.sql           # generated + trigger + backfill
apps/api/src/db/schema/references.ts, reference-traits.ts
apps/api/src/dataset/references.ts (+ test)             # fields, filters, traits on detail, shortCitationFrom
apps/api/src/dataset/catalog.ts                         # create/update fields
apps/api/src/dataset/imports/references.ts (+ test), cli/import-references.ts, package.json
apps/api/src/http/routes/dataset/references.ts (+ test)
apps/api/src/integrations/doi.ts                        # shortCitationFrom(metadata)
packages/contracts/src/dataset.ts, curation.ts
apps/web/src/lib/references.ts (+ test)                 # referenceLabel
apps/web/src/components/dataset/RecordTable.tsx, RecordDrawer.tsx, TraitPanel.tsx, TraitCard.tsx   # label
apps/web/src/pages/dataset/ReferencesPage.tsx (+ test), ReferencePage.tsx (+ test)
apps/web/src/components/catalog/ReferenceDialog.tsx (+ test)
apps/web/src/components/curation/DoiField.tsx           # label from preview
apps/web/src/test/dataset-fixtures.ts
README.md
```

---

### Task 1: RFC amendments

- [ ] RFC-61: R1 columns; R4 fields and filters (`q` matches `short_citation` too; `traitId`, `categoryKey`; detail `traits`); R6 accepts `shortCitation?`, `fullCitation?`; R8 derivation rule; R9 `reference_traits` (spec §7 verbatim). RFC-68 R13. Changelog lines. Commit — `docs(rfc): enriched references and reference × trait counters (RFC-61 R9, RFC-68 R13; plan 10d)`.

---

### Task 2: Contracts

- [ ] `referenceSchema` += `shortCitation: z.string().nullable(), fullCitation: z.string().nullable()`; `referenceRefSchema` += `shortCitation: z.string().nullable()` (plan 10c added it to `traitSpeciesItemSchema.accepted.reference` — now it lives on the ref itself; remove the extension there); `referenceDetailSchema` += `traits: z.array(z.strictObject({ trait: traitRefSchema, recordCount: z.number().int().nonnegative() }))`; `listReferencesQuerySchema` += `traitId: z.uuid().optional(), categoryKey: z.string().trim().min(1).max(100).optional()`; create/update bodies += `shortCitation: z.string().trim().min(1).max(200).optional()` (nullable on update), `fullCitation` 1–2,000. Tests; fixtures (`shortCitation: null, fullCitation: null`, `traits: []`); build; commit — `feat(contracts): reference citations, traits and filters (RFC-61 R4, R6, R9)`.

---

### Task 3: Schema, trigger, backfill

- [ ] **Step 1: Failing tests** — inserting records for a reference in the primary role and in the secondary role on two traits yields `reference_traits` rows with the right counts; a record naming the same reference in both roles counts once; the app role cannot write the table.
- [ ] **Step 2: Schema** — `references.ts` += `shortCitation: text('short_citation')`, `fullCitation: text('full_citation')`; new `reference-traits.ts`:

```ts
/** Maintained by the trait_records insert trigger. @rfc RFC-61 R9 */
export const referenceTraits = pgTable('reference_traits', {
  referenceId: uuid('reference_id').notNull().references(() => bibliographicReferences.id, { onDelete: 'restrict' }),
  traitId: uuid('trait_id').notNull().references(() => traits.id, { onDelete: 'restrict' }),
  recordCount: integer('record_count').notNull(),
}, (t) => [primaryKey({ columns: [t.referenceId, t.traitId] }), index('reference_traits_trait_idx').on(t.traitId)]);
```

- [ ] **Step 3: Migration** — `db:generate --name references_enriched`, append `CREATE OR REPLACE FUNCTION trait_records_reference_usage()` (the plan 10a body) plus, before `RETURN NULL`:

```sql
  INSERT INTO reference_traits (reference_id, trait_id, record_count)
  SELECT reference_id, trait_id, count(*) FROM (
    SELECT DISTINCT id, primary_reference_id AS reference_id, trait_id FROM inserted WHERE primary_reference_id IS NOT NULL
    UNION
    SELECT DISTINCT id, secondary_reference_id, trait_id FROM inserted WHERE secondary_reference_id IS NOT NULL
  ) x GROUP BY 1, 2
  ON CONFLICT (reference_id, trait_id) DO UPDATE SET record_count = reference_traits.record_count + EXCLUDED.record_count;
```

then the grants inside the same `DO $$ … IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'treerepro_app') …` guard plan 10a uses (`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON reference_traits FROM treerepro_app; GRANT SELECT …`) and the backfill (the same `UNION` over `trait_records` grouped, `ON CONFLICT DO NOTHING`).

- [ ] **Step 4: Run; commit** — `feat(db): short and full citations; reference_traits maintained by the insert trigger (RFC-61 R1, R9)`.

---

### Task 4: Service, DOI derivation, routes

- [ ] **Step 1: Failing tests** — `toReference` carries the two fields; `searchReferences({ traitId })` keeps references with a `reference_traits` row for a visible trait; `{ categoryKey }` likewise for any visible trait of the category; `q` matches `short_citation`; `getReference` `traits` ordered by count desc (visible traits only); `shortCitationFrom({ authors: 'Alfaro, A; Diaz, B; Silva, C', year: 2023 })` → `'Alfaro et al. (2023)'`, two authors → `'Alfaro and Diaz (2023)'`, one → `'Alfaro (2023)'`, no year → `'Alfaro et al.'`, no authors → `null`; `createReferenceFromDoi` stores the derived short citation and the full citation `Alfaro, A; Diaz, B (2023). Seed size. Global Ecology. https://doi.org/10.1111/geb.13000` when title is present; `updateReference` accepts the fields and audits `fields: ['shortCitation']`.
- [ ] **Step 2: Implement** (`shortCitationFrom` in `integrations/doi.ts`; family name = the part before the first comma of each author entry).
- [ ] **Step 3: Commit** — `feat(api): citations on references, reference filters by trait and category, traits on the detail (RFC-61 R4, R6, R8)`.

---

### Task 5: `import:references`

- [ ] **Step 1: Failing test** — header `reference_key,short_citation,full_citation,doi,url`; a reference with all nulls gets all four filled (`inserted`); a second run is `duplicate`; a reference that already has a `doi` keeps it and fills only `url` (`inserted`); a DOI held by another reference → `doi_taken`; malformed DOI → `invalid_value`; unknown key → `unknown_reference`; DOIs normalised (`10.1111/GEB.1` → `10.1111/geb.1`).
- [ ] **Step 2: Implement `apply`** — join on `citation_key`; compute per row the set of fillable fields (`coalesce(stored, new)`); `outcome` per the reasons; the update sets only null fields; `inserted = rows where at least one field changed`.
- [ ] **Step 3: CLI + script; commit** — `feat(api): import:references (RFC-68 R13)`.

---

### Task 6: Web

- [ ] **Step 1: `referenceLabel`** (`lib/references.ts` + test): `(ref: { citationKey; shortCitation?: string | null; kind?: ReferenceKind; observer?: { name } | null }) => string` — `'Personal observation'` + ` (Name)` when the observer is known, else `shortCitation ?? citationKey`.
- [ ] **Step 2: Failing tests** — `RecordTable`, `RecordDrawer`, `TraitPanel`, `TraitCard` (accepted source), `DoiField` (`ok` label uses the preview's derived short citation when the API answers `known` with `shortCitation`) render the label; `ReferencesPage`: Category / Trait filters (URL params), DOI column with an anchor `href="https://doi.org/<doi>"`, `target="_blank"`, `rel="noopener noreferrer"`; `ReferencePage`: full citation paragraph, DOI link, Traits section with `Chip`s linking to `/app/traits/$id`; `ReferenceDialog`: Short citation and Full citation fields.
- [ ] **Step 3: Implement; commit** — `feat(web): citation labels everywhere, DOI links, reference filters and traits (RFC-61 R4, R9)`.

---

### Task 7: Close-out

- [ ] README command `import:references`; spec status; full checks; E2E: the reference page shows the DOI link and a trait chip that opens the trait page. PR `feat: enriched references (plan 10d)`; one CodeRabbit run.

## Self-review

- Spec §7 R1 → Task 3; R4, R6, R8 → Task 4; R9 → Task 3; RFC-68 R13 → Task 5; web → Task 6.
