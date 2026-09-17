# Contribution 09b — Web: Validate / Add Different Record, Contest Dialog, Add Entries, DOI Field, Help Tips, Missing Traits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`).

**Goal:** The contributor's screens over the plan 09a API: two clear buttons per record (Validate with an optional supporting DOI; Add different record), the two-step contest dialog, the "Add entries for another trait" form with category → trait cascade and a list of DOI fields with a live check, `?` help tips with trait descriptions, and the "Show traits with no data" view with empty trait cards.

**Architecture:** New primitives in `apps/web/src/components/ui/`: `HelpTip` (popover), `Chip` is plan 10c. New form pieces in `components/curation/`: `DoiField` (one input with the resolve indicator), `SourcesField` (the list + "Add another reference" + personal-observation line), `ValueField` (level select or number, extracted from `AddValueDialog`), `ContestDialog`, `AddEntriesDialog` (replaces `AddValueDialog`), `EmptyTraitCard`. `RecordActions` is rewritten around the two buttons; the reviewer actions stay behind `records.review`. API calls go through `apps/web/src/api/curation.ts` (`resolveDoi`, `createRecords`).

**Tech Stack:** unchanged. No new dependencies.

**Spec:** `docs/specs/2026-09-17-contribution-design.md` §7 and §8. Depends on plan 09a merged.

## Global Constraints

Same as plan 08a, plus: no `style` attributes, no third-party scripts (RFC-13 R5); every page and component has Vitest + Testing Library tests with `vi.mock` of `apps/web/src/api/*` (RFC-13 R8); dialogs go through the modal stack (RFC-13 R10). Branch `feat/contribution-09b` in worktree `../Elisa-09b`. Web commands: `pnpm --filter @treerepro/web test`, `pnpm --filter @treerepro/web exec vitest run <path>`.

## File structure (end state)

```
apps/web/src/api/curation.ts                              # resolveDoi, createRecords (replaces createRecord)
apps/web/src/components/ui/HelpTip.tsx (+ .test.tsx)      # new primitive; exported from ui/index.ts
apps/web/src/components/curation/ValueField.tsx (+ test)  # extracted from AddValueDialog
apps/web/src/components/curation/DoiField.tsx (+ test)
apps/web/src/components/curation/SourcesField.tsx (+ test)
apps/web/src/components/curation/ContestDialog.tsx (+ test)
apps/web/src/components/curation/AddEntriesDialog.tsx (+ test)   # replaces AddValueDialog.tsx (deleted)
apps/web/src/components/curation/RecordActions.tsx (+ test)      # rewritten
apps/web/src/components/curation/errors.ts                # contributionErrorMessage
apps/web/src/components/dataset/EmptyTraitCard.tsx (+ test)
apps/web/src/components/dataset/TraitCard.tsx             # HelpTip
apps/web/src/components/dataset/RecordDrawer.tsx          # intent badge, Responses section, annotation reference
apps/web/src/pages/dataset/SpeciesPage.tsx (+ test)       # missing toggle, renamed button
apps/web/src/routes/app/species/$id.tsx                   # ?missing=true
apps/web/src/lib/dictionary.ts (+ test)                   # traitDescription(dictionary, traitId), categoriesWithActiveTraits
apps/web/src/test/dataset-fixtures.ts
apps/e2e/tests/contribution.spec.ts
docs/rfc/10-platform/13-presentation-layer.md             # R11 HelpTip; routes unchanged
```

---

### Task 1: API layer and error mapping

**Files:** `apps/web/src/api/curation.ts`, `apps/web/src/components/curation/errors.ts` (+ `errors.test.ts`)

**Interfaces (produces):**

```ts
export async function resolveDoi(doi: string): Promise<ResolveDoiResult>            // GET /references/resolve?doi=
export async function createRecords(body: CreateRecordBody): Promise<CreateRecordsResult>   // POST /records
export function contributionErrorMessage(error: unknown): string   // RFC-13 R6 mapping of §7.7
```

