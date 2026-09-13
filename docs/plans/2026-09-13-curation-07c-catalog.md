# Curation 07c — Web: Catalog Editors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit once (`coderabbit:code-review`); without quota, the whole-branch Opus review is enough.

**Goal:** The catalog editors of the web application over the plan-07a API: the trait and level editor on `/app/traits` (new trait, edit trait, add / rename / reorder / activate levels with the seed warning), the reference editor (new reference on `/app/references`, edit on `/app/references/$id`), the species editor on `/app/species/$id` (edit species with genus and family creation inline, add an alternative name) plus **New species** on `/app/species`, and the `/app/taxa` page where families and genera are created, renamed and moved — every button behind its permission, every write invalidating the queries it makes stale.

**Architecture:** One typed client `apps/web/src/api/catalog.ts` (families, genera, species, names, references, traits, levels) over `apiFetch` with the shared Zod bodies; one `invalidateAfterCatalogWrite(queryClient, area)` per catalog area. Editors are dialogs in `components/catalog/`, mounted only while open (fresh state per open, `docs/gotchas/web.md`), validating locally with the contracts' schemas, sending a **diff** on edit (the `PATCH` bodies are `nonEmpty`; an unchanged form closes without a request), mapping `VALIDATION_FAILED` details and the 409 codes to their fields. Pages: `TraitsPage`, `ReferencesPage`, `ReferencePage`, `SpeciesPage`, `SpeciesSearchPage` gain header / row buttons; `pages/catalog/TaxaPage.tsx` is new with route `/app/taxa` and a navigation entry. Two carried-over follow-ups land first because every task would otherwise duplicate them: a kit `ButtonLink` / `buttonClassName` (two pages hand-copy the `Button` classes onto anchors) and one shared `withQuery` (`api/dataset.ts` and `api/curation.ts` each have a copy).

**Tech Stack:** unchanged (React 19, TanStack Router 1.170 + Query, Tailwind 4, Zod 4.6, Vitest + Testing Library + user-event, Biome 2.5). No new dependencies.

**Spec:** `docs/specs/2026-09-13-curation-design.md` section 10.4 (this plan; sections 10.1–10.3 are plan 07b, merged as PR #57) and section 6 (the catalog routes, bodies, codes and the seed gotcha). API contract: RFC-60 R9, RFC-61 R6, RFC-62 R6; `packages/contracts/src/curation.ts` (the catalog body schemas). Epic: issue #45.

**Beyond the spec's wording (ruled by the plan author, to be confirmed in the PR):** section 10.4 lists **Edit species** and **Add alternative name** on the species page but no way to create a species from the web, although `POST /api/species` exists (section 6, issue #45's "taxa editor (family/genus/species, alternative names)"). Task 5 adds **New species** on `/app/species` with the same dialog in create mode; Task 7 records it in the spec's "As delivered (plan 07c)" note. If the owner prefers to keep species creation out of the web, the button and its two tests are the only thing to drop.

## Global Constraints

- All artifacts in English: code, comments, docs, commit messages. Conversation with the owner in Portuguese.
- No new dependencies. Prefix every command with `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH`.
- RFC first (RFC-00 R6): no new rule is needed — the web reflects RFC-60 R9, RFC-61 R6, RFC-62 R6 and RFC-13 R3/R6/R10; every exported symbol under `apps/web/src` carries a JSDoc `@rfc` tag (type-only exports exempt); `pnpm rfc:check` enforces.
- TDD (RFC-01, RFC-13 R8): failing component test first (Vitest + Testing Library, `vi.mock` of `apps/web/src/api/*`), seen failing for the expected reason, then the minimum code. Pages render through `renderAt(path)` (`apps/web/src/test/router.tsx`, real route tree, `fetchMe` mocked through `vi.mock('../../api/auth.ts')`) or components through `renderWithProviders(ui, { me })` (`test/render.tsx`); `me` seeds from `test/fixtures.ts` (`ME`, `ADMIN_ME`); dataset fixtures in `test/dataset-fixtures.ts`. Every new `/app` page test has the two RFC-13 R8 cases: a 403 shows the permission sentence, a 401 ends the session and returns to `/` (copy the pattern of `pages/curation/PendingPage.test.tsx`).
- RFC-02 / RFC-13 R1: no business rules in the web; uniqueness, immutability and permissions are the API's; buttons render only with `hasPermission(me, …)` (RFC-13 R3); every request goes through `apiFetch`.
- RFC-13 R5: no `style` attributes, no `<style>` injection; Tailwind classes only; the kit's type scale (`text-title/section/card/body/cell/meta/label`, never `text-xs/sm/base/lg/2xl`); `Button size="sm"` inside rows. R6: each dialog maps the API codes it can receive to one English sentence (`errorMessage`), `VALIDATION_FAILED` details under the field named by `path`, unknown codes `GENERIC_MESSAGE`. R7: no motion. R9: English copy; error messages never echo internals. R10: forms live in `Dialog` (native `<dialog>`, modal).
- Dialogs are mounted only while open (no `open` prop; the parent renders `{open ? <XDialog … /> : null}`), as 07b's `AddValueDialog` — `docs/gotchas/web.md` "A dialog mounted only while open starts from fresh state".
- Edit dialogs send only the fields that differ from the loaded entity; an emptied optional field sends `null` where the schema allows it; an unchanged form calls `onClose()` without a request (the API would answer 400 `VALIDATION_FAILED` for an empty body and 200-no-audit for a no-op — neither is worth a round trip).
- `mutationFn` wraps the API call (`(input) => fn(input)`) — TanStack passes a second argument (`docs/gotchas/web.md`). `reset()` is never called from a mutation's own `onSuccess`.
- Suggestion lists are `<div role="listbox">` of `<button type="button" role="option">`; the `Combobox` is the only autocomplete; a small fixed choice is a `Select`.
- Query keys: `datasetKeys` (`['species' …]`, `['records' …]`, `['traits']`, `['references' …]`, `['families']`, `['genera', params]`), `curationKeys`; after a write call `invalidateAfterCatalogWrite(queryClient, area)` (Task 1) — never invalidate ad hoc.
- Run `pnpm lint:fix`, `pnpm typecheck`, `pnpm rfc:check` and `pnpm --filter @treerepro/web test` before every commit; conventional commit messages ending with the attribution lines the session reminder gives; one commit per task unless the task says otherwise.
- Branch: `feat/curation-07c` from `origin/main` (`579ccb8` or later) — **created in a worktree, never with `checkout -b` in the main checkout** (another session may hold it). Parallel tasks run in worktrees `../Elisa-07c-tN` branched from the integration branch; `apps/web/src/routeTree.gen.ts` is regenerated by the router plugin whenever vitest runs — after merging a task that adds a route, run the web tests once and commit the regenerated tree if it changed.
- The web test command: `pnpm --filter @treerepro/web test` (whole suite, ~25 s) or `pnpm --filter @treerepro/web exec vitest run <path>` for one file.

## Setup (before Task 1)

```bash
cd /Users/rafael/Documents/Aplicativos/Elisa && git fetch origin
git worktree add ../Elisa-07c -b feat/curation-07c origin/main
cd ../Elisa-07c
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm install --frozen-lockfile
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/contracts build
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/web test   # green before any change (51 files / 295 tests on 579ccb8)
```

Integration happens in `../Elisa-07c`; the main checkout stays untouched. Task worktrees: `git worktree add ../Elisa-07c-tN -b 07c-tN feat/curation-07c`, merged back with `git merge --ff-only` (or a merge commit when two tasks of one wave both landed) after the task review.

## Waves (parallelism)

| Wave | Tasks | Why |
|---|---|---|
| W1 | T1 | Foundation every other task imports: `api/catalog.ts`, `withQuery`, `ButtonLink`, fixtures. |
| W2 | T2 · T4 · T5 · T6 in parallel | Disjoint files: T2 `TraitsPage` + trait dialogs; T4 reference dialog + reference pages; T5 species dialogs + species pages; T6 `/app/taxa` + `nav.ts` + one icon. Merge order T2, T4, T5, T6; the only shared file is `routeTree.gen.ts` (T6) — run the web suite after the merges and commit the regenerated tree. |
| W3 | T3 | `LevelsEditor` inside the `TraitsPage` T2 reshaped. |
| W4 | T7 | Docs, spec note, issues, close-out (its review folds into the whole-branch review). |

## File structure (end state of this plan)

```
apps/web/src/api/query.ts (+ query.test.ts)                       # Task 1: shared withQuery
apps/web/src/api/dataset.ts, api/curation.ts                      # Task 1: import withQuery; createReference moves out of curation.ts
apps/web/src/api/catalog.ts (+ catalog.test.ts)                   # Task 1: every catalog write + invalidateAfterCatalogWrite
apps/web/src/components/ui/Button.tsx                             # Task 1: buttonClassName()
apps/web/src/components/ui/ButtonLink.tsx (+ ui.test.tsx cases)   # Task 1: router Link dressed as a Button
apps/web/src/components/ui/index.ts                               # Task 1: exports
apps/web/src/pages/curation/PendingPage.tsx                       # Task 1: ButtonLink replaces MANAGE_LEVELS_LINK
apps/web/src/pages/dataset/SpeciesSearchPage.tsx                  # Task 1: buttonClassName on the export anchor; Task 5: New species
apps/web/src/components/curation/AddValueDialog.tsx (+ test)      # Task 1: createReference from api/catalog.ts
apps/web/src/test/dataset-fixtures.ts                             # Task 1: FAMILIES, GENERA, SEXUAL_SYSTEM_TRAIT, SEED_MASS_TRAIT, NEW_TRAIT
apps/web/src/components/catalog/NewTraitDialog.tsx (+ test)       # Task 2
apps/web/src/components/catalog/EditTraitDialog.tsx (+ test)      # Task 2
apps/web/src/pages/dataset/TraitsPage.tsx (+ test)                # Task 2: New trait, Edit; Task 3: LevelsEditor in the levels row
apps/web/src/components/catalog/LevelsEditor.tsx (+ test)         # Task 3: add, rename (seed warning), move, activate
apps/web/src/components/catalog/ReferenceDialog.tsx (+ test)      # Task 4: create + edit
apps/web/src/pages/dataset/ReferencesPage.tsx (+ test)            # Task 4: New reference
apps/web/src/pages/dataset/ReferencePage.tsx (+ test)             # Task 4: Edit
apps/web/src/components/catalog/SpeciesDialog.tsx (+ test)        # Task 5: create + edit; family Select with inline create; genus Combobox with inline create
apps/web/src/components/catalog/AddNameDialog.tsx (+ test)        # Task 5
apps/web/src/pages/dataset/SpeciesPage.tsx (+ test)               # Task 5: Edit species, Add name
apps/web/src/components/catalog/TaxonNameDialog.tsx (+ test)      # Task 6: one name form for new / rename family and genus
apps/web/src/components/catalog/MoveGenusDialog.tsx (+ test)      # Task 6
apps/web/src/pages/catalog/TaxaPage.tsx (+ test)                  # Task 6
apps/web/src/routes/app/taxa.tsx                                  # Task 6
apps/web/src/components/shell/nav.ts (+ AppShell.test.tsx case)   # Task 6: Taxa entry
apps/web/src/components/ui/Icon.tsx                               # Task 6: `branch` icon
docs/gotchas/web.md                                               # Task 3 (level reorder), Task 4 (diff PATCH)
docs/specs/2026-09-13-curation-design.md                          # Task 7: "As delivered (plan 07c)"
README.md                                                         # Task 7
```

## Shared interfaces (defined once, used by every task)

```ts
// apps/web/src/api/query.ts (Task 1)
export type QueryParams = Record<string, string | number | boolean | undefined>;
export function withQuery(path: string, params: QueryParams): string;   // skips undefined, '' and false; `true` → 'true'

// apps/web/src/api/catalog.ts (Task 1)
export type CatalogArea = 'taxa' | 'references' | 'traits';
export async function createFamily(body: FamilyBody): Promise<TaxonRef>;                       // POST /families
export async function updateFamily(id: string, body: FamilyBody): Promise<TaxonRef>;           // PATCH /families/:id
export async function createGenus(body: CreateGenusBody): Promise<Genus>;                      // POST /genera
export async function updateGenus(id: string, body: UpdateGenusBody): Promise<Genus>;          // PATCH /genera/:id
export async function createSpecies(body: CreateSpeciesBody): Promise<Species>;                // POST /species
export async function updateSpecies(id: string, body: UpdateSpeciesBody): Promise<Species>;    // PATCH /species/:id
export async function addSpeciesName(id: string, body: SpeciesNameBody): Promise<Species>;     // POST /species/:id/names
export async function createReference(body: CreateReferenceBody): Promise<ReferenceDetail>;    // POST /references (moved from api/curation.ts)
export async function updateReference(id: string, body: UpdateReferenceBody): Promise<ReferenceDetail>; // PATCH /references/:id
export async function createTrait(body: CreateTraitBody): Promise<Trait>;                      // POST /traits
export async function updateTrait(id: string, body: UpdateTraitBody): Promise<Trait>;          // PATCH /traits/:id
export async function createLevel(traitId: string, body: CreateLevelBody): Promise<Trait>;     // POST /traits/:id/levels
export async function updateLevel(traitId: string, levelId: string, body: UpdateLevelBody): Promise<Trait>; // PATCH /traits/:id/levels/:levelId
export function invalidateAfterCatalogWrite(queryClient: QueryClient, area: CatalogArea): Promise<void>;
//   taxa       → ['families'], ['genera'], ['species'], ['records']   (records and species carry taxon names)
//   references → ['references'], ['records']                          (records carry citation keys)
//   traits     → ['traits'], ['species'], ['records']                 (summaries and records carry level keys)

// apps/web/src/components/ui/Button.tsx (Task 1)
export function buttonClassName(options?: { variant?: 'primary' | 'secondary' | 'danger'; size?: 'md' | 'sm' }): string;
// apps/web/src/components/ui/ButtonLink.tsx (Task 1)
export interface ButtonLinkProps { to: LinkProps['to']; params?: LinkProps['params']; search?: LinkProps['search']; variant?: ButtonVariant; size?: ButtonSize; className?: string; children: ReactNode; 'aria-label'?: string }
export function ButtonLink(props: ButtonLinkProps): JSX.Element;      // <Link className={buttonClassName(…)}>

// apps/web/src/test/dataset-fixtures.ts (Task 1)
export const FAMILIES: TaxonRef[];        // [FAMILY (Fabaceae), MALVACEAE { id …d05, name: 'Malvaceae' }]
export const GENERA: Genus[];             // [{ ...GENUS, family: FAMILY }, ADANSONIA_GENUS { id …d06, name: 'Adansonia', family: null }]
export const SEXUAL_SYSTEM_TRAIT: Trait;  // DICTIONARY[0].traits[0]
export const SEED_MASS_TRAIT: Trait;      // DICTIONARY[1].traits[0]
export const NEW_TRAIT: Trait;            // { id …e04, key: 'flower_colour', valueType: 'categorical', unit: null, description: '', active: true, levels: [] }

// apps/web/src/components/catalog/NewTraitDialog.tsx (Task 2)
export function NewTraitDialog(props: { categories: ReadonlyArray<{ key: string; label: string }>; onClose: () => void; onSaved: (trait: Trait) => void }): JSX.Element;
// apps/web/src/components/catalog/EditTraitDialog.tsx (Task 2)
export function EditTraitDialog(props: { trait: Trait; categoryKey: string; categories: ReadonlyArray<{ key: string; label: string }>; onClose: () => void; onSaved: (trait: Trait) => void }): JSX.Element;

// apps/web/src/components/catalog/LevelsEditor.tsx (Task 3)
export function LevelsEditor(props: { trait: Trait; canManage: boolean }): JSX.Element;   // list + controls; mutations and invalidation inside

// apps/web/src/components/catalog/ReferenceDialog.tsx (Task 4)
export function ReferenceDialog(props: { reference?: ReferenceDetail; onClose: () => void; onSaved: (reference: ReferenceDetail) => void }): JSX.Element;   // create when `reference` is absent

// apps/web/src/components/catalog/SpeciesDialog.tsx (Task 5)
export function SpeciesDialog(props: { species?: Species; onClose: () => void; onSaved: (species: Species) => void }): JSX.Element;   // create when `species` is absent
// apps/web/src/components/catalog/AddNameDialog.tsx (Task 5)
export function AddNameDialog(props: { species: Species; onClose: () => void; onSaved: (species: Species) => void }): JSX.Element;

// apps/web/src/components/catalog/TaxonNameDialog.tsx (Task 6)
export function TaxonNameDialog(props: { title: string; label: string; initial?: string; submitLabel: string; takenMessage: string; save: (name: string) => Promise<unknown>; onClose: () => void; onSaved: () => void }): JSX.Element;
// apps/web/src/components/catalog/MoveGenusDialog.tsx (Task 6)
export function MoveGenusDialog(props: { genus: Genus; families: TaxonRef[]; onClose: () => void; onSaved: (genus: Genus) => void }): JSX.Element;

// apps/web/src/components/shell/nav.ts (Task 6)
//   + { to: '/app/taxa', label: 'Taxa', icon: 'branch', permission: 'taxa.manage', section: 'data' }
```

