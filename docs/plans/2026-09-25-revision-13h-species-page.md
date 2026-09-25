# Revision 13h — Species Page (Validate · Contest · Complement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the species page of spec §2 on top of the 13g/13f/13d API. A legend (👍 Validate · 👎 Contest · ＋ Complement) sits at the top. Every categorical level on a trait card has the three actions, a validation count and a **Contested** badge. The quantitative record rows have the same three actions. One entry dialog asks Contest or Complement first whenever records already exist, and takes several levels or the six quantitative fields. The dialog reports what the API created, validated or found duplicated. The record panel sorts on the server, shows the record ID, ✓ n / ✗ n and **Contested**, and joins references with `; `. Withdrawal is a confirmation only.

**Architecture:** Web only (`apps/web`, plus the Playwright specs in `apps/e2e`). The plan adds three components:
- `ValidateDialog`: one question plus an optional single-row `SourcesField`, which posts through a `write` callback the caller names.
- `VoteButton`: an icon button whose `aria-label` names the action and its subject.
- `SortTh`: a sortable header in `ui/Table`.

`AddEntriesDialog` absorbs `ContestDialog`, which is then deleted. It gains the intent step, the "Responding to" select and the create-result view. `ValueField` becomes level checkboxes, or six numeric inputs for a quantitative trait. `RecordTable`, `TraitPanel`, `TraitCard`, `RecordActions`, `RecordDrawer` and `SpeciesPage` are rewired around these pieces. The web keeps no business rules: who may validate, what is a duplicate and what is contested all come from the API (RFC-13 R1). The page only reflects permissions (RFC-13 R3).

**Tech Stack:** unchanged. No new dependencies.

**Spec:** `docs/specs/2026-09-25-record-model-revision-design.md` §2, items 2.1, 2.3, 2.4, 2.6; shared interfaces §6.

**Depends on:** 13g merged (annotations `{ kind: 'confirm', referenceSource? } | { kind: 'withdraw' }`, `POST …/levels/:levelId/validate`, record `validationCount`/`contestCount`/`contested`, summary levels `{ levelId, key, count, validationCount, contested }` and summary `contested`, create response `{ created, validated, duplicates }`, value `{ levelIds }`, records `sort`/`order`, permission `records.withdraw_imported`); 13f merged (`{ quantitative }` value, `QuantitativeValue`, record `recordCode`, `quantitative`, `references[]`, summary numeric `{ min, max, mean, count }`); 13d merged (source input with `{ isbn, citation }`, the ISBN rows of `SourcesField`); 13e merged (no accepted value anywhere in the web).

## Cross-review amendments (2026-09-25 — apply these; they override the code below)

The plans were written in parallel; the orchestrator's cross-review settled these. Where a task's code disagrees, follow this section.

1. **No emoji — `Icon` glyphs.** The workspace UI pattern forbids emoji. Add three paths to `PATHS` in `apps/web/src/components/ui/Icon.tsx` (20px grid, same stroke style):
   ```ts
   thumbsUp: 'M6.5 9v7.5h-3V9zM6.5 9l3-5.5c1.2 0 2 .9 1.8 2.1L10.8 8h4.4a1.5 1.5 0 0 1 1.5 1.8l-1.2 5.5a1.5 1.5 0 0 1-1.5 1.2H6.5',
   thumbsDown: 'M6.5 11V3.5h-3V11zM6.5 11l3 5.5c1.2 0 2-.9 1.8-2.1L10.8 12h4.4a1.5 1.5 0 0 0 1.5-1.8l-1.2-5.5a1.5 1.5 0 0 0-1.5-1.2H6.5',
   plus: 'M10 4v12M4 10h12',
   ```
   `VoteButton`'s prop becomes `icon: 'thumbsUp' | 'thumbsDown' | 'plus'` and renders `<Icon name={icon} />`. The legend renders the same three `Icon`s next to the words **Validate**, **Contest**, **Complement**. Tests assert the accessible name and `svg[aria-hidden="true"]`, not an emoji text.
2. **Source input keeps the wrapper.** 13d keeps `{ personalObservation: true } | { references: SourceRef[] }` (spec §6 amended). `sourcesToBody` returns that shape; `ValidateDialog` sends `referenceSource: body.references[0]` when the body is not a personal observation (Spec note 4 resolved this way).
3. **Level validate response.** 13g answers `200 { data: { validated: RecordCodeRef[] } }` (and level withdraw `{ data: { withdrawn: RecordCodeRef[] } }`). Mocks use `{ data: { validated: [] } }`; `validateLevel` may keep returning `Promise<void>`.
4. **Record withdraw** answers `200 { data: null }` (13a RFC-65 R3 amended to match 13g); the drawer closes on success.
5. **Quantitative group error is announced**: give the group error element an `id` and set the fieldset's `aria-describedby` to `"<hintId> <errorId>"` when the error is shown.
 The task bodies below predate these amendments: where they disagree, the amendment wins and the executor edits the task code accordingly.

## Global Constraints