- [ ] **Step 1: Failing test** `errors.test.ts`:

```ts
it('RFC-13 R6 maps the contribution codes', () => {
  expect(contributionErrorMessage(new ApiError(502, 'DOI_LOOKUP_FAILED', 'x'))).toBe('The DOI registry could not be reached. Try again in a moment.');
  expect(contributionErrorMessage(new ApiError(409, 'RECORD_DUPLICATE', 'x'))).toBe('Every reference already supports this exact claim. Validate the existing record instead.');
  expect(contributionErrorMessage(new ApiError(409, 'RECORD_WITHDRAWN', 'x'))).toBe('This record is withdrawn; it cannot be contested.');
  expect(contributionErrorMessage(new ApiError(400, 'VALIDATION_FAILED', 'x'))).toBe('Check the highlighted fields.');
  expect(contributionErrorMessage(new Error('boom'))).toBe('Something went wrong. Try again.');
});
```

(Check `ApiError`'s constructor signature in `api/client.ts` and match it.)

- [ ] **Step 2: Implement** — `createRecords` posts to `/records` and returns `(await apiFetch<DataEnvelope<CreateRecordsResult>>(…)).data`; delete `createRecord`; `resolveDoi` uses `withQuery('/references/resolve', { doi })`. `errors.ts` as tested, falling back to `pageErrorMessage`.
- [ ] **Step 3: Run; commit** — `feat(web): createRecords, resolveDoi and the contribution error map (RFC-70, RFC-80 R4)`.

---

### Task 2: `HelpTip`

**Files:** `apps/web/src/components/ui/HelpTip.tsx`, `HelpTip.test.tsx`, `ui/index.ts`, `Icon.tsx` (`help` icon: a circled question mark path), RFC-13 R11.

**Interfaces:** `<HelpTip label?: string; children: ReactNode; learnMore?: string />` — a `<button type="button" aria-label={label ?? 'What does this mean?'} aria-expanded aria-controls>` with the `help` icon; the popover is a `<div role="tooltip" id>` rendered as a sibling, hidden until open; opens on click, on focus and on pointer hover; closes on Escape, on blur-out, on outside click. Positioned with Tailwind (`absolute left-0 top-full mt-1 z-20 w-72 rounded-[10px] border … bg-white p-3 text-meta shadow`), no inline styles. `learnMore` (plan 12a) renders a router `Link` "Learn more".

- [ ] **Step 1: Failing test**

```ts
it('RFC-13 R11 opens on click, closes on Escape, is described by the trigger', async () => {
  render(<HelpTip>Explains things.</HelpTip>);
  const button = screen.getByRole('button', { name: 'What does this mean?' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  await userEvent.click(button);
  const tip = screen.getByRole('tooltip');
  expect(tip).toHaveTextContent('Explains things.');
  expect(button).toHaveAttribute('aria-controls', tip.id);
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('tooltip')).toBeNull();
});
```

- [ ] **Step 2: Implement** — `useId` for the tooltip id, `useState(open)`, a wrapping `<span className="relative inline-flex">` with `onMouseEnter`/`onMouseLeave`, `onFocus`/`onBlur` (with `relatedTarget` containment check), a document `keydown` listener for Escape and `pointerdown` outside while open.
- [ ] **Step 3: RFC-13** — add `- **R11** A `?` help tip is a button that toggles a `role="tooltip"` element it controls; it opens on click, focus and hover, closes on Escape and outside click; its text is plain content, never HTML from the API.` + changelog. Commit — `feat(web): HelpTip primitive (RFC-13 R11)`.

---

### Task 3: `ValueField`, `DoiField`, `SourcesField`

**Files:** `apps/web/src/components/curation/ValueField.tsx`, `DoiField.tsx`, `SourcesField.tsx` and tests.

**Interfaces (produces):**

```ts
// ValueField: the level select or the number input for one trait (extracted from AddValueDialog, unchanged behaviour)
export interface ValueFieldProps { trait: Pick<Trait, 'valueType' | 'unit' | 'levels'>; levelId: string; numeric: string; onLevel(id: string): void; onNumeric(text: string): void; errors: Record<string, string>; ids: { level: string; numeric: string } }
// DoiField
export type DoiCheck = { status: 'idle' } | { status: 'checking' } | { status: 'ok'; label: string } | { status: 'not_found' } | { status: 'malformed' } | { status: 'failed' };
export interface DoiFieldProps { id: string; value: string; onChange(v: string): void; check: DoiCheck; onBlur(): void; onRemove?: () => void; error?: string }
// SourcesField — owns the list state and the checks
export type SourcesValue = { dois: string[] }   // '' entries are blank rows
export interface SourcesFieldProps { value: SourcesValue; onChange(v: SourcesValue): void; errors: Record<string, string>; onValidity(ready: boolean): void }
export function sourcesToBody(value: SourcesValue): CreateRecordBody['sources']   // blank rows dropped; none → { personalObservation: true }
```

`SourcesField` keeps a `Map<string, DoiCheck>` keyed by row index; on blur of a non-empty row it calls `resolveDoi` (debounced 300 ms per row through `useDebouncedValue` of the row's value), maps `known`/`resolvable` → `ok` (label = `preview?.title ?? reference?.citationKey` with the year), `not_found`, `VALIDATION_FAILED` → `malformed`, `DOI_LOOKUP_FAILED` or network → `failed`; `onValidity(true)` only when every non-empty row is `ok`.

- [ ] **Step 1: Failing tests**
  - `ValueField.test.tsx`: categorical renders the level select with active levels only; quantitative renders the number input with the unit.
  - `DoiField.test.tsx`: renders the hint; shows ✅ text "Resolved: Seed size (2023)" for `ok`; ❌ "DOI not found" for `not_found`; "Malformed DOI" for `malformed`; "Could not check the DOI — try again" for `failed`; Remove button when `onRemove`.
  - `SourcesField.test.tsx` (mock `resolveDoi`): starts with one blank row and the personal-observation line "This will be recorded as your personal observation"; typing a DOI and blurring calls `resolveDoi('10.1111/geb.13000')` once and shows "Resolved"; "Add another reference" adds a row (max 10 → button hidden); a `not_found` row reports `onValidity(false)`; `sourcesToBody({ dois: ['', ' 10.1/x '] })` → `{ references: [{ doi: '10.1/x' }] }`; `sourcesToBody({ dois: [''] })` → `{ personalObservation: true }`.
- [ ] **Step 2: Implement** (the hint text and `HelpTip` copy from the spec §7.4: "Leave blank if this comes from your own field work or expert knowledge; otherwise give the DOI.").
- [ ] **Step 3: Commit** — `feat(web): ValueField, DoiField and SourcesField with live DOI check (RFC-80 R4, RFC-70 R1)`.

---

### Task 4: `AddEntriesDialog` (replaces `AddValueDialog`)

**Files:** `AddEntriesDialog.tsx` (+ test), delete `AddValueDialog.tsx` and its test, `apps/web/src/lib/dictionary.ts` (+ test), `SpeciesPage.tsx` call site.

**Interfaces:**

```ts
// lib/dictionary.ts
export function categoriesWithActiveTraits(d: Dictionary): { key: string; label: string; traits: Trait[] }[]
export function traitDescription(d: Dictionary | undefined, traitId: string): string | undefined
// AddEntriesDialog
export function AddEntriesDialog(props: { speciesId: string; initialTrait?: TraitRef | null; onClose(): void; onCreated(result: CreateRecordsResult): void; onOpenRecord(id: string): void })
```

Form order (spec §7.3): category `Select` → trait `Select` (disabled until a category; options = active traits of the category; the trait's unit after the label) → `ValueField` → `SourcesField` → the attribution line `Recorded as <me.user.name>` → Cancel / **Add record(s)**. Submit validates locally (category, trait, value, sources ready), builds `{ speciesId, traitId, value, sources: sourcesToBody(sources) }`, parses with `createRecordBodySchema`, calls `createRecords` through `useRecordWrite` (`speciesId`), then `onCreated(result)`. API details under the field named by the path (`sources.references.<i>.doi` → the row's error). `RECORD_DUPLICATE` → alert with a link per detail ("Open existing record").

- [ ] **Step 1: Failing tests** — the cascade (choosing "Dispersal" fills the trait select with its active traits only; changing the category clears the trait and the value); fixed trait when `initialTrait` (paragraph, no selects); submission body with one DOI; submission with no DOI sends `personalObservation`; duplicate alert links.
- [ ] **Step 2: Implement; update `SpeciesPage` (button label "Add entries for another trait", `onCreated` opens `result.created[0].id`).**
- [ ] **Step 3: Commit** — `feat(web): Add entries for another trait dialog (RFC-70 R1-R3)`.

---

### Task 5: `ContestDialog` and the new `RecordActions`

**Files:** `ContestDialog.tsx` (+ test), `RecordActions.tsx` (+ test rewritten), `RecordDrawer.tsx` (+ test), fixtures.

**Interfaces:**

```ts
export function ContestDialog(props: { record: RecordDetail; onClose(): void; onCreated(result: CreateRecordsResult): void; onOpenRecord(id: string): void })
```

Step 1 radio group (`fieldset` legend "What does your value mean?"): `contest` — "Contest — The existing value is wrong; mine should replace it." with the example "Existing: biotic; yours: abiotic — the mode is abiotic, not biotic."; `complement` — "Complement — The existing value is also correct; I am adding another observation." with "Existing: biotic; yours: abiotic — it can be both." Step 2 (`fieldset disabled={!intent}`): `ValueField` (trait from the record; levels from the dictionary query), `SourcesField`, attribution line, submit **Add record**. Body: `{ speciesId, traitId, value, sources, intent, respondsToRecordId: record.id }`.

`RecordActions` (spec §7.1):
- `canAnnotate = hasPermission(me, 'records.annotate') && !withdrawn`.
- **✓ Validate** (`variant="primary"`): disabled with hint "You validated this record" when the viewer's latest non-withdraw annotation is `confirm`; a disclosure `<details>` "Add a supporting DOI (optional)" holding one `DoiField`; posts `{ kind: 'confirm', reference: doi ? { doi } : undefined }`.
- **+ Add different record** (`variant="danger"`): opens `ContestDialog`; on created, `onOpenRecord(result.created[0].id)`.
- `HelpTip` beside each: Validate — "Records that you agree with this value as it stands. Nothing is changed; your confirmation is attached to the record."; Add different record — "Opens a form for a different or additional value. You will say whether it contests this record (it is wrong) or complements it (both are true)."
- With `records.review`: Neutral and Dispute (note form) as before. Withdraw and Set as accepted unchanged.
- `RecordDrawer`: badge `contests …` / `complements …` with a link to `respondsTo.id` (opens it in the same drawer via `onOpenRecord`); a "Responses" section listing `responses` (intent badge, author, date, open link); annotation rows show "supported by *citation*" when `reference` and a small `generated` badge "automatic". New `apps/web/src/lib/references.ts` with `referenceLabel(ref: { citationKey: string; kind?: ReferenceKind; observer?: { name: string } | null })` → `'Personal observation'` (+ ` (Name)` when the observer is known) for `kind === 'personal_observation'`, else `citationKey`; every place that prints a citation key (`RecordTable`, `RecordDrawer`, `TraitPanel`, `TraitCard` accepted source, `AnnotationRow`) uses it, so a contributor never sees `personal-observation:<uuid>` (plan 10d adds the short-citation branch).

- [ ] **Step 1: Failing tests**
  - `ContestDialog.test.tsx`: fields disabled until a radio is chosen; submission body carries `intent` and `respondsToRecordId`; `RECORD_WITHDRAWN` maps to the sentence.
  - `lib/references.test.ts`: `referenceLabel` for a publication, a personal observation with and without observer.
  - `RecordActions.test.tsx`: contributor sees exactly Validate and Add different record (no Neutral / Dispute); manager sees the four; Validate posts `confirm` without reference; with a DOI typed and resolved it posts `reference: { doi }`; Validate disabled after the viewer's `confirm`; withdrawn record shows the sentence; admin still sees Set as accepted.
  - `RecordDrawer.test.tsx`: intent badge link and Responses section render from fixtures.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** — `feat(web): Validate / Add different record, contest dialog, responses in the drawer (RFC-70 R4-R6)`.

---

### Task 6: Species page — missing traits, empty cards, tooltips

**Files:** `EmptyTraitCard.tsx` (+ test), `TraitCard.tsx`, `SpeciesPage.tsx` (+ test), `routes/app/species/$id.tsx`, `api/dataset.ts` (`fetchSpeciesTraits(id, { includeMissing })`, key `datasetKeys.speciesTraits(id, includeMissing)`).

- [ ] **Step 1: Failing tests** — `?missing=true` renders the checkbox checked and calls `fetchSpeciesTraits(id, { includeMissing: true })`; a zero-count summary renders `EmptyTraitCard` with "No records yet" and, with `records.create`, "Add the first entry" opening `AddEntriesDialog` with the trait fixed; `TraitCard` renders a `HelpTip` whose tooltip holds the dictionary description (mock `fetchDictionary`); the header button reads "Add entries for another trait".
- [ ] **Step 2: Implement** — `validateSearch` of `$id.tsx` accepts `missing`; the checkbox navigates with `search: { missing }`; `EmptyTraitCard` shares the card chrome with `TraitCard` (extract `CardFrame` if the classes are long); the description comes from `traitDescription(dictionary.data, trait.id)` — `SpeciesPage` gains the dictionary query (`useQuery({ queryKey: datasetKeys.dictionary, queryFn: fetchDictionary })`; today only the dialogs, `PendingPage` and `TraitsPage` load it) and passes `dictionary.data` to the cards.
- [ ] **Step 3: Commit** — `feat(web): traits with no data, empty trait cards, trait help tips (RFC-70 R7)`.

---

### Task 7: E2E, docs, close-out

- [ ] **Step 1:** `apps/e2e/tests/contribution.spec.ts` — a contributor (seeded through the admin API with the `contributor` role; reuse the helper of plan 08a) opens a species with a record, clicks Validate → the drawer shows the confirmation; clicks Add different record → chooses Contest → picks a level → submits with no DOI → the new record opens with "contests" and the reference reads "Personal observation (<name>)"; opens "Show traits with no data" → "Add the first entry" on a trait → submits → the card now shows one record. (No DOI path in E2E: the stack has no network; the fake client is not wired into the images.)
- [ ] **Step 2:** `docs/specs/2026-09-17-contribution-design.md` status line; README Layout paragraph: the species page's contributor actions.
- [ ] **Step 3:** `pnpm lint`, `pnpm typecheck`, `pnpm rfc:check`, `pnpm test`, `pnpm build`, `pnpm test:e2e -- tests/contribution.spec.ts`; commit; push; PR `feat(web): contributor workflow — validate, contest, add entries, DOI check, help tips (plan 09b)`; one CodeRabbit run.

## Self-review

- Spec §7.1 → Task 5; §7.2 → Task 5; §7.3 → Task 4; §7.4 → Task 3; §7.5 → Task 2 (+ uses in 4–6); §7.6 → Task 6; §7.7 → Task 1; §8 web/E2E → each task + Task 7.
- Names: `sourcesToBody` (Task 3) used by Tasks 4 and 5; `createRecords` / `resolveDoi` (Task 1) used by 3–5; `traitDescription` (Task 4) used by 6.