---

### Task 1: Foundation — shared `withQuery`, `api/catalog.ts`, `buttonClassName` / `ButtonLink`, fixtures

**Files:**
- Create: `apps/web/src/api/query.ts`, `apps/web/src/api/query.test.ts`, `apps/web/src/api/catalog.ts`, `apps/web/src/api/catalog.test.ts`, `apps/web/src/components/ui/ButtonLink.tsx`
- Modify: `apps/web/src/api/dataset.ts`, `apps/web/src/api/curation.ts` (+ `curation.test.ts`), `apps/web/src/components/ui/Button.tsx`, `apps/web/src/components/ui/index.ts`, `apps/web/src/pages/curation/PendingPage.tsx` (+ test), `apps/web/src/pages/dataset/SpeciesSearchPage.tsx`, `apps/web/src/components/curation/AddValueDialog.tsx` (+ test), `apps/web/src/test/dataset-fixtures.ts`
- Test: `apps/web/src/components/ui/ui.test.tsx`

**Interfaces:**
- Produces: everything in "Shared interfaces" for Task 1. `createReference` now lives in `api/catalog.ts` (removed from `api/curation.ts`).

- [ ] **Step 1: Failing tests — `withQuery`**

Create `apps/web/src/api/query.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { withQuery } from './query.ts';

describe('withQuery', () => {
  it('appends the defined, non-empty, non-false params and leaves the path alone otherwise', () => {
    expect(withQuery('/species', { q: 'Aden', limit: 20, unresolved: true })).toBe(
      '/species?q=Aden&limit=20&unresolved=true',
    );
    expect(withQuery('/species', { q: '', cursor: undefined, unresolved: false })).toBe('/species');
  });
});
```

Run: `pnpm --filter @treerepro/web exec vitest run src/api/query.test.ts` — expected: FAIL, "Cannot find module './query.ts'".

- [ ] **Step 2: `api/query.ts`; both clients import it**

```ts
// apps/web/src/api/query.ts
export type QueryParams = Record<string, string | number | boolean | undefined>;

/**
 * The path with its query string: `undefined`, `''` and `false` are left out
 * (an unchecked filter sends nothing), `true` is sent as `'true'` — the
 * form the API's boolean query params take (RFC-60 R6).
 * @rfc RFC-11 R6
 * @rfc RFC-60 R6
 */
export function withQuery(path: string, params: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && value !== false) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}
```

(RFC-11 R6 is the cursor / limit query rule every list shares; RFC-60 R6 the list whose `unresolved=true` fixes the boolean form.)

In `api/dataset.ts` delete the local `Params` type and `withQuery` function; `import { type QueryParams as Params, withQuery } from './query.ts';` (keep the `Params` alias so `datasetKeys` is unchanged). `searchSpecies` no longer needs its `unresolved: params.unresolved ? 'true' : undefined` rewrite — pass `params` through (`true` → `'true'` is now `withQuery`'s job); keep the existing `api/dataset.test.ts` assertion on the URL green. In `api/curation.ts` delete its `Params` and `withQuery` and import from `./query.ts`.

Run `src/api/query.test.ts`, `src/api/dataset.test.ts`, `src/api/curation.test.ts` — all green.

- [ ] **Step 3: Failing tests — `api/catalog.ts`**

Create `apps/web/src/api/catalog.test.ts` (same style as `curation.test.ts`: `installFetchMock`, `mockJson`, `lastRequest`):

```ts
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  FAMILY,
  GENUS,
  REFERENCE_DETAIL,
  SEXUAL_SYSTEM_TRAIT,
  SPECIES,
} from '../test/dataset-fixtures.ts';
import { installFetchMock, lastRequest, mockJson } from '../test/fetch.ts';
import {
  addSpeciesName,
  createFamily,
  createGenus,
  createLevel,
  createReference,
  createSpecies,
  createTrait,
  invalidateAfterCatalogWrite,
  updateFamily,
  updateGenus,
  updateLevel,
  updateReference,
  updateSpecies,
  updateTrait,
} from './catalog.ts';

installFetchMock();

const body = () => JSON.parse(String(lastRequest().init?.body));

describe('RFC-60 R9 taxa writes', () => {
  it('createFamily / updateFamily post and patch /families', async () => {
    mockJson(201, { data: FAMILY });
    expect(await createFamily({ name: 'Fabaceae' })).toEqual(FAMILY);
    expect(lastRequest()).toMatchObject({ url: '/api/families', init: { method: 'POST' } });
    mockJson(200, { data: FAMILY });
    await updateFamily(FAMILY.id, { name: 'Fabaceae' });
    expect(lastRequest()).toMatchObject({ url: `/api/families/${FAMILY.id}`, init: { method: 'PATCH' } });
    expect(body()).toEqual({ name: 'Fabaceae' });
  });
  it('createGenus / updateGenus post and patch /genera; null familyId is sent', async () => {
    mockJson(201, { data: { ...GENUS, family: FAMILY } });
    await createGenus({ name: 'Adenanthera', familyId: FAMILY.id });
    expect(lastRequest()).toMatchObject({ url: '/api/genera', init: { method: 'POST' } });
    mockJson(200, { data: { ...GENUS, family: null } });
    await updateGenus(GENUS.id, { familyId: null });
    expect(lastRequest().url).toBe(`/api/genera/${GENUS.id}`);
    expect(body()).toEqual({ familyId: null });
  });
  it('createSpecies / updateSpecies / addSpeciesName use the species paths', async () => {
    mockJson(201, { data: SPECIES });
    await createSpecies({ canonicalName: 'Adenanthera pavonina', nameSource: 'wcvp', genusId: GENUS.id });
    expect(lastRequest()).toMatchObject({ url: '/api/species', init: { method: 'POST' } });
    mockJson(200, { data: SPECIES });
    await updateSpecies(SPECIES.id, { nameSource: 'original' });
    expect(lastRequest()).toMatchObject({ url: `/api/species/${SPECIES.id}`, init: { method: 'PATCH' } });
    mockJson(201, { data: SPECIES });
    await addSpeciesName(SPECIES.id, { name: 'Adenanthera gersenii', gbifUsageKey: '2969393' });
    expect(lastRequest()).toMatchObject({ url: `/api/species/${SPECIES.id}/names`, init: { method: 'POST' } });
  });
});

describe('RFC-61 R6 reference writes', () => {
  it('createReference posts, updateReference patches with nulls kept', async () => {
    mockJson(201, { data: REFERENCE_DETAIL });
    expect(await createReference({ citationKey: 'Smith2001' })).toEqual(REFERENCE_DETAIL);
    expect(lastRequest()).toMatchObject({ url: '/api/references', init: { method: 'POST' } });
    mockJson(200, { data: REFERENCE_DETAIL });
    await updateReference(REFERENCE_DETAIL.id, { title: null, year: 2002 });
    expect(lastRequest()).toMatchObject({ url: `/api/references/${REFERENCE_DETAIL.id}`, init: { method: 'PATCH' } });
    expect(body()).toEqual({ title: null, year: 2002 });
  });
});

describe('RFC-62 R6 trait and level writes', () => {
  it('createTrait / updateTrait / createLevel / updateLevel use the trait paths and unwrap the trait', async () => {
    mockJson(201, { data: SEXUAL_SYSTEM_TRAIT });
    await createTrait({ key: 'sexual_system', categoryKey: 'reproductive_system', valueType: 'categorical' });
    expect(lastRequest()).toMatchObject({ url: '/api/traits', init: { method: 'POST' } });
    mockJson(200, { data: SEXUAL_SYSTEM_TRAIT });
    await updateTrait(SEXUAL_SYSTEM_TRAIT.id, { active: false });
    expect(lastRequest()).toMatchObject({ url: `/api/traits/${SEXUAL_SYSTEM_TRAIT.id}`, init: { method: 'PATCH' } });
    mockJson(201, { data: SEXUAL_SYSTEM_TRAIT });
    const trait = await createLevel(SEXUAL_SYSTEM_TRAIT.id, { key: 'monoecious' });
    expect(trait.id).toBe(SEXUAL_SYSTEM_TRAIT.id);
    expect(lastRequest()).toMatchObject({ url: `/api/traits/${SEXUAL_SYSTEM_TRAIT.id}/levels`, init: { method: 'POST' } });
    const level = SEXUAL_SYSTEM_TRAIT.levels[0];
    mockJson(200, { data: SEXUAL_SYSTEM_TRAIT });
    await updateLevel(SEXUAL_SYSTEM_TRAIT.id, level?.id ?? '', { sortOrder: 3 });
    expect(lastRequest().url).toBe(`/api/traits/${SEXUAL_SYSTEM_TRAIT.id}/levels/${level?.id}`);
    expect(body()).toEqual({ sortOrder: 3 });
  });
});

describe('RFC-13 R6 invalidateAfterCatalogWrite', () => {
  it('invalidates the prefixes of each area', async () => {
    const queryClient = new QueryClient();
    const seen = (key: readonly unknown[]) =>
      queryClient.getQueryState(key)?.isInvalidated === true;
    for (const key of [['families'], ['genera', {}], ['species', 'x'], ['records', 'y'], ['references', 'z'], ['traits']]) {
      queryClient.setQueryData(key, {});
    }
    await invalidateAfterCatalogWrite(queryClient, 'taxa');
    expect([seen(['families']), seen(['genera', {}]), seen(['species', 'x']), seen(['records', 'y'])]).toEqual([true, true, true, true]);
    expect(seen(['references', 'z'])).toBe(false);
    expect(seen(['traits'])).toBe(false);
    await invalidateAfterCatalogWrite(queryClient, 'references');
    expect(seen(['references', 'z'])).toBe(true);
    await invalidateAfterCatalogWrite(queryClient, 'traits');
    expect(seen(['traits'])).toBe(true);
  });
});
```

Add the fixtures the test imports (`SEXUAL_SYSTEM_TRAIT` and the others of the interface block) to `apps/web/src/test/dataset-fixtures.ts`:

```ts
/** @rfc RFC-60 R8 */
export const MALVACEAE = { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d05', name: 'Malvaceae' };
/** @rfc RFC-60 R8 */
export const FAMILIES: TaxonRef[] = [FAMILY, MALVACEAE];
/** A genus without a family, the case `/app/taxa` moves. @rfc RFC-60 R8 */
export const ADANSONIA_GENUS: Genus = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d06',
  name: 'Adansonia',
  family: null,
};
/** @rfc RFC-60 R8 */
export const GENERA: Genus[] = [{ ...GENUS, family: FAMILY }, ADANSONIA_GENUS];
/** @rfc RFC-62 R5 */
export const SEXUAL_SYSTEM_TRAIT: Trait = DICTIONARY[0]?.traits[0] as Trait;
/** @rfc RFC-62 R5 */
export const SEED_MASS_TRAIT: Trait = DICTIONARY[1]?.traits[0] as Trait;
/** What `POST /api/traits` answers for a fresh categorical trait. @rfc RFC-62 R6 */
export const NEW_TRAIT: Trait = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e04',
  key: 'flower_colour',
  valueType: 'categorical',
  unit: null,
  description: '',
  active: true,
  levels: [],
};
```

(`Genus`, `TaxonRef`, `Trait` come from `@treerepro/contracts`; `DICTIONARY` is declared above these lines — place them after it. The `as Trait` casts avoid `noUncheckedIndexedAccess` unions in every test that uses them.)

Run: `pnpm --filter @treerepro/web exec vitest run src/api/catalog.test.ts` — expected: FAIL, "Cannot find module './catalog.ts'".

- [ ] **Step 4: `api/catalog.ts`**

```ts
import type { QueryClient } from '@tanstack/react-query';
import type {
  CreateGenusBody,
  CreateLevelBody,
  CreateReferenceBody,
  CreateSpeciesBody,
  CreateTraitBody,
  DataEnvelope,
  FamilyBody,
  Genus,
  ReferenceDetail,
  Species,
  SpeciesNameBody,
  TaxonRef,
  Trait,
  UpdateGenusBody,
  UpdateLevelBody,
  UpdateReferenceBody,
  UpdateSpeciesBody,
  UpdateTraitBody,
} from '@treerepro/contracts';
import { apiFetch } from './client.ts';

async function post<T>(path: string, json: unknown): Promise<T> {
  return (await apiFetch<DataEnvelope<T>>(path, { method: 'POST', json })).data;
}
async function patch<T>(path: string, json: unknown): Promise<T> {
  return (await apiFetch<DataEnvelope<T>>(path, { method: 'PATCH', json })).data;
}

/** @rfc RFC-60 R9 */
export function createFamily(body: FamilyBody): Promise<TaxonRef> {
  return post('/families', body);
}
/** @rfc RFC-60 R9 */
export function updateFamily(id: string, body: FamilyBody): Promise<TaxonRef> {
  return patch(`/families/${id}`, body);
}
/** @rfc RFC-60 R9 */
export function createGenus(body: CreateGenusBody): Promise<Genus> {
  return post('/genera', body);
}
/** @rfc RFC-60 R9 */
export function updateGenus(id: string, body: UpdateGenusBody): Promise<Genus> {
  return patch(`/genera/${id}`, body);
}
/** @rfc RFC-60 R9 */
export function createSpecies(body: CreateSpeciesBody): Promise<Species> {
  return post('/species', body);
}
/** @rfc RFC-60 R9 */
export function updateSpecies(id: string, body: UpdateSpeciesBody): Promise<Species> {
  return patch(`/species/${id}`, body);
}
/** @rfc RFC-60 R9 */
export function addSpeciesName(id: string, body: SpeciesNameBody): Promise<Species> {
  return post(`/species/${id}/names`, body);
}
/** @rfc RFC-61 R6 */
export function createReference(body: CreateReferenceBody): Promise<ReferenceDetail> {
  return post('/references', body);
}
/** @rfc RFC-61 R6 */
export function updateReference(id: string, body: UpdateReferenceBody): Promise<ReferenceDetail> {
  return patch(`/references/${id}`, body);
}
/** @rfc RFC-62 R6 */
export function createTrait(body: CreateTraitBody): Promise<Trait> {
  return post('/traits', body);
}
/** @rfc RFC-62 R6 */
export function updateTrait(id: string, body: UpdateTraitBody): Promise<Trait> {
  return patch(`/traits/${id}`, body);
}
/** Answers the parent trait with its levels. @rfc RFC-62 R6 */
export function createLevel(traitId: string, body: CreateLevelBody): Promise<Trait> {
  return post(`/traits/${traitId}/levels`, body);
}
/** Answers the parent trait with its levels. @rfc RFC-62 R6 */
export function updateLevel(traitId: string, levelId: string, body: UpdateLevelBody): Promise<Trait> {
  return patch(`/traits/${traitId}/levels/${levelId}`, body);
}

export type CatalogArea = 'taxa' | 'references' | 'traits';

const STALE_AFTER: Record<CatalogArea, readonly (readonly string[])[]> = {
  // Records and species items carry family, genus and species names.
  taxa: [['families'], ['genera'], ['species'], ['records']],
  // Record items and details carry citation keys; the list and detail the edit itself.
  references: [['references'], ['records']],
  // Species summaries and record items carry level keys; the dictionary the edit itself.
  traits: [['traits'], ['species'], ['records']],
};

/**
 * After a catalog write, every query that renders a name or key of that
 * area is stale; the prefixes are the `datasetKeys` roots.
 * @rfc RFC-13 R6
 */
export async function invalidateAfterCatalogWrite(
  queryClient: QueryClient,
  area: CatalogArea,
): Promise<void> {
  await Promise.all(
    STALE_AFTER[area].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}
```

Remove `createReference` (and its `CreateReferenceBody` / `ReferenceDetail` imports) from `api/curation.ts`; move its test case from `api/curation.test.ts` (the `RFC-61 R6 createReference` describe, if present) into `catalog.test.ts` (Step 3 already covers it — delete the old one). `AddValueDialog.tsx`: `import { createReference } from '../../api/catalog.ts';`; `AddValueDialog.test.tsx`: move `createReference: vi.fn()` from the `curation` hoisted mock into a new `catalog` hoisted mock (`vi.mock('../../api/catalog.ts', …)` with the same `importOriginal` spread) and update the three references (`curation.createReference` → `catalog.createReference`).

Run `src/api/catalog.test.ts`, `src/api/curation.test.ts`, `src/components/curation/AddValueDialog.test.tsx` — green.

- [ ] **Step 5: Failing test — `buttonClassName` and `ButtonLink`**

Append to `apps/web/src/components/ui/ui.test.tsx` (`describe('RFC-13 R5 UI kit renders with classes only')`):

```tsx
  it('buttonClassName returns the Button dress for a variant and size', () => {
    const { container } = render(<Button variant="secondary" size="sm">Same</Button>);
    expect(buttonClassName({ variant: 'secondary', size: 'sm' }).trim()).toBe(
      container.querySelector('button')?.className.trim(),
    );
    expect(buttonClassName()).toBe(buttonClassName({ variant: 'primary', size: 'md' }));
  });
```

Import `buttonClassName` from `./index.ts`. `ButtonLink` needs a router, so its test lives in the page that uses it (Step 7). Run the file — expected: FAIL, "buttonClassName is not a function" (or the import error).

- [ ] **Step 6: `buttonClassName`, `ButtonLink`, exports**

`Button.tsx`: export the two union types and the class builder; `Button` uses it:

```ts
export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'md' | 'sm';

/**
 * The Button's classes for an element that is not a `<button>` — a router
 * `Link` (`ButtonLink`) or an `<a download>` — so every action looks the same.
 * @rfc RFC-13 R5
 */
export function buttonClassName({
  variant = 'primary',
  size = 'md',
}: { variant?: ButtonVariant; size?: ButtonSize } = {}): string {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]}`;
}
```

and in `Button`: `className={`${buttonClassName({ variant, size })} ${className}`}` (delete the local `Variant` / `Size` aliases in favour of the exported names).

```tsx
// apps/web/src/components/ui/ButtonLink.tsx
import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { type ButtonSize, type ButtonVariant, buttonClassName } from './Button.tsx';