- RFC first, TDD, `@rfc` JSDoc tag on every exported symbol, English everywhere, no business rules in the web (README "Non-negotiable rules"; RFC-13 R1). The RFC text is 13a's. Tags cite existing rule ids, for example `@rfc RFC-70 R4`, read as "RFC-70 R4 (as amended by 13a for spec §2)". See Spec notes.
- RFC-13 R5: no `style` attributes; Tailwind classes only. RFC-13 R8: every component has Vitest + Testing Library tests, with `vi.mock` of `apps/web/src/api/*` in component tests and `installFetchMock` / `mockJson` / `lastRequest` (`apps/web/src/test/fetch.ts`) in `api/*.test.ts`. RFC-13 R10: dialogs go through `Dialog`, which shares the modal stack. A dialog over a drawer is allowed; a drawer over a dialog is not.
- Accessibility is never cut. Emoji are `aria-hidden="true"` and the control carries the name, either as text ("Validate") or as `aria-label` plus `title` ("Validate dioecious for sexual system"). Sort state is `aria-sort` on the `<th>`. Checkbox groups and the quantitative inputs sit in `<fieldset>`s with legends.
- Parallel-plan hygiene (memory: parallel-plans-break-on-merge). Build reference refs only from `PRIMARY_REFERENCE`, `SECONDARY_REFERENCE`, `PERSONAL_OBSERVATION_REFERENCE` and `GRACE_PERSONAL_OBSERVATION_REFERENCE` in `apps/web/src/test/dataset-fixtures.ts`, never as inline literals. Give the new record fields (`recordCode`, `validationCount`, `contestCount`, `contested`, `quantitative`, `references`) in local spreads over the shared fixtures, never by editing `dataset-fixtures.ts`, which 13f and 13g own.
- Branch `feat/13h-species-page`, worktree `../TreeRepro-13h`, cut from `origin/main` after 13d, 13e, 13f and 13g merged. Rebase, never merge (epic #85 rule 1).
- **Verify (this Mac has no Node — memory: verify-in-docker-no-node).** Use one container per agent, created once:

  ```sh
  docker run -d --name treerepro-13h -w /workspace treerepro-verify:base sleep infinity
  ```

  **Sync** before every run, from the worktree root. Delete first; always `-exec rm -f {} +` and `COPYFILE_DISABLE=1`:

  ```sh
  docker exec treerepro-13h sh -c 'cd /workspace && find . -name node_modules -prune -o -type f -exec rm -f {} +'
  COPYFILE_DISABLE=1 tar -cf - --exclude='./node_modules' --exclude='*/node_modules' --exclude='./.git' \
      --exclude='./data' --exclude='./.claude' --exclude='*/dist' \
      --exclude='.DS_Store' --exclude='._*' --exclude='*/._*' . \
    | docker exec -i treerepro-13h tar -x -C /workspace
  ```

  Web test of one file: `docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run <path relative to apps/web>`. Web typecheck: `docker exec treerepro-13h pnpm --filter @treerepro/web typecheck`. The typecheck is expected red from Task 4 (new `ValueField` props) until Task 7 deletes `ContestDialog`. Tasks 1, 3, 7, 9 and 11 end with it green.
- E2E cannot run on this Mac. The spec edits in Task 10 are written one-shot, CI's `e2e` job validates them, and every asserted string is quoted from the component code in this plan.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## File Structure (end state)

```
apps/web/src/api/dataset.ts                         # RecordSort, SortOrder; fetchRecords sort/order
apps/web/src/api/dataset.test.ts                    # + sort/order query
apps/web/src/api/curation.ts                        # ValidateBody, validateLevel
apps/web/src/api/curation.test.ts                   # + validateLevel
apps/web/src/components/ui/Table.tsx                # + SortTh
apps/web/src/components/ui/Table.test.tsx           # new
apps/web/src/components/ui/index.ts                 # export SortTh
apps/web/src/components/curation/SourcesField.tsx   # + single, EMPTY_SOURCES
apps/web/src/components/curation/SourcesField.test.tsx
apps/web/src/components/curation/ValueField.tsx     # checkboxes / six numeric inputs (rewritten)
apps/web/src/components/curation/ValueField.test.tsx
apps/web/src/components/curation/ValidateDialog.tsx # new
apps/web/src/components/curation/ValidateDialog.test.tsx
apps/web/src/components/curation/AddEntriesDialog.tsx # + intent step, Responding to, result view (rewritten)
apps/web/src/components/curation/AddEntriesDialog.test.tsx
apps/web/src/components/curation/ContestDialog.tsx  # deleted (+ its test)
apps/web/src/components/curation/RecordActions.tsx  # Validate / Contest / Complement / Withdraw (rewritten)
apps/web/src/components/curation/RecordActions.test.tsx
apps/web/src/components/dataset/VoteButton.tsx      # new
apps/web/src/components/dataset/VoteButton.test.tsx
apps/web/src/components/dataset/RecordTable.tsx     # ID, References, Counts, sort (rewritten)
apps/web/src/components/dataset/RecordTable.test.tsx
apps/web/src/components/dataset/TraitPanel.tsx      # sort state, quantitative row actions (rewritten)
apps/web/src/components/dataset/TraitPanel.test.tsx # new
apps/web/src/components/dataset/TraitCard.tsx       # every level, level actions, counts, Contested (rewritten)
apps/web/src/components/dataset/TraitCard.test.tsx
apps/web/src/components/dataset/RecordDrawer.tsx    # Record ID row, Contested badge, close on withdraw
apps/web/src/components/dataset/RecordDrawer.test.tsx
apps/web/src/components/dataset/ReviewBadge.tsx     # deleted (+ its test): no user left
apps/web/src/pages/dataset/SpeciesPage.tsx          # legend, wiring
apps/web/src/pages/dataset/SpeciesPage.test.tsx
apps/web/src/pages/dataset/ReferencePage.test.tsx   # column indices
apps/web/src/pages/workspace/ContributionsPage.test.tsx # no Review column
apps/e2e/tests/contribution.spec.ts
apps/e2e/tests/contributions.spec.ts                # drawer validate / contest steps only
apps/e2e/tests/dashboard.spec.ts                    # drawer validate step only
```

---

### Task 1: API layer (`sort`/`order`, `validateLevel`) and the single-row `SourcesField`

**Files:**
- Modify: `apps/web/src/api/dataset.ts`, `apps/web/src/api/dataset.test.ts`
- Modify: `apps/web/src/api/curation.ts`, `apps/web/src/api/curation.test.ts`
- Modify: `apps/web/src/components/curation/SourcesField.tsx`, `apps/web/src/components/curation/SourcesField.test.tsx`

**Interfaces:**
- Consumes: `ListRecordsQuery` (contracts; 13g adds `sort`, `order`), `SourceRef` (contracts; 13d adds `{ isbn, citation }`), `okStatusSchema`, `dataEnvelopeSchema`.
- Produces:

```ts
// api/dataset.ts
export type RecordSort = NonNullable<ListRecordsQuery['sort']>;   // 'value' | 'references' | 'origin' | 'added'
export type SortOrder = NonNullable<ListRecordsQuery['order']>;   // 'asc' | 'desc'
export function fetchRecords(params: { speciesId?: string; traitId?: string; referenceId?: string;
  sort?: RecordSort; order?: SortOrder; cursor?: string; limit?: number }): Promise<Page<RecordItem>>;
// api/curation.ts
export type ValidateBody = { referenceSource?: SourceRef };
export async function validateLevel(speciesId: string, traitId: string, levelId: string, body: ValidateBody): Promise<void>;
// SourcesField.tsx
export const EMPTY_SOURCES: SourcesValue;
export interface SourcesFieldProps { /* …existing… */ single?: boolean }
```

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/api/dataset.test.ts`, inside the existing `describe('RFC-63 R9 fetchRecords', …)`:

```ts
  it('sends the sort column and its order', async () => {
    mockJson(200, { data: [], meta: { nextCursor: null } });
    await fetchRecords({ speciesId: SPECIES.id, traitId: GENUS.id, sort: 'value', order: 'asc' });
    expect(lastRequest().url).toBe(
      `/api/records?speciesId=${SPECIES.id}&traitId=${GENUS.id}&sort=value&order=asc`,
    );
  });
```

In `apps/web/src/api/curation.test.ts`, add `validateLevel` to the import list from `./curation.ts` and append:

```ts
describe('RFC-70 R4 validateLevel', () => {
  const LEVEL_ID = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d20';

  it('posts the optional supporting reference to the level route', async () => {
    mockJson(200, { data: { status: 'ok' } });
    await validateLevel(SPECIES.id, SEXUAL_SYSTEM.id, LEVEL_ID, {
      referenceSource: { doi: '10.1111/geb.13000' },
    });
    expect(lastRequest().url).toBe(
      `/api/species/${SPECIES.id}/traits/${SEXUAL_SYSTEM.id}/levels/${LEVEL_ID}/validate`,
    );
    expect(lastRequest().init?.method).toBe('POST');
    expect(body()).toEqual({ referenceSource: { doi: '10.1111/geb.13000' } });
  });

  it('sends an empty body when there is no supporting reference', async () => {
    mockJson(200, { data: { status: 'ok' } });
    await validateLevel(SPECIES.id, SEXUAL_SYSTEM.id, LEVEL_ID, {});
    expect(body()).toEqual({});
  });
});
```

In `apps/web/src/components/curation/SourcesField.test.tsx`, add `EMPTY_SOURCES` to the import from `./SourcesField.tsx` and append:

```ts
describe('RFC-70 R4 SourcesField single', () => {
  it('offers one optional row, without the personal-observation wording', () => {
    render(
      <SourcesField
        value={EMPTY_SOURCES}
        onChange={vi.fn()}
        errors={{}}
        onValidity={vi.fn()}
        single
      />,
    );
    expect(screen.getAllByRole('textbox', { name: /doi/i })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Add another reference' })).not.toBeInTheDocument();
    expect(
      screen.queryByText('This will be recorded as your personal observation'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/own field work/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Sync, then:

```sh
docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/api/curation.test.ts src/components/curation/SourcesField.test.tsx
docker exec treerepro-13h pnpm --filter @treerepro/web typecheck
```

Expected: `curation.test.ts` fails with `validateLevel is not a function`. `SourcesField.test.tsx` fails with `EMPTY_SOURCES` undefined, and the row count is wrong because `single` is ignored. The typecheck fails with TS2353 (`'sort' does not exist in type …` in `dataset.test.ts`). The `dataset.test.ts` runtime passes already, because `fetchRecords` forwards its params; the type error is the failing signal for that test.

- [ ] **Step 3: Implement**

`apps/web/src/api/dataset.ts`: add `type ListRecordsQuery,` to the `@treerepro/contracts` import, then insert above `fetchRecords` and replace its signature:

```ts
/** A sortable column of the records list (spec §2). @rfc RFC-63 R9 */
export type RecordSort = NonNullable<ListRecordsQuery['sort']>;
/** @rfc RFC-63 R9 */
export type SortOrder = NonNullable<ListRecordsQuery['order']>;

/**
 * `sort` and `order` pick the column and direction the API orders by (spec
 * §2; the API validates them and defaults to `added desc`).
 * @rfc RFC-63 R9
 */
export function fetchRecords(params: {
  speciesId?: string;
  traitId?: string;
  referenceId?: string;
  sort?: RecordSort;
  order?: SortOrder;
  cursor?: string;
  limit?: number;
}) {
  return apiFetch(withQuery('/records', params), listEnvelopeSchema(recordSchema));
}
```

`apps/web/src/api/curation.ts`: add `okStatusSchema,` and `type SourceRef,` to the contracts import, then append after `annotateRecord`:

```ts
/** What a validation sends: at most one supporting reference (spec §2, R-6). @rfc RFC-70 R4 */
export type ValidateBody = { referenceSource?: SourceRef };

/**
 * Validates every visible record of one level of a species × trait (spec
 * §2): the API writes one `confirm` per record, skipping what R-6 forbids.
 * @rfc RFC-70 R4
 */
export async function validateLevel(
  speciesId: string,
  traitId: string,
  levelId: string,
  body: ValidateBody,
): Promise<void> {
  await apiFetch(
    `/species/${speciesId}/traits/${traitId}/levels/${levelId}/validate`,
    dataEnvelopeSchema(okStatusSchema),
    { method: 'POST', json: body },
  );
}
```

`apps/web/src/components/curation/SourcesField.tsx`, four edits:

1. In `SourcesFieldProps`, add:

```ts
  /**
   * One optional supporting reference (Validate, spec §2): a single row, no
   * "Add another reference", and none of the personal-observation wording —
   * a blank row here means "no reference", not own field work.
   */
  single?: boolean;
```

2. Below `SourcesFieldProps`, add:

```ts
/** The value a form starts from: one blank row. @rfc RFC-70 R1 */
export const EMPTY_SOURCES: SourcesValue = { dois: [''] };
```

If 13d changed the shape of `SourcesValue`, use the literal that 13d's `AddEntriesDialog` passes to `useState<SourcesValue>(…)`. See Spec notes.

3. Destructure `single = false` in `SourcesField({ …, single = false })`. On the `<fieldset>`, set `aria-describedby={single ? undefined : hintId}`. Wrap the hint `<p id={hintId}>…</p>` as `{single ? null : (<p id={hintId}>…</p>)}`.

4. Change the add-row guard to `{rows.length < (single ? 1 : MAX_ROWS) ? (` and the personal-observation guard to `{!single && dois.every((doi) => doi === '') ? (`. Under 13d's markup, apply the same three `single` guards to the hint paragraph, the add-row button and the personal-observation line.

- [ ] **Step 4: Run the tests and see them pass**

Sync, then:

```sh
docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/api/dataset.test.ts src/api/curation.test.ts src/components/curation/SourcesField.test.tsx
docker exec treerepro-13h pnpm --filter @treerepro/web typecheck
```

Expected: all pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/api/dataset.ts apps/web/src/api/dataset.test.ts apps/web/src/api/curation.ts apps/web/src/api/curation.test.ts apps/web/src/components/curation/SourcesField.tsx apps/web/src/components/curation/SourcesField.test.tsx
git commit -m "feat(web): records sort params, validateLevel, single-row SourcesField (RFC-63 R9, RFC-70 R4)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `SortTh` and the new `RecordTable`

**Files:**
- Modify: `apps/web/src/components/ui/Table.tsx`, `apps/web/src/components/ui/index.ts`
- Create: `apps/web/src/components/ui/Table.test.tsx`
- Rewrite: `apps/web/src/components/dataset/RecordTable.tsx`, `apps/web/src/components/dataset/RecordTable.test.tsx`
- Modify: `apps/web/src/pages/dataset/ReferencePage.test.tsx`, `apps/web/src/pages/workspace/ContributionsPage.test.tsx`

**Interfaces:**
- Consumes: `RecordSort`, `SortOrder` (Task 1); record item `recordCode`, `quantitative`, `references`, `validationCount`, `contestCount`, `contested` (13f/13g); `LabelledReference`, `referenceLabel` (`lib/references.ts`).
- Produces:

```ts
// ui/Table.tsx
export function SortTh(props: { label: string; direction: 'asc' | 'desc' | null; onSort: () => void }): JSX.Element;
// dataset/RecordTable.tsx
export function recordValueLabel(record: RecordItem): string;
export interface RecordTableSort { by: RecordSort; order: SortOrder; onSort(by: RecordSort): void }
export function RecordTable<T extends RecordItem>(props: { records: T[]; onSelect: (record: T) => void;
  showSpecies?: boolean; showTrait?: boolean; sort?: RecordTableSort;
  extra?: { header: string; cell: (record: T) => ReactNode } }): JSX.Element;
```

Columns: `[Species] [Trait] ID · Value · References · Secondary article · Origin · Harmonisation · Counts · Added [extra]`. With `sort`, Value, References, Origin and Added are `SortTh`. The Review column and `acceptedRecordId` are gone.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/ui/Table.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SortTh, Table, Thead, Tr } from './Table.tsx';

const inTable = (th: ReactElement) => (
  <Table>
    <Thead>
      <Tr>{th}</Tr>
    </Thead>
  </Table>
);

describe('RFC-13 R5 SortTh', () => {
  it('is a column header holding a button; aria-sort follows the direction', async () => {
    const onSort = vi.fn();
    const { rerender } = render(inTable(<SortTh label="Value" direction={null} onSort={onSort} />));
    expect(screen.getByRole('columnheader', { name: 'Value' })).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(screen.getByRole('button', { name: 'Value' }));
    expect(onSort).toHaveBeenCalledTimes(1);
    rerender(inTable(<SortTh label="Value" direction="asc" onSort={onSort} />));
    expect(screen.getByRole('columnheader', { name: 'Value' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    rerender(inTable(<SortTh label="Value" direction="desc" onSort={onSort} />));
    expect(screen.getByRole('columnheader', { name: 'Value' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });
});
```

Replace `apps/web/src/components/dataset/RecordTable.test.tsx` entirely:

```tsx
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordItem } from '@treerepro/contracts';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  PENDING_RECORD,
  PERSONAL_OBSERVATION_REFERENCE,
  PRIMARY_REFERENCE,
  RECORD,
  SECONDARY_REFERENCE,
} from '../../test/dataset-fixtures.ts';
import { RecordTable, recordValueLabel } from './RecordTable.tsx';

// The reference and species columns are router `Link`s, so the table mounts
// inside a minimal router whose only page is the table itself.
function renderInRouter(ui: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => ui,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(<RouterProvider router={router} />);
}

const cells = (row: HTMLElement) => within(row).getAllByRole('cell');

// An imported categorical record with two references, validated twice and
// contested once.
const ROW: RecordItem = {
  ...RECORD,
  recordCode: 'EB_1',
  references: [PRIMARY_REFERENCE, PERSONAL_OBSERVATION_REFERENCE],
  secondaryReference: SECONDARY_REFERENCE,
  validationCount: 2,
  contestCount: 1,
  contested: true,
};
// A manual quantitative record with a summary instead of a single value.
const MEASURED: RecordItem = {
  ...PENDING_RECORD,
  recordCode: 'TR_7',
  level: null,
  quantitative: { min: 0.5, max: 3, mean: 1.2, sd: 0.4, n: 12 },
  references: [PRIMARY_REFERENCE],
  secondaryReference: null,
  validationCount: 0,
  contestCount: 0,
  contested: false,
};

describe('RFC-63 R8 RecordTable', () => {
  it('lists ID, value, references, secondary article, origin, harmonisation, counts and date; no review column', async () => {
    const onSelect = vi.fn();
    renderInRouter(<RecordTable records={[ROW, MEASURED]} onSelect={onSelect} />);
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers).toEqual([
      'ID',
      'Value',
      'References',
      'Secondary article',
      'Origin',
      'Harmonisation',
      'Counts',
      'Added',
    ]);
    const rows = screen.getAllByRole('row');
    const first = cells(rows[1] as HTMLElement);
    expect(first[0]).toHaveTextContent('EB_1');
    // R-4: every reference of the record, joined by "; ".
    expect(first[2]).toHaveTextContent('Renner2014; Personal observation (Ada)');
    expect(within(first[2] as HTMLElement).getByRole('link', { name: 'Renner2014' })).toHaveAttribute(
      'href',
      `/app/references/${PRIMARY_REFERENCE.id}`,
    );
    expect(within(first[3] as HTMLElement).getByRole('link', { name: 'TRY-6.0' })).toBeVisible();
    expect(first[4]).toHaveTextContent('import');
    expect(within(first[5] as HTMLElement).getByText('harmonised')).toBeInTheDocument();
    expect(first[6]).toHaveTextContent('✓ 2 / ✗ 1');
    expect(within(first[6] as HTMLElement).getByText('Contested')).toBeInTheDocument();
    expect(first[7]).toHaveTextContent('2026-09-01');
    expect(screen.queryByText('confirmed')).not.toBeInTheDocument();

    const second = cells(rows[2] as HTMLElement);
    expect(second[3]).toHaveTextContent(/^—$/);
    expect(second[6]).toHaveTextContent('✓ 0 / ✗ 0');
    expect(within(second[6] as HTMLElement).queryByText('Contested')).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: '0.5–3 · mean 1.2 · SD 0.4 mg (n = 12)' }),
    );
    expect(onSelect).toHaveBeenCalledWith(MEASURED);
  });

  it('reads a quantitative record by its single value, and a record with nothing harmonised by its text', () => {
    expect(recordValueLabel({ ...MEASURED, quantitative: { single: 1.5 } })).toBe('1.5 mg');
    expect(recordValueLabel({ ...MEASURED, quantitative: { max: 3 } })).toBe('…–3 mg');
    expect(recordValueLabel({ ...MEASURED, quantitative: null })).toBe('about two');
    expect(recordValueLabel(ROW)).toBe('dioecious');
  });

  it('says so with a dash when a record lists no reference', async () => {
    renderInRouter(<RecordTable records={[{ ...MEASURED, references: [] }]} onSelect={vi.fn()} />);
    const rows = await screen.findAllByRole('row');
    expect(cells(rows[1] as HTMLElement)[2]).toHaveTextContent(/^—$/);
  });

  it('cuts a long reference label at sixty characters and keeps it whole in the link title', async () => {
    const longKey = `Smith, J.; Doe, A. (2001). ${'x'.repeat(60)}`;
    const long: RecordItem = {
      ...ROW,
      references: [{ ...PRIMARY_REFERENCE, citationKey: longKey }],
    };
    renderInRouter(<RecordTable records={[long]} onSelect={vi.fn()} />);
    const rows = await screen.findAllByRole('row');
    const link = within(cells(rows[1] as HTMLElement)[2] as HTMLElement).getByRole('link');
    expect(link).toHaveTextContent(`${longKey.slice(0, 59)}…`);
    expect(link).toHaveAttribute('title', longKey);
  });

  it('with showSpecies and showTrait, leading columns name the species (as a link) and the trait', async () => {
    renderInRouter(<RecordTable records={[ROW, MEASURED]} onSelect={vi.fn()} showSpecies showTrait />);
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers.slice(0, 4)).toEqual(['Species', 'Trait', 'ID', 'Value']);
    const links = screen.getAllByRole('link', { name: 'Adenanthera pavonina' });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', `/app/species/${ROW.species.id}`);
    expect(links[0]).toHaveClass('italic');
    const rows = screen.getAllByRole('row');
    expect(cells(rows[1] as HTMLElement)[1]).toHaveTextContent('sexual system');
    expect(cells(rows[2] as HTMLElement)[1]).toHaveTextContent('seed mass');
  });

  it('spec §2 sorts on value, references, origin and added only, and says which is active', async () => {
    const onSort = vi.fn();
    renderInRouter(
      <RecordTable
        records={[ROW]}
        onSelect={vi.fn()}
        sort={{ by: 'added', order: 'desc', onSort }}
      />,
    );
    expect(await screen.findByRole('columnheader', { name: 'Added' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(screen.getByRole('columnheader', { name: 'Value' })).toHaveAttribute('aria-sort', 'none');
    for (const name of ['ID', 'Secondary article', 'Harmonisation', 'Counts']) {
      expect(screen.getByRole('columnheader', { name })).not.toHaveAttribute('aria-sort');
    }
    await userEvent.click(screen.getByRole('button', { name: 'References' }));
    expect(onSort).toHaveBeenCalledWith('references');
  });
});

describe('RFC-71 R2 RecordTable extra column', () => {
  it("appends one column of the caller's own, cell by row", async () => {
    renderInRouter(
      <RecordTable
        records={[ROW, MEASURED]}
        onSelect={vi.fn()}
        extra={{ header: 'Status', cell: (record) => (record.contested ? 'contested' : 'quiet') }}
      />,
    );
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers.at(-1)).toBe('Status');
    const rows = screen.getAllByRole('row');
    expect(cells(rows[1] as HTMLElement).at(-1)).toHaveTextContent('contested');
    expect(cells(rows[2] as HTMLElement).at(-1)).toHaveTextContent('quiet');
  });

  it('adds no column when the caller passes none', async () => {
    renderInRouter(<RecordTable records={[ROW]} onSelect={vi.fn()} />);
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers.at(-1)).toBe('Added');
  });
});
```

`apps/web/src/pages/dataset/ReferencePage.test.tsx`, in the test "lists the records with the species, trait, primary and secondary article per row…":

- Replace `expect(headers.slice(0, 5)).toEqual(['Species', 'Trait', 'Value', 'Primary article', 'Secondary article']);` with `expect(headers.slice(0, 6)).toEqual(['Species', 'Trait', 'ID', 'Value', 'References', 'Secondary article']);`.
- Change `first[3]` → `first[4]`, `first[4]` → `first[5]`, `second[3]` → `second[4]`, `second[4]` → `second[5]`.
- Delete the two lines asserting `getByText('confirmed')` and `getByText('disputed')`.

`apps/web/src/pages/workspace/ContributionsPage.test.tsx`: delete the line `expect(within(accepted as HTMLElement).getByText('disputed')).toBeInTheDocument();`. The Review column no longer exists.

- [ ] **Step 2: Run the tests and see them fail**

Sync, then:

```sh
docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/components/ui/Table.test.tsx src/components/dataset/RecordTable.test.tsx
```

Expected: `Table.test.tsx` fails with `SortTh` not exported (`is not a function`). `RecordTable.test.tsx` fails on the header list (`'Primary article'` and `'Review'` still present) and on `recordValueLabel is not a function`.

- [ ] **Step 3: Implement**

Append to `apps/web/src/components/ui/Table.tsx`:

```tsx
const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;
const ARROWS = { asc: '↑', desc: '↓' } as const;

/**
 * A column header that sorts: a button naming the column, the direction as a
 * decorative arrow and as `aria-sort` on the header itself (`none` while
 * another column sorts).
 * @rfc RFC-13 R5
 */
export function SortTh({
  label,
  direction,
  onSort,
}: {
  label: string;
  direction: 'asc' | 'desc' | null;
  onSort: () => void;
}) {
  return (
    <Th aria-sort={direction ? ARIA_SORT[direction] : 'none'}>
      <button
        type="button"
        onClick={onSort}
        className="inline-flex items-center gap-1 font-bold uppercase tracking-[0.06em] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
      >
        {label}
        <span aria-hidden="true" className={direction ? 'text-canopy-900' : 'text-mist-500'}>
          {direction ? ARROWS[direction] : '↕'}
        </span>
      </button>
    </Th>
  );
}
```

In `apps/web/src/components/ui/index.ts`, replace `export { Table, Tbody, Td, Th, Thead, Tr } from './Table.tsx';` with `export { SortTh, Table, Tbody, Td, Th, Thead, Tr } from './Table.tsx';`.

Replace `apps/web/src/components/dataset/RecordTable.tsx` entirely:

```tsx
import { Link } from '@tanstack/react-router';
import type { RecordItem } from '@treerepro/contracts';
import { Fragment, type ReactNode } from 'react';
import type { RecordSort, SortOrder } from '../../api/dataset.ts';
import { formatNumber, humaniseKey, isoDate, truncate } from '../../lib/format.ts';
import { type LabelledReference, referenceLabel } from '../../lib/references.ts';
import { Badge, SortTh, Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';
import { HarmonisationBadge } from './HarmonisationBadge.tsx';

const ARTICLE_MAX = 60;
const DASH = <span className="text-mist-500">—</span>;
const SORT_LABELS: Record<RecordSort, string> = {
  value: 'Value',
  references: 'References',
  origin: 'Origin',
  added: 'Added',
};

function bound(value: number | undefined): string {
  return value === undefined ? '…' : formatNumber(value);
}

/**
 * How a record's value reads: its level; else its quantitative value in the
 * trait's unit — the single value, the min–max range, the mean and the SD,
 * with n last (R-5) — else the text as it was entered.
 * @rfc RFC-63 R8
 */
export function recordValueLabel(record: RecordItem): string {
  if (record.level) return record.level.key;
  const q = record.quantitative;
  if (q) {
    const parts = [
      q.single === undefined ? null : formatNumber(q.single),
      q.min === undefined && q.max === undefined ? null : `${bound(q.min)}–${bound(q.max)}`,
      q.mean === undefined ? null : `mean ${formatNumber(q.mean)}`,
      q.sd === undefined ? null : `SD ${formatNumber(q.sd)}`,
    ].filter((part): part is string => part !== null);
    if (parts.length > 0) {
      const unit = record.trait.unit ? ` ${record.trait.unit}` : '';
      const n = q.n === undefined ? '' : ` (n = ${q.n})`;
      return `${parts.join(' · ')}${unit}${n}`;
    }
  }
  return record.valueText || '(empty)';
}

// One reference as it reads (RFC-61 R4 — a personal observation by its
// observer, never by its key) linked to its page, cut at sixty characters
// with the whole label in the link's `title`.
function ReferenceLink({ reference }: { reference: LabelledReference & { id: string } }) {
  const label = referenceLabel(reference);
  const shown = truncate(label, ARTICLE_MAX);
  return (
    <Link
      to="/app/references/$id"
      params={{ id: reference.id }}
      title={shown === label ? undefined : label}
      className="font-medium text-canopy-900 underline-offset-2 hover:underline"
    >
      {shown}
    </Link>
  );
}

/** The column and direction the list is ordered by, and how to change them. @rfc RFC-63 R9 */
export interface RecordTableSort {
  by: RecordSort;
  order: SortOrder;
  onSort(by: RecordSort): void;
}

/**
 * Records as rows: the record ID (R-2), the value — a button that selects the
 * row, so every record is reachable by keyboard — every reference of the
 * record joined by "; " (R-4), the import's secondary article, origin,
 * harmonisation, the validation and contest counts with a **Contested**
 * badge (R-9), and the date added. Withdrawn records never reach it (R-13).
 * With `sort`, the value, references, origin and added headers sort on the
 * server (spec §2). `showSpecies` / `showTrait` add leading columns outside a
 * species page or trait panel; `extra` appends one column of the caller's.
 * @rfc RFC-63 R8, R9
 * @rfc RFC-71 R2
 */
export function RecordTable<T extends RecordItem>({
  records,
  onSelect,
  showSpecies = false,
  showTrait = false,
  sort,
  extra,
}: {
  records: T[];
  onSelect: (record: T) => void;
  showSpecies?: boolean;
  showTrait?: boolean;
  sort?: RecordTableSort;
  extra?: { header: string; cell: (record: T) => ReactNode };
}) {
  const head = (by: RecordSort) =>
    sort ? (
      <SortTh
        label={SORT_LABELS[by]}
        direction={sort.by === by ? sort.order : null}
        onSort={() => sort.onSort(by)}
      />
    ) : (
      <Th>{SORT_LABELS[by]}</Th>
    );
  return (
    <Table>
      <Thead>
        <Tr>
          {showSpecies ? <Th>Species</Th> : null}
          {showTrait ? <Th>Trait</Th> : null}
          <Th>ID</Th>
          {head('value')}
          {head('references')}
          <Th>Secondary article</Th>
          {head('origin')}
          <Th>Harmonisation</Th>
          <Th>Counts</Th>
          {head('added')}
          {extra ? <Th>{extra.header}</Th> : null}
        </Tr>
      </Thead>
      <Tbody>
        {records.map((record) => (
          <Tr key={record.id} className="transition-colors hover:bg-mist-50">
            {showSpecies ? (
              <Td>
                <Link
                  to="/app/species/$id"
                  params={{ id: record.species.id }}
                  className="font-medium italic text-canopy-900 underline-offset-2 hover:underline"
                >
                  {record.species.canonicalName}
                </Link>
              </Td>
            ) : null}
            {showTrait ? <Td>{humaniseKey(record.trait.key)}</Td> : null}
            <Td className="whitespace-nowrap tabular-nums">{record.recordCode}</Td>
            <Td>
              <button
                type="button"
                onClick={() => onSelect(record)}
                className="text-left font-medium text-canopy-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
              >
                {recordValueLabel(record)}
              </button>
            </Td>
            <Td>
              {record.references.length === 0
                ? DASH
                : record.references.map((reference, index) => (
                    <Fragment key={reference.id}>
                      {index > 0 ? '; ' : null}
                      <ReferenceLink reference={reference} />
                    </Fragment>
                  ))}
            </Td>
            <Td>
              {record.secondaryReference ? (
                <ReferenceLink reference={record.secondaryReference} />
              ) : (
                DASH
              )}
            </Td>
            <Td>{record.origin}</Td>
            <Td>
              <HarmonisationBadge status={record.harmonisation} />
            </Td>
            <Td className="whitespace-nowrap">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="tabular-nums">
                  <span aria-hidden="true">{`✓ ${record.validationCount} / ✗ ${record.contestCount}`}</span>
                  <span className="sr-only">
                    {` (${record.validationCount} ${record.validationCount === 1 ? 'validation' : 'validations'}, ${record.contestCount} ${record.contestCount === 1 ? 'contest' : 'contests'})`}
                  </span>
                </span>
                {record.contested ? <Badge tone="red">Contested</Badge> : null}
              </span>
            </Td>
            <Td className="whitespace-nowrap tabular-nums">
              <time dateTime={record.createdAt}>{isoDate(record.createdAt)}</time>
            </Td>
            {extra ? <Td>{extra.cell(record)}</Td> : null}
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
```

- [ ] **Step 4: Run the tests and see them pass**

Sync, then:

```sh
docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/components/ui/Table.test.tsx src/components/dataset/RecordTable.test.tsx src/pages/dataset/ReferencePage.test.tsx src/pages/workspace/ContributionsPage.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/components/ui/Table.tsx apps/web/src/components/ui/Table.test.tsx apps/web/src/components/ui/index.ts apps/web/src/components/dataset/RecordTable.tsx apps/web/src/components/dataset/RecordTable.test.tsx apps/web/src/pages/dataset/ReferencePage.test.tsx apps/web/src/pages/workspace/ContributionsPage.test.tsx
git commit -m "feat(web): record table with ID, references, counts, contested and sortable headers (RFC-63 R8, R9)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `VoteButton` and the sortable `TraitPanel` with quantitative row actions

**Files:**
- Create: `apps/web/src/components/dataset/VoteButton.tsx`, `apps/web/src/components/dataset/VoteButton.test.tsx`
- Rewrite: `apps/web/src/components/dataset/TraitPanel.tsx`
- Create: `apps/web/src/components/dataset/TraitPanel.test.tsx`
- Modify: `apps/web/src/pages/dataset/SpeciesPage.test.tsx`

**Interfaces:**
- Consumes: `RecordTable`, `RecordTableSort` (Task 2); `fetchRecords`, `RecordSort`, `SortOrder` (Task 1).
- Produces:

```ts
export function VoteButton(props: { icon: '👍' | '👎' | '＋'; label: string; onClick: () => void }): JSX.Element;
export function TraitPanel(props: { speciesId: string; summary: TraitSummary; onClose: () => void;
  onSelectRecord: (id: string) => void;
  onValidateRecord?: (record: RecordItem) => void;
  onRespondRecord?: (record: RecordItem, intent: RecordIntent) => void }): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/dataset/VoteButton.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VoteButton } from './VoteButton.tsx';

describe('RFC-13 R5 VoteButton', () => {
  it('is named by its label, shows it as a tooltip, and keeps the icon out of the name', async () => {
    const onClick = vi.fn();
    render(<VoteButton icon="👍" label="Validate dioecious for sexual system" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Validate dioecious for sexual system' });
    expect(button).toHaveAttribute('title', 'Validate dioecious for sexual system');
    expect(button.querySelector('[aria-hidden="true"]')).toHaveTextContent('👍');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

Create `apps/web/src/components/dataset/TraitPanel.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordItem, TraitSummary } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PENDING_RECORD,
  RECORD,
  SEED_MASS_SUMMARY,
  SEXUAL_SYSTEM_SUMMARY,
  SPECIES,
} from '../../test/dataset-fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { withRouter } from '../../test/router.tsx';
import { TraitPanel } from './TraitPanel.tsx';

const dataset = vi.hoisted(() => ({ fetchRecords: vi.fn() }));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

const MASS: RecordItem = {
  ...PENDING_RECORD,
  recordCode: 'TR_7',
  level: null,
  quantitative: { single: 1.5 },
};
const page = (data: RecordItem[]) => ({ data, meta: { nextCursor: null } });

beforeEach(() => {
  dataset.fetchRecords.mockReset().mockResolvedValue(page([MASS]));
});

function mount(summary: TraitSummary, props: Partial<Parameters<typeof TraitPanel>[0]> = {}) {
  renderWithProviders(
    withRouter(
      <TraitPanel
        speciesId={SPECIES.id}
        summary={summary}
        onClose={vi.fn()}
        onSelectRecord={vi.fn()}
        {...props}
      />,
    ),
  );
}

describe('RFC-63 R9 TraitPanel sorting', () => {
  it('asks for the newest first, then re-sorts on the server from a header', async () => {
    mount(SEED_MASS_SUMMARY);
    const panel = await screen.findByRole('dialog', { name: 'seed mass' });
    await waitFor(() =>
      expect(dataset.fetchRecords).toHaveBeenCalledWith({
        speciesId: SPECIES.id,
        traitId: SEED_MASS_SUMMARY.trait.id,
        sort: 'added',
        order: 'desc',
        cursor: undefined,
        limit: 50,
      }),
    );
    expect(await within(panel).findByRole('columnheader', { name: 'Added' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Value' }));
    await waitFor(() =>
      expect(dataset.fetchRecords).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'value', order: 'asc' }),
      ),
    );
    expect(within(panel).getByRole('columnheader', { name: 'Value' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Value' }));
    await waitFor(() =>
      expect(dataset.fetchRecords).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'value', order: 'desc' }),
      ),
    );
  });
});

describe('spec §2 TraitPanel row actions', () => {
  it('puts Validate, Contest and Complement on each row of a quantitative trait', async () => {
    const onValidateRecord = vi.fn();
    const onRespondRecord = vi.fn();
    mount(SEED_MASS_SUMMARY, { onValidateRecord, onRespondRecord });
    const panel = await screen.findByRole('dialog', { name: 'seed mass' });
    await userEvent.click(await within(panel).findByRole('button', { name: 'Validate TR_7' }));
    expect(onValidateRecord).toHaveBeenCalledWith(MASS);
    await userEvent.click(within(panel).getByRole('button', { name: 'Contest TR_7' }));
    expect(onRespondRecord).toHaveBeenLastCalledWith(MASS, 'contest');
    await userEvent.click(within(panel).getByRole('button', { name: 'Complement TR_7' }));
    expect(onRespondRecord).toHaveBeenLastCalledWith(MASS, 'complement');
  });

  it('offers only what the viewer may do', async () => {
    mount(SEED_MASS_SUMMARY, { onValidateRecord: vi.fn() });
    const panel = await screen.findByRole('dialog', { name: 'seed mass' });
    expect(await within(panel).findByRole('button', { name: 'Validate TR_7' })).toBeVisible();
    expect(within(panel).queryByRole('button', { name: 'Contest TR_7' })).not.toBeInTheDocument();
  });

  it('leaves the rows of a categorical trait alone: its levels carry the actions on the card', async () => {
    dataset.fetchRecords.mockResolvedValue(page([{ ...RECORD, recordCode: 'EB_1' }]));
    mount(SEXUAL_SYSTEM_SUMMARY, { onValidateRecord: vi.fn(), onRespondRecord: vi.fn() });
    const panel = await screen.findByRole('dialog', { name: 'sexual system' });
    await within(panel).findByRole('button', { name: 'dioecious' });
    expect(within(panel).queryByRole('button', { name: /^Validate/ })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });
});
```

In `apps/web/src/pages/dataset/SpeciesPage.test.tsx`, test "opens the panel for a card, lists the records with both chips, and closes it":

- Replace the expected `fetchRecords` call object with `{ speciesId: SPECIES.id, traitId: SEXUAL_SYSTEM.id, sort: 'added', order: 'desc', cursor: undefined, limit: 50 }`.
- Delete the two lines `expect(within(rows[1] as HTMLElement).getByText('confirmed')).toBeInTheDocument();` and `expect(within(rows[2] as HTMLElement).getByText('disputed')).toBeInTheDocument();`.

- [ ] **Step 2: Run the tests and see them fail**

Sync, then:

```sh
docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/components/dataset/VoteButton.test.tsx src/components/dataset/TraitPanel.test.tsx
```

Expected: `VoteButton.test.tsx` fails to resolve `./VoteButton.tsx`. `TraitPanel.test.tsx` fails with `fetchRecords` called without `sort`/`order` and no `Validate TR_7` button.

- [ ] **Step 3: Implement**

Create `apps/web/src/components/dataset/VoteButton.tsx`:

```tsx
import { Button } from '../ui/index.ts';

/**
 * One of the three record decisions as an icon button (spec §2): 👍 Validate,
 * 👎 Contest, ＋ Complement. The icon is decorative; `label` names the action
 * and its subject for assistive technology and, as `title`, for the pointer.
 * @rfc RFC-13 R5
 * @rfc RFC-70 R1, R4
 */
export function VoteButton({
  icon,
  label,
  onClick,
}: {
  icon: '👍' | '👎' | '＋';
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="px-3"
    >
      <span aria-hidden="true">{icon}</span>
    </Button>
  );
}
```

Replace `apps/web/src/components/dataset/TraitPanel.tsx` entirely:

```tsx
import type { RecordIntent, RecordItem, TraitSummary } from '@treerepro/contracts';
import { useState } from 'react';
import { datasetKeys, fetchRecords, type RecordSort, type SortOrder } from '../../api/dataset.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { humaniseKey } from '../../lib/format.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';
import { Alert, Drawer, EmptyState } from '../ui/index.ts';
import { Pagination } from './Pagination.tsx';
import { RecordTable } from './RecordTable.tsx';
import { VoteButton } from './VoteButton.tsx';

/**
 * The records of one trait for one species, in a wide drawer: one page at a
 * time of `GET /api/records?speciesId&traitId&sort&order` (RFC-63 R9), newest
 * first until a sortable header says otherwise — a new column sorts
 * ascending, the same column again flips it, and either starts over at page
 * one. The table omits the species and trait columns, which the page and the
 * title already name; a row hands its id back so the page can open the
 * record. A quantitative trait's rows carry 👍 👎 ＋ (spec §2) — a
 * categorical trait's levels carry them on the card instead — each present
 * only when the page passes its handler, that is, when the viewer holds the
 * permission it needs.
 * @rfc RFC-63 R9
 * @rfc RFC-70 R1, R4
 */
export function TraitPanel({
  speciesId,
  summary,
  onClose,
  onSelectRecord,
  onValidateRecord,
  onRespondRecord,
}: {
  speciesId: string;
  summary: TraitSummary;
  onClose: () => void;
  onSelectRecord: (id: string) => void;
  onValidateRecord?: (record: RecordItem) => void;
  onRespondRecord?: (record: RecordItem, intent: RecordIntent) => void;
}) {
  const traitId = summary.trait.id;
  const [sort, setSort] = useState<{ by: RecordSort; order: SortOrder }>({
    by: 'added',
    order: 'desc',
  });
  const params = { speciesId, traitId, sort: sort.by, order: sort.order };
  const list = usePagedList(datasetKeys.records(params), (cursor, limit) =>
    fetchRecords({ ...params, cursor, limit }),
  );
  const withActions =
    summary.trait.valueType === 'quantitative' &&
    (onValidateRecord !== undefined || onRespondRecord !== undefined);

  return (
    <Drawer open title={humaniseKey(summary.trait.key)} onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        <p className="text-body text-mist-500">
          {summary.trait.unit ? `${summary.trait.unit} · ` : ''}
          {summary.recordCount} {summary.recordCount === 1 ? 'record' : 'records'}
        </p>
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading && !list.error ? (
          <p className="text-body text-mist-500">Loading records…</p>
        ) : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No records for this trait yet." />
        ) : null}
        {list.items.length > 0 ? (
          <RecordTable
            records={list.items}
            onSelect={(record) => onSelectRecord(record.id)}
            sort={{
              ...sort,
              onSort: (by) =>
                setSort((prev) => ({
                  by,
                  order: prev.by === by && prev.order === 'asc' ? 'desc' : 'asc',
                })),
            }}
            extra={
              withActions
                ? {
                    header: 'Actions',
                    cell: (record) => (
                      <span className="flex gap-1.5">
                        {onValidateRecord ? (
                          <VoteButton
                            icon="👍"
                            label={`Validate ${record.recordCode}`}
                            onClick={() => onValidateRecord(record)}
                          />
                        ) : null}
                        {onRespondRecord ? (
                          <>
                            <VoteButton
                              icon="👎"
                              label={`Contest ${record.recordCode}`}
                              onClick={() => onRespondRecord(record, 'contest')}
                            />
                            <VoteButton
                              icon="＋"
                              label={`Complement ${record.recordCode}`}
                              onClick={() => onRespondRecord(record, 'complement')}
                            />
                          </>
                        ) : null}
                      </span>
                    ),
                  }
                : undefined
            }
          />
        ) : null}
        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>
    </Drawer>
  );
}
```

- [ ] **Step 4: Run the tests and see them pass**

Sync, then:

```sh
docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/components/dataset/VoteButton.test.tsx src/components/dataset/TraitPanel.test.tsx src/pages/dataset/SpeciesPage.test.tsx
docker exec treerepro-13h pnpm --filter @treerepro/web typecheck
```

Expected: all pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/components/dataset/VoteButton.tsx apps/web/src/components/dataset/VoteButton.test.tsx apps/web/src/components/dataset/TraitPanel.tsx apps/web/src/components/dataset/TraitPanel.test.tsx apps/web/src/pages/dataset/SpeciesPage.test.tsx
git commit -m "feat(web): sortable record panel with actions on quantitative rows (RFC-63 R9, RFC-70 R4)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `ValueField`: level checkboxes and six quantitative inputs

**Files:**
- Rewrite: `apps/web/src/components/curation/ValueField.tsx`, `apps/web/src/components/curation/ValueField.test.tsx`

**Interfaces:**
- Consumes: `QuantitativeValue`, `Trait` (contracts).
- Produces:

```ts
export const QUANTITATIVE_FIELDS: readonly [{ key: 'single'; label: 'Single value' }, { key: 'min'; label: 'Min' },
  { key: 'max'; label: 'Max' }, { key: 'mean'; label: 'Mean' }, { key: 'sd'; label: 'SD' }, { key: 'n'; label: 'n' }];
export type QuantitativeKey = 'single' | 'min' | 'max' | 'mean' | 'sd' | 'n';
export type QuantitativeText = Record<QuantitativeKey, string>;
export const EMPTY_QUANTITATIVE: QuantitativeText;
export function quantitativeToBody(text: QuantitativeText): QuantitativeValue;
export interface ValueFieldProps { trait: Pick<Trait, 'valueType' | 'unit' | 'levels'>; levelIds: string[];
  quantitative: QuantitativeText; onLevels(ids: string[]): void; onQuantitative(next: QuantitativeText): void;
  errors: Record<string, string>; idPrefix: string }
export function ValueField(props: ValueFieldProps): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

Replace `apps/web/src/components/curation/ValueField.test.tsx` entirely:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SEED_MASS_TRAIT, SEXUAL_SYSTEM_TRAIT } from '../../test/dataset-fixtures.ts';
import {
  EMPTY_QUANTITATIVE,
  type QuantitativeText,
  quantitativeToBody,
  ValueField,
} from './ValueField.tsx';

const HERMAPHRODITE = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e11';
const DIOECIOUS = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e12';

function mount(
  props: Partial<{
    levelIds: string[];
    quantitative: QuantitativeText;
    errors: Record<string, string>;
    quantitativeTrait: boolean;
  }> = {},
) {
  const onLevels = vi.fn();
  const onQuantitative = vi.fn();
  render(
    <ValueField
      trait={props.quantitativeTrait ? SEED_MASS_TRAIT : SEXUAL_SYSTEM_TRAIT}
      levelIds={props.levelIds ?? []}
      quantitative={props.quantitative ?? EMPTY_QUANTITATIVE}
      onLevels={onLevels}
      onQuantitative={onQuantitative}
      errors={props.errors ?? {}}
      idPrefix="v"
    />,
  );
  return { onLevels, onQuantitative };
}

describe('RFC-65 R1 ValueField categorical', () => {
  it('offers the active levels as checkboxes, several at once (R-3)', async () => {
    const { onLevels } = mount({ levelIds: [HERMAPHRODITE] });
    expect(screen.getByRole('group', { name: 'Levels' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'hermaphrodite' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'dioecious' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'polygamous' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'dioecious' }));
    expect(onLevels).toHaveBeenLastCalledWith([HERMAPHRODITE, DIOECIOUS]);
    await userEvent.click(screen.getByRole('checkbox', { name: 'hermaphrodite' }));
    expect(onLevels).toHaveBeenLastCalledWith([]);
  });

  it('shows the error for the levels under the group', () => {
    mount({ errors: { 'value.levelIds': 'Choose at least one level.' } });
    expect(screen.getByRole('group', { name: 'Levels' })).toHaveAccessibleDescription(
      'Choose at least one level.',
    );
  });
});

describe('RFC-65 R1 ValueField quantitative', () => {
  it('takes six numbers, each labelled in the trait unit except n, with the hint once', async () => {
    const { onQuantitative } = mount({ quantitativeTrait: true });
    for (const name of ['Single value (mg)', 'Min (mg)', 'Max (mg)', 'Mean (mg)', 'SD (mg)', 'n']) {
      expect(screen.getByRole('spinbutton', { name })).toBeInTheDocument();
    }
    expect(
      screen.getByText(
        'Give a single value, or summary statistics — at least one of single, min, max or mean. Min must not exceed max; SD is 0 or more; n is a whole number, 1 or more.',
      ),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Min (mg)' }), '2');
    expect(onQuantitative).toHaveBeenLastCalledWith({ ...EMPTY_QUANTITATIVE, min: '2' });
  });

  it('shows a field error under its input and a value error under the group', () => {
    mount({
      quantitativeTrait: true,
      errors: {
        'value.quantitative.min': 'Min must not exceed max',
        'value.quantitative': 'Enter at least one of single, min, max or mean.',
      },
    });
    expect(screen.getByRole('spinbutton', { name: 'Min (mg)' })).toHaveAccessibleDescription(
      'Min must not exceed max',
    );
    expect(
      screen.getByText('Enter at least one of single, min, max or mean.'),
    ).toBeInTheDocument();
  });
});

describe('RFC-65 R1 quantitativeToBody', () => {
  it('turns the filled inputs into numbers and leaves the blank ones out', () => {
    expect(
      quantitativeToBody({ single: '', min: ' 0.5 ', max: '3', mean: '', sd: '0', n: '12' }),
    ).toEqual({ min: 0.5, max: 3, sd: 0, n: 12 });
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Sync, then `docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/components/curation/ValueField.test.tsx`.
Expected: FAIL. `EMPTY_QUANTITATIVE` and `quantitativeToBody` are undefined, and no group named "Levels" exists (the old control is a select).

- [ ] **Step 3: Implement**

Replace `apps/web/src/components/curation/ValueField.tsx` entirely:

```tsx
import type { QuantitativeValue, Trait } from '@treerepro/contracts';
import { Field, Input } from '../ui/index.ts';

/** The six inputs of a quantitative value, in the order the form shows them (R-5). @rfc RFC-65 R1 */
export const QUANTITATIVE_FIELDS = [
  { key: 'single', label: 'Single value' },
  { key: 'min', label: 'Min' },
  { key: 'max', label: 'Max' },
  { key: 'mean', label: 'Mean' },
  { key: 'sd', label: 'SD' },
  { key: 'n', label: 'n' },
] as const;

/** @rfc RFC-65 R1 */
export type QuantitativeKey = (typeof QUANTITATIVE_FIELDS)[number]['key'];
/** The six inputs as typed; `''` is a blank input. @rfc RFC-65 R1 */
export type QuantitativeText = Record<QuantitativeKey, string>;
/** @rfc RFC-65 R1 */
export const EMPTY_QUANTITATIVE: QuantitativeText = {
  single: '',
  min: '',
  max: '',
  mean: '',
  sd: '',
  n: '',
};

const QUANTITATIVE_HINT =
  'Give a single value, or summary statistics — at least one of single, min, max or mean. Min must not exceed max; SD is 0 or more; n is a whole number, 1 or more.';

/**
 * The filled inputs as numbers, the blank ones left out. The rules of R-5 are
 * the API's to enforce; the form only hints at them.
 * @rfc RFC-65 R1
 */
export function quantitativeToBody(text: QuantitativeText): QuantitativeValue {
  const value: QuantitativeValue = {};
  for (const { key } of QUANTITATIVE_FIELDS) {
    if (text[key].trim() !== '') value[key] = Number(text[key]);
  }
  return value;
}

/** @rfc RFC-65 R1 */
export interface ValueFieldProps {
  /** The trait the value belongs to; only its type, unit and levels matter. */
  trait: Pick<Trait, 'valueType' | 'unit' | 'levels'>;
  levelIds: string[];
  quantitative: QuantitativeText;
  onLevels(ids: string[]): void;
  onQuantitative(next: QuantitativeText): void;
  /** Field errors keyed by the API's paths (`value`, `value.levelIds`, `value.quantitative[.<key>]`). */
  errors: Record<string, string>;
  /** Prefix of the controls' ids; each control appends its own suffix. */
  idPrefix: string;
}

const LEGEND = 'text-label font-bold uppercase tracking-[0.08em] text-canopy-800';

/**
 * The value one trait takes. A categorical trait gets a checkbox per active
 * level, several at once, each chosen level becoming a record of its own
 * (R-3). A quantitative trait gets six numeric inputs — single, min, max,
 * mean and SD in the trait's unit, and n — with the rules of R-5 as a hint
 * and the HTML bounds (`min`, `step`) as the only client-side guard; the API
 * validates. The form above owns the state, so the one control serves every
 * entry form. An issue the schema reports at `value` itself shows under the
 * group.
 * @rfc RFC-65 R1
 */
export function ValueField({
  trait,
  levelIds,
  quantitative,
  onLevels,
  onQuantitative,
  errors,
  idPrefix,
}: ValueFieldProps) {
  if (trait.valueType === 'categorical') {
    const error = errors['value.levelIds'] ?? errors.value;
    const errorId = `${idPrefix}-levels-error`;
    return (
      <fieldset className="flex flex-col gap-2" aria-describedby={error ? errorId : undefined}>
        <legend className={LEGEND}>Levels</legend>
        {trait.levels
          .filter((level) => level.active)
          .map((level) => (
            <label key={level.id} className="flex items-center gap-2 text-body text-canopy-950">
              <input
                type="checkbox"
                className="size-4 accent-canopy-700"
                checked={levelIds.includes(level.id)}
                onChange={(event) =>
                  onLevels(
                    event.target.checked
                      ? [...levelIds, level.id]
                      : levelIds.filter((id) => id !== level.id),
                  )
                }
              />
              {level.key}
            </label>
          ))}
        {error ? (
          <p id={errorId} className="text-meta text-red-700">
            {error}
          </p>
        ) : null}
      </fieldset>
    );
  }
  const unit = trait.unit ? ` (${trait.unit})` : '';
  const hintId = `${idPrefix}-hint`;
  const groupError = errors['value.quantitative'] ?? errors.value;
  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={hintId}>
      <legend className={LEGEND}>{`Value${unit}`}</legend>
      <p id={hintId} className="text-meta text-mist-500">
        {QUANTITATIVE_HINT}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {QUANTITATIVE_FIELDS.map(({ key, label }) => {
          const id = `${idPrefix}-${key}`;
          const error = errors[`value.quantitative.${key}`];
          const count = key === 'n';
          return (
            <Field key={key} id={id} label={count ? label : `${label}${unit}`} error={error}>
              <Input
                id={id}
                type="number"
                inputMode={count ? 'numeric' : 'decimal'}
                step={count ? 1 : 'any'}
                min={count ? 1 : key === 'sd' ? 0 : undefined}
                value={quantitative[key]}
                onChange={(event) => onQuantitative({ ...quantitative, [key]: event.target.value })}
                invalid={Boolean(error)}
              />
            </Field>
          );
        })}
      </div>
      {groupError ? <p className="text-meta text-red-700">{groupError}</p> : null}
    </fieldset>
  );
}
```

If Biome flags the nested ternary on `min`, hoist it as `const lowest = count ? 1 : key === 'sd' ? 0 : undefined;` above the `return`, or split it into an `if`.

- [ ] **Step 4: Run the test and see it pass**

Sync, then `docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/components/curation/ValueField.test.tsx`.
Expected: PASS. The web typecheck is now red in `AddEntriesDialog.tsx` and `ContestDialog.tsx` (old `ValueField` props). Tasks 6 and 7 fix it.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/components/curation/ValueField.tsx apps/web/src/components/curation/ValueField.test.tsx
git commit -m "feat(web): value field takes several levels or six quantitative numbers (RFC-65 R1)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `ValidateDialog`

**Files:**
- Create: `apps/web/src/components/curation/ValidateDialog.tsx`, `apps/web/src/components/curation/ValidateDialog.test.tsx`

**Interfaces:**
- Consumes: `ValidateBody` (Task 1), `SourcesField` with `single` and `EMPTY_SOURCES` (Task 1), `sourcesToBody` (13d: returns `{ personalObservation: true } | SourceRef[]`), `useRecordWrite`.
- Produces:

```ts
export interface ValidateDialogProps { subject: string; speciesId: string;
  write(body: ValidateBody): Promise<unknown>; onClose(): void }
export function ValidateDialog(props: ValidateDialogProps): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/curation/ValidateDialog.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { SPECIES } from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { withRouter } from '../../test/router.tsx';
import { ValidateDialog } from './ValidateDialog.tsx';

const curation = vi.hoisted(() => ({
  resolveDoi: vi.fn(),
  invalidateAfterRecordWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/curation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/curation.ts')>()),
  ...curation,
}));

const DOI = '10.1111/geb.13000';
const RESOLVABLE = {
  status: 'resolvable',
  reference: null,
  preview: { title: 'Seed size', authors: 'Moles, A.', year: 2023, journal: 'GEB' },
};

beforeEach(() => {
  curation.resolveDoi.mockReset();
  curation.invalidateAfterRecordWrite.mockClear();
});

function mount(write = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  renderWithProviders(
    withRouter(
      <ValidateDialog subject="dioecious" speciesId={SPECIES.id} write={write} onClose={onClose} />,
    ),
    { me: ME },
  );
  return { write, onClose };
}

describe('RFC-70 R4 ValidateDialog', () => {
  it('asks the question and validates with no reference, then closes', async () => {
    const { write, onClose } = mount();
    const dialog = await screen.findByRole('dialog', { name: 'Validate dioecious' });
    expect(
      within(dialog).getByText('Do you confirm that this record is correct?'),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText('This will be recorded as your personal observation'),
    ).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Validate' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(write).toHaveBeenCalledWith({});
    expect(curation.invalidateAfterRecordWrite).toHaveBeenCalledWith(expect.anything(), SPECIES.id);
  });

  it('sends the one supporting DOI once it resolved', async () => {
    curation.resolveDoi.mockResolvedValue(RESOLVABLE);
    const { write } = mount();
    const dialog = await screen.findByRole('dialog', { name: 'Validate dioecious' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'DOI' }), DOI);
    await userEvent.tab();
    expect(await within(dialog).findByText('Resolved: Seed size (2023)')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Validate' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith({ referenceSource: { doi: DOI } }));
  });

  it('refuses to send while the DOI has not resolved', async () => {
    curation.resolveDoi.mockResolvedValue({ status: 'not_found', reference: null });
    const { write } = mount();
    const dialog = await screen.findByRole('dialog', { name: 'Validate dioecious' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'DOI' }), DOI);
    await userEvent.tab();
    await within(dialog).findByText('DOI not found');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Validate' }));
    expect(
      within(dialog).getByText('Each DOI must resolve before the record can be added.'),
    ).toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
  });

  it('RFC-13 R6 shows the API refusal and stays open', async () => {
    const write = vi.fn().mockRejectedValue(new ApiError(409, 'SOMETHING_ELSE', 'x'));
    const { onClose } = mount(write);
    const dialog = await screen.findByRole('dialog', { name: 'Validate dioecious' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Validate' }));
    expect(await within(dialog).findByText('Something went wrong. Try again.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Sync, then `docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/components/curation/ValidateDialog.test.tsx`.
Expected: FAIL, `Failed to resolve import "./ValidateDialog.tsx"`.

- [ ] **Step 3: Implement**

Create `apps/web/src/components/curation/ValidateDialog.tsx`:

```tsx
import { useState } from 'react';
import type { ValidateBody } from '../../api/curation.ts';
import { fieldErrors } from '../../lib/errors.ts';
import { useRecordWrite } from '../../lib/use-record-write.ts';
import { Alert, Button, Dialog } from '../ui/index.ts';
import { contributionErrorMessage, SOURCES_NOT_READY } from './errors.ts';
import { EMPTY_SOURCES, SourcesField, type SourcesValue, sourcesToBody } from './SourcesField.tsx';

/** @rfc RFC-70 R4 */
export interface ValidateDialogProps {
  /** What is validated, as the title names it: a level ("dioecious") or a record ID. */
  subject: string;
  /** The species whose summaries and lists the validation leaves stale. */
  speciesId: string;
  /** The write: a level's records (`validateLevel`) or one record (`annotateRecord` with `confirm`). */
  write(body: ValidateBody): Promise<unknown>;
  onClose(): void;
}

/**
 * 👍 Validate (spec §2, R-6): one question — "Do you confirm that this record
 * is correct?" — and an optional supporting reference in a single
 * `SourcesField` row (a DOI, or an ISBN with its citation; left blank, none
 * is sent), then the write the caller names. It closes once every stale
 * query is invalidated. Who may validate what (never one's own record, once
 * per user) is the API's answer, shown in the alert, in the API's own words
 * when it names a field this dialog does not lay out.
 * @rfc RFC-13 R6, R10
 * @rfc RFC-70 R4
 */
export function ValidateDialog({ subject, speciesId, write, onClose }: ValidateDialogProps) {
  const [sources, setSources] = useState<SourcesValue>(EMPTY_SOURCES);
  const [ready, setReady] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const save = useRecordWrite<ValidateBody, unknown>({
    write,
    speciesId,
    onInvalidated: () => onClose(),
  });

  function confirm() {
    if (!ready) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    const body = sourcesToBody(sources);
    const referenceSource = Array.isArray(body) ? body[0] : undefined;
    save.mutate(referenceSource ? { referenceSource } : {});
  }

  let alert: string | null = null;
  if (blocked) alert = SOURCES_NOT_READY;
  else if (save.isError) {
    alert = Object.values(fieldErrors(save.error))[0] ?? contributionErrorMessage(save.error);
  }

  return (
    <Dialog open title={`Validate ${subject}`} onClose={onClose} closeDisabled={save.isPending}>
      <div className="flex flex-col gap-4">
        <p className="text-body text-canopy-900">Do you confirm that this record is correct?</p>
        <p className="text-meta text-mist-500">A supporting reference is optional.</p>
        <SourcesField
          value={sources}
          onChange={setSources}
          errors={{}}
          onValidity={setReady}
          single
        />
        {alert ? <Alert tone="error">{alert}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button pending={save.isPending} onClick={confirm}>
            Validate
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the test and see it pass**

Sync, then `docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/components/curation/ValidateDialog.test.tsx`.
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/components/curation/ValidateDialog.tsx apps/web/src/components/curation/ValidateDialog.test.tsx
git commit -m "feat(web): validate dialog with an optional supporting reference (RFC-70 R4)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: One entry dialog: intent first, several levels, result view

**Files:**
- Rewrite: `apps/web/src/components/curation/AddEntriesDialog.tsx`, `apps/web/src/components/curation/AddEntriesDialog.test.tsx`

**Interfaces:**
- Consumes: `ValueField`, `EMPTY_QUANTITATIVE`, `quantitativeToBody` (Task 4); `EMPTY_SOURCES`, `SourcesField`, `sourcesToBody` (Task 1 / 13d); `recordValueLabel` (Task 2); `fetchRecords` (Task 1); `createRecords` returning `{ created, validated, duplicates }` (13g); `createRecordBodySchema` with value `{ levelIds } | { quantitative }` (13f/13g).
- Produces:

```ts
export interface RespondTo { intent?: RecordIntent; levelId?: string; recordId?: string }
export interface AddEntriesDialogProps { speciesId: string; initialTrait?: TraitRef | null;
  respondTo?: RespondTo | null; onClose(): void; onCreated(result: CreateRecordsResult): void;
  onOpenRecord(id: string): void }
export function AddEntriesDialog(props: AddEntriesDialogProps): JSX.Element;
```

Behaviour:
- Once a trait is known, the dialog reads up to 200 of the species' records for it (`fetchRecords({ speciesId, traitId, limit: 200 })`).
- If any exist, a required first step appears: the Contest / Complement radios plus a **Responding to** select. The select lists the levels for a categorical trait and the records (`recordCode · value`) for a quantitative one.
- Every other field and the submit button stay disabled (`fieldset disabled`) until both are answered, or while the records load.
- `respondTo` pre-answers the step (from 👎/＋ on a level or a row, or from the drawer).
- For a categorical target, `respondsToRecordId` is the preset record when it has that level, else the first loaded record of the level. R-8 makes any record of the level equivalent.
- A 201 that carries `validated` or `duplicates` switches to a result view, which lists each created, validated and duplicate record ID as a button that opens it. Otherwise `onCreated` runs as before.

- [ ] **Step 1: Write the failing test**

Replace `apps/web/src/components/curation/AddEntriesDialog.test.tsx` entirely:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordItem } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  DICTIONARY,
  DICTIONARY_SEED_MASS,
  DICTIONARY_SEXUAL_SYSTEM,
  PENDING_RECORD,
  RECORD,
  RECORD_DETAIL,
  SPECIES,
} from '../../test/dataset-fixtures.ts';
import { ME, USER } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { withRouter } from '../../test/router.tsx';
import { AddEntriesDialog } from './AddEntriesDialog.tsx';

const curation = vi.hoisted(() => ({
  createRecords: vi.fn(),
  resolveDoi: vi.fn(),
  invalidateAfterRecordWrite: vi.fn(async () => undefined),
}));
const dataset = vi.hoisted(() => ({ fetchDictionary: vi.fn(), fetchRecords: vi.fn() }));
vi.mock('../../api/curation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/curation.ts')>()),
  ...curation,
}));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

const TITLE = 'Add entries for another trait';
const SEED_MASS = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e02';
const HERMAPHRODITE = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e11';
const DIOECIOUS = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e12';
const CONTEST_LABEL = 'Contest — The existing value is wrong; mine should replace it.';
const COMPLEMENT_LABEL =
  'Complement — The existing value is also correct; I am adding another observation.';
const page = (data: RecordItem[]) => ({ data, meta: { nextCursor: null } });
const CREATED = { created: [{ ...RECORD_DETAIL, recordCode: 'TR_9' }], validated: [], duplicates: [] };

// A record the species already has for the dictionary's sexual system.
const EXISTING: RecordItem = {
  ...RECORD,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e90',
  recordCode: 'EB_3',
  trait: DICTIONARY_SEXUAL_SYSTEM,
  level: { id: HERMAPHRODITE, key: 'hermaphrodite' },
};
// One it already has for the dictionary's seed mass.
const EXISTING_MASS: RecordItem = {
  ...PENDING_RECORD,
  recordCode: 'TR_4',
  trait: DICTIONARY_SEED_MASS,
  level: null,
  quantitative: { single: 1.25 },
};

beforeEach(() => {
  curation.createRecords.mockReset();
  curation.resolveDoi.mockReset();
  curation.invalidateAfterRecordWrite.mockClear();
  dataset.fetchDictionary.mockReset().mockResolvedValue(DICTIONARY);
  dataset.fetchRecords.mockReset().mockResolvedValue(page([]));
});

function mount(props: Partial<Parameters<typeof AddEntriesDialog>[0]> = {}) {
  const onCreated = vi.fn();
  const onOpenRecord = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    withRouter(
      <AddEntriesDialog
        speciesId={SPECIES.id}
        onClose={onClose}
        onCreated={onCreated}
        onOpenRecord={onOpenRecord}
        {...props}
      />,
    ),
    { me: ME },
  );
  return { onCreated, onOpenRecord, onClose };
}

const categorySelect = (dialog: HTMLElement) =>
  within(dialog).getByRole('combobox', { name: 'Broad trait category' });
const traitSelect = (dialog: HTMLElement) =>
  within(dialog).getByRole('combobox', { name: 'Trait' });
const submit = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: 'Add record(s)' });

async function openWith(categoryKey: string, traitId: string): Promise<HTMLElement> {
  const dialog = await screen.findByRole('dialog', { name: TITLE });
  await within(dialog).findByRole('option', { name: 'Seed' });
  await userEvent.selectOptions(categorySelect(dialog), categoryKey);
  await userEvent.selectOptions(traitSelect(dialog), traitId);
  return dialog;
}

/** A fixed-trait dialog whose record fields are open (no existing record). */
async function openFixed(title = 'Add entries for sexual system') {
  const dialog = await screen.findByRole('dialog', { name: title });
  await waitFor(() => expect(submit(dialog)).toBeEnabled());
  return dialog;
}

describe('RFC-70 R1 AddEntriesDialog trait choice', () => {
  it('fills the trait select with the active traits of the chosen category only', async () => {
    mount();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    await within(dialog).findByRole('option', { name: 'Seed' });
    expect(traitSelect(dialog)).toBeDisabled();
    await userEvent.selectOptions(categorySelect(dialog), 'seed');
    const trait = traitSelect(dialog);
    expect(within(trait).getByRole('option', { name: 'seed mass (mg)' })).toBeInTheDocument();
    expect(within(trait).queryByRole('option', { name: /seed colour/ })).not.toBeInTheDocument();
  });

  it('clears the trait and the value when the category changes', async () => {
    mount();
    const dialog = await openWith('seed', SEED_MASS);
    const single = await within(dialog).findByRole('spinbutton', { name: 'Single value (mg)' });
    await waitFor(() => expect(single).toBeEnabled());
    await userEvent.type(single, '12.5');
    await userEvent.selectOptions(categorySelect(dialog), 'reproductive_system');
    expect(traitSelect(dialog)).toHaveValue('');
    expect(within(dialog).queryByRole('spinbutton')).not.toBeInTheDocument();
    await userEvent.selectOptions(categorySelect(dialog), 'seed');
    await userEvent.selectOptions(traitSelect(dialog), SEED_MASS);
    expect(
      await within(dialog).findByRole('spinbutton', { name: 'Single value (mg)' }),
    ).toHaveValue(null);
  });

  it('fixes the trait when opened from a card, without the selects, and names it in the title', async () => {
    mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await openFixed();
    expect(within(dialog).queryByRole('combobox', { name: 'Trait' })).toBeNull();
    expect(within(dialog).getByText('Reproductive system › sexual system')).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Levels' })).toBeInTheDocument();
  });

  it('RFC-13 R11 explains the chosen trait from the dictionary', async () => {
    mount();
    const dialog = await openWith('seed', SEED_MASS);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'What does this trait mean?' }),
    );
    expect(within(dialog).getByRole('tooltip')).toHaveTextContent('Dry mass of one seed.');
  });
});

describe('RFC-70 R1 AddEntriesDialog submission', () => {
  it('R-3 sends every ticked level with no DOI as a personal observation', async () => {
    curation.createRecords.mockResolvedValue(CREATED);
    const { onCreated } = mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await openFixed();
    expect(dataset.fetchRecords).toHaveBeenCalledWith({
      speciesId: SPECIES.id,
      traitId: DICTIONARY_SEXUAL_SYSTEM.id,
      limit: 200,
    });
    // No existing record: no intent step.
    expect(within(dialog).queryByRole('group', { name: 'What does your value mean?' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'hermaphrodite' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'dioecious' }));
    expect(within(dialog).getByText(`Recorded as ${USER.name}`)).toBeInTheDocument();
    await userEvent.click(submit(dialog));
    await waitFor(() =>
      expect(curation.createRecords).toHaveBeenCalledWith({
        speciesId: SPECIES.id,
        traitId: DICTIONARY_SEXUAL_SYSTEM.id,
        value: { levelIds: [HERMAPHRODITE, DIOECIOUS] },
        sources: { personalObservation: true },
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
  });

  it('R-5 sends only the quantitative fields that were filled', async () => {
    curation.createRecords.mockResolvedValue(CREATED);
    mount({ initialTrait: DICTIONARY_SEED_MASS });
    const dialog = await openFixed('Add entries for seed mass (mg)');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Min (mg)' }), '0.5');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Max (mg)' }), '3');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'n' }), '12');
    await userEvent.click(submit(dialog));
    await waitFor(() =>
      expect(curation.createRecords).toHaveBeenCalledWith(
        expect.objectContaining({ value: { quantitative: { min: 0.5, max: 3, n: 12 } } }),
      ),
    );
  });

  it('RFC-13 R6 asks for the category, the trait and the value before sending anything', async () => {
    mount();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    await userEvent.click(submit(dialog));
    expect(within(dialog).getByText('Choose a broad trait category.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a trait.')).toBeInTheDocument();
    expect(curation.createRecords).not.toHaveBeenCalled();
  });

  it('RFC-13 R6 asks for at least one level, and clears the message once one is ticked', async () => {
    mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await openFixed();
    await userEvent.click(submit(dialog));
    expect(within(dialog).getByText('Choose at least one level.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'dioecious' }));
    expect(within(dialog).queryByText('Choose at least one level.')).not.toBeInTheDocument();
    expect(curation.createRecords).not.toHaveBeenCalled();
  });

  it('RFC-13 R6 asks for one of single, min, max or mean before sending a quantitative claim', async () => {
    mount({ initialTrait: DICTIONARY_SEED_MASS });
    const dialog = await openFixed('Add entries for seed mass (mg)');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'SD (mg)' }), '1');
    await userEvent.click(submit(dialog));
    expect(
      within(dialog).getByText('Enter at least one of single, min, max or mean.'),
    ).toBeInTheDocument();
    expect(curation.createRecords).not.toHaveBeenCalled();
  });

  it('RFC-13 R6 shows an API field error under the field its path names', async () => {
    curation.createRecords.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Request validation failed', [
        { path: 'value.quantitative.single', message: 'Number is out of range' },
        { path: 'traitId', message: 'Trait is inactive' },
      ]),
    );
    mount({ initialTrait: DICTIONARY_SEED_MASS });
    const dialog = await openFixed('Add entries for seed mass (mg)');
    await userEvent.type(
      within(dialog).getByRole('spinbutton', { name: 'Single value (mg)' }),
      '1',
    );
    await userEvent.click(submit(dialog));
    expect(
      await within(dialog).findByRole('spinbutton', { name: 'Single value (mg)' }),
    ).toHaveAccessibleDescription(expect.stringContaining('Number is out of range'));
    expect((await within(dialog).findByText('Trait is inactive')).tagName).toBe('P');
  });

  it('RFC-13 R6 says a fixed trait has no level to choose from', async () => {
    dataset.fetchDictionary.mockResolvedValue([]);
    mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    expect(
      await within(dialog).findByText('This trait has no level to choose from.'),
    ).toBeInTheDocument();
  });
});