export interface ButtonLinkProps {
  to: LinkProps['to'];
  params?: LinkProps['params'];
  search?: LinkProps['search'];
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  'aria-label'?: string;
  children: ReactNode;
}

/**
 * A router `Link` dressed as a `Button`: navigation that sits among actions
 * (a "Manage levels" link next to a "Map" button) without being a button.
 * @rfc RFC-13 R5
 */
export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...rest
}: ButtonLinkProps) {
  return <Link {...rest} className={`${buttonClassName({ variant, size })} ${className}`} />;
}
```

If `LinkProps['to']` does not typecheck against the route tree in this router version, use `ComponentProps<typeof Link>['to']` (and the same for `params` / `search`); the props stay the three named ones. `index.ts`: `export type { ButtonLinkProps } from './ButtonLink.tsx'; export { ButtonLink } from './ButtonLink.tsx';` and add `ButtonSize`, `ButtonVariant`, `buttonClassName` to the `Button.tsx` export lines.

- [ ] **Step 7: Adopt in the two pages**

`pages/curation/PendingPage.tsx`: delete `MANAGE_LEVELS_LINK` and render `<ButtonLink to="/app/traits" size="sm">Manage levels</ButtonLink>` (import from the kit index; drop the now-unused `Link` import if nothing else uses it). Add to `PendingPage.test.tsx` (seed `fetchMe` with `['dataset.read', 'records.create', 'traits.manage']` for this case):

```tsx
  it('offers "Manage levels" to a traits.manage holder as a link to /app/traits', async () => {
    auth.fetchMe.mockResolvedValue({ ...ME, permissions: ['dataset.read', 'records.create', 'traits.manage'] });
    renderAt('/app/curation/pending');
    await userEvent.click(await screen.findByRole('button', { name: /sexual system/i }));
    const link = await screen.findByRole('link', { name: 'Manage levels' });
    expect(link).toHaveAttribute('href', '/app/traits');
    expect(link.className).toContain('rounded-full');
  });
```

(Adapt the trait button's accessible name to what the page renders — read the existing tests in the file for the selector they use to pick a trait.)

`pages/dataset/SpeciesSearchPage.tsx`: the export anchor keeps `<a href download>` and takes `className={buttonClassName({ variant: 'secondary' })}` instead of the hand-copied string (the existing test asserting the link stays green).

- [ ] **Step 8: Verify and commit**

```bash
PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint:fix && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm typecheck && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/web test
git add apps/web/src/api apps/web/src/components/ui apps/web/src/components/curation apps/web/src/pages apps/web/src/test
git commit -m "feat(web): catalog API client, shared withQuery, ButtonLink and buttonClassName; catalog fixtures (RFC-60 R9, RFC-61 R6, RFC-62 R6)"
```

### Task 2: Trait editor — `NewTraitDialog`, `EditTraitDialog`, `TraitsPage` buttons

**Files:**
- Create: `apps/web/src/components/catalog/NewTraitDialog.tsx`, `NewTraitDialog.test.tsx`, `apps/web/src/components/catalog/EditTraitDialog.tsx`, `EditTraitDialog.test.tsx`
- Modify: `apps/web/src/pages/dataset/TraitsPage.tsx`, `apps/web/src/pages/dataset/TraitsPage.test.tsx`

**Interfaces:**
- Consumes: `createTrait`, `updateTrait`, `invalidateAfterCatalogWrite` (Task 1); `createTraitBodySchema`, `updateTraitBodySchema`, `TRAIT_VALUE_TYPES` (contracts); `Dialog`, `Field`, `Input`, `Select`, `Textarea`, `Button`, `Alert` (kit).
- Produces: `NewTraitDialog`, `EditTraitDialog` (interface block). `TraitsPage` exposes the `traits.manage` buttons; the levels row is unchanged here (Task 3 replaces it).

- [ ] **Step 1: Failing tests — `NewTraitDialog`**

`apps/web/src/components/catalog/NewTraitDialog.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { DICTIONARY, NEW_TRAIT } from '../../test/dataset-fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { NewTraitDialog } from './NewTraitDialog.tsx';

const catalog = vi.hoisted(() => ({
  createTrait: vi.fn(),
  invalidateAfterCatalogWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/catalog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/catalog.ts')>()),
  ...catalog,
}));

const CATEGORIES = DICTIONARY.map((c) => ({ key: c.key, label: c.label }));

beforeEach(() => {
  catalog.createTrait.mockReset();
  catalog.invalidateAfterCatalogWrite.mockClear();
});

function mount() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderWithProviders(<NewTraitDialog categories={CATEGORIES} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved, dialog: screen.getByRole('dialog', { name: 'New trait' }) };
}

describe('RFC-62 R6 NewTraitDialog', () => {
  it('posts key, category, value type, unit and description, then invalidates traits and reports the trait', async () => {
    catalog.createTrait.mockResolvedValue(NEW_TRAIT);
    const { dialog, onSaved } = mount();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^key/i }), 'flower_colour');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /category/i }), 'seed');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /value type/i }), 'quantitative');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /unit/i }), 'mm');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /description/i }), 'Colour of the petals.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create trait' }));
    await waitFor(() =>
      expect(catalog.createTrait).toHaveBeenCalledWith({
        key: 'flower_colour',
        categoryKey: 'seed',
        valueType: 'quantitative',
        unit: 'mm',
        description: 'Colour of the petals.',
      }),
    );
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'traits');
    expect(onSaved).toHaveBeenCalledWith(NEW_TRAIT);
  });

  it('requires key and category before sending; an empty unit is not sent', async () => {
    catalog.createTrait.mockResolvedValue(NEW_TRAIT);
    const { dialog } = mount();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create trait' }));
    expect(within(dialog).getByText('Enter a key.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a category.')).toBeInTheDocument();
    expect(catalog.createTrait).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^key/i }), 'flower_colour');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /category/i }), 'reproductive_system');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create trait' }));
    await waitFor(() =>
      expect(catalog.createTrait).toHaveBeenCalledWith({
        key: 'flower_colour',
        categoryKey: 'reproductive_system',
        valueType: 'categorical',
      }),
    );
  });

  it('maps TRAIT_KEY_TAKEN under the key field and VALIDATION_FAILED details by path', async () => {
    catalog.createTrait.mockRejectedValueOnce(new ApiError(409, 'TRAIT_KEY_TAKEN', 'taken'));
    const { dialog } = mount();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^key/i }), 'sexual_system');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /category/i }), 'seed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create trait' }));
    expect(await within(dialog).findByText('A trait with this key already exists.')).toBeInTheDocument();
    catalog.createTrait.mockRejectedValueOnce(
      new ApiError(400, 'VALIDATION_FAILED', 'bad', [{ path: 'categoryKey', message: 'Unknown category' }]),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create trait' }));
    expect(await within(dialog).findByText('Unknown category')).toBeInTheDocument();
  });
});
```

(Check `ApiError`'s constructor signature in `apps/web/src/api/client.ts` — 07b tests build it as `new ApiError(status, code, message, details?)`; follow them.)

Run: `pnpm --filter @treerepro/web exec vitest run src/components/catalog/NewTraitDialog.test.tsx` — expected: FAIL, "Cannot find module './NewTraitDialog.tsx'".

- [ ] **Step 2: `NewTraitDialog`**

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type CreateTraitBody,
  createTraitBodySchema,
  TRAIT_VALUE_TYPES,
  type Trait,
  type TraitValueType,
} from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { createTrait, invalidateAfterCatalogWrite } from '../../api/catalog.ts';
import { ApiError } from '../../api/client.ts';
import { fieldErrors, pageErrorMessage } from '../../lib/errors.ts';
import { Alert, Button, Dialog, Field, Input, Select, Textarea } from '../ui/index.ts';

/** @rfc RFC-13 R6 */
export function traitErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'TRAIT_KEY_TAKEN':
        return 'A trait with this key already exists.';
      case 'TRAIT_NOT_FOUND':
        return 'This trait no longer exists. Reload the page.';
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}

const LOCAL: Record<string, string> = { key: 'Enter a key.', categoryKey: 'Choose a category.' };

/**
 * The form of RFC-62 R6 `POST /api/traits`: key, category (one of the
 * dictionary's), value type, unit and description — the last two optional.
 * Key, value type and unit are immutable afterwards (the hint says so).
 * Mounted only while open.
 * @rfc RFC-13 R6
 * @rfc RFC-62 R6
 */
export function NewTraitDialog({
  categories,
  onClose,
  onSaved,
}: {
  categories: ReadonlyArray<{ key: string; label: string }>;
  onClose: () => void;
  onSaved: (trait: Trait) => void;
}) {
  const queryClient = useQueryClient();
  const ids = { key: useId(), category: useId(), type: useId(), unit: useId(), description: useId() };
  const [key, setKey] = useState('');
  const [categoryKey, setCategoryKey] = useState('');
  const [valueType, setValueType] = useState<TraitValueType>('categorical');
  const [unit, setUnit] = useState('');
  const [description, setDescription] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: CreateTraitBody) => createTrait(body),
    onSuccess: async (trait) => {
      await invalidateAfterCatalogWrite(queryClient, 'traits');
      onSaved(trait);
    },
  });
  const errors = {
    ...fieldErrors(save.error),
    ...(save.error instanceof ApiError && save.error.code === 'TRAIT_KEY_TAKEN'
      ? { key: traitErrorMessage(save.error) }
      : {}),
    ...local,
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const required: Record<string, string> = {};
    if (key.trim() === '') required.key = LOCAL.key ?? '';
    if (categoryKey === '') required.categoryKey = LOCAL.categoryKey ?? '';
    if (Object.keys(required).length > 0) {
      save.reset();
      setLocal(required);
      return;
    }
    const parsed = createTraitBodySchema.safeParse({
      key: key.trim(),
      categoryKey,
      valueType,
      unit: unit.trim() || undefined,
      description: description.trim() || undefined,
    });
    if (!parsed.success) {
      save.reset();
      setLocal(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setLocal({});
    save.mutate(parsed.data);
  }

  return (
    <Dialog open title="New trait" onClose={onClose} closeDisabled={save.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field id={ids.key} label="Key" hint="snake_case, immutable once created (the import matches by key)." error={errors.key}>
          <Input id={ids.key} value={key} maxLength={200} onChange={(e) => setKey(e.target.value)} invalid={Boolean(errors.key)} />
        </Field>
        <Field id={ids.category} label="Category" error={errors.categoryKey}>
          <Select id={ids.category} value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} invalid={Boolean(errors.categoryKey)}>
            <option value="">Choose a category</option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </Select>
        </Field>
        <Field id={ids.type} label="Value type" hint="Immutable once created." error={errors.valueType}>
          <Select id={ids.type} value={valueType} onChange={(e) => setValueType(e.target.value as TraitValueType)}>
            {TRAIT_VALUE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field id={ids.unit} label="Unit (optional)" hint="Immutable once created; a changed unit would change the meaning of stored numbers." error={errors.unit}>
          <Input id={ids.unit} value={unit} maxLength={32} onChange={(e) => setUnit(e.target.value)} invalid={Boolean(errors.unit)} />
        </Field>
        <Field id={ids.description} label="Description (optional)" error={errors.description}>
          <Textarea id={ids.description} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {save.isError && !errors.key ? <Alert tone="error">{traitErrorMessage(save.error)}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" pending={save.isPending}>Create trait</Button>
        </div>
      </form>
    </Dialog>
  );
}
```

(Biome will reflow the long JSX lines on `lint:fix`.) Run the test file — green.

- [ ] **Step 3: Failing tests — `EditTraitDialog`**

`apps/web/src/components/catalog/EditTraitDialog.test.tsx` (same mocks, `updateTrait` instead of `createTrait`):

```tsx
describe('RFC-62 R6 EditTraitDialog', () => {
  it('shows the immutable fields as text and patches only what changed', async () => {
    catalog.updateTrait.mockResolvedValue({ ...SEXUAL_SYSTEM_TRAIT, active: false });
    const { dialog, onSaved } = mount(SEXUAL_SYSTEM_TRAIT, 'reproductive_system');
    expect(within(dialog).getByText('sexual_system')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: /^key/i })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /active/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(catalog.updateTrait).toHaveBeenCalledWith(SEXUAL_SYSTEM_TRAIT.id, { active: false }),
    );
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'traits');
    expect(onSaved).toHaveBeenCalledWith({ ...SEXUAL_SYSTEM_TRAIT, active: false });
  });

  it('an unchanged form closes without a request; a changed category and description are both sent', async () => {
    catalog.updateTrait.mockResolvedValue(SEXUAL_SYSTEM_TRAIT);
    const first = mount(SEXUAL_SYSTEM_TRAIT, 'reproductive_system');
    await userEvent.click(within(first.dialog).getByRole('button', { name: 'Save' }));
    expect(catalog.updateTrait).not.toHaveBeenCalled();
    expect(first.onClose).toHaveBeenCalled();
    cleanup();
    const second = mount(SEXUAL_SYSTEM_TRAIT, 'reproductive_system');
    await userEvent.selectOptions(within(second.dialog).getByRole('combobox', { name: /category/i }), 'seed');
    const description = within(second.dialog).getByRole('textbox', { name: /description/i });
    await userEvent.clear(description);
    await userEvent.type(description, 'Sex distribution.');
    await userEvent.click(within(second.dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(catalog.updateTrait).toHaveBeenCalledWith(SEXUAL_SYSTEM_TRAIT.id, {
        categoryKey: 'seed',
        description: 'Sex distribution.',
      }),
    );
  });

  it('maps TRAIT_NOT_FOUND to its sentence', async () => {
    catalog.updateTrait.mockRejectedValue(new ApiError(404, 'TRAIT_NOT_FOUND', 'gone'));
    const { dialog } = mount(SEXUAL_SYSTEM_TRAIT, 'reproductive_system');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /active/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This trait no longer exists. Reload the page.');
  });
});
```

with `mount(trait, categoryKey)` rendering `<EditTraitDialog trait={trait} categoryKey={categoryKey} categories={CATEGORIES} onClose onSaved />` and returning `{ dialog: screen.getByRole('dialog', { name: 'Edit trait' }), onClose, onSaved }`; `cleanup` from `@testing-library/react`. Run — expected: FAIL, module not found.

- [ ] **Step 4: `EditTraitDialog`**

Same shape as `NewTraitDialog`, reusing `traitErrorMessage` (import it from `./NewTraitDialog.tsx`). The header shows the immutable fields as text: `<p className="text-body text-canopy-900"><span className="text-mist-500">Key: </span>{trait.key}<span className="text-mist-500"> · {trait.valueType}{trait.unit ? ` · ${trait.unit}` : ''}</span></p>`. Fields: Category (`Select`, initial `categoryKey`), Description (`Textarea`, initial `trait.description`), Active (a native checkbox — `<label className="flex items-center gap-2 text-body"><input type="checkbox" className="size-4 accent-canopy-600" checked={active} onChange={…} /> Active — inactive traits are hidden from manual entry; their records stay</label>`, no kit `Checkbox` exists and one field does not justify it). The diff:

```ts
function diff(): UpdateTraitBody | null {
  const body: UpdateTraitBody = {};
  if (category !== categoryKey) body.categoryKey = category;
  if (description.trim() !== trait.description) body.description = description.trim();
  if (active !== trait.active) body.active = active;
  return Object.keys(body).length > 0 ? body : null;
}
```

`submit`: `const body = diff(); if (!body) { onClose(); return; }`, then `updateTraitBodySchema.safeParse(body)` → local errors by path, else `save.mutate(body)` where `mutationFn: (b: UpdateTraitBody) => updateTrait(trait.id, b)`. Buttons "Cancel" / "Save". Title "Edit trait". Run — green.

- [ ] **Step 5: Failing tests — `TraitsPage` buttons**

Append to `TraitsPage.test.tsx` (mocks: add `vi.mock('../../api/catalog.ts', …)` with `createTrait`, `updateTrait`, `invalidateAfterCatalogWrite`; a `MANAGER: MeResponse = { ...ME, permissions: ['dataset.read', 'traits.manage'] }`):

```tsx
describe('RFC-62 R6 TraitsPage editing', () => {
  it('hides "New trait" and "Edit" from a reader', async () => {
    renderAt('/app/traits');
    await screen.findByText('sexual system');
    expect(screen.queryByRole('button', { name: 'New trait' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument();
  });

  it('creates a trait from the header dialog and refetches the dictionary', async () => {
    auth.fetchMe.mockResolvedValue(MANAGER);
    catalog.createTrait.mockResolvedValue(NEW_TRAIT);
    dataset.fetchDictionary
      .mockResolvedValueOnce(DICTIONARY)
      .mockResolvedValue([
        DICTIONARY[0] as Dictionary[number],
        { ...(DICTIONARY[1] as Dictionary[number]), traits: [...(DICTIONARY[1] as Dictionary[number]).traits, NEW_TRAIT] },
      ]);
    renderAt('/app/traits');
    await userEvent.click(await screen.findByRole('button', { name: 'New trait' }));
    const dialog = screen.getByRole('dialog', { name: 'New trait' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^key/i }), 'flower_colour');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /category/i }), 'seed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create trait' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('flower colour')).toBeInTheDocument();
  });

  it('opens the edit dialog for a trait with its category preselected', async () => {
    auth.fetchMe.mockResolvedValue(MANAGER);
    renderAt('/app/traits');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit sexual system' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit trait' });
    expect(within(dialog).getByRole('combobox', { name: /category/i })).toHaveValue('reproductive_system');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
```