describe('spec §2 item 2.1 AddEntriesDialog intent first', () => {
  it('asks Contest or Complement first when records exist, and keeps everything else shut until answered', async () => {
    dataset.fetchRecords.mockResolvedValue(page([EXISTING]));
    mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    const intent = await within(dialog).findByRole('group', { name: 'What does your value mean?' });
    expect(
      within(intent).getByText(
        'This species already has records for this trait. Say first what your value means, and which value it answers.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'dioecious' })).toBeDisabled();
    expect(submit(dialog)).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('radio', { name: COMPLEMENT_LABEL }));
    expect(submit(dialog)).toBeDisabled();
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Responding to' }),
      'hermaphrodite',
    );
    expect(within(dialog).getByRole('checkbox', { name: 'dioecious' })).toBeEnabled();
    expect(submit(dialog)).toBeEnabled();
  });

  it('comes pre-answered from a level: contest, responding to a record of that level', async () => {
    dataset.fetchRecords.mockResolvedValue(page([EXISTING]));
    curation.createRecords.mockResolvedValue(CREATED);
    mount({
      initialTrait: DICTIONARY_SEXUAL_SYSTEM,
      respondTo: { intent: 'contest', levelId: HERMAPHRODITE },
    });
    const dialog = await openFixed();
    expect(within(dialog).getByRole('radio', { name: CONTEST_LABEL })).toBeChecked();
    expect(within(dialog).getByRole('combobox', { name: 'Responding to' })).toHaveValue(
      HERMAPHRODITE,
    );
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'dioecious' }));
    await userEvent.click(submit(dialog));
    await waitFor(() =>
      expect(curation.createRecords).toHaveBeenCalledWith(
        expect.objectContaining({
          value: { levelIds: [DIOECIOUS] },
          intent: 'contest',
          respondsToRecordId: EXISTING.id,
        }),
      ),
    );
  });

  it('comes pre-answered from a quantitative row, naming the record by its ID', async () => {
    dataset.fetchRecords.mockResolvedValue(page([EXISTING_MASS]));
    curation.createRecords.mockResolvedValue(CREATED);
    mount({
      initialTrait: DICTIONARY_SEED_MASS,
      respondTo: { intent: 'complement', recordId: EXISTING_MASS.id },
    });
    const dialog = await openFixed('Add entries for seed mass (mg)');
    const target = within(dialog).getByRole('combobox', { name: 'Responding to' });
    expect(target).toHaveValue(EXISTING_MASS.id);
    expect(within(target).getByRole('option', { name: 'TR_4 · 1.25 mg' })).toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByRole('spinbutton', { name: 'Single value (mg)' }),
      '2',
    );
    await userEvent.click(submit(dialog));
    await waitFor(() =>
      expect(curation.createRecords).toHaveBeenCalledWith(
        expect.objectContaining({ intent: 'complement', respondsToRecordId: EXISTING_MASS.id }),
      ),
    );
  });
});