(The page test's `catalog` mock spreads `importOriginal` and overrides only `createTrait` / `updateTrait` — the real `invalidateAfterCatalogWrite` runs, so the dictionary refetches and the mocked `fetchDictionary`'s second answer is what the page renders after the dialog closes. Also add `vi.mock('../../api/catalog.ts', …)` with `createLevel` for Task 3's case.)

Run — expected: FAIL on the buttons.

- [ ] **Step 6: `TraitsPage` wiring**

`TraitsPage`: `const me = useMe(); const canManage = hasPermission(me, 'traits.manage');` `PageHeader actions={canManage ? <Button onClick={() => setCreating(true)}>New trait</Button> : undefined}`; `{creating ? <NewTraitDialog categories={categories} onClose={() => setCreating(false)} onSaved={() => setCreating(false)} /> : null}` where `categories = (dictionary.data ?? []).map((c) => ({ key: c.key, label: c.label }))` (every category, not the filtered ones). `CategorySection` receives `categoryKey`, `categories` and `canManage`; `TraitRows` gets an "Edit" `Button size="sm" variant="secondary" aria-label={`Edit ${name}`}` in the last cell next to the levels toggle when `canManage`, opening `<EditTraitDialog trait categoryKey categories onClose onSaved />` (state `editing: boolean` per row). Keep the levels row as is (Task 3 replaces the `<ul>`). The `@rfc` block of `TraitsPage` gains `RFC-62 R6` and `RFC-13 R3`.

Run the file, then the whole suite — green.

- [ ] **Step 7: Verify and commit**

```bash
PATH=… pnpm lint:fix && PATH=… pnpm typecheck && PATH=… pnpm rfc:check && PATH=… pnpm --filter @treerepro/web test
git add apps/web/src/components/catalog apps/web/src/pages/dataset/TraitsPage.tsx apps/web/src/pages/dataset/TraitsPage.test.tsx
git commit -m "feat(web): trait editor — new trait and edit trait dialogs on /app/traits (RFC-62 R6)"
```

---

### Task 3: Level editor — add, rename with the seed warning, move up / down, activate / deactivate

**Files:**
- Create: `apps/web/src/components/catalog/LevelsEditor.tsx`, `LevelsEditor.test.tsx`
- Modify: `apps/web/src/pages/dataset/TraitsPage.tsx` (+ test), `docs/gotchas/web.md`

**Interfaces:**
- Consumes: `createLevel`, `updateLevel`, `invalidateAfterCatalogWrite` (Task 1); `createLevelBodySchema`, `updateLevelBodySchema`; `TraitsPage` after Task 2.
- Produces: `LevelsEditor({ trait, canManage })`.

Behaviour (RFC-62 R6): the levels in `sortOrder, key` order (the API's order — do not re-sort). With `canManage`: **Add level** (`Button size="sm"`, dialog with one Key field, `createLevel(trait.id, { key })`, no `sortOrder` — the API appends); per level **Rename** (dialog, Key prefilled, `updateLevel(trait.id, level.id, { key })`; the dialog carries `<Alert tone="info">` with: "The repository's `trait-dictionary.csv` is the source of the vocabulary: `seed:traits` re-inserts a level under its old key unless the CSV is renamed too."), **Move up** / **Move down** (icon-less `Button size="sm"` with `aria-label={`Move ${level.key} up`}` — disabled at the ends), **Deactivate** / **Activate** (`updateLevel(…, { active })`). Every mutation's `onSuccess` calls `invalidateAfterCatalogWrite(queryClient, 'traits')`; the API answers the whole trait, which the page re-renders from the refetched dictionary (the component does not keep the answer). A move swaps the two levels' `sortOrder`s: two sequential `updateLevel` calls in one `mutationFn` (the moved level first). When the neighbours' `sortOrder`s are equal (possible only for a dictionary seeded before `sortOrder` existed), the swap would be a no-op: send only the moved level with `sortOrder: neighbour.sortOrder + 1` (down) or `Math.max(0, neighbour.sortOrder - 1)` (up).

- [ ] **Step 1: Failing tests**

`LevelsEditor.test.tsx` (`catalog` hoisted mock with `createLevel`, `updateLevel`, `invalidateAfterCatalogWrite`; `renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage />)`):

```tsx
describe('RFC-62 R6 LevelsEditor', () => {
  it('renders the levels in order, inactive struck through, with no controls for a reader', () => {
    renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage={false} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual(['hermaphrodite', 'dioecious', 'polygamous (inactive)']);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('adds a level through the dialog and invalidates the dictionary', async () => {
    catalog.createLevel.mockResolvedValue(SEXUAL_SYSTEM_TRAIT);
    renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add level' }));
    const dialog = screen.getByRole('dialog', { name: 'Add level' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^key/i }), 'monoecious');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add level' }));
    await waitFor(() => expect(catalog.createLevel).toHaveBeenCalledWith(SEXUAL_SYSTEM_TRAIT.id, { key: 'monoecious' }));
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'traits');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('renames a level, shows the seed warning, and maps LEVEL_KEY_TAKEN under the field', async () => {
    catalog.updateLevel.mockRejectedValueOnce(new ApiError(409, 'LEVEL_KEY_TAKEN', 'taken')).mockResolvedValue(SEXUAL_SYSTEM_TRAIT);
    renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage />);
    await userEvent.click(screen.getByRole('button', { name: 'Rename dioecious' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename level' });
    expect(within(dialog).getByRole('status')).toHaveTextContent(/seed:traits re-inserts/);
    const key = within(dialog).getByRole('textbox', { name: /^key/i });
    expect(key).toHaveValue('dioecious');
    await userEvent.clear(key);
    await userEvent.type(key, 'hermaphrodite');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    expect(await within(dialog).findByText('A level with this key already exists.')).toBeInTheDocument();
    await userEvent.clear(key);
    await userEvent.type(key, 'dioecy');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() =>
      expect(catalog.updateLevel).toHaveBeenLastCalledWith(SEXUAL_SYSTEM_TRAIT.id, SEXUAL_SYSTEM_TRAIT.levels[1]?.id, { key: 'dioecy' }),
    );
  });

  it('moves a level down by swapping the two sortOrders, moved level first; the ends are disabled', async () => {
    catalog.updateLevel.mockResolvedValue(SEXUAL_SYSTEM_TRAIT);
    renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage />);
    expect(screen.getByRole('button', { name: 'Move hermaphrodite up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move polygamous down' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move hermaphrodite down' }));
    const [first, second] = SEXUAL_SYSTEM_TRAIT.levels;
    await waitFor(() => expect(catalog.updateLevel).toHaveBeenCalledTimes(2));
    expect(catalog.updateLevel.mock.calls[0]).toEqual([SEXUAL_SYSTEM_TRAIT.id, first?.id, { sortOrder: second?.sortOrder }]);
    expect(catalog.updateLevel.mock.calls[1]).toEqual([SEXUAL_SYSTEM_TRAIT.id, second?.id, { sortOrder: first?.sortOrder }]);
  });

  it('sends a single patch with a shifted sortOrder when the neighbours tie', async () => {
    catalog.updateLevel.mockResolvedValue(SEXUAL_SYSTEM_TRAIT);
    const tied = { ...SEXUAL_SYSTEM_TRAIT, levels: SEXUAL_SYSTEM_TRAIT.levels.map((l) => ({ ...l, sortOrder: 0 })) };
    renderWithProviders(<LevelsEditor trait={tied} canManage />);
    await userEvent.click(screen.getByRole('button', { name: 'Move dioecious down' }));
    await waitFor(() => expect(catalog.updateLevel).toHaveBeenCalledTimes(1));
    expect(catalog.updateLevel).toHaveBeenCalledWith(tied.id, tied.levels[1]?.id, { sortOrder: 1 });
  });

  it('deactivates and activates with one patch each', async () => {
    catalog.updateLevel.mockResolvedValue(SEXUAL_SYSTEM_TRAIT);
    renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage />);
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate dioecious' }));
    await waitFor(() => expect(catalog.updateLevel).toHaveBeenCalledWith(SEXUAL_SYSTEM_TRAIT.id, SEXUAL_SYSTEM_TRAIT.levels[1]?.id, { active: false }));
    await userEvent.click(screen.getByRole('button', { name: 'Activate polygamous' }));
    await waitFor(() => expect(catalog.updateLevel).toHaveBeenCalledWith(SEXUAL_SYSTEM_TRAIT.id, SEXUAL_SYSTEM_TRAIT.levels[2]?.id, { active: true }));
  });

  it('shows the generic sentence when a toggle fails', async () => {
    catalog.updateLevel.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage />);
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate dioecious' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });
});
```

Run — expected: FAIL, module not found.

- [ ] **Step 2: `LevelsEditor`**

Structure: `<div className="flex flex-col gap-3">` → `<ul aria-label={`Levels of ${humaniseKey(trait.key)}`} className="flex flex-col gap-1.5">` with one `<li className="flex flex-wrap items-center gap-2">` per level: the key as `<Badge>` (inactive: `<span className="line-through">{key}</span><span className="sr-only"> (inactive)</span>` as `TraitsPage` renders today — the reader test reads `polygamous (inactive)` from `textContent`, so keep that exact markup), then, when `canManage`, the four `Button size="sm" variant="secondary"` controls (Rename, Move up, Move down, Deactivate/Activate). Below the list, when `canManage`, `<Button size="sm" onClick={() => setAdding(true)}>Add level</Button>` and `{toggle.isError || move.isError ? <Alert tone="error">{levelErrorMessage(error)}</Alert> : null}`. Dialogs: `{adding ? <LevelKeyDialog title="Add level" submitLabel="Add level" save={(key) => createLevel(trait.id, { key })} … /> : null}` and `{renaming ? <LevelKeyDialog title="Rename level" submitLabel="Rename" initial={renaming.key} warning save={(key) => updateLevel(trait.id, renaming.id, { key })} … /> : null}` — `LevelKeyDialog` is a private component of the file (one `Field` "Key", `createLevelBodySchema.pick({ key: true })` / `catalogNameSchema` for the local check, `LEVEL_KEY_TAKEN` → "A level with this key already exists." under the field, `LEVEL_NOT_FOUND` / `TRAIT_NOT_FOUND` → "This level no longer exists. Reload the page." in an `Alert`). Mutations: `toggle` (`(input: { levelId: string; active: boolean }) => updateLevel(trait.id, input.levelId, { active: input.active })`), `move` (`async ({ index, direction }) => { … }` per the behaviour above), each with `onSuccess: () => invalidateAfterCatalogWrite(queryClient, 'traits')`. `levelErrorMessage` mirrors `traitErrorMessage` (codes `LEVEL_KEY_TAKEN`, `LEVEL_NOT_FOUND`, `TRAIT_NOT_FOUND`, `VALIDATION_FAILED`). Tag `@rfc RFC-62 R6` and `@rfc RFC-13 R3, R6`.

Run — green.

- [ ] **Step 3: `TraitsPage` uses it; test**

In `TraitRows`, the unfolded row renders `<LevelsEditor trait={trait} canManage={canManage} />` instead of the `<ul>`; the "Show levels" toggle renders when `trait.valueType === 'categorical' && (trait.levels.length > 0 || canManage)` (a manager can add the first level). Existing `TraitsPage.test.tsx` "unfolds and folds" stays green (same list markup); add:

```tsx
  it('a traits.manage holder can unfold a categorical trait without levels and add one', async () => {
    auth.fetchMe.mockResolvedValue(MANAGER);
    dataset.fetchDictionary.mockResolvedValue([{ key: 'seed', label: 'Seed', traits: [NEW_TRAIT] }]);
    catalog.createLevel.mockResolvedValue({ ...NEW_TRAIT, levels: [{ id: 'l1', key: 'red', sortOrder: 0, active: true }] });
    renderAt('/app/traits');
    await userEvent.click(await screen.findByRole('button', { name: 'Show levels' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add level' }));
    const dialog = screen.getByRole('dialog', { name: 'Add level' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^key/i }), 'red');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add level' }));
    await waitFor(() => expect(catalog.createLevel).toHaveBeenCalledWith(NEW_TRAIT.id, { key: 'red' }));
  });
```

- [ ] **Step 4: Gotcha**

Append to `docs/gotchas/web.md`:

```markdown
## Reordering dictionary levels is two PATCHes, moved level first

`PATCH /api/traits/:id/levels/:levelId` changes one level; a move swaps the `sortOrder` of two. `LevelsEditor` sends the moved level first, then the neighbour, inside one `mutationFn`, and invalidates the dictionary once at the end — a first-call failure leaves the order untouched, a second-call failure leaves the two levels tied (the list then orders them by key), which the next move repairs. Ties are only possible in that state or in a dictionary seeded before `sortOrder` existed; a move across a tie sends a single shifted `sortOrder` instead of a swap.
```

- [ ] **Step 5: Verify and commit**

```bash
PATH=… pnpm lint:fix && PATH=… pnpm typecheck && PATH=… pnpm rfc:check && PATH=… pnpm --filter @treerepro/web test
git add apps/web/src/components/catalog/LevelsEditor.tsx apps/web/src/components/catalog/LevelsEditor.test.tsx apps/web/src/pages/dataset/TraitsPage.tsx apps/web/src/pages/dataset/TraitsPage.test.tsx docs/gotchas/web.md
git commit -m "feat(web): level editor — add, rename with the seed warning, reorder, activate on /app/traits (RFC-62 R6)"
```

---

### Task 4: Reference editor — `ReferenceDialog`; New reference on the list, Edit on the detail

**Files:**
- Create: `apps/web/src/components/catalog/ReferenceDialog.tsx`, `ReferenceDialog.test.tsx`
- Modify: `apps/web/src/pages/dataset/ReferencesPage.tsx` (+ test), `apps/web/src/pages/dataset/ReferencePage.tsx` (+ test), `docs/gotchas/web.md`

**Interfaces:**
- Consumes: `createReference`, `updateReference`, `invalidateAfterCatalogWrite` (Task 1); `createReferenceBodySchema`, `updateReferenceBodySchema`.
- Produces: `ReferenceDialog({ reference?, onClose, onSaved })`.

Behaviour (RFC-61 R6): fields Citation key (required), Title, Authors, Year (number input, 1500–2100), Journal, DOI, URL. **Create** (no `reference`): trimmed values, empty optionals omitted, `createReferenceBodySchema` locally, `createReference`. **Edit**: the diff against `reference` — a changed non-empty field sends its value, an emptied optional field sends `null`, `citationKey` never `null` (an emptied key is a local error "Enter a citation key."), unchanged fields are omitted; an empty diff calls `onClose()` without a request; `updateReferenceBodySchema` locally, `updateReference(reference.id, body)`. Codes: `REFERENCE_KEY_TAKEN` → "A reference with this citation key already exists." under Citation key; `REFERENCE_DOI_TAKEN` → "Another reference has this DOI." under DOI; `REFERENCE_NOT_FOUND` → "This reference no longer exists. Reload the page."; `VALIDATION_FAILED` → details by path. Success: `invalidateAfterCatalogWrite(queryClient, 'references')`, `onSaved(detail)`.

- [ ] **Step 1: Failing tests — `ReferenceDialog`**

```tsx
describe('RFC-61 R6 ReferenceDialog', () => {
  it('creates with the citation key alone, omitting empty optionals', async () => {
    catalog.createReference.mockResolvedValue(REFERENCE_DETAIL);
    const { dialog, onSaved } = mount();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /citation key/i }), 'Smith2001');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create reference' }));
    await waitFor(() => expect(catalog.createReference).toHaveBeenCalledWith({ citationKey: 'Smith2001' }));
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'references');
    expect(onSaved).toHaveBeenCalledWith(REFERENCE_DETAIL);
  });

  it('creates with every field, the year as a number', async () => {
    catalog.createReference.mockResolvedValue(REFERENCE_DETAIL);
    const { dialog } = mount();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /citation key/i }), 'Smith2001');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^title/i }), 'Breeding systems');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /authors/i }), 'Smith, J.');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: /year/i }), '2001');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /journal/i }), 'JTE');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /doi/i }), '10.1000/x');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /url/i }), 'https://example.org');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create reference' }));
    await waitFor(() =>
      expect(catalog.createReference).toHaveBeenCalledWith({
        citationKey: 'Smith2001', title: 'Breeding systems', authors: 'Smith, J.', year: 2001, journal: 'JTE', doi: '10.1000/x', url: 'https://example.org',
      }),
    );
  });

  it('edit: prefilled; sends only the changed fields, null for an emptied one; unchanged closes without a request', async () => {
    catalog.updateReference.mockResolvedValue(REFERENCE_DETAIL);
    const first = mount(REFERENCE_DETAIL);
    expect(within(first.dialog).getByRole('textbox', { name: /citation key/i })).toHaveValue('Smith2001');
    expect(within(first.dialog).getByRole('spinbutton', { name: /year/i })).toHaveValue(2001);
    await userEvent.click(within(first.dialog).getByRole('button', { name: 'Save' }));
    expect(catalog.updateReference).not.toHaveBeenCalled();
    expect(first.onClose).toHaveBeenCalled();
    cleanup();
    const second = mount(REFERENCE_DETAIL);
    const journal = within(second.dialog).getByRole('textbox', { name: /journal/i });
    await userEvent.clear(journal);
    const year = within(second.dialog).getByRole('spinbutton', { name: /year/i });
    await userEvent.clear(year);
    await userEvent.type(year, '2002');
    await userEvent.click(within(second.dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(catalog.updateReference).toHaveBeenCalledWith(REFERENCE_DETAIL.id, { year: 2002, journal: null }),
    );
  });

  it('an emptied citation key is a local error; REFERENCE_KEY_TAKEN and REFERENCE_DOI_TAKEN land under their fields', async () => {
    const { dialog } = mount(REFERENCE_DETAIL);
    const key = within(dialog).getByRole('textbox', { name: /citation key/i });
    await userEvent.clear(key);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Enter a citation key.')).toBeInTheDocument();
    expect(catalog.updateReference).not.toHaveBeenCalled();
    await userEvent.type(key, 'Doe2001');
    catalog.updateReference.mockRejectedValueOnce(new ApiError(409, 'REFERENCE_KEY_TAKEN', 'taken'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('A reference with this citation key already exists.')).toBeInTheDocument();
    catalog.updateReference.mockRejectedValueOnce(new ApiError(409, 'REFERENCE_DOI_TAKEN', 'taken'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Another reference has this DOI.')).toBeInTheDocument();
  });

  it('a year outside 1500–2100 is refused locally with the schema message', async () => {
    const { dialog } = mount();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /citation key/i }), 'X');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: /year/i }), '1200');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create reference' }));
    expect(within(dialog).getByRole('spinbutton', { name: /year/i })).toHaveAccessibleDescription(/1500/);
    expect(catalog.createReference).not.toHaveBeenCalled();
  });
});
```

`mount(reference?)` renders `<ReferenceDialog reference={reference} onClose onSaved />` under `renderWithProviders` and returns `{ dialog: screen.getByRole('dialog', { name: reference ? 'Edit reference' : 'New reference' }), onClose, onSaved }`. Run — expected: FAIL, module not found.

- [ ] **Step 2: `ReferenceDialog`**

State: one `useState` per field, strings (`year` as string; `reference?.year?.toString() ?? ''`). Helpers:

```ts
const OPTIONAL = ['title', 'authors', 'journal', 'doi', 'url'] as const;
type OptionalKey = (typeof OPTIONAL)[number];

function createBody(v: FormValues): CreateReferenceBody {
  const body: CreateReferenceBody = { citationKey: v.citationKey.trim() };
  for (const k of OPTIONAL) if (v[k].trim()) body[k] = v[k].trim();
  if (v.year.trim()) body.year = Number(v.year);
  return body;
}
function updateBody(v: FormValues, r: ReferenceDetail): UpdateReferenceBody {
  const body: UpdateReferenceBody = {};
  if (v.citationKey.trim() !== r.citationKey) body.citationKey = v.citationKey.trim();
  for (const k of OPTIONAL) {
    const next = v[k].trim() || null;
    if (next !== r[k]) body[k] = next;
  }
  const year = v.year.trim() ? Number(v.year) : null;
  if (year !== r.year) body.year = year;
  return body;
}
```

`submit`: citation key empty → local `{ citationKey: 'Enter a citation key.' }`; edit with an empty `updateBody` → `onClose()`; parse with the matching schema (`safeParse`) → local errors by path (`issue.path.join('.')`, message from Zod — the year test reads the `min` message, which for Zod 4 `z.number().int().min(1500)` contains "1500"; if the message differs, assert on the message Zod produces, printed by the failing run); else mutate. Error mapping as the behaviour block; the 409s are shown under their field (not in the `Alert`) — `errors = { ...fieldErrors(save.error), ...takenErrors(save.error), ...local }`. Year input: `<Input id type="number" inputMode="numeric" min={1500} max={2100} step={1} />`. Buttons "Cancel" and "Create reference" / "Save". `@rfc RFC-61 R6`, `@rfc RFC-13 R6`. Export `referenceErrorMessage` for the `Alert` (codes above + `pageErrorMessage`).

Run — green.

- [ ] **Step 3: Failing tests — pages**

`ReferencesPage.test.tsx` (add a `catalog` mock with `createReference`; `LIBRARIAN = { ...ME, permissions: ['dataset.read', 'references.manage'] }`):

```tsx
  it('offers "New reference" to references.manage and navigates to the created reference', async () => {
    auth.fetchMe.mockResolvedValue(LIBRARIAN);
    catalog.createReference.mockResolvedValue(REFERENCE_DETAIL);
    dataset.fetchReference.mockResolvedValue(REFERENCE_DETAIL);
    const { router } = renderAt('/app/references');
    await userEvent.click(await screen.findByRole('button', { name: 'New reference' }));
    const dialog = screen.getByRole('dialog', { name: 'New reference' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /citation key/i }), 'Smith2001');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create reference' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/references/${REFERENCE_DETAIL.id}`));
  });
  it('hides "New reference" from a reader', async () => {
    renderAt('/app/references');
    await screen.findByText('References');
    expect(screen.queryByRole('button', { name: 'New reference' })).not.toBeInTheDocument();
  });