describe('RFC-70 R3 AddEntriesDialog result (R-7)', () => {
  it('stays open and names what was added, what counted as a validation and what was a duplicate', async () => {
    curation.createRecords.mockResolvedValue({
      created: [{ ...RECORD_DETAIL, recordCode: 'TR_9' }],
      validated: [{ recordId: EXISTING.id, recordCode: 'EB_3' }],
      duplicates: [{ recordId: EXISTING_MASS.id, recordCode: 'TR_4' }],
    });
    const { onCreated, onOpenRecord } = mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await openFixed();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'dioecious' }));
    await userEvent.click(submit(dialog));
    const items = await within(dialog).findAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'TR_9 was added.',
      'EB_3 matches an existing record — counted as your validation.',
      'TR_4 is already your own record — nothing was added.',
    ]);
    expect(onCreated).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'EB_3' }));
    expect(onOpenRecord).toHaveBeenCalledWith(EXISTING.id);
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Sync, then `docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/components/curation/AddEntriesDialog.test.tsx`.
Expected: FAIL. There is no `Levels` group (still the old `ValueField` usage), `fetchRecords` is not called, and no intent step or result list exists.

- [ ] **Step 3: Implement**

Replace `apps/web/src/components/curation/AddEntriesDialog.tsx` entirely:

```tsx
import { useQuery } from '@tanstack/react-query';
import {
  type CreateRecordBody,
  type CreateRecordsResult,
  createRecordBodySchema,
  type RecordIntent,
  type RecordItem,
  type TraitRef,
} from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { createRecords } from '../../api/curation.ts';
import { datasetKeys, fetchDictionary, fetchRecords } from '../../api/dataset.ts';
import { helpHref } from '../../content/help/href.ts';
import { categoriesWithActiveTraits, traitDescription } from '../../lib/dictionary.ts';
import { fieldErrors } from '../../lib/errors.ts';
import { humaniseKey } from '../../lib/format.ts';
import { useMe } from '../../lib/session.ts';
import { useRecordWrite } from '../../lib/use-record-write.ts';
import { recordValueLabel } from '../dataset/RecordTable.tsx';
import { Alert, Button, Dialog, Field, HelpTip, Select } from '../ui/index.ts';
import { contributionErrorMessage, SOURCES_NOT_READY } from './errors.ts';
import { EMPTY_SOURCES, SourcesField, type SourcesValue, sourcesToBody } from './SourcesField.tsx';
import {
  EMPTY_QUANTITATIVE,
  type QuantitativeText,
  quantitativeToBody,
  ValueField,
} from './ValueField.tsx';

const TITLE = 'Add entries for another trait';
// The API's page ceiling (RFC-11 R6): every value one species holds for one
// trait, in practice.
const EXISTING_LIMIT = 200;
// A hint, not the rule: the API validates the quantitative value (R-5).
const ANCHORS = ['single', 'min', 'max', 'mean'] as const;
const MESSAGES = {
  categoryKey: 'Choose a broad trait category.',
  traitId: 'Choose a trait.',
  respondsTo: 'Choose the value you respond to.',
  levelIds: 'Choose at least one level.',
  quantitative: 'Enter at least one of single, min, max or mean.',
  value: 'Check the value.',
};
const EXISTING_NOTE =
  'This species already has records for this trait. Say first what your value means, and which value it answers.';
const LEGEND = 'text-label font-bold uppercase tracking-[0.08em] text-canopy-800';

/** The two things a new value can mean about the value it answers (R-8). */
const INTENTS: ReadonlyArray<{ value: RecordIntent; label: string; example: string }> = [
  {
    value: 'contest',
    label: 'Contest — The existing value is wrong; mine should replace it.',
    example: 'Existing: biotic; yours: abiotic — the mode is abiotic, not biotic.',
  },
  {
    value: 'complement',
    label: 'Complement — The existing value is also correct; I am adding another observation.',
    example: 'Existing: biotic; yours: abiotic — it can be both.',
  },
];

/** The trait as the select reads it: its name, and its unit when it has one. */
function traitLabel(trait: Pick<TraitRef, 'key' | 'unit'>): string {
  return trait.unit ? `${humaniseKey(trait.key)} (${trait.unit})` : humaniseKey(trait.key);
}

/**
 * What an entry answers, when the caller already knows: the intent (👎 is
 * `contest`, ＋ is `complement`) and the value — a level of a categorical
 * trait, a record of a quantitative one, or both from the record drawer.
 * @rfc RFC-70 R1
 */
export interface RespondTo {
  intent?: RecordIntent;
  levelId?: string;
  recordId?: string;
}

// The values an entry can answer: each level once for a categorical trait
// (a contest applies to every record of its level, R-8), each record for a
// quantitative one.
function respondableTargets(
  records: RecordItem[],
  categorical: boolean,
): { value: string; label: string }[] {
  if (!categorical) {
    return records.map((record) => ({
      value: record.id,
      label: `${record.recordCode} · ${recordValueLabel(record)}`,
    }));
  }
  const levels = new Map<string, string>();
  for (const record of records) {
    if (record.level && !levels.has(record.level.id)) levels.set(record.level.id, record.level.key);
  }
  return [...levels].map(([value, label]) => ({ value, label }));
}

function CodeButton({ id, code, onOpen }: { id: string; code: string; onOpen(id: string): void }) {
  return (
    <button
      type="button"
      className="font-semibold text-canopy-900 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
      onClick={() => onOpen(id)}
    >
      {code}
    </button>
  );
}

/** @rfc RFC-70 R1, R3 */
export interface AddEntriesDialogProps {
  speciesId: string;
  /** The trait a card, a row or the drawer opened the dialog for; the selects are then fixed. */
  initialTrait?: TraitRef | null;
  /** The answer 👎 / ＋ / the drawer already gave; see {@link RespondTo}. */
  respondTo?: RespondTo | null;
  onClose(): void;
  /** The API's answer, once every stale query is invalidated — only when nothing matched an existing record. */
  onCreated(result: CreateRecordsResult): void;
  onOpenRecord(id: string): void;
}

/**
 * The one entry form of the species page (spec §2): the broad category and
 * the trait within it (fixed and read as one line when a card, a row or the
 * drawer opened it), then — when the species already has records for the
 * trait — a required first step: **Contest** or **Complement**, and which
 * existing value it answers. Every other field and the submit button stay
 * disabled until both are answered (item 2.1), and while the existing records
 * load. Then the value: one checkbox per level, several allowed (R-3), or the
 * six quantitative numbers (R-5); and the sources: DOIs, ISBNs with their
 * citation, or none for a personal observation (R-4, R-16).
 *
 * For a categorical trait the record sent as `respondsToRecordId` is the one
 * the drawer opened when it has the chosen level, else the first loaded
 * record of that level — equivalent, since a contest applies to every record
 * of its level (R-8). The API decides duplicates (R-7): an answer carrying
 * `validated` or `duplicates` keeps the dialog open to name every record ID
 * it touched, each opening its record; any other answer goes to `onCreated`.
 * @rfc RFC-13 R6, R10, R11
 * @rfc RFC-65 R1
 * @rfc RFC-70 R1, R2, R3
 */
export function AddEntriesDialog({
  speciesId,
  initialTrait = null,
  respondTo = null,
  onClose,
  onCreated,
  onOpenRecord,
}: AddEntriesDialogProps) {
  const me = useMe();
  const baseId = useId();
  const ids = {
    category: `${baseId}-category`,
    trait: `${baseId}-trait`,
    target: `${baseId}-target`,
    value: `${baseId}-value`,
  };
  const dictionary = useQuery({
    queryKey: datasetKeys.dictionary(),
    queryFn: () => fetchDictionary(),
  });
  const categories = categoriesWithActiveTraits(dictionary.data ?? []);

  const [categoryKey, setCategoryKey] = useState('');
  const [traitId, setTraitId] = useState(initialTrait?.id ?? '');
  const [intent, setIntent] = useState<RecordIntent | null>(respondTo?.intent ?? null);
  const [target, setTarget] = useState(() =>
    initialTrait?.valueType === 'categorical'
      ? (respondTo?.levelId ?? '')
      : (respondTo?.recordId ?? ''),
  );
  const [levelIds, setLevelIds] = useState<string[]>([]);
  const [quantitative, setQuantitative] = useState<QuantitativeText>(EMPTY_QUANTITATIVE);
  const [sources, setSources] = useState<SourcesValue>(EMPTY_SOURCES);
  // A blank field is a personal observation, which is ready as it stands.
  const [sourcesReady, setSourcesReady] = useState(true);
  const [local, setLocal] = useState<Record<string, string>>({});
  const [answered, setAnswered] = useState<CreateRecordsResult | null>(null);

  // A fixed trait brings its own category: the one it sits in.
  const category = initialTrait
    ? categories.find((c) => c.traits.some((t) => t.id === initialTrait.id))
    : categories.find((c) => c.key === categoryKey);
  const traits = category?.traits ?? [];
  const trait = traits.find((t) => t.id === traitId);
  const levels = trait?.levels ?? [];
  const activeLevels = levels.filter((level) => level.active);
  const valueType = trait?.valueType ?? initialTrait?.valueType;
  const unit = trait?.unit ?? initialTrait?.unit ?? null;
  const description = traitDescription(dictionary.data, traitId);
  const title = initialTrait ? `Add entries for ${traitLabel(initialTrait)}` : TITLE;

  const existing = useQuery({
    queryKey: datasetKeys.records({ speciesId, traitId, limit: EXISTING_LIMIT }),
    queryFn: () => fetchRecords({ speciesId, traitId, limit: EXISTING_LIMIT }),
    enabled: traitId !== '',
  });
  const records = existing.data?.data ?? [];
  const needsIntent = records.length > 0;
  const locked =
    traitId !== '' &&
    (existing.isPending || existing.isError || (needsIntent && (intent === null || target === '')));
  const targets = respondableTargets(records, valueType === 'categorical');

  const save = useRecordWrite<CreateRecordBody, CreateRecordsResult>({
    write: createRecords,
    speciesId,
    onInvalidated: (result) => {
      if (result.validated.length === 0 && result.duplicates.length === 0) onCreated(result);
      else setAnswered(result);
    },
  });

  const errors: Record<string, string | undefined> = { ...fieldErrors(save.error), ...local };
  const valueErrors: Record<string, string> = {};
  const sourceErrors: Record<string, string> = {};
  for (const [path, message] of Object.entries(errors)) {
    if (message === undefined) continue;
    if (path === 'value' || path.startsWith('value.')) valueErrors[path] = message;
    if (path === 'sources' || path.startsWith('sources.')) sourceErrors[path] = message;
  }
  const alertMessage =
    local.form ?? (save.isError ? contributionErrorMessage(save.error) : undefined);

  // A new trait (or category) starts the answer and the value over: they
  // belonged to the old one.
  function resetAnswer() {
    setIntent(null);
    setTarget('');
    setLevelIds([]);
    setQuantitative(EMPTY_QUANTITATIVE);
  }
  function chooseCategory(key: string) {
    setCategoryKey(key);
    setTraitId('');
    resetAnswer();
    setLocal(({ categoryKey: _categoryKey, traitId: _traitId, ...rest }) => rest);
  }
  function chooseTrait(id: string) {
    setTraitId(id);
    resetAnswer();
    setLocal(({ traitId: _traitId, ...rest }) => rest);
  }
  function chooseIntent(next: RecordIntent) {
    setIntent(next);
    save.reset();
  }
  function chooseTarget(value: string) {
    setTarget(value);
    setLocal(({ respondsTo: _respondsTo, ...rest }) => rest);
  }
  function changeLevels(next: string[]) {
    setLevelIds(next);
    setLocal(({ 'value.levelIds': _levelIds, value: _value, ...rest }) => rest);
  }
  function changeQuantitative(next: QuantitativeText) {
    setQuantitative(next);
    setLocal(({ 'value.quantitative': _quantitative, value: _value, ...rest }) => rest);
  }

  function respondsToRecordId(): string | undefined {
    if (valueType !== 'categorical') return target === '' ? undefined : target;
    if (respondTo?.recordId && respondTo.levelId === target) return respondTo.recordId;
    return records.find((record) => record.level?.id === target)?.id;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const required: Record<string, string> = {};
    if (!initialTrait && categoryKey === '') required.categoryKey = MESSAGES.categoryKey;
    if (traitId === '') required.traitId = MESSAGES.traitId;
    if (valueType === 'categorical' && levelIds.length === 0) {
      required['value.levelIds'] = MESSAGES.levelIds;
    }
    if (valueType === 'quantitative' && ANCHORS.every((key) => quantitative[key].trim() === '')) {
      required['value.quantitative'] = MESSAGES.quantitative;
    }
    const respondsTo = needsIntent ? respondsToRecordId() : undefined;
    if (needsIntent && respondsTo === undefined) required.respondsTo = MESSAGES.respondsTo;
    if (!sourcesReady) required.form = SOURCES_NOT_READY;
    if (Object.keys(required).length > 0) {
      save.reset();
      setLocal(required);
      return;
    }

    const candidate = {
      speciesId,
      traitId,
      value:
        valueType === 'quantitative'
          ? { quantitative: quantitativeToBody(quantitative) }
          : { levelIds },
      sources: sourcesToBody(sources),
      ...(intent && respondsTo ? { intent, respondsToRecordId: respondsTo } : {}),
    };
    const parsed = createRecordBodySchema.safeParse(candidate);
    if (!parsed.success) {
      save.reset();
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.');
        next[path] = path === 'value' ? MESSAGES.value : issue.message;
      }
      setLocal(next);
      return;
    }
    setLocal({});
    save.mutate(parsed.data);
  }

  if (answered) {
    return (
      <Dialog open title={title} onClose={onClose}>
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2 text-body text-canopy-900">
            {answered.created.map((record) => (
              <li key={`created-${record.id}`}>
                <CodeButton id={record.id} code={record.recordCode} onOpen={onOpenRecord} /> was
                added.
              </li>
            ))}
            {answered.validated.map((match) => (
              <li key={`validated-${match.recordId}`}>
                <CodeButton id={match.recordId} code={match.recordCode} onOpen={onOpenRecord} />{' '}
                matches an existing record — counted as your validation.
              </li>
            ))}
            {answered.duplicates.map((match) => (
              <li key={`duplicate-${match.recordId}`}>
                <CodeButton id={match.recordId} code={match.recordCode} onOpen={onOpenRecord} /> is
                already your own record — nothing was added.
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open title={title} onClose={onClose} closeDisabled={save.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {initialTrait ? (
          <div className="flex flex-col gap-1">
            <p className="text-body text-canopy-900">
              <span className="text-mist-500">Trait: </span>
              {[category?.label, traitLabel({ key: initialTrait.key, unit })]
                .filter((part) => part !== undefined)
                .join(' › ')}{' '}
              {description ? (
                <HelpTip
                  label="What does this trait mean?"
                  learnMore={helpHref('vocabulary', 'descriptions')}
                >
                  {description}
                </HelpTip>
              ) : null}
            </p>
            {errors.traitId ? <p className="text-label text-red-700">{errors.traitId}</p> : null}
          </div>
        ) : (
          <>
            <Field
              id={ids.category}
              label="Broad trait category"
              error={errors.categoryKey}
              hint={dictionary.isError ? 'Could not load the dictionary.' : undefined}
            >
              <Select
                id={ids.category}
                value={categoryKey}
                onChange={(e) => chooseCategory(e.target.value)}
                invalid={Boolean(errors.categoryKey)}
              >
                <option value="">Choose a category</option>
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id={ids.trait}
              label="Trait"
              error={errors.traitId}
              trailing={
                description ? (
                  <HelpTip
                    label="What does this trait mean?"
                    learnMore={helpHref('vocabulary', 'descriptions')}
                  >
                    {description}
                  </HelpTip>
                ) : undefined
              }
            >
              <Select
                id={ids.trait}
                value={traitId}
                disabled={category === undefined}
                onChange={(e) => chooseTrait(e.target.value)}
                invalid={Boolean(errors.traitId)}
              >
                <option value="">Choose a trait</option>
                {traits.map((t) => (
                  <option key={t.id} value={t.id}>
                    {traitLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        {traitId !== '' && existing.isPending ? (
          <p className="text-meta text-mist-500">Checking the existing records…</p>
        ) : null}
        {existing.isError ? (
          <p className="text-meta text-red-700">
            Could not load the existing records. Reload the page.
          </p>
        ) : null}

        {needsIntent ? (
          <fieldset className="flex flex-col gap-3">
            <legend className={LEGEND}>What does your value mean?</legend>
            <p className="text-meta text-mist-500">{EXISTING_NOTE}</p>
            {INTENTS.map((option) => {
              const exampleId = `${baseId}-${option.value}-example`;
              return (
                <div key={option.value} className="flex flex-col gap-0.5">
                  <label className="flex items-start gap-2 text-body text-canopy-950">
                    <input
                      type="radio"
                      name={`${baseId}-intent`}
                      value={option.value}
                      checked={intent === option.value}
                      aria-describedby={exampleId}
                      onChange={() => chooseIntent(option.value)}
                      className="mt-1 size-4 accent-canopy-700"
                    />
                    <span>{option.label}</span>
                  </label>
                  <p id={exampleId} className="pl-6 text-meta text-mist-500">
                    {option.example}
                  </p>
                </div>
              );
            })}
            <Field id={ids.target} label="Responding to" error={errors.respondsTo}>
              <Select
                id={ids.target}
                value={target}
                onChange={(e) => chooseTarget(e.target.value)}
                invalid={Boolean(errors.respondsTo)}
              >
                <option value="">Choose the value you respond to</option>
                {targets.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </fieldset>
        ) : null}

        <fieldset disabled={locked} className="flex flex-col gap-4">
          <legend className="sr-only">Your record</legend>
          {valueType ? (
            <ValueField
              trait={{ valueType, unit, levels }}
              levelIds={levelIds}
              quantitative={quantitative}
              onLevels={changeLevels}
              onQuantitative={changeQuantitative}
              errors={valueErrors}
              idPrefix={ids.value}
            />
          ) : null}
          {valueType === 'categorical' && activeLevels.length === 0 && !dictionary.isPending ? (
            <p className="text-meta text-red-700">
              {dictionary.isError
                ? 'Could not load the levels. Reload the page.'
                : 'This trait has no level to choose from.'}
            </p>
          ) : null}
          <SourcesField
            value={sources}
            onChange={setSources}
            errors={sourceErrors}
            onValidity={setSourcesReady}
          />
          <p className="text-meta text-mist-500">Recorded as {me.user.name}</p>
        </fieldset>

        {alertMessage ? <Alert tone="error">{alertMessage}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending} disabled={locked}>
            Add record(s)
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the test and see it pass**

Sync, then `docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/components/curation/AddEntriesDialog.test.tsx`.
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/components/curation/AddEntriesDialog.tsx apps/web/src/components/curation/AddEntriesDialog.test.tsx
git commit -m "feat(web): one entry dialog — contest or complement first, several levels, validated and duplicate results (RFC-70 R1, R3)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `RecordActions` and `RecordDrawer`; delete `ContestDialog` and `ReviewBadge`

**Files:**
- Rewrite: `apps/web/src/components/curation/RecordActions.tsx`, `apps/web/src/components/curation/RecordActions.test.tsx`
- Modify: `apps/web/src/components/dataset/RecordDrawer.tsx`, `apps/web/src/components/dataset/RecordDrawer.test.tsx`
- Modify: `apps/web/src/pages/dataset/SpeciesPage.test.tsx` (one line)
- Delete: `apps/web/src/components/curation/ContestDialog.tsx`, `apps/web/src/components/curation/ContestDialog.test.tsx`, `apps/web/src/components/dataset/ReviewBadge.tsx`, `apps/web/src/components/dataset/ReviewBadge.test.tsx`

**Interfaces:**
- Consumes: `ValidateDialog` (Task 5), `AddEntriesDialog` + `RespondTo` (Task 6), `annotateRecord` with the 13g body, `ConfirmDialog`, permission `records.withdraw_imported` (13g).
- Produces:

```ts
export function actionErrorMessage(error: unknown): string;
export function RecordActions(props: { record: RecordDetail; onOpenRecord?: (id: string) => void;
  onWithdrawn?: () => void }): JSX.Element | null;