```

`ReferencePage.test.tsx`:

```tsx
  it('offers "Edit" to references.manage; a saved edit re-renders the detail', async () => {
    auth.fetchMe.mockResolvedValue(LIBRARIAN);
    dataset.fetchReference.mockResolvedValueOnce(REFERENCE_DETAIL).mockResolvedValue({ ...REFERENCE_DETAIL, title: 'New title' });
    catalog.updateReference.mockResolvedValue({ ...REFERENCE_DETAIL, title: 'New title' });
    renderAt(`/app/references/${REFERENCE_DETAIL.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit reference' });
    const title = within(dialog).getByRole('textbox', { name: /^title/i });
    await userEvent.clear(title);
    await userEvent.type(title, 'New title');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('New title')).toBeInTheDocument();
  });
```

(Both page tests keep the real `invalidateAfterCatalogWrite`, mocking only `createReference` / `updateReference`.) Run — expected: FAIL on the buttons.

- [ ] **Step 4: Page wiring**

`ReferencesPage`: `PageHeader actions={hasPermission(me, 'references.manage') ? <Button onClick={() => setCreating(true)}>New reference</Button> : undefined}`; `{creating ? <ReferenceDialog onClose={() => setCreating(false)} onSaved={(r) => { setCreating(false); navigate({ to: '/app/references/$id', params: { id: r.id } }); }} /> : null}` (`useNavigate` from the router; `useMe` from `lib/session.ts`). `ReferencePage`: `actions={hasPermission(me, 'references.manage') ? <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button> : undefined}` on the loaded header; `{editing ? <ReferenceDialog reference={data} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} /> : null}` — the invalidation inside the dialog refetches `datasetKeys.reference(id)`. Tags: add `RFC-61 R6` and `RFC-13 R3` to both pages' `@rfc` blocks.

- [ ] **Step 5: Gotcha**

Append to `docs/gotchas/web.md`:

```markdown
## An edit dialog sends a diff, and an unchanged form is not a request

The catalog `PATCH` bodies are `nonEmpty` (400 `VALIDATION_FAILED` on `{}`) and a `PATCH` that changes nothing writes no audit row. Edit dialogs therefore compute the difference against the loaded entity — a changed field sends its value, an emptied optional field sends `null`, an untouched field is omitted — and close without a request when the difference is empty. Comparing trimmed strings against the stored value is what makes "typed a space and deleted it" a no-op.
```

- [ ] **Step 6: Verify and commit**

```bash
PATH=… pnpm lint:fix && PATH=… pnpm typecheck && PATH=… pnpm rfc:check && PATH=… pnpm --filter @treerepro/web test
git add apps/web/src/components/catalog/ReferenceDialog.tsx apps/web/src/components/catalog/ReferenceDialog.test.tsx apps/web/src/pages/dataset/ReferencesPage.tsx apps/web/src/pages/dataset/ReferencesPage.test.tsx apps/web/src/pages/dataset/ReferencePage.tsx apps/web/src/pages/dataset/ReferencePage.test.tsx docs/gotchas/web.md
git commit -m "feat(web): reference editor — new reference on the list, edit on the detail (RFC-61 R6)"
```

---

### Task 5: Species editor — `SpeciesDialog` (create + edit, genus and family inline), `AddNameDialog`; species page and search page buttons

**Files:**
- Create: `apps/web/src/components/catalog/SpeciesDialog.tsx`, `SpeciesDialog.test.tsx`, `apps/web/src/components/catalog/AddNameDialog.tsx`, `AddNameDialog.test.tsx`
- Modify: `apps/web/src/pages/dataset/SpeciesPage.tsx` (+ test), `apps/web/src/pages/dataset/SpeciesSearchPage.tsx` (+ test)

**Interfaces:**
- Consumes: `createSpecies`, `updateSpecies`, `addSpeciesName`, `createGenus`, `createFamily`, `invalidateAfterCatalogWrite` (Task 1); `fetchFamilies`, `fetchGenera`, `datasetKeys` (`api/dataset.ts`); `createSpeciesBodySchema`, `updateSpeciesBodySchema`, `speciesNameBodySchema`, `NAME_SOURCES`; `Combobox` (`onCreate`), `Select`.
- Produces: `SpeciesDialog({ species?, onClose, onSaved })`, `AddNameDialog({ species, onClose, onSaved })`.

Behaviour (RFC-60 R9):
- **Canonical name** (`Input`, required, "Enter the canonical name."), **Name source** (`Select` over `NAME_SOURCES`; default `original` on create — a scientist typing a name by hand; the value the species has on edit), **Family** (`Select` of `fetchFamilies()` in name order with "No family" as the empty option; beside it, with `taxa.manage` — always true here, the dialog only opens with it — a `Button size="sm" variant="secondary"` "New family" that swaps the select for an `Input` + "Create" + "Cancel": Create calls `createFamily({ name })`, invalidates `['families']`, selects the new id; `FAMILY_NAME_TAKEN` → "A family with this name already exists." under the input), **Genus** (`Combobox`, `search: (q) => fetchGenera({ familyId: family || undefined, q, limit: 20 })` → options `{ id, label: name, hint: family?.name }`, `searchKey: \`genera:${family}\`` so the list refetches when the family changes, `onCreate: (name) => createGenus({ name, familyId: family || undefined })` then `invalidateQueries(['genera'])`; choosing a genus whose family differs from the selected family sets the family select to it). The species body carries `genusId` only — the family is the genus's; the family control filters the search and gives an inline-created genus its family.
- **Create**: `createSpeciesBodySchema` on `{ canonicalName, nameSource, genusId: genus?.id }` (undefined omitted) → `createSpecies`. **Edit**: diff — `canonicalName` when trimmed differs, `nameSource` when differs, `genusId: genus?.id ?? null` when `(genus?.id ?? null) !== (species.genus?.id ?? null)`; empty diff → `onClose()`; `updateSpeciesBodySchema` → `updateSpecies(species.id, body)`. Codes: `SPECIES_NAME_TAKEN` → "A species with this name already exists." under Canonical name; `GENUS_NOT_FOUND` / `FAMILY_NOT_FOUND` → "The chosen taxon no longer exists. Reload the page."; `SPECIES_NOT_FOUND` → "This species no longer exists. Reload the page."; `VALIDATION_FAILED` by path. Success → `invalidateAfterCatalogWrite(queryClient, 'taxa')`, `onSaved(species)`.
- **`AddNameDialog`**: Name (required, "Enter the name."), GBIF usage key (optional, max 64); `speciesNameBodySchema` → `addSpeciesName(species.id, body)`; `SPECIES_NAME_TAKEN` → "This species already has that name." under Name; success → invalidate `'taxa'`, `onSaved(species)`.

- [ ] **Step 1: Failing tests — `SpeciesDialog`**

```tsx
const catalog = vi.hoisted(() => ({
  createSpecies: vi.fn(), updateSpecies: vi.fn(), createGenus: vi.fn(), createFamily: vi.fn(),
  invalidateAfterCatalogWrite: vi.fn(async () => undefined),
}));
const dataset = vi.hoisted(() => ({ fetchFamilies: vi.fn(), fetchGenera: vi.fn() }));
// vi.mock both modules with importOriginal spreads

beforeEach(() => {
  dataset.fetchFamilies.mockReset().mockResolvedValue(FAMILIES);
  dataset.fetchGenera.mockReset().mockResolvedValue({ data: GENERA, meta: { nextCursor: null } });
  // reset the catalog fns
});

describe('RFC-60 R9 SpeciesDialog', () => {
  it('creates a species with name, source and a searched genus', async () => {
    catalog.createSpecies.mockResolvedValue(SPECIES);
    const { dialog, onSaved } = mount();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /canonical name/i }), 'Adenanthera pavonina');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /name source/i }), 'wcvp');
    await userEvent.type(within(dialog).getByRole('combobox', { name: /^genus/i }), 'Aden');
    await userEvent.click(await screen.findByRole('option', { name: /Adenanthera/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create species' }));
    await waitFor(() =>
      expect(catalog.createSpecies).toHaveBeenCalledWith({ canonicalName: 'Adenanthera pavonina', nameSource: 'wcvp', genusId: GENUS.id }),
    );
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'taxa');
    expect(onSaved).toHaveBeenCalledWith(SPECIES);
  });

  it('filters the genus search by the chosen family and creates a genus inline under it', async () => {
    catalog.createGenus.mockResolvedValue({ id: 'g-new', name: 'Novus', family: MALVACEAE });
    const { dialog } = mount();
    await userEvent.selectOptions(await within(dialog).findByRole('combobox', { name: /^family/i }), MALVACEAE.id);
    dataset.fetchGenera.mockResolvedValue({ data: [], meta: { nextCursor: null } });
    await userEvent.type(within(dialog).getByRole('combobox', { name: /^genus/i }), 'Novus');
    await waitFor(() => expect(dataset.fetchGenera).toHaveBeenLastCalledWith({ familyId: MALVACEAE.id, q: 'Novus', limit: 20 }));
    await userEvent.click(await screen.findByRole('option', { name: /Create "Novus"/ }));
    await waitFor(() => expect(catalog.createGenus).toHaveBeenCalledWith({ name: 'Novus', familyId: MALVACEAE.id }));
    expect(within(dialog).getByText('Novus')).toBeInTheDocument();
  });

  it('creates a family inline and selects it', async () => {
    catalog.createFamily.mockResolvedValue({ id: 'f-new', name: 'Novaceae' });
    dataset.fetchFamilies.mockResolvedValueOnce(FAMILIES).mockResolvedValue([...FAMILIES, { id: 'f-new', name: 'Novaceae' }]);
    const { dialog } = mount();
    await within(dialog).findByRole('combobox', { name: /^family/i });
    await userEvent.click(within(dialog).getByRole('button', { name: 'New family' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: /new family name/i }), 'Novaceae');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(catalog.createFamily).toHaveBeenCalledWith({ name: 'Novaceae' }));
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: /^family/i })).toHaveValue('f-new'));
  });

  it('edit: prefilled from the species; detaching the genus sends null; unchanged closes without a request', async () => {
    catalog.updateSpecies.mockResolvedValue({ ...SPECIES, genus: null, family: null });
    const first = mount(SPECIES);
    expect(within(first.dialog).getByRole('textbox', { name: /canonical name/i })).toHaveValue('Adenanthera pavonina');
    expect(within(first.dialog).getByRole('combobox', { name: /name source/i })).toHaveValue('wcvp');
    expect(await within(first.dialog).findByRole('combobox', { name: /^family/i })).toHaveValue(FAMILY.id);
    expect(within(first.dialog).getByText('Adenanthera')).toBeInTheDocument();
    await userEvent.click(within(first.dialog).getByRole('button', { name: 'Save' }));
    expect(catalog.updateSpecies).not.toHaveBeenCalled();
    expect(first.onClose).toHaveBeenCalled();
    cleanup();
    const second = mount(SPECIES);
    await userEvent.click(within(second.dialog).getByRole('button', { name: 'Clear' }));
    await userEvent.click(within(second.dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(catalog.updateSpecies).toHaveBeenCalledWith(SPECIES.id, { genusId: null }));
  });

  it('maps SPECIES_NAME_TAKEN under the name and GENUS_NOT_FOUND to its sentence', async () => {
    catalog.updateSpecies
      .mockRejectedValueOnce(new ApiError(409, 'SPECIES_NAME_TAKEN', 'taken'))
      .mockRejectedValueOnce(new ApiError(404, 'GENUS_NOT_FOUND', 'gone'));
    const { dialog } = mount(SPECIES);
    const name = within(dialog).getByRole('textbox', { name: /canonical name/i });
    await userEvent.clear(name);
    await userEvent.type(name, 'Adansonia digitata');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('A species with this name already exists.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The chosen taxon no longer exists. Reload the page.');
  });
});
```

(`Combobox`'s clear button in the chosen state is `aria-label="Clear"`; the genus is the only `Combobox` in the dialog, so query `within(dialog).getByRole('button', { name: 'Clear' })` — the test above says "clear genus" for readability; use the exact name.) Run — expected: FAIL, module not found.

- [ ] **Step 2: `SpeciesDialog`**

Layout: `Field` Canonical name → `Field` Name source (`Select`) → Family block → `Field` Genus (`Combobox`). Family block:

```tsx
<div className="flex flex-col gap-2">
  {newFamily === null ? (
    <Field id={ids.family} label="Family" hint="Narrows the genus search; a genus created here belongs to it." error={errors.familyId}>
      <div className="flex items-center gap-2">
        <Select id={ids.family} value={family} onChange={(e) => setFamily(e.target.value)} disabled={families.isPending}>
          <option value="">No family</option>
          {(families.data ?? []).map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </Select>
        <Button size="sm" variant="secondary" onClick={() => setNewFamily('')}>New family</Button>
      </div>
    </Field>
  ) : (
    <Field id={ids.newFamily} label="New family name" error={familyError}>
      <div className="flex items-center gap-2">
        <Input id={ids.newFamily} value={newFamily} maxLength={200} onChange={(e) => setNewFamily(e.target.value)} invalid={Boolean(familyError)} />
        <Button size="sm" pending={addFamily.isPending} onClick={() => addFamily.mutate(newFamily.trim())}>Create</Button>
        <Button size="sm" variant="secondary" onClick={() => setNewFamily(null)} disabled={addFamily.isPending}>Cancel</Button>
      </div>
    </Field>
  )}
</div>
```

`addFamily = useMutation({ mutationFn: (name: string) => createFamily({ name }), onSuccess: async (created) => { await queryClient.invalidateQueries({ queryKey: datasetKeys.families }); setFamily(created.id); setNewFamily(null); } })`; `familyError` = "Enter a family name." locally when empty (checked before mutating), `FAMILY_NAME_TAKEN` → "A family with this name already exists.", else `pageErrorMessage`. `families = useQuery({ queryKey: datasetKeys.families, queryFn: fetchFamilies })` — `fetchFamilies` already walks every page. Genus `Combobox`: `id={ids.genus}`, `value={genus}`, `onChange={(next) => { setGenus(next); const fam = next ? generaById.current.get(next.id)?.family?.id : undefined; if (fam && fam !== family) setFamily(fam); }}` — keep a `useRef(new Map<string, Genus>())` filled by the `search` callback so the chosen genus's family is known; `search` and `onCreate` as the behaviour block; `listLabel="Genus suggestions"`, `placeholder="Type to search genera"`. Initial state on edit: `family = species.family?.id ?? ''`, `genus = species.genus ? { id: species.genus.id, label: species.genus.name, hint: species.family?.name } : null`. Title "New species" / "Edit species"; submit label "Create species" / "Save". Export `speciesErrorMessage`. `@rfc RFC-60 R9`, `@rfc RFC-13 R3, R6`.

Run — green.

- [ ] **Step 3: Failing tests — `AddNameDialog`**

```tsx
describe('RFC-60 R9 AddNameDialog', () => {
  it('posts the name and the GBIF key, invalidates taxa and reports the species', async () => {
    catalog.addSpeciesName.mockResolvedValue(SPECIES);
    const { dialog, onSaved } = mount();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Adenanthera gersenii');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /gbif usage key/i }), '2969393');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add name' }));
    await waitFor(() => expect(catalog.addSpeciesName).toHaveBeenCalledWith(SPECIES.id, { name: 'Adenanthera gersenii', gbifUsageKey: '2969393' }));
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'taxa');
    expect(onSaved).toHaveBeenCalledWith(SPECIES);
  });
  it('requires the name; omits an empty key; maps SPECIES_NAME_TAKEN under the name', async () => {
    catalog.addSpeciesName.mockRejectedValueOnce(new ApiError(409, 'SPECIES_NAME_TAKEN', 'taken'));
    const { dialog } = mount();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add name' }));
    expect(within(dialog).getByText('Enter the name.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Adenanthera pavonina');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add name' }));
    await waitFor(() => expect(catalog.addSpeciesName).toHaveBeenCalledWith(SPECIES.id, { name: 'Adenanthera pavonina' }));
    expect(await within(dialog).findByText('This species already has that name.')).toBeInTheDocument();
  });
});
```

Run — expected: FAIL, module not found. **Step 4:** implement `AddNameDialog` (title "Add alternative name", fields Name and "GBIF usage key (optional)", hint "The name is stored as a GBIF-sourced alternative name."; button "Add name"). Run — green.

- [ ] **Step 5: Failing tests — pages**

`SpeciesPage.test.tsx` (`catalog` mock with `updateSpecies`, `addSpeciesName`; the `dataset` mock already has `fetchSpecies` — add `fetchFamilies` → `FAMILIES` and `fetchGenera` → `{ data: GENERA, meta: { nextCursor: null } }` for the dialog; `CURATOR_TAXA = { ...ME, permissions: ['dataset.read', 'taxa.manage'] }`):

```tsx
describe('RFC-60 R9 SpeciesPage taxa editing', () => {
  it('hides "Edit species" and "Add name" from a reader', async () => {
    renderAt(`/app/species/${SPECIES.id}`);
    await screen.findByText('Adenanthera pavonina');
    expect(screen.queryByRole('button', { name: 'Edit species' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add name' })).not.toBeInTheDocument();
  });
  it('edits the species and re-renders the header from the refetched detail', async () => {
    auth.fetchMe.mockResolvedValue(CURATOR_TAXA);
    dataset.fetchSpecies.mockResolvedValueOnce(SPECIES).mockResolvedValue({ ...SPECIES, nameSource: 'original' });
    dataset.fetchFamilies.mockResolvedValue(FAMILIES);
    catalog.updateSpecies.mockResolvedValue({ ...SPECIES, nameSource: 'original' });
    renderAt(`/app/species/${SPECIES.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit species' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit species' });
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /name source/i }), 'original');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(catalog.updateSpecies).toHaveBeenCalledWith(SPECIES.id, { nameSource: 'original' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(dataset.fetchSpecies).toHaveBeenCalledTimes(2));
  });
  it('adds an alternative name and shows it in the header', async () => {
    auth.fetchMe.mockResolvedValue(CURATOR_TAXA);
    const withName = { ...SPECIES, names: [...SPECIES.names, { name: 'Adenanthera polita', source: 'gbif' as const, gbifUsageKey: null }] };
    dataset.fetchSpecies.mockResolvedValueOnce(SPECIES).mockResolvedValue(withName);
    catalog.addSpeciesName.mockResolvedValue(withName);
    renderAt(`/app/species/${SPECIES.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Add name' }));
    const dialog = screen.getByRole('dialog', { name: 'Add alternative name' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Adenanthera polita');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add name' }));
    expect(await screen.findByText(/Adenanthera polita/)).toBeInTheDocument();
  });
});
```

`SpeciesSearchPage.test.tsx` (`catalog` mock with `createSpecies`; `dataset` mock gains `fetchSpecies`, `fetchSpeciesTraits`, `fetchFamilies`, `fetchGenera` if absent):

```tsx
  it('offers "New species" to taxa.manage and navigates to the created species', async () => {
    auth.fetchMe.mockResolvedValue({ ...ME, permissions: ['dataset.read', 'taxa.manage'] });
    catalog.createSpecies.mockResolvedValue(SPECIES);
    dataset.fetchSpecies.mockResolvedValue(SPECIES);
    dataset.fetchSpeciesTraits.mockResolvedValue([]);
    const { router } = renderAt('/app/species');
    await userEvent.click(await screen.findByRole('button', { name: 'New species' }));
    const dialog = screen.getByRole('dialog', { name: 'New species' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /canonical name/i }), 'Adenanthera pavonina');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create species' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/species/${SPECIES.id}`));
  });
  it('hides "New species" from a reader', async () => { /* renderAt('/app/species') with dataset.read only; queryByRole null */ });