```

The drawer's actions become 👍 **Validate** (opens `ValidateDialog`, hidden on the viewer's own record, disabled with "You validated this record" once they have), 👎 **Contest** and ＋ **Complement** (open `AddEntriesDialog` pre-answered with this record), and **Withdraw** (a `ConfirmDialog`, no note). Withdraw is visible to the author, to `records.withdraw` holders on a manual record and to `records.withdraw_imported` holders on an imported one (R-12). Neutral, Dispute and the withdrawn branch are gone (R-11, R-13).

- [ ] **Step 1: Write the failing tests**

Replace `apps/web/src/components/curation/RecordActions.test.tsx` entirely:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordDetail } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  DICTIONARY,
  DICTIONARY_SEXUAL_SYSTEM,
  RECORD_DETAIL,
  RESPONDED_RECORD_DETAIL,
} from '../../test/dataset-fixtures.ts';
import { ME, USER } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { withRouter } from '../../test/router.tsx';
import { RecordActions } from './RecordActions.tsx';

const curation = vi.hoisted(() => ({
  annotateRecord: vi.fn(),
  createRecords: vi.fn(),
  resolveDoi: vi.fn(),
  invalidateAfterRecordWrite: vi.fn(async () => undefined),
}));
const dataset = vi.hoisted(() => ({ fetchDictionary: vi.fn(), fetchRecords: vi.fn() }));
vi.mock('../../api/curation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/curation.ts')>()),
  ...curation,
}));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

const perms = (...keys: string[]) => ({ ...ME, permissions: keys }) as never;
const CONTRIBUTOR = perms('dataset.read', 'records.annotate', 'records.create');
const HERMAPHRODITE = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e11';
const CONTEST_LABEL = 'Contest — The existing value is wrong; mine should replace it.';

// A manual record by someone else, on the dictionary's trait.
const THEIRS: RecordDetail = {
  ...RECORD_DETAIL,
  recordCode: 'TR_5',
  origin: 'manual',
  trait: DICTIONARY_SEXUAL_SYSTEM,
  level: { id: HERMAPHRODITE, key: 'hermaphrodite' },
  valueText: 'hermaphrodite',
  annotations: [],
  createdBy: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9f', name: 'Grace' },
};
const MINE: RecordDetail = { ...THEIRS, createdBy: { id: USER.id, name: USER.name } };
const IMPORTED: RecordDetail = { ...THEIRS, origin: 'import', createdBy: null };
// THEIRS once the viewer validated it: every annotation of the shared
// fixture, re-signed as the viewer's `confirm`.
const VALIDATED: RecordDetail = {
  ...THEIRS,
  annotations: RESPONDED_RECORD_DETAIL.annotations.map((annotation) => ({
    ...annotation,
    kind: 'confirm' as const,
    actor: { id: USER.id, name: USER.name },
  })),
};

beforeEach(() => {
  curation.annotateRecord.mockReset().mockResolvedValue(THEIRS);
  curation.createRecords.mockReset();
  curation.resolveDoi.mockReset();
  curation.invalidateAfterRecordWrite.mockClear();
  dataset.fetchDictionary.mockReset().mockResolvedValue(DICTIONARY);
  dataset.fetchRecords.mockReset().mockResolvedValue({ data: [THEIRS], meta: { nextCursor: null } });
});

function mount(record: RecordDetail, me: never, props: { onWithdrawn?: () => void } = {}) {
  renderWithProviders(withRouter(<RecordActions record={record} {...props} />), { me });
}

describe('spec §2 RecordActions by permission', () => {
  it('renders nothing without records.annotate', async () => {
    mount(THEIRS, perms('dataset.read'));
    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument());
  });

  it('gives a contributor Validate, Contest and Complement on someone else’s record, and no Withdraw', async () => {
    mount(THEIRS, CONTRIBUTOR);
    expect(await screen.findByRole('button', { name: 'Validate' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Contest' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complement' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    for (const gone of ['Neutral', 'Dispute', 'Set as accepted']) {
      expect(screen.queryByRole('button', { name: gone })).not.toBeInTheDocument();
    }
  });

  it('withholds Contest and Complement without records.create', async () => {
    mount(THEIRS, perms('dataset.read', 'records.annotate'));
    expect(await screen.findByRole('button', { name: 'Validate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Contest' })).not.toBeInTheDocument();
  });

  it('R-6 offers no Validate on the viewer’s own record, which they may withdraw', async () => {
    mount(MINE, CONTRIBUTOR);
    expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Validate' })).not.toBeInTheDocument();
  });

  it('R-6 is out of reach once the viewer validated, and says why', async () => {
    mount(VALIDATED, CONTRIBUTOR);
    const validate = await screen.findByRole('button', { name: 'Validate' });
    expect(validate).toBeDisabled();
    expect(validate).toHaveAccessibleDescription('You validated this record');
  });

  it('R-12 offers Withdraw by origin: records.withdraw for manual, records.withdraw_imported for imported', async () => {
    const withdraw = perms('dataset.read', 'records.annotate', 'records.withdraw');
    const imported = perms('dataset.read', 'records.annotate', 'records.withdraw_imported');
    const first = renderWithProviders(withRouter(<RecordActions record={THEIRS} />), { me: withdraw });
    expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    first.unmount();
    const second = renderWithProviders(withRouter(<RecordActions record={IMPORTED} />), {
      me: withdraw,
    });
    await screen.findByRole('button', { name: 'Validate' });
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    second.unmount();
    renderWithProviders(withRouter(<RecordActions record={IMPORTED} />), { me: imported });
    expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });
});

describe('RFC-70 R4 RecordActions validate', () => {
  it('asks the question, then confirms the record as it stands', async () => {
    mount(THEIRS, CONTRIBUTOR);
    await userEvent.click(await screen.findByRole('button', { name: 'Validate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Validate TR_5' });
    expect(
      within(dialog).getByText('Do you confirm that this record is correct?'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Validate' }));
    await waitFor(() =>
      expect(curation.annotateRecord).toHaveBeenCalledWith(THEIRS.id, { kind: 'confirm' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Validate TR_5' })).not.toBeInTheDocument(),
    );
  });
});

describe('RFC-70 R1 RecordActions contest and complement', () => {
  it('opens the entry dialog already answered: contest, responding to this record’s level', async () => {
    mount(THEIRS, CONTRIBUTOR);
    await userEvent.click(await screen.findByRole('button', { name: 'Contest' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    expect(await within(dialog).findByRole('radio', { name: CONTEST_LABEL })).toBeChecked();
    expect(within(dialog).getByRole('combobox', { name: 'Responding to' })).toHaveValue(
      HERMAPHRODITE,
    );
  });
});

describe('R-12 RecordActions withdraw', () => {
  it('asks for confirmation only, then withdraws and hands back', async () => {
    const onWithdrawn = vi.fn();
    mount(MINE, CONTRIBUTOR, { onWithdrawn });
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw this record?' });
    expect(
      within(dialog).getByText(
        'The record leaves the dataset for every viewer. It stays in the database for audit only.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(onWithdrawn).toHaveBeenCalled());
    expect(curation.annotateRecord).toHaveBeenCalledWith(MINE.id, { kind: 'withdraw' });
  });

  it('RFC-13 R6 maps a refusal to a sentence and stays open', async () => {
    curation.annotateRecord.mockRejectedValue(new ApiError(403, 'RECORD_NOT_WITHDRAWABLE', 'x'));
    mount(MINE, CONTRIBUTOR);
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw this record?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    expect(
      await within(dialog).findByText('You may not withdraw this record.'),
    ).toBeInTheDocument();
  });
});
```

`apps/web/src/components/dataset/RecordDrawer.test.tsx`:
- Add `waitFor` to the `@testing-library/react` import.
- Below the `dataset` mock, add:

```ts
const curation = vi.hoisted(() => ({
  annotateRecord: vi.fn(),
  invalidateAfterRecordWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/curation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/curation.ts')>()),
  ...curation,
}));
```

- In the first test, replace `screen.getByRole('button', { name: '✓ Validate' })` with `screen.getByRole('button', { name: 'Validate' })`.
- Delete the whole test `it('still lists the responses of a withdrawn record, which has no actions left', …)`.
- Append:

```ts
describe('spec §2 RecordDrawer record ID and contested flag', () => {
  it('names the record by its ID and flags it Contested (R-2, R-9)', async () => {
    dataset.fetchRecord.mockResolvedValue({ ...RECORD_DETAIL, recordCode: 'EB_42', contested: true });
    renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={() => undefined} />, {
      ...ME,
      permissions: ['dataset.read'],
    });
    expect(await screen.findByText('Record ID')).toBeInTheDocument();
    expect(screen.getByText('Record ID').nextElementSibling).toHaveTextContent('EB_42');
    expect(screen.getByText('Contested')).toBeInTheDocument();
  });
});

describe('R-13 RecordDrawer withdrawal', () => {
  it('closes once the author confirmed the withdrawal: the record has left the dataset', async () => {
    const mine = {
      ...RECORD_DETAIL,
      origin: 'manual' as const,
      createdBy: { id: ME.user.id, name: ME.user.name },
    };
    dataset.fetchRecord.mockResolvedValue(mine);
    curation.annotateRecord.mockResolvedValue(mine);
    const onClose = vi.fn();
    renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={onClose} />, {
      ...ME,
      permissions: ['dataset.read', 'records.annotate'],
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const confirm = await screen.findByRole('dialog', { name: 'Withdraw this record?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(curation.annotateRecord).toHaveBeenCalledWith(RECORD_DETAIL.id, { kind: 'withdraw' });
  });
});
```

`apps/web/src/pages/dataset/SpeciesPage.test.tsx`: in "opens the record drawer from a row…", delete `expect(within(drawer).getByText('confirmed')).toBeInTheDocument();`.

- [ ] **Step 2: Run the tests and see them fail**

Sync, then:

```sh
docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/components/curation/RecordActions.test.tsx src/components/dataset/RecordDrawer.test.tsx
```

Expected: FAIL. The buttons are still named "✓ Validate" / "+ Add different record", there is no "Contest" button, no "Record ID" row, and Withdraw opens a note form.

- [ ] **Step 3: Implement**

Replace `apps/web/src/components/curation/RecordActions.tsx` entirely:

```tsx
import type { RecordDetail, RecordIntent } from '@treerepro/contracts';
import { useId, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { annotateRecord } from '../../api/curation.ts';
import { helpHref } from '../../content/help/href.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { useRecordWrite } from '../../lib/use-record-write.ts';
import { DrawerSection } from '../dataset/DrawerSection.tsx';
import { Button, ConfirmDialog, HelpTip } from '../ui/index.ts';
import { AddEntriesDialog } from './AddEntriesDialog.tsx';
import { contributionErrorMessage } from './errors.ts';
import { ValidateDialog } from './ValidateDialog.tsx';

/**
 * The sentence a record action shows for an API refusal, falling back to the
 * contribution map.
 * @rfc RFC-13 R6
 */
export function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'RECORD_NOT_WITHDRAWABLE':
        return 'You may not withdraw this record.';
      case 'RECORD_NOT_FOUND':
        return 'This record no longer exists.';
    }
  }
  return contributionErrorMessage(error);
}

const VALIDATE_HELP =
  'Records that you agree with this value as it stands. Nothing is changed; your validation is attached to the record.';
const RESPOND_HELP =
  'Contest: the value is wrong, and you add the one you believe is right. Complement: the value is right, and you add another one. Either way you add a record of your own.';
const WITHDRAW_MESSAGE =
  'The record leaves the dataset for every viewer. It stays in the database for audit only.';

type Open = 'validate' | 'withdraw' | RecordIntent;

/**
 * What a viewer can do with one record (spec §2), the same three decisions
 * the page legend names:
 * - 👍 **Validate** opens {@link ValidateDialog} and posts a `confirm`. It is
 *   hidden on the viewer's own record and disabled once they validated it
 *   (R-6).
 * - 👎 **Contest** and ＋ **Complement** open {@link AddEntriesDialog} already
 *   answered with this record, since a different value is a record of its
 *   own and needs `records.create`.
 * - **Withdraw** only asks for confirmation, with no note (R-12). It is shown
 *   to the author, to `records.withdraw` holders on a manual record and to
 *   `records.withdraw_imported` holders on an imported one, and hands back
 *   through `onWithdrawn` once done, because a withdrawn record leaves the
 *   dataset (R-13).
 *
 * Everything needs `records.annotate`. The API remains the authority on
 * every one of these (RFC-13 R3).
 * @rfc RFC-13 R3, R6, R11
 * @rfc RFC-65 R3, R4
 * @rfc RFC-70 R1, R4
 */
export function RecordActions({
  record,
  onOpenRecord,
  onWithdrawn,
}: {
  record: RecordDetail;
  /** Opens another record in the drawer this section sits in; the new record after an entry. */
  onOpenRecord?: (id: string) => void;
  /** Runs once a withdrawal is written and every stale query invalidated. */
  onWithdrawn?: () => void;
}) {
  const me = useMe();
  const validatedId = useId();
  const [open, setOpen] = useState<Open | null>(null);
  const withdraw = useRecordWrite<void, unknown>({
    write: () => annotateRecord(record.id, { kind: 'withdraw' }),
    speciesId: record.speciesId,
    onInvalidated: () => {
      setOpen(null);
      onWithdrawn?.();
    },
  });

  if (!hasPermission(me, 'records.annotate')) return null;
  const isAuthor = record.createdBy?.id === me.user.id;
  const validated = record.annotations.some(
    (annotation) => annotation.kind === 'confirm' && annotation.actor.id === me.user.id,
  );
  const canRespond = hasPermission(me, 'records.create');
  const canWithdraw =
    isAuthor ||
    hasPermission(
      me,
      record.origin === 'manual' ? 'records.withdraw' : 'records.withdraw_imported',
    );

  return (
    <DrawerSection title="Actions">
      <div className="flex flex-wrap items-center gap-2">
        {isAuthor ? null : (
          <>
            <Button
              size="sm"
              disabled={validated}
              aria-describedby={validated ? validatedId : undefined}
              onClick={() => setOpen('validate')}
            >
              <span aria-hidden="true">👍</span> Validate
            </Button>
            <HelpTip label="What does Validate mean?" learnMore={helpHref('workflow', 'validate')}>
              {VALIDATE_HELP}
            </HelpTip>
            {validated ? (
              <span id={validatedId} className="text-meta text-mist-500">
                You validated this record
              </span>
            ) : null}
          </>
        )}
        {canRespond ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen('contest')}>
              <span aria-hidden="true">👎</span> Contest
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setOpen('complement')}>
              <span aria-hidden="true">＋</span> Complement
            </Button>
            <HelpTip
              label="What do Contest and Complement mean?"
              learnMore={helpHref('workflow', 'different')}
            >
              {RESPOND_HELP}
            </HelpTip>
          </>
        ) : null}
        {canWithdraw ? (
          <Button variant="danger" size="sm" onClick={() => setOpen('withdraw')}>
            Withdraw
          </Button>
        ) : null}
      </div>
      {open === 'validate' ? (
        <ValidateDialog
          subject={record.recordCode}
          speciesId={record.speciesId}
          write={(body) => annotateRecord(record.id, { kind: 'confirm', ...body })}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === 'contest' || open === 'complement' ? (
        <AddEntriesDialog
          speciesId={record.speciesId}
          initialTrait={record.trait}
          respondTo={{ intent: open, recordId: record.id, levelId: record.level?.id }}
          onClose={() => setOpen(null)}
          onCreated={(result) => {
            setOpen(null);
            const [first] = result.created;
            if (first) onOpenRecord?.(first.id);
          }}
          onOpenRecord={(id) => {
            setOpen(null);
            onOpenRecord?.(id);
          }}
        />
      ) : null}
      {open === 'withdraw' ? (
        <ConfirmDialog
          title="Withdraw this record?"
          message={WITHDRAW_MESSAGE}
          confirmLabel="Withdraw"
          danger
          pending={withdraw.isPending}
          error={withdraw.error ? actionErrorMessage(withdraw.error) : null}
          onConfirm={() => withdraw.mutate()}
          onClose={() => {
            withdraw.reset();
            setOpen(null);
          }}
        />
      ) : null}
    </DrawerSection>
  );
}
```

`apps/web/src/components/dataset/RecordDrawer.tsx`:
1. Delete `import { ReviewBadge } from './ReviewBadge.tsx';`.
2. In `RecordBody`'s "Value" `Definitions` rows, make the first row `{ label: 'Record ID', value: record.recordCode },`, placed before `{ label: 'Value', … }`.
3. Replace `<ReviewBadge status={record.review} />` with `{record.contested ? <Badge tone="red">Contested</Badge> : null}`.
4. Give `RecordBody` a third prop, `onWithdrawn?: () => void` (destructured, typed in its props object), and render `<RecordActions record={record} onOpenRecord={onOpenRecord} onWithdrawn={onWithdrawn} />`.
5. Replace `RecordLoader` with:

```tsx
function RecordLoader({
  id,
  onOpenRecord,
  onClose,
}: {
  id: string;
  onOpenRecord?: (id: string) => void;
  onClose: () => void;
}) {
  const query = useQuery({ queryKey: datasetKeys.record(id), queryFn: () => fetchRecord(id) });
  if (query.error && !query.data) return <Alert tone="error">{errorMessage(query.error)}</Alert>;
  if (!query.data) return <p className="text-body text-mist-500">Loading record…</p>;
  return <RecordBody record={query.data} onOpenRecord={onOpenRecord} onWithdrawn={onClose} />;
}
```

6. In `RecordDrawer`, render `<RecordLoader id={recordId} onOpenRecord={onOpenRecord} onClose={onClose} />`. In its JSDoc, replace "its value and both status chips" with "its record ID, its value, the harmonisation chip and the **Contested** badge (R-2, R-9)", and add "; a withdrawal closes it, the record having left the dataset (R-13)" after "the curation actions the session may take on it".

Delete the four files:

```sh
git rm apps/web/src/components/curation/ContestDialog.tsx apps/web/src/components/curation/ContestDialog.test.tsx apps/web/src/components/dataset/ReviewBadge.tsx apps/web/src/components/dataset/ReviewBadge.test.tsx
```

- [ ] **Step 4: Run the tests and see them pass**

Sync, then:

```sh
docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/components/curation src/components/dataset
docker exec treerepro-13h pnpm --filter @treerepro/web typecheck
docker exec treerepro-13h sh -c "grep -rn 'ContestDialog\|ReviewBadge' apps/web/src || true"
```

Expected: all pass. The typecheck exits 0 (green again). The grep prints nothing.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/components/curation/RecordActions.tsx apps/web/src/components/curation/RecordActions.test.tsx apps/web/src/components/dataset/RecordDrawer.tsx apps/web/src/components/dataset/RecordDrawer.test.tsx apps/web/src/pages/dataset/SpeciesPage.test.tsx
git commit -m "feat(web): record actions validate, contest, complement and a note-free withdraw; drop ContestDialog and ReviewBadge (RFC-70 R1, R4, RFC-65 R4)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `TraitCard`: every level, level actions, counts, Contested

**Files:**
- Rewrite: `apps/web/src/components/dataset/TraitCard.tsx`, `apps/web/src/components/dataset/TraitCard.test.tsx`

**Interfaces:**
- Consumes: summary `levels: [{ levelId, key, count, validationCount, contested }]`, summary `contested`, numeric `{ min, max, mean, count }` (13f/13g); `VoteButton` (Task 3).
- Produces:

```ts
export type LevelSummary = NonNullable<TraitSummary['levels']>[number];
export function TraitCard(props: { summary: TraitSummary; dictionary?: Dictionary; onOpen: () => void;
  onAdd?: () => void; onValidateLevel?: (level: LevelSummary) => void;
  onRespondLevel?: (level: LevelSummary, intent: RecordIntent) => void }): JSX.Element;
```