```

Run — expected: FAIL on the buttons.

- [ ] **Step 6: Page wiring**

`SpeciesPage`: `const canManageTaxa = hasPermission(me, 'taxa.manage');` (`me` is already read for "Add value") — `SpeciesHeader` already takes `actions`: with `canManageTaxa`, `<Button variant="secondary" onClick={() => setEditing(true)}>Edit species</Button>` and `<Button variant="secondary" onClick={() => setAddingName(true)}>Add name</Button>` next to the existing "Add value" button (07b placed it in the header; keep the order Add value · Edit species · Add name). `{editing && species.data ? <SpeciesDialog species={species.data} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} /> : null}`, same for `AddNameDialog`. The dialog's `invalidateAfterCatalogWrite('taxa')` refetches `['species', id]`. `SpeciesSearchPage`: header `actions` gains `<Button onClick={() => setCreating(true)}>New species</Button>` before the export anchor when `hasPermission(me, 'taxa.manage')`; `{creating ? <SpeciesDialog onClose={() => setCreating(false)} onSaved={(s) => { setCreating(false); navigate({ to: '/app/species/$id', params: { id: s.id } }); }} /> : null}`. Tags `RFC-60 R9`, `RFC-13 R3`.

Run the two files, then the suite — green.

- [ ] **Step 7: Verify and commit**

```bash
PATH=… pnpm lint:fix && PATH=… pnpm typecheck && PATH=… pnpm rfc:check && PATH=… pnpm --filter @treerepro/web test
git add apps/web/src/components/catalog/SpeciesDialog.tsx apps/web/src/components/catalog/SpeciesDialog.test.tsx apps/web/src/components/catalog/AddNameDialog.tsx apps/web/src/components/catalog/AddNameDialog.test.tsx apps/web/src/pages/dataset/SpeciesPage.tsx apps/web/src/pages/dataset/SpeciesPage.test.tsx apps/web/src/pages/dataset/SpeciesSearchPage.tsx apps/web/src/pages/dataset/SpeciesSearchPage.test.tsx
git commit -m "feat(web): species editor — new and edit species with genus and family created inline, alternative names (RFC-60 R9)"
```

---

### Task 6: `/app/taxa` — families and genera: create, rename, move; route, navigation entry, icon

**Files:**
- Create: `apps/web/src/components/catalog/TaxonNameDialog.tsx`, `TaxonNameDialog.test.tsx`, `apps/web/src/components/catalog/MoveGenusDialog.tsx`, `MoveGenusDialog.test.tsx`, `apps/web/src/pages/catalog/TaxaPage.tsx`, `TaxaPage.test.tsx`, `apps/web/src/routes/app/taxa.tsx`
- Modify: `apps/web/src/components/shell/nav.ts`, `apps/web/src/components/shell/AppShell.test.tsx`, `apps/web/src/components/ui/Icon.tsx`

**Interfaces:**
- Consumes: `createFamily`, `updateFamily`, `createGenus`, `updateGenus`, `invalidateAfterCatalogWrite` (Task 1); `fetchFamilies`, `fetchGenera`, `datasetKeys`; `usePagedList`, `Pagination`; `NoPermission`.
- Produces: `TaxonNameDialog`, `MoveGenusDialog`, `TaxaPage`, route `/app/taxa`, nav entry Taxa (`taxa.manage`, section `data`), icon `branch`.

Behaviour (RFC-60 R9, spec 10.4): the page is for `taxa.manage` only (`NoPermission` otherwise, RFC-13 R3 — a single route, so the gate lives in the page component, as the `/app/imports` layout does for its subtree). Two columns as `PendingPage`: left, a filter `Input` "Filter families" and the families (`fetchFamilies`, name order, filtered client-side, `aria-pressed` buttons) with a **New family** button above the list; right, the selected family's name with **Rename** and **New genus**, a `Input` "Search genera" and the table of genera (Name, Family, actions **Rename**, **Move**). The table lists `fetchGenera({ familyId: selected.id })` through `usePagedList(datasetKeys.genera({ familyId }), …)`; when the search term is non-empty it lists `fetchGenera({ q })` across every family instead (the only way to reach a genus without a family — the API has no "unattached" filter — and the Family column then matters), with the heading "Genera matching “<q>”". `TaxonNameDialog` is one name form reused four times (new family, rename family, new genus, rename genus): title, label, initial value, submit label, the 409 sentence, and a `save(name)` the caller binds (`createFamily({ name })`, `updateFamily(id, { name })`, `createGenus({ name, familyId })`, `updateGenus(id, { name })`); an unchanged rename closes without a request; success → `invalidateAfterCatalogWrite('taxa')`, `onSaved()`. `MoveGenusDialog`: a `Select` "Family" over `families` with "No family" (`''`) — `updateGenus(genus.id, { familyId: value || null })`; unchanged closes; `FAMILY_NOT_FOUND` / `GENUS_NOT_FOUND` → "The chosen taxon no longer exists. Reload the page.". Selecting a family after a rename keeps the selection (state holds the id, the name re-renders from the refetched list).

- [ ] **Step 1: Failing tests — `TaxonNameDialog` and `MoveGenusDialog`**

```tsx
describe('RFC-60 R9 TaxonNameDialog', () => {
  it('requires a name, saves through the bound callback and reports success', async () => {
    const save = vi.fn(async () => FAMILY);
    const { dialog, onSaved } = mount({ title: 'New family', label: 'Family name', submitLabel: 'Create', takenMessage: 'A family with this name already exists.', save });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(within(dialog).getByText('Enter a name.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Family name' }), '  Fabaceae ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('Fabaceae'));
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'taxa');
    expect(onSaved).toHaveBeenCalled();
  });
  it('an unchanged rename closes without saving; a 409 shows the taken sentence under the field', async () => {
    const save = vi.fn().mockRejectedValue(new ApiError(409, 'GENUS_NAME_TAKEN', 'taken'));
    const first = mount({ title: 'Rename genus', label: 'Genus name', initial: 'Adenanthera', submitLabel: 'Rename', takenMessage: 'A genus with this name already exists.', save });
    await userEvent.click(within(first.dialog).getByRole('button', { name: 'Rename' }));
    expect(save).not.toHaveBeenCalled();
    expect(first.onClose).toHaveBeenCalled();
    cleanup();
    const second = mount({ title: 'Rename genus', label: 'Genus name', initial: 'Adenanthera', submitLabel: 'Rename', takenMessage: 'A genus with this name already exists.', save });
    const input = within(second.dialog).getByRole('textbox', { name: 'Genus name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Adansonia');
    await userEvent.click(within(second.dialog).getByRole('button', { name: 'Rename' }));
    expect(await within(second.dialog).findByText('A genus with this name already exists.')).toBeInTheDocument();
  });
});