The level rows can no longer sit inside the card's main button, because buttons cannot nest. The main button keeps the name, unit, record count, badges and the numeric summary. The level list follows it as a sibling `<ul aria-label="Levels of <trait>">`.

- [ ] **Step 1: Write the failing test**

Replace `apps/web/src/components/dataset/TraitCard.test.tsx` entirely:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TraitSummary } from '@treerepro/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  DICTIONARY,
  DICTIONARY_SEED_MASS,
  DICTIONARY_SEXUAL_SYSTEM,
  POLLINATION_MODE_SUMMARY,
  SEED_MASS_SUMMARY,
  SEXUAL_SYSTEM_SUMMARY,
} from '../../test/dataset-fixtures.ts';
import { tipText } from '../../test/render.tsx';
import { withRouter } from '../../test/router.tsx';
import { TraitCard } from './TraitCard.tsx';

// Three levels, the top one validated twice and contested.
const LEVELLED: TraitSummary = {
  ...SEXUAL_SYSTEM_SUMMARY,
  contested: true,
  levels: [
    { levelId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d20', key: 'dioecious', count: 4, validationCount: 2, contested: true },
    { levelId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d21', key: 'monoecious', count: 1, validationCount: 0, contested: false },
    { levelId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d22', key: 'hermaphrodite', count: 1, validationCount: 1, contested: false },
  ],
};

describe('RFC-63 R10 TraitCard', () => {
  it('is a button named after the trait, with the record count, the pending line and the trait’s Contested badge', () => {
    render(<TraitCard summary={LEVELLED} onOpen={() => {}} />);
    const card = screen.getByRole('button', { name: /^sexual system/ });
    expect(card).toHaveTextContent('8 records');
    expect(card).toHaveTextContent('2 pending');
    expect(within(card).getByText('Contested')).toBeInTheDocument();
    expect(card.parentElement?.querySelector('[style]')).toBeNull();
  });

  it('spec §2 lists every level of the species, with no cap', () => {
    const many: TraitSummary = {
      ...LEVELLED,
      levels: Array.from({ length: 7 }, (_, i) => ({
        levelId: `018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d${20 + i}`,
        key: `level_${i}`,
        count: 7 - i,
        validationCount: 0,
        contested: false,
      })),
    };
    render(<TraitCard summary={many} onOpen={() => {}} />);
    const list = screen.getByRole('list', { name: 'Levels of sexual system' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(7);
    expect(within(list).getByText('level_6')).toBeInTheDocument();
  });

  it('shows per level its record count, its validations, a bar and a Contested badge where it applies', () => {
    render(<TraitCard summary={LEVELLED} onOpen={() => {}} />);
    const list = screen.getByRole('list', { name: 'Levels of sexual system' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('dioecious');
    expect(items[0]).toHaveTextContent('4 records');
    expect(items[0]).toHaveTextContent('✓ 2');
    expect(within(items[0] as HTMLElement).getByText('Contested')).toBeInTheDocument();
    expect(items[1]).toHaveTextContent('1 record');
    expect(within(items[1] as HTMLElement).queryByText('Contested')).not.toBeInTheDocument();
    const fills = list.querySelectorAll('.bg-canopy-500');
    expect(fills[0]?.className).toContain('w-full');
    expect(fills[1]?.className).toContain('w-3/10');
  });

  it('spec §2 gives each level Validate, Contest and Complement, outside the card’s own button', async () => {
    const onValidateLevel = vi.fn();
    const onRespondLevel = vi.fn();
    const onOpen = vi.fn();
    render(
      <TraitCard
        summary={LEVELLED}
        onOpen={onOpen}
        onValidateLevel={onValidateLevel}
        onRespondLevel={onRespondLevel}
      />,
    );
    const card = screen.getByRole('button', { name: /^sexual system/ });
    const validate = screen.getByRole('button', { name: 'Validate dioecious for sexual system' });
    expect(card.contains(validate)).toBe(false);
    await userEvent.click(validate);
    expect(onValidateLevel).toHaveBeenCalledWith(LEVELLED.levels?.[0]);
    await userEvent.click(
      screen.getByRole('button', { name: 'Contest monoecious for sexual system' }),
    );
    expect(onRespondLevel).toHaveBeenLastCalledWith(LEVELLED.levels?.[1], 'contest');
    await userEvent.click(
      screen.getByRole('button', { name: 'Complement hermaphrodite for sexual system' }),
    );
    expect(onRespondLevel).toHaveBeenLastCalledWith(LEVELLED.levels?.[2], 'complement');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('offers only the actions the page passes', () => {
    render(<TraitCard summary={LEVELLED} onOpen={() => {}} onValidateLevel={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Validate dioecious for sexual system' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Contest / })).not.toBeInTheDocument();
  });

  it('shows min · mean · max with the unit for a quantitative trait, and no level list', () => {
    render(
      <TraitCard
        summary={{ ...SEED_MASS_SUMMARY, numeric: { min: 0.5, max: 3, mean: 1.25, count: 3 } }}
        onOpen={() => {}}
      />,
    );
    const card = screen.getByRole('button', { name: /seed mass/ });
    expect(card).toHaveTextContent('min · mean · max');
    expect(within(card).getByText('0.5 · 1.25 · 3 mg')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('says "1 record" for a single record and calls onOpen when clicked', async () => {
    const onOpen = vi.fn();
    render(<TraitCard summary={POLLINATION_MODE_SUMMARY} onOpen={onOpen} />);
    const card = screen.getByRole('button', { name: /pollination mode/ });
    expect(card).toHaveTextContent('1 record');
    expect(card).not.toHaveTextContent('1 records');
    await userEvent.click(card);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders an Add value button, named after the trait, beside the card when onAdd is given', async () => {
    const onAdd = vi.fn();
    const onOpen = vi.fn();
    render(<TraitCard summary={LEVELLED} onOpen={onOpen} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add value for sexual system' }));
    expect(onAdd).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('RFC-13 R11 shows a HelpTip with the trait description from the dictionary, outside the open button', async () => {
    const summary = { ...LEVELLED, trait: DICTIONARY_SEXUAL_SYSTEM };
    render(withRouter(<TraitCard summary={summary} dictionary={DICTIONARY} onOpen={() => {}} />));
    const card = await screen.findByRole('button', { name: /^sexual system/ });
    const tip = screen.getByRole('button', { name: 'What does sexual system mean?' });
    expect(card.contains(tip)).toBe(false);
    await userEvent.click(tip);
    expect(tipText(screen.getByRole('tooltip'))).toBe(
      'Distribution of male and female function among individuals.',
    );
  });

  it('spec §7.5 the tip of a quantitative trait names the unit its records are measured in', async () => {
    const summary = { ...SEED_MASS_SUMMARY, trait: DICTIONARY_SEED_MASS };
    render(withRouter(<TraitCard summary={summary} dictionary={DICTIONARY} onOpen={() => {}} />));
    await userEvent.click(await screen.findByRole('button', { name: 'What does seed mass mean?' }));
    expect(tipText(screen.getByRole('tooltip'))).toBe('Dry mass of one seed. Measured in mg.');
  });

  it('renders no HelpTip when the dictionary has no description for the trait', () => {
    render(<TraitCard summary={LEVELLED} onOpen={() => {}} />);
    expect(screen.queryByRole('button', { name: /What does .* mean\?/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Sync, then `docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/components/dataset/TraitCard.test.tsx`.
Expected: FAIL, `Unable to find an accessible element with the role "list" and name "Levels of sexual system"`.

- [ ] **Step 3: Implement**

Replace `apps/web/src/components/dataset/TraitCard.tsx` entirely:

```tsx
import type { Dictionary, RecordIntent, TraitSummary } from '@treerepro/contracts';
import { helpHref } from '../../content/help/href.ts';
import { formatNumber, humaniseKey } from '../../lib/format.ts';
import { Badge, Button, HelpTip } from '../ui/index.ts';
import { CardFrame } from './CardFrame.tsx';
import { traitTip } from './trait-tip.ts';
import { VoteButton } from './VoteButton.tsx';

// One class per tenth, spelled out so Tailwind finds them at build time; a
// bar's width is a class, never a style attribute (RFC-13 R5).
const WIDTHS = [
  'w-1/10',
  'w-2/10',
  'w-3/10',
  'w-4/10',
  'w-5/10',
  'w-6/10',
  'w-7/10',
  'w-8/10',
  'w-9/10',
  'w-full',
] as const;

function widthClass(count: number, max: number): string {
  const tenths = Math.min(WIDTHS.length, Math.max(1, Math.round((count / max) * WIDTHS.length)));
  return WIDTHS[tenths - 1] ?? 'w-full';
}

function pendingCount(summary: TraitSummary): number {
  const { unknownLevel, multiValue, notNumeric, empty } = summary.harmonisationCounts;
  return unknownLevel + multiValue + notNumeric + empty;
}

/** One level of a categorical trait as the summary gives it. @rfc RFC-63 R10 */
export type LevelSummary = NonNullable<TraitSummary['levels']>[number];

/**
 * One trait of a species. The card itself is a button that opens the trait's
 * records, naming the trait, its unit and record count, what still waits for
 * harmonisation, a **Contested** badge while any of its levels or records is
 * contested (R-9), and — for a measurement — min · mean · max (R-5). Below it,
 * outside the button so no control nests in another, a categorical trait
 * lists **every** level the species has (spec §2; no cap): its record count,
 * its validations (✓ n), a bar scaled against the most frequent level, its
 * own **Contested** badge, and 👍 👎 ＋ — each present only when the page
 * passes its handler. Beside the card sit the `?` with the dictionary's
 * description (RFC-13 R11) and the "+" that opens the entry dialog for the
 * trait (RFC-65 R1).
 * @rfc RFC-13 R11
 * @rfc RFC-63 R10
 * @rfc RFC-65 R1
 * @rfc RFC-70 R1, R4
 */
export function TraitCard({
  summary,
  dictionary,
  onOpen,
  onAdd,
  onValidateLevel,
  onRespondLevel,
}: {
  summary: TraitSummary;
  dictionary?: Dictionary;
  onOpen: () => void;
  onAdd?: () => void;
  onValidateLevel?: (level: LevelSummary) => void;
  onRespondLevel?: (level: LevelSummary, intent: RecordIntent) => void;
}) {
  const { trait, recordCount, numeric } = summary;
  const levels = summary.levels ?? [];
  const pending = pendingCount(summary);
  const maxCount = Math.max(0, ...levels.map((level) => level.count));
  const name = humaniseKey(trait.key);
  const tip = traitTip(dictionary, trait);

  return (
    <CardFrame>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <button
          type="button"
          onClick={onOpen}
          className="flex flex-col gap-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
        >
          <span className="flex w-full items-start justify-between gap-3">
            <span className="flex flex-col">
              <span className="font-display text-card font-semibold text-canopy-950">{name}</span>
              <span className="text-meta text-mist-500">
                {trait.unit ? `${trait.unit} · ` : ''}
                {recordCount} {recordCount === 1 ? 'record' : 'records'}
              </span>
            </span>
            <span className="flex flex-wrap justify-end gap-1.5">
              {summary.contested ? <Badge tone="red">Contested</Badge> : null}
              {pending > 0 ? <Badge tone="amber">{pending} pending</Badge> : null}
            </span>
          </span>
          {numeric ? (
            <span className="flex flex-col">
              <span className="text-label uppercase tracking-[0.06em] text-mist-500">
                min · mean · max
              </span>
              <span className="text-body tabular-nums text-canopy-900">
                {`${formatNumber(numeric.min)} · ${formatNumber(numeric.mean)} · ${formatNumber(numeric.max)}${trait.unit ? ` ${trait.unit}` : ''}`}
              </span>
            </span>
          ) : null}
        </button>

        {levels.length > 0 ? (
          <ul aria-label={`Levels of ${name}`} className="flex flex-col gap-3">
            {levels.map((level) => (
              <li key={level.levelId} className="flex flex-col gap-1">
                <span className="flex items-center justify-between gap-2 text-meta text-canopy-900">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{level.key}</span>
                    {level.contested ? <Badge tone="red">Contested</Badge> : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-3 tabular-nums text-mist-500">
                    <span>
                      {level.count}
                      <span className="sr-only">{level.count === 1 ? ' record' : ' records'}</span>
                    </span>
                    <span>
                      <span aria-hidden="true">✓</span> {level.validationCount}
                      <span className="sr-only"> validated</span>
                    </span>
                  </span>
                </span>
                <span aria-hidden="true" className="block h-2 w-full rounded-full bg-mist-100">
                  <span
                    className={`block h-full rounded-full bg-canopy-500 ${widthClass(level.count, maxCount)}`}
                  />
                </span>
                {onValidateLevel || onRespondLevel ? (
                  <span className="flex gap-1.5">
                    {onValidateLevel ? (
                      <VoteButton
                        icon="👍"
                        label={`Validate ${level.key} for ${name}`}
                        onClick={() => onValidateLevel(level)}
                      />
                    ) : null}
                    {onRespondLevel ? (
                      <>
                        <VoteButton
                          icon="👎"
                          label={`Contest ${level.key} for ${name}`}
                          onClick={() => onRespondLevel(level, 'contest')}
                        />
                        <VoteButton
                          icon="＋"
                          label={`Complement ${level.key} for ${name}`}
                          onClick={() => onRespondLevel(level, 'complement')}
                        />
                      </>
                    ) : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <span className="flex shrink-0 items-center gap-1">
        {tip ? (
          <HelpTip
            label={`What does ${name} mean?`}
            learnMore={helpHref('vocabulary', 'descriptions')}
          >
            {tip}
          </HelpTip>
        ) : null}
        {onAdd ? (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Add value for ${name}`}
            onClick={onAdd}
            className="shrink-0 px-3"
          >
            +
          </Button>
        ) : null}
      </span>
    </CardFrame>
  );
}
```

- [ ] **Step 4: Run the test and see it pass**

Sync, then `docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/components/dataset/TraitCard.test.tsx`.
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/components/dataset/TraitCard.tsx apps/web/src/components/dataset/TraitCard.test.tsx
git commit -m "feat(web): trait card lists every level with validate, contest, complement, counts and contested (RFC-63 R10, RFC-70 R4)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `SpeciesPage`: legend and wiring

**Files:**
- Modify: `apps/web/src/pages/dataset/SpeciesPage.tsx`, `apps/web/src/pages/dataset/SpeciesPage.test.tsx`

**Interfaces:**
- Consumes: `TraitCard` `onValidateLevel` / `onRespondLevel` (Task 8), `TraitPanel` `onValidateRecord` / `onRespondRecord` (Task 3), `ValidateDialog` (Task 5), `AddEntriesDialog` + `RespondTo` (Task 6), `validateLevel`, `annotateRecord`, `ValidateBody` (Task 1).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/pages/dataset/SpeciesPage.test.tsx`:

1. Add these keys to the hoisted `curation` object:

```ts
  annotateRecord: vi.fn(),
  validateLevel: vi.fn(),
  resolveDoi: vi.fn(),
```

Add to `beforeEach`:

```ts
  curation.annotateRecord.mockReset().mockResolvedValue(RECORD_DETAIL);
  curation.validateLevel.mockReset().mockResolvedValue(undefined);
  curation.resolveDoi.mockReset();
```

2. In "shows the add buttons only with records.create; …", replace the two lines

```ts
    const card = screen.getByRole('button', { name: /^sexual system/ })
      .parentElement as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: /^Add value for/ }));
```

with

```ts
    await userEvent.click(screen.getByRole('button', { name: 'Add value for sexual system' }));
```

3. Replace the test "RFC-70 R3 opens the first created record in the drawer" with:

```ts
  it('RFC-70 R3 opens the first created record in the drawer', async () => {
    auth.fetchMe.mockResolvedValue({ ...READER, permissions: ['dataset.read', 'records.create'] });
    // The dialog reads the species' records for the trait: none, so no intent step.
    dataset.fetchRecords.mockResolvedValue(page([]));
    curation.createRecords.mockResolvedValue({
      created: [RECORD_DETAIL],
      validated: [],
      duplicates: [],
    });
    dataset.fetchRecord.mockResolvedValue(RECORD_DETAIL);
    await openPage();
    await userEvent.click(screen.getByRole('button', { name: ADD_ENTRIES }));
    const dialog = await screen.findByRole('dialog', { name: ADD_ENTRIES });
    await within(dialog).findByRole('option', { name: 'Reproductive system' });
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Broad trait category' }),
      'Reproductive system',
    );
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Trait' }),
      'sexual system',
    );
    const dioecious = await within(dialog).findByRole('checkbox', { name: 'dioecious' });
    await waitFor(() => expect(dioecious).toBeEnabled());
    await userEvent.click(dioecious);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add record(s)' }));
    expect(await screen.findByRole('dialog', { name: 'Record' })).toHaveTextContent('dioecious');
    expect(dataset.fetchRecord).toHaveBeenCalledWith(RECORD_DETAIL.id);
  });
```

4. Append:

```ts
const MASS: RecordItem = {
  ...PENDING_RECORD,
  recordCode: 'TR_7',
  level: null,
  quantitative: { single: 1.5 },
};
const DIOECIOUS_LEVEL = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d20';

describe('spec §2 SpeciesPage legend and record decisions', () => {
  it('opens with the legend of the three decisions', async () => {
    await openPage();
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '👍 Validate',
      '👎 Contest',
      '＋ Complement',
    ]);
  });

  it('shows no level decisions to a reader', async () => {
    await openPage();
    expect(
      screen.queryByRole('button', { name: 'Validate dioecious for sexual system' }),
    ).not.toBeInTheDocument();
  });

  it('validates every record of a level from its card (R-6)', async () => {
    auth.fetchMe.mockResolvedValue({ ...READER, permissions: ['dataset.read', 'records.annotate'] });
    await openPage();
    await userEvent.click(
      screen.getByRole('button', { name: 'Validate dioecious for sexual system' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Validate dioecious' });
    expect(
      within(dialog).getByText('Do you confirm that this record is correct?'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Validate' }));
    await waitFor(() =>
      expect(curation.validateLevel).toHaveBeenCalledWith(
        SPECIES.id,
        SEXUAL_SYSTEM.id,
        DIOECIOUS_LEVEL,
        {},
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Validate dioecious' })).not.toBeInTheDocument(),
    );
  });

  it('contests a level from its card: the entry dialog opens already answered', async () => {
    auth.fetchMe.mockResolvedValue({ ...READER, permissions: ['dataset.read', 'records.create'] });
    await openPage();
    await userEvent.click(
      screen.getByRole('button', { name: 'Contest dioecious for sexual system' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    expect(
      await within(dialog).findByRole('radio', {
        name: 'Contest — The existing value is wrong; mine should replace it.',
      }),
    ).toBeChecked();
    expect(within(dialog).getByRole('combobox', { name: 'Responding to' })).toHaveValue(
      DIOECIOUS_LEVEL,
    );
  });

  it('validates one record from a quantitative trait’s panel', async () => {
    auth.fetchMe.mockResolvedValue({ ...READER, permissions: ['dataset.read', 'records.annotate'] });
    dataset.fetchRecords.mockResolvedValue(page([MASS]));
    await openPage();
    await userEvent.click(screen.getByRole('button', { name: /^seed mass/ }));
    const panel = await screen.findByRole('dialog', { name: 'seed mass' });
    await userEvent.click(await within(panel).findByRole('button', { name: 'Validate TR_7' }));
    const dialog = await screen.findByRole('dialog', { name: 'Validate TR_7' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Validate' }));
    await waitFor(() =>
      expect(curation.annotateRecord).toHaveBeenCalledWith(MASS.id, { kind: 'confirm' }),
    );
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Sync, then `docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/pages/dataset/SpeciesPage.test.tsx`.
Expected: FAIL. There is no list named "Legend", and no button named "Validate dioecious for sexual system" or "Validate TR_7".

- [ ] **Step 3: Implement**

In `apps/web/src/pages/dataset/SpeciesPage.tsx`:

1. Imports. Replace `import { AddEntriesDialog } from '../../components/curation/AddEntriesDialog.tsx';` with the second line below, and add the other two:

```ts
import { annotateRecord, type ValidateBody, validateLevel } from '../../api/curation.ts';
import { AddEntriesDialog, type RespondTo } from '../../components/curation/AddEntriesDialog.tsx';
import { ValidateDialog } from '../../components/curation/ValidateDialog.tsx';
```

2. Above `SpeciesHeader`, add:

```tsx
// The three decisions every level and quantitative record offers (spec §2);
// the icons are decorative, the words carry them.
function Legend() {
  return (
    <ul aria-label="Legend" className="flex flex-wrap gap-x-6 gap-y-1 text-body text-canopy-900">
      <li>
        <span aria-hidden="true">👍</span> Validate
      </li>
      <li>
        <span aria-hidden="true">👎</span> Contest
      </li>
      <li>
        <span aria-hidden="true">＋</span> Complement
      </li>
    </ul>
  );
}
```

3. In `SpeciesPage`, after `const canAdd = hasPermission(me, 'records.create');` add `const canAnnotate = hasPermission(me, 'records.annotate');`. Replace `const [adding, setAdding] = useState<{ trait: TraitRef | null } | null>(null);` with:

```ts
  const [adding, setAdding] = useState<{ trait: TraitRef | null; respondTo?: RespondTo } | null>(
    null,
  );
  const [validating, setValidating] = useState<{
    subject: string;
    write: (body: ValidateBody) => Promise<unknown>;
  } | null>(null);
```

4. Make the first child of `<div className="flex flex-col gap-8">` `{species.isSuccess ? <Legend /> : null}`.

5. Give the `TraitCard` element two more props:

```tsx
                      onValidateLevel={
                        canAnnotate
                          ? (level) =>
                              setValidating({
                                subject: level.key,
                                write: (body) =>
                                  validateLevel(id, summary.trait.id, level.levelId, body),
                              })
                          : undefined
                      }
                      onRespondLevel={
                        canAdd
                          ? (level, intent) =>
                              setAdding({
                                trait: summary.trait,
                                respondTo: { intent, levelId: level.levelId },
                              })
                          : undefined
                      }
```

6. Give the `TraitPanel` element two more props:

```tsx
          onValidateRecord={
            canAnnotate
              ? (record) =>
                  setValidating({
                    subject: record.recordCode,
                    write: (body) => annotateRecord(record.id, { kind: 'confirm', ...body }),
                  })
              : undefined
          }
          onRespondRecord={
            canAdd
              ? (record, intent) =>
                  setAdding({ trait: record.trait, respondTo: { intent, recordId: record.id } })
              : undefined
          }
```

7. On `<AddEntriesDialog …>`, add `respondTo={adding.respondTo}`. After that dialog block, add:

```tsx
      {validating ? (
        <ValidateDialog
          subject={validating.subject}
          speciesId={id}
          write={validating.write}
          onClose={() => setValidating(null)}
        />
      ) : null}
```

8. In the `SpeciesPage` JSDoc:
   - After "(RFC-63 R10).", add: "A legend at the top names the three decisions (spec §2). With `records.annotate`, each level of a categorical card and each row of a quantitative panel carries 👍, which opens the validation question (R-6). With `records.create`, they carry 👎 and ＋, which open the entry dialog already answered; the card's "+" opens it unanswered, and it asks Contest or Complement first whenever records exist (item 2.1)."
   - Delete the sentence starting "The open panel is remembered by trait id and its summary read from the traits query on every render, so the accepted badge follows…" through "…instead of freezing at the click;" and replace it with "The open panel is remembered by trait id and its summary read from the traits query on every render, so its counts follow every write;". The rest of that sentence stays.
   - Add `@rfc RFC-70 R4` to the tag list.

- [ ] **Step 4: Run the tests and see them pass**

Sync, then:

```sh
docker exec treerepro-13h pnpm --filter @treerepro/web exec vitest run src/pages/dataset/SpeciesPage.test.tsx
docker exec treerepro-13h pnpm --filter @treerepro/web typecheck
```

Expected: PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/pages/dataset/SpeciesPage.tsx apps/web/src/pages/dataset/SpeciesPage.test.tsx
git commit -m "feat(web): species page legend and validate, contest, complement on levels and quantitative rows (spec §2)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: E2E: the contributor flow on the new species page

**Files:**
- Modify: `apps/e2e/tests/contribution.spec.ts`, `apps/e2e/tests/contributions.spec.ts`, `apps/e2e/tests/dashboard.spec.ts`

Every string asserted below comes from code in this plan:
- `'Validate <level> for <trait>'`, `'Contest …'` from `TraitCard`;
- `'Validate <subject>'` and `'Do you confirm that this record is correct?'` from `ValidateDialog`;
- `'Levels of <trait>'` and `'✓'` from `TraitCard`;
- `'Add entries for <trait>'`, `'Responding to'`, `'Add record(s)'` and the intent labels from `AddEntriesDialog`;
- `'Single value (mm)'` from `ValueField`;
- `'Record ID'` from `RecordDrawer`;
- `'Validate'` and `'Contest'` from `RecordActions`;
- `'Legend'` from `SpeciesPage`.

- [ ] **Step 1: Update `contribution.spec.ts`**

1. In the seeding `create<CreatedRecords>(admin, '/api/records', …)` call, make the value `value: { levelIds: [seededLevel.id] },`. This matches 13g's `{ levelIds }`; if 13g already changed it, leave it.

2. Replace the `traitCard` JSDoc paragraph with: "The trait card's own button, the one that opens the trait's records. The `?` ("What does <trait> mean?"), the `+` ("Add value for <trait>") and the level buttons ("Validate <level> for <trait>") carry the name too, but only the card's own starts with it."

3. Add, above `test.describe`:

```ts
const CONTEST = 'Contest — The existing value is wrong; mine should replace it.';
const COMPLEMENT =
  'Complement — The existing value is also correct; I am adding another observation.';
```

4. Replace the test title with `'a contributor validates and contests a level from its card, must say contest or complement first, and adds the first entry for a trait with no data'`. Replace everything inside `try { … }` with:

```ts
      // ── The contributor validates the seeded level from its card (spec §2, R-6) ──
      await page.goto(`/app/species/${species.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(speciesName);
      await expect(page.getByRole('list', { name: 'Legend' })).toContainText('Validate');
      await page
        .getByRole('button', { name: `Validate ${seededLevel.key} for ${recordedName}`, exact: true })
        .click();
      const validate = page.getByRole('dialog', { name: `Validate ${seededLevel.key}` });
      await expect(validate.getByText('Do you confirm that this record is correct?')).toBeVisible();
      await validate.getByRole('button', { name: 'Validate', exact: true }).click();
      await expect(validate).toBeHidden();
      const levels = page.getByRole('list', { name: `Levels of ${recordedName}` });
      await expect(levels.getByRole('listitem').filter({ hasText: seededLevel.key })).toContainText(
        '✓ 1',
      );

      // ── …then contests it from the same row, as a personal observation ──
      await page
        .getByRole('button', { name: `Contest ${seededLevel.key} for ${recordedName}`, exact: true })
        .click();
      const contest = page.getByRole('dialog', { name: `Add entries for ${recordedName}` });
      await expect(contest.getByRole('radio', { name: CONTEST })).toBeChecked();
      await contest.getByRole('checkbox', { name: contestedLevel.key }).check();
      await contest.getByRole('button', { name: 'Add record(s)', exact: true }).click();
      await expect(contest).toBeHidden();

      // RFC-70 R3: the record the API created opens in the drawer, badged
      // with what it says about the record it answers.
      const drawer = page.getByRole('dialog', { name: 'Record', exact: true });
      await expect(drawer.getByRole('button', { name: /^contests record/ })).toBeVisible();
      await expect(drawer.getByText(contestedLevel.key, { exact: true }).first()).toBeVisible();
      const observation = drawer.getByRole('link', {
        name: `Personal observation (${contributorName})`,
        exact: true,
      });
      await expect(observation).toBeVisible();
      await observation.click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        `Personal observation (${contributorName})`,
      );

      // ── The card's own + asks Contest or Complement first (item 2.1) ─────
      await page.goto(`/app/species/${species.id}`);
      await page.getByRole('button', { name: `Add value for ${recordedName}`, exact: true }).click();
      const entry = page.getByRole('dialog', { name: `Add entries for ${recordedName}` });
      await expect(entry.getByRole('checkbox', { name: seededLevel.key })).toBeDisabled();
      await expect(entry.getByRole('button', { name: 'Add record(s)', exact: true })).toBeDisabled();
      await entry.getByRole('radio', { name: COMPLEMENT }).check();
      await entry.getByLabel('Responding to').selectOption({ label: seededLevel.key });
      await expect(entry.getByRole('checkbox', { name: seededLevel.key })).toBeEnabled();
      await entry.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(entry).toBeHidden();

      // ── …and records the first entry for a trait with no data ────────────
      await expect(traitCard(page, recordedName)).toBeVisible();
      await expect(page.getByText(untouchedName)).toHaveCount(0);
      await page.getByRole('checkbox', { name: 'Show traits with no data' }).check();

      const emptyCard = page.locator('div').filter({ hasText: untouchedName }).last();
      await expect(emptyCard.getByText('No records yet')).toBeVisible();
      await emptyCard.getByRole('button', { name: 'Add the first entry' }).click();

      const entries = page.getByRole('dialog', {
        name: `Add entries for ${untouchedName} (mm)`,
      });
      await entries.getByLabel('Single value (mm)').fill('12.5');
      await entries.getByRole('button', { name: 'Add record(s)', exact: true }).click();

      await expect(entries).toBeHidden();
      // R-2: a record created on the platform takes a TR_ code.
      await expect(drawer.getByText('Record ID')).toBeVisible();
      await expect(drawer.getByText(/^TR_\d+[a-z]*$/)).toBeVisible();
      await drawer.getByRole('button', { name: 'Close' }).click();

      await expect(traitCard(page, untouchedName)).toContainText('1 record');
```

- [ ] **Step 2: Update the drawer steps in `contributions.spec.ts`**

Replace

```ts
      await drawer.getByRole('button', { name: '✓ Validate', exact: true }).click();
      // RFC-70 R4: the confirmation is attached to the record.
      await expect(drawer.getByText('You validated this record')).toBeVisible();
```

with

```ts
      await drawer.getByRole('button', { name: 'Validate', exact: true }).click();
      const confirmation = page.getByRole('dialog', { name: /^Validate / });
      await confirmation.getByRole('button', { name: 'Validate', exact: true }).click();
      await expect(confirmation).toBeHidden();
      // RFC-70 R4: the confirmation is attached to the record.
      await expect(drawer.getByText('You validated this record')).toBeVisible();
```

Replace the block that runs from `await drawer.getByRole('button', { name: '+ Add different record', exact: true }).click();` through `await expect(contest).toBeHidden();` with:

```ts
      await drawer.getByRole('button', { name: 'Contest', exact: true }).click();
      const contest = page.getByRole('dialog', { name: `Add entries for ${traitName}` });
      await expect(
        contest.getByRole('radio', {
          name: 'Contest — The existing value is wrong; mine should replace it.',
        }),
      ).toBeChecked();
      await contest.getByRole('checkbox', { name: contestedLevel.key }).check();
      await contest.getByRole('button', { name: 'Add record(s)', exact: true }).click();
      await expect(contest).toBeHidden();
```

If the seeding in this file still posts `value: { levelId: … }`, change it to `value: { levelIds: [ … ] }`.

- [ ] **Step 3: Update the drawer step in `dashboard.spec.ts`**

Replace

```ts
      await drawer.getByRole('button', { name: '✓ Validate', exact: true }).click();
      await expect(drawer.getByText('You validated this record')).toBeVisible();
```

with

```ts
      await drawer.getByRole('button', { name: 'Validate', exact: true }).click();
      const confirmation = page.getByRole('dialog', { name: /^Validate / });
      await confirmation.getByRole('button', { name: 'Validate', exact: true }).click();
      await expect(confirmation).toBeHidden();
      await expect(drawer.getByText('You validated this record')).toBeVisible();
```

- [ ] **Step 4: Check the specs compile and lint**

Sync, then:

```sh
docker exec treerepro-13h pnpm --filter @treerepro/e2e exec tsc --noEmit
docker exec treerepro-13h pnpm lint
docker exec treerepro-13h sh -c "grep -rn '✓ Validate\|Add different record\|Add a different record for' apps/e2e/tests apps/web/src/components apps/web/src/pages || true"
```

Expected: tsc exits 0 and lint is clean. The grep prints nothing. The `content/help` pages keep their old wording until 13j (see Spec notes).

- [ ] **Step 5: Commit**

```sh
git add apps/e2e/tests/contribution.spec.ts apps/e2e/tests/contributions.spec.ts apps/e2e/tests/dashboard.spec.ts
git commit -m "test(e2e): contributor validates and contests from the card, intent first, six-field entry (spec §2)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Full verification, rebase, PR

- [ ] **Step 1: Rebase on the moving `main`** (memory: main-moves-mid-run-recheck, rebase-not-merge-before-push).

```sh
git fetch origin && git rebase origin/main
```

Resolve conflicts in the files 13e, 13f and 13g also touched: `SpeciesPage.test.tsx`, `ContributionsPage.test.tsx`, `ReferencePage.test.tsx` and the e2e specs. Keep both sides' intent. Before accepting an append-vs-append hunk, read its boundary lines.

- [ ] **Step 2: Run the whole pipeline on the rebased tree** (memory: parallel-plans-break-on-merge)

Sync, then:

```sh
docker exec treerepro-13h pnpm lint
docker exec treerepro-13h pnpm typecheck
docker exec treerepro-13h pnpm rfc:check
docker exec treerepro-13h pnpm build
docker exec treerepro-13h pnpm test
```

Expected: all green. If `pnpm build` regenerates `apps/web/src/routeTree.gen.ts`, `docker cp` it out and diff it against the worktree copy. This plan adds no route, so it must be unchanged. Also grep 13i's new strings across `apps/web` and `apps/e2e` if 13i merged first.

- [ ] **Step 3: CodeRabbit locally, before the PR** (memory: coderabbit-local-before-pr). Run `coderabbit:code-review` once on the branch. Apply what holds up, commit, and re-run Step 2 if code changed.

- [ ] **Step 4: Push and open the PR**

```sh
git -c http.version=HTTP/1.1 push -u origin feat/13h-species-page
gh pr create --title "feat(web): species page — validate, contest, complement on every level; intent-first entry; sortable record panel (plan 13h)" --body "$(cat <<'EOF'
Implements spec 2026-09-25 §2 (items 2.1, 2.3, 2.4, 2.6) on the 13g/13f/13d API.

- Legend 👍 Validate · 👎 Contest · ＋ Complement at the top of the species page.
- Trait cards list every level with ✓ n, a Contested badge and the three actions; quantitative panel rows carry them too.
- One entry dialog (ContestDialog removed): Contest or Complement first whenever records exist; several levels or the six quantitative fields; reports created / validated / duplicate record IDs.
- Record panel: record ID, references joined by "; ", ✓ n / ✗ n + Contested, server-side sort with aria-sort; no Review column.
- Withdraw is a confirmation only; visible per R-12.

E2E specs updated one-shot; CI validates them.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: every required check passes (Verify, Images, E2E, CodeQL, Dependency review, Gitleaks, Zizmor, Trivy config). For a red E2E, download the artifact and read the screenshot before theorising.

---

## Spec notes (minimal readings; mention to the owner)

1. **Emoji vs the workspace UI pattern.** `2026-09-13-workspace-ui-pattern.md` §1 says "No emoji", while the approved design §2 names 👍 👎 ＋. §2 is newer and was confirmed by the owner, so it wins. Every emoji is `aria-hidden`; the name travels as text or as `aria-label` plus `title`. The UI pattern spec is not edited here.
2. **"trait gains `contested`" (§6)** is read as `TraitSummary.contested: boolean`, not as a field on `TraitRef`.
3. **Level-validate response.** §6 fixes the route and body, not the answer. `validateLevel` parses `dataEnvelopeSchema(okStatusSchema)`. If 13g answers anything else, swap that one schema in `api/curation.ts`.
4. **Source input shape.** Per §6, `sourcesToBody` returns `{ personalObservation: true } | SourceRef[]` after 13d, and `ValidateDialog` takes element 0 as `referenceSource`. If 13d kept `{ references: [...] }`, read `body.references[0]` instead. The `single` prop's three guards and `EMPTY_SOURCES` are applied to whatever markup and state shape 13d left in `SourcesField`.
5. **`referenceSource` type.** It is contracts' `SourceRef` (13d adds `{ isbn, citation }`). The web's own `ValidateBody` is `{ referenceSource?: SourceRef }`.
6. **Trait-level "+" with existing records.** The contract still pairs `intent` with `respondsToRecordId`, so the required first step also asks **Responding to**. That is a level for a categorical trait and a record for a quantitative one. For a categorical level, the web sends the preset record when it has that level, otherwise the first loaded record of the level. Per R-8, a contest applies to every record of its level, so the choice is equivalent. The dialog reads at most 200 records, the API's page ceiling.
7. **Drawer actions follow the legend.** "✓ Validate" and "+ Add different record" become 👍 Validate, 👎 Contest and ＋ Complement. Validate now opens the same confirmation dialog as the card. As a result, `contributions.spec.ts` and `dashboard.spec.ts` change only in their drawer steps; 13e and 13g may edit the same files, so expect conflicts to resolve at rebase.
8. **Own records.** The drawer hides Validate on the viewer's own record (R-6). Card levels and quantitative rows do not pre-filter: a level may mix authors, and the API's refusal is shown in the dialog.
9. **Duplicate wording (R-7).** Validated matches read "`<ID>` matches an existing record — counted as your validation." The viewer's own duplicates read "`<ID>` is already your own record — nothing was added." The old 409 `RECORD_DUPLICATE` links are removed from the dialog because §6's 201 carries both lists. The `RECORD_DUPLICATE` sentence in `errors.ts` is left in place.
10. **Numeric summary label.** It reads `min · mean · max` per §6 `{ min, max, mean, count }`. If 13f already rewrote this block, keep 13f's wording and update the TraitCard test's expected label to match.
11. **Fixtures.** New record fields are given in local spreads over the shared fixtures. `ReferencePage.test.tsx` assumes 13f set each fixture record's `references` to start with its primary reference, as R-4 says.
12. **Help pages and README.** `content/help/*` still says "✓ Validate" and "+ Add different record", and the README Layout paragraph describes the plan-09b drawer. Both are left to 13j (help) and the owner (README), to avoid a third branch in those files.
13. **RFC tags.** Tags use existing rule ids (RFC-13 R5/R6/R10/R11, RFC-63 R8/R9/R10, RFC-65 R1/R3/R4, RFC-70 R1/R2/R3/R4, RFC-71 R2), read "as amended by 13a". If 13a numbered the level-validate or record-ID rules separately, retag in Task 11 before `rfc:check`.
14. **ReviewBadge** is deleted because it has no user left. The contract's `review` field is untouched; 13g owns it.
15. **The legend shows to every viewer,** as §2 places it "at the top of the page", even readers who have no buttons.
16. **Typecheck red window.** Between Tasks 4 and 7 the web typecheck is expected red: the old dialogs still use the old `ValueField` props until `ContestDialog` is deleted.

## Self-review

- §2 legend → Task 9. Every level without a cap, plus 👍 👎 ＋ → Task 8. 👍 question with an optional reference → Tasks 5, 9. 👎/＋ open the entry dialog → Tasks 6, 9. Quantitative row actions → Tasks 3, 9. Entry dialog: intent required first (2.1), multi-level, six fields, DOI/ISBN/none → Tasks 4, 6 (sources via 13d's `SourcesField`). Record panel: sort with `aria-sort`, counts with Contested, record ID, `; `-joined references, no withdrawn or review column → Tasks 2, 3. Create result → Task 6. Withdraw is confirmation only, per R-12 → Task 7. E2E → Task 10.
- Names are consistent across tasks: `RecordSort`, `SortOrder`, `ValidateBody`, `validateLevel`, `EMPTY_SOURCES`, `single` (Task 1) are used in Tasks 2, 3, 5, 6, 9. `SortTh`, `recordValueLabel`, `RecordTableSort` (Task 2) are used in 3 and 6. `VoteButton` (3) is used in 8. `QuantitativeText`, `EMPTY_QUANTITATIVE`, `quantitativeToBody` (4) are used in 6. `ValidateDialog` (5) is used in 7 and 9. `RespondTo`, `AddEntriesDialog` (6) are used in 7 and 9. `LevelSummary` (8) is used by 9 through inference.
- §6 names are used verbatim: `levelIds`, `quantitative`, `recordCode`, `references`, `validationCount`, `contestCount`, `contested`, `referenceSource`, `created`/`validated`/`duplicates` with `{ recordId, recordCode }`, `sort=value|references|origin|added`, `order=asc|desc`, `records.withdraw_imported`.