describe('RFC-60 R9 MoveGenusDialog', () => {
  it('patches the chosen family, null for "No family", and closes unchanged without a request', async () => {
    catalog.updateGenus.mockResolvedValue({ ...GENUS, family: MALVACEAE });
    const first = mount(GENERA[0] as Genus);
    expect(within(first.dialog).getByRole('combobox', { name: /family/i })).toHaveValue(FAMILY.id);
    await userEvent.click(within(first.dialog).getByRole('button', { name: 'Move' }));
    expect(catalog.updateGenus).not.toHaveBeenCalled();
    expect(first.onClose).toHaveBeenCalled();
    cleanup();
    const second = mount(GENERA[0] as Genus);
    await userEvent.selectOptions(within(second.dialog).getByRole('combobox', { name: /family/i }), MALVACEAE.id);
    await userEvent.click(within(second.dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(catalog.updateGenus).toHaveBeenCalledWith(GENUS.id, { familyId: MALVACEAE.id }));
    cleanup();
    const third = mount(GENERA[0] as Genus);
    await userEvent.selectOptions(within(third.dialog).getByRole('combobox', { name: /family/i }), '');
    await userEvent.click(within(third.dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(catalog.updateGenus).toHaveBeenCalledWith(GENUS.id, { familyId: null }));
  });
});
```

(`mount` for `TaxonNameDialog` takes the props minus `onClose` / `onSaved`; for `MoveGenusDialog` it renders `<MoveGenusDialog genus families={FAMILIES} onClose onSaved />`; both return `{ dialog, onClose, onSaved }`.) Run — expected: FAIL, modules not found.

- [ ] **Step 2: The two dialogs**

`TaxonNameDialog`: one `Field` (`Input` maxLength 200), local check `catalogNameSchema.safeParse(name)` (empty → "Enter a name."; over-long → the schema message), `if (initial !== undefined && trimmed === initial) { onClose(); return; }`, `save = useMutation({ mutationFn: (n: string) => props.save(n), onSuccess: async () => { await invalidateAfterCatalogWrite(queryClient, 'taxa'); onSaved(); } })`; errors: any `ApiError` whose code ends with `_NAME_TAKEN` → `takenMessage` under the field; `FAMILY_NOT_FOUND` / `GENUS_NOT_FOUND` → "The chosen taxon no longer exists. Reload the page." in an `Alert`; `VALIDATION_FAILED` by path (`name`); else `pageErrorMessage`. `MoveGenusDialog`: `Select` "Family" (`value` = `genus.family?.id ?? ''`), buttons "Cancel" / "Move", title `Move ${genus.name}`. Tags `@rfc RFC-60 R9`, `@rfc RFC-13 R6`. Run — green.

- [ ] **Step 3: Failing tests — `TaxaPage`**

`pages/catalog/TaxaPage.test.tsx` (`renderAt('/app/taxa')`; `auth.fetchMe` → `{ ...ME, permissions: ['dataset.read', 'taxa.manage'] }`; `dataset` mock `fetchFamilies` → `FAMILIES`, `fetchGenera` → `{ data: [GENERA[0]], meta: { nextCursor: null } }`; `catalog` mock overrides `createFamily`, `updateFamily`, `createGenus`, `updateGenus` only):

```tsx
describe('RFC-60 R9 TaxaPage', () => {
  it('lists the families, selects the first, and lists its genera with the family column', async () => {
    renderAt('/app/taxa');
    expect(await screen.findByRole('button', { name: /Fabaceae/, pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Malvaceae/, pressed: false })).toBeInTheDocument();
    await waitFor(() => expect(dataset.fetchGenera).toHaveBeenCalledWith(expect.objectContaining({ familyId: FAMILY.id })));
    const row = (await screen.findAllByRole('row'))[1] as HTMLElement;
    expect(within(row).getByText('Adenanthera')).toBeInTheDocument();
    expect(within(row).getByText('Fabaceae')).toBeInTheDocument();
  });

  it('filters families client-side and switches the genera list on selection', async () => {
    renderAt('/app/taxa');
    await screen.findByRole('button', { name: /Fabaceae/ });
    await userEvent.type(screen.getByRole('searchbox', { name: /filter families/i }), 'malv');
    expect(screen.queryByRole('button', { name: /Fabaceae/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Malvaceae/ }));
    await waitFor(() => expect(dataset.fetchGenera).toHaveBeenLastCalledWith(expect.objectContaining({ familyId: MALVACEAE.id })));
    expect(screen.getByRole('heading', { name: 'Malvaceae' })).toBeInTheDocument();
  });

  it('searches genera across every family when a term is typed', async () => {
    dataset.fetchGenera.mockResolvedValue({ data: GENERA, meta: { nextCursor: null } });
    renderAt('/app/taxa');
    await screen.findByRole('button', { name: /Fabaceae/ });
    await userEvent.type(screen.getByRole('searchbox', { name: /search genera/i }), 'Adan');
    await waitFor(() => expect(dataset.fetchGenera).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Adan' })));
    expect(dataset.fetchGenera.mock.calls.at(-1)?.[0]).not.toHaveProperty('familyId');
    expect(await screen.findByRole('heading', { name: 'Genera matching “Adan”' })).toBeInTheDocument();
    const rows = await screen.findAllByRole('row');
    expect(within(rows[2] as HTMLElement).getByText('—')).toBeInTheDocument();   // Adansonia has no family
  });

  it('creates a family, renames the selected one, creates and renames a genus, moves a genus', async () => {
    catalog.createFamily.mockResolvedValue({ id: 'f-new', name: 'Novaceae' });
    catalog.updateFamily.mockResolvedValue({ ...FAMILY, name: 'Fabaceae s.l.' });
    catalog.createGenus.mockResolvedValue({ id: 'g-new', name: 'Novus', family: FAMILY });
    catalog.updateGenus.mockResolvedValue({ ...GENUS, name: 'Adenantherum', family: FAMILY });
    renderAt('/app/taxa');
    await screen.findByRole('button', { name: /Fabaceae/ });
    await userEvent.click(screen.getByRole('button', { name: 'New family' }));
    await userEvent.type(within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Family name' }), 'Novaceae');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(catalog.createFamily).toHaveBeenCalledWith({ name: 'Novaceae' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rename family' }));
    const rename = within(screen.getByRole('dialog', { name: 'Rename family' })).getByRole('textbox', { name: 'Family name' });
    await userEvent.type(rename, ' s.l.');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(catalog.updateFamily).toHaveBeenCalledWith(FAMILY.id, { name: 'Fabaceae s.l.' }));
    await userEvent.click(await screen.findByRole('button', { name: 'New genus' }));
    await userEvent.type(within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Genus name' }), 'Novus');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(catalog.createGenus).toHaveBeenCalledWith({ name: 'Novus', familyId: FAMILY.id }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Adenanthera' }));
    const renameGenus = within(screen.getByRole('dialog', { name: 'Rename genus' })).getByRole('textbox', { name: 'Genus name' });
    await userEvent.clear(renameGenus);
    await userEvent.type(renameGenus, 'Adenantherum');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(catalog.updateGenus).toHaveBeenCalledWith(GENUS.id, { name: 'Adenantherum' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Move Adenanthera' }));
    await userEvent.selectOptions(within(screen.getByRole('dialog')).getByRole('combobox', { name: /family/i }), MALVACEAE.id);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(catalog.updateGenus).toHaveBeenCalledWith(GENUS.id, { familyId: MALVACEAE.id }));
  });

  it('says so when there is no family yet, and still offers New family', async () => {
    dataset.fetchFamilies.mockResolvedValue([]);
    renderAt('/app/taxa');
    expect(await screen.findByText('No family yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New family' })).toBeInTheDocument();
  });

  it('RFC-13 R3 shows the permission sentence without taxa.manage', async () => {
    auth.fetchMe.mockResolvedValue({ ...ME, permissions: ['dataset.read'] });
    renderAt('/app/taxa');
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to open this area.');
    expect(dataset.fetchFamilies).not.toHaveBeenCalled();
  });

  it('RFC-13 R4 a 403 on the families shows the permission sentence', async () => { /* fetchFamilies rejects ApiError(403, 'PERMISSION_DENIED') → alert 'You do not have permission to do this.' */ });
  it('RFC-13 R4 a 401 ends the session and returns to /', async () => { /* PendingPage.test.tsx pattern */ });
});
```

(Since the genera mock returns the same page for every call, the rename / move rows keep the fixture names — the assertions are on the calls. `Rename family` and `New genus` render only while a family is selected; after `createFamily` the refetched `fetchFamilies` still answers `FAMILIES` — the selection stays on Fabaceae.) Run — expected: FAIL, route not found (the route file does not exist yet).

- [ ] **Step 4: `TaxaPage`, route, nav entry, icon**

`routes/app/taxa.tsx`: `createFileRoute('/app/taxa')({ component: TaxaPage })` with `@rfc RFC-13 R2, R3` and `@rfc RFC-60 R9`. `TaxaPage`: `if (!hasPermission(useMe(), 'taxa.manage')) return <NoPermission />;` first (then the queries — hooks after an early return are not allowed: put the gate in a wrapper `TaxaPage` that renders `<TaxaEditor />` when permitted). `TaxaEditor`: `families = useQuery({ queryKey: datasetKeys.families, queryFn: fetchFamilies })`; `selectedId` state initialised to the first family once loaded (`useEffect` when `selectedId === null && families.data?.[0]`); `filter` state; `term` (debounced 300 ms, `useDebouncedValue`); `genera = usePagedList(datasetKeys.genera(term ? { q: term } : { familyId: selectedId ?? '' }), (cursor, limit) => fetchGenera(term ? { q: term, cursor, limit } : { familyId: selectedId ?? undefined, cursor, limit }))` (`usePagedList(queryKeyBase, (cursor, limit) => Promise<Page<T>>, { enabled })` — pass `{ enabled: term !== '' || selectedId !== null }` so nothing is fetched before a family is selected); dialogs as state `dialog: null | { kind: 'newFamily' } | { kind: 'renameFamily'; family: TaxonRef } | { kind: 'newGenus' } | { kind: 'renameGenus'; genus: Genus } | { kind: 'move'; genus: Genus }` rendered at the end. The families column: `Button` "New family" (md) above; `<ul aria-label="Families">` of `aria-pressed` buttons as `PendingPage`; `EmptyState title="No family yet."` when the list is empty, "No family matches." when the filter empties it. The right column heading: `<h2 className="font-display text-section font-semibold text-canopy-950">{selected.name}</h2>` with `Button size="sm" variant="secondary"` "Rename family" and `Button size="sm"` "New genus" (hidden while a search term is active — the heading is then `Genera matching “<term>”`). The table: `Th` Name, Family, `<span className="sr-only">Actions</span>`; per row `Td` name, `Td` family name or `—` (`DASH`), `Td` with `Button size="sm" variant="secondary" aria-label={`Rename ${genus.name}`}` "Rename" and `aria-label={`Move ${genus.name}`}` "Move"; `Pagination pager={genera}` below when there is a page. `PageHeader title="Taxa" description="Families and genera of the catalog: create, rename and move. Species are edited on their own page."`. Tags: `@rfc RFC-13 R2, R3, R4`, `@rfc RFC-60 R8, R9`.

`nav.ts`: after the References entry, `{ to: '/app/taxa', label: 'Taxa', icon: 'branch', permission: 'taxa.manage', section: 'data' }` (the docblock's `@rfc` list gains `RFC-60 R9`). `Icon.tsx`: `branch: 'M6 4v12M6 8c0 3 8 1 8 5M7.5 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM15.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM7.5 16a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z'` (a trunk with one branch and three nodes, on the 20px grid like its neighbours). `AppShell.test.tsx`: add to the dataset-entries case (or a new `it`) that `taxa.manage` shows a "Taxa" link to `/app/taxa` under Data and `dataset.read` alone does not.

Run the page test, `AppShell.test.tsx`, then the suite (the router plugin regenerates `routeTree.gen.ts` — commit it) — green.

- [ ] **Step 5: Verify and commit**

```bash
PATH=… pnpm lint:fix && PATH=… pnpm typecheck && PATH=… pnpm rfc:check && PATH=… pnpm --filter @treerepro/web test
git add apps/web/src/components/catalog/TaxonNameDialog.tsx apps/web/src/components/catalog/TaxonNameDialog.test.tsx apps/web/src/components/catalog/MoveGenusDialog.tsx apps/web/src/components/catalog/MoveGenusDialog.test.tsx apps/web/src/pages/catalog apps/web/src/routes/app/taxa.tsx apps/web/src/routeTree.gen.ts apps/web/src/components/shell/nav.ts apps/web/src/components/shell/AppShell.test.tsx apps/web/src/components/ui/Icon.tsx
git commit -m "feat(web): /app/taxa — families and genera created, renamed and moved; Taxa navigation entry (RFC-60 R9)"
```

---

### Task 7: Close-out — docs, spec alignment, README, issues, full suites, pull request

**Files:**
- Modify: `docs/specs/2026-09-13-curation-design.md`, `README.md`, `docs/plans/2026-09-13-curation-07c-catalog.md` (execution record)

- [ ] **Step 1: Spec note**

After "### As delivered (plan 07b)" and before "### 10.4 Catalog editors (07c)", or directly under 10.4, add:

```markdown
### As delivered (plan 07c)

- **New species** on `/app/species` (header, `taxa.manage`) opens the species dialog in create mode — section 10.4 only listed the edit; `POST /api/species` existed (section 6) and a species missing from the catalog has no other way in but an import.
- Family and genus are created inline from the species dialog (a "New family" input beside the family `Select`; the genus `Combobox`'s create option under the chosen family); `/app/taxa` is where they are renamed and moved.
- Edit dialogs send only the changed fields (`null` to clear an optional one) and close without a request when nothing changed — the `PATCH` bodies are `nonEmpty` (`docs/gotchas/web.md`).
- A level move is two `PATCH`es (moved level first) swapping the `sortOrder`s (`docs/gotchas/web.md`).
- The trait key, value type and unit are shown as text in the edit dialog with a hint that they are immutable (RFC-62 R6).
- The kit gained `ButtonLink` / `buttonClassName` (navigation dressed as a button) and `api/query.ts` holds the one `withQuery`.
```

- [ ] **Step 2: README**

In the web section that lists the pages (07b added the curation pages), add: `/app/traits` — with `traits.manage`: new trait, edit trait, add / rename / reorder / activate levels; `/app/references` and `/app/references/$id` — with `references.manage`: new and edit reference; `/app/species` and `/app/species/$id` — with `taxa.manage`: new species, edit species (genus and family created inline), add alternative name; `/app/taxa` — with `taxa.manage`: families and genera (create, rename, move).

- [ ] **Step 3: Issues to file (tech-debt, after the PR)**

The 07b follow-ups that do not land here — one issue each, or one issue "Web follow-ups after plan 07c" with a checklist: (1) dialog close timing / focus return to the opener when a dialog unmounts on success; (2) URL-driven queue filters (`/app/curation/pending?traitId=`); (3) a shared `useRecordWrite` mutation hook for the record actions; (4) a Drawer / Dialog nesting guard; (5) `MapDialog` levels briefly empty before the dictionary loads; (6) trait suggestion rows without the unit hint (`Combobox` has one hint slot). Record the issue numbers in the execution record.

- [ ] **Step 4: Full verification, execution record, pull request**

```bash
PATH=… pnpm lint && PATH=… pnpm typecheck && PATH=… pnpm rfc:check && PATH=… pnpm --filter @treerepro/web test
git diff --stat origin/main..HEAD -- apps/api packages   # expected: empty (web-only branch)
```

Append the "Execution record" section to this plan (waves, rulings, review outcomes, test count) as 07b did; commit `docs: curation 07c — spec as-delivered note, README catalog editors, execution record`. Then the review policy: `coderabbit:code-review` once on the branch (fix findings, tests validate, no re-review); push `feat/curation-07c` and open the PR (base `main`) with the body: what (per page), tests (count; `apps/api` untouched), notes (New species beyond 10.4's wording; `ButtonLink`; diff `PATCH` rule; deferred follow-ups → issue numbers), ending with the attribution lines. **Merge only with the owner's explicit authorization.**

## Self-review notes

- Spec coverage (10.4): `/app/traits` new trait / edit / levels add-rename-move-activate + seed warning → T2, T3; references new / edit → T4; species edit + add name (+ genus / family inline) → T5; `/app/taxa` families and genera rename / create / move + nav entry → T6. Section 6's every 409 has a sentence; `PATCH` no-op handled client-side (diff).
- Placeholders: every dialog has its fields, messages and tests written out; the two page-test stubs in T5 / T6 (`hides "New species" from a reader`, the R8 401 / 403 cases) point at an existing file whose pattern is copied verbatim.
- Type consistency: `createLevel(traitId, body)` / `updateLevel(traitId, levelId, body)` answer `Trait` everywhere (T1 client, T3 editor); `TaxonNameDialog.save` returns `Promise<unknown>` so the four bindings need no cast; `Genus.family` is `TaxonRef | null` (fixtures `GENERA`).
- Assumption to confirm in the PR: New species on the web (see the header note).

## Execution record

Task 1 landed alone on `feat/curation-07c` (base `39cb506`, the plan commit on top of `origin/main` `6452b4b`): `9de6aed` — the catalog API client, the shared `withQuery`, `ButtonLink` / `buttonClassName` and the catalog fixtures. Wave 2 (Tasks 2, 4, 5, 6) then ran in parallel worktrees (`../Elisa-07c-t2`, `-t4`, `-t5`, `-t6`, branches `07c-t2`/`07c-t4`/`07c-t5`/`07c-t6`, each from `9de6aed`) and merged back into the integration branch in the plan's order — T2 first, as a fast-forward (no other commit had landed yet), then T4 (`5a40db5`), T5 (`9e2f1c9`), T6 (`a468136`) each its own merge commit. `routeTree.gen.ts` needed no change after the merges even though T6 regenerates it — the four branches' route additions did not collide. Task 3 (the level editor, reshaping the `TraitsPage` T2 delivered) then ran on the integration branch itself, closing with `f4ecb19`.

Two rulings were made before Wave 2 started. Ruling 1: `fetchGenera`'s params gained an optional `cursor` in Task 1 so Task 6 could page genera through `usePagedList`, even though nothing in Task 1 itself needed it — additive, and `withQuery` already drops undefined values, so the cost of being wrong was one unused optional parameter. Ruling 2: Wave 2's four tasks ran in parallel worktrees rather than sequentially, on the strength of the pre-flight file-disjointness scan; the risk accepted was a merge conflict to resolve by hand, which did not materialise.

Each task's review round closed with its own `fix(web): …` commit before the next task started. Task 6: `0f1d995` — `MoveGenusDialog` reports the updated genus to `onSaved`, per the plan's callback signature. Task 5: `b3c05b9` — Enter in the inline "New family name" input creates the family instead of submitting the species form, and changing the family now drops a genus that belongs to a different family instead of silently discarding it on save. Task 2: `05c0793` — both trait dialogs gate their `Alert` with `!isValidationError(save.error)` instead of the plan's single-field `!errors.key` sample (Ruling 3): RFC-13 R6 already routes a `VALIDATION_FAILED` detail under its field, so a second generic banner beside it is noise; the codebase convention lives in `lib/errors.ts` and is already used by `TotpSection`. Task 3: `f4ecb19` — `move` invalidates the dictionary in `onSettled` rather than only `onSuccess` (Ruling 4, superseding the plan's text): a partial two-`PATCH` swap is still a write the server committed, so the Global Constraint that a write is followed by an invalidation covers the failure case too, and a failed second `PATCH` now refetches so the tie between the two levels is visible; `toggle` keeps `onSuccess` (a single call, nothing written on failure).

Three implementer deviations were accepted at review rather than fixed. Task 2 lifts the edit-dialog's open/closed state up to `TraitsPage` instead of keeping it local to the row component, because a `<dialog>` cannot be mounted inside a `<tbody>`. Task 5 renders the family `Select` only after `fetchFamilies` settles, rather than always, so the control never shows with an empty option list. Task 4's page tests use an `openPage()` helper instead of a bare `findByText('References')`, because "References" also names the page heading and would be ambiguous.

The per-task reviews also deferred a number of minor findings, recorded in the ledger for the whole-branch review; the ones that reach across pages — `Combobox.onCreate` swallowing the API error behind a boolean (so a failed inline genus creation shows only the generic message) and `SpeciesDialog`'s family block breaking `aria-describedby`/`aria-invalid` wiring plus its two "Cancel" buttons while the inline family row is open — went to issue #59 rather than being enumerated here.

Full verification: `pnpm lint` is clean (one pre-existing Biome *info* in `Combobox.tsx`, same as 07b); `pnpm typecheck` and `pnpm rfc:check` are clean; `pnpm --filter @treerepro/web test` — 62 files, 356 tests, all passing. `git diff --stat origin/main..HEAD -- apps/api packages` is empty, so this branch touches only `apps/web` and its docs; the Docker-backed API suite was not run for that reason.

Follow-ups: issue #59 "Web follow-ups after plan 07c" carries the 07b and 07c deferred items as one checklist.

Whole-branch review and pull request: see the PR body.
