import { useNavigate } from '@tanstack/react-router';
import type { SpeciesSort, SpeciesStatus, TraitDataMode } from '@treerepro/contracts';
import { useState } from 'react';
import { EXPORT_ACCEPTED_URL } from '../../api/curation.ts';
import { datasetKeys, searchSpecies } from '../../api/dataset.ts';
import { SpeciesDialog } from '../../components/catalog/SpeciesDialog.tsx';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import { SpeciesList } from '../../components/dataset/SpeciesList.tsx';
import {
  SpeciesSearchForm,
  type SpeciesSearchValue,
} from '../../components/dataset/SpeciesSearchForm.tsx';
import {
  Alert,
  Button,
  buttonClassName,
  EmptyState,
  PageHeader,
} from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { useDebouncedValue } from '../../lib/use-debounced-value.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

/**
 * Every control of the species search as URL search params, so a link from
 * the trait page or the dashboard opens the list pre-filtered and a filtered
 * list can be shared. The route's `validateSearch` is what produces this
 * shape; nothing else here is trusted to.
 * @rfc RFC-60 R6
 */
export interface SpeciesSearch {
  q?: string;
  familyId?: string;
  genusId?: string;
  unresolved?: boolean;
  status?: SpeciesStatus;
  scope?: 'plots' | 'all';
  plotId?: string;
  categoryKey?: string;
  traitId?: string;
  traitData?: TraitDataMode;
  sort?: SpeciesSort;
}

function toValue(search: SpeciesSearch): SpeciesSearchValue {
  return {
    q: search.q ?? '',
    familyId: search.familyId,
    genusId: search.genusId,
    unresolved: search.unresolved === true,
    status: search.status,
    scope: search.scope,
    plotId: search.plotId,
    categoryKey: search.categoryKey,
    traitId: search.traitId,
    traitData: search.traitData,
    sort: search.sort,
  };
}

// A param whose value is `undefined` is left out of the URL, so a cleared
// filter disappears instead of lingering as an empty one.
function toSearch(value: SpeciesSearchValue): SpeciesSearch {
  const q = value.q.trim();
  return {
    q: q === '' ? undefined : q,
    familyId: value.familyId,
    genusId: value.genusId,
    unresolved: value.unresolved ? true : undefined,
    status: value.status,
    scope: value.scope,
    plotId: value.plotId,
    categoryKey: value.categoryKey,
    traitId: value.traitId,
    traitData: value.traitData,
    sort: value.sort,
  };
}

// Everything the URL carries except the name. The name is typed a letter at
// a time and pushed on every keystroke, so a URL that differs only in `q` is
// this page's own echo and must not reset the form under the typist's
// fingers; a difference anywhere else came from outside (a sidebar link, the
// back button, a pasted link) and does reset it.
function filtersOf(value: SpeciesSearchValue): string {
  return JSON.stringify([
    value.familyId ?? null,
    value.genusId ?? null,
    value.unresolved,
    value.status ?? null,
    value.scope ?? null,
    value.plotId ?? null,
    value.categoryKey ?? null,
    value.traitId ?? null,
    value.traitData ?? null,
    value.sort ?? null,
  ]);
}

/**
 * Species catalog: the first page lists at once; the form's value, with the
 * name debounced, narrows it and starts over at page 1. A name shorter than
 * the API's minimum of two letters (RFC-60 R6) is not sent. The whole form
 * lives in the URL (RFC-60 R6 amendment): `search` seeds it and every change
 * is pushed back with `replace`, so `/app/species?traitId=…&traitData=missing`
 * from the trait page or the dashboard opens the list pre-filtered and the
 * address bar always mirrors the form. A change of any filter changes the
 * query key, which resets `usePagedList` to page 1 — that reset is what
 * keeps a cursor from crossing a change of order, where it would be invalid
 * (a `sort=name` cursor has two keys, a `sort=completeness` cursor three).
 * The records column is shown exactly while a trait filter is set, since
 * `traitRecordCount` answers "how many records for that trait" and is null
 * otherwise. The export link is a plain download, gated by dataset.export.
 * With `taxa.manage`, "New species" opens the species editor and a created
 * species opens its own page (RFC-60 R9). The form's status filter is
 * carried through to the search and the query key (RFC-33 R7).
 * Scope and plotId filter per RFC-33 R6 and RFC-67 R8.
 * @rfc RFC-13 R2, R3, R4
 * @rfc RFC-60 R6, R9
 * @rfc RFC-66 R1
 * @rfc RFC-33 R6, R7, R8
 */
export function SpeciesSearchPage({ search }: { search: SpeciesSearch }) {
  const me = useMe();
  const navigate = useNavigate();
  const incoming = toValue(search);
  const [form, setForm] = useState<SpeciesSearchValue>(incoming);
  const [seenFilters, setSeenFilters] = useState(() => filtersOf(incoming));
  const incomingFilters = filtersOf(incoming);
  if (incomingFilters !== seenFilters) {
    // The URL moved under the page (a sidebar link, the back button): adopt
    // it during this render rather than in an effect, so the form and the
    // search that follows it never disagree for a frame (React's
    // adjust-state-during-render pattern).
    setSeenFilters(incomingFilters);
    setForm(incoming);
  }
  const [creating, setCreating] = useState(false);
  const term = useDebouncedValue(form.q.trim(), 300);
  const params = {
    q: term.length >= 2 ? term : undefined,
    familyId: form.familyId,
    genusId: form.genusId,
    unresolved: form.unresolved,
    status: form.status,
    scope: form.scope,
    plotId: form.plotId,
    categoryKey: form.categoryKey,
    traitId: form.traitId,
    traitData: form.traitData,
    sort: form.sort,
  };
  const list = usePagedList(datasetKeys.species(params), (cursor, limit) =>
    searchSpecies({ ...params, cursor, limit }),
  );

  function update(next: SpeciesSearchValue) {
    setForm(next);
    void navigate({ to: '/app/species', search: toSearch(next), replace: true });
  }

  return (
    <>
      <PageHeader
        title="Species"
        description="Browse the taxonomy catalog, or narrow it by name, family, genus or trait."
        actions={
          hasPermission(me, 'taxa.manage') || hasPermission(me, 'dataset.export') ? (
            <>
              {hasPermission(me, 'taxa.manage') ? (
                <Button onClick={() => setCreating(true)}>New species</Button>
              ) : null}
              {hasPermission(me, 'dataset.export') ? (
                <a
                  href={EXPORT_ACCEPTED_URL}
                  download
                  // Dressed as the kit's secondary `Button` (md): a download stays an anchor.
                  className={buttonClassName({ variant: 'secondary' })}
                >
                  Export accepted values (CSV)
                </a>
              ) : null}
            </>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-6">
        <SpeciesSearchForm value={form} onChange={update} />
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading ? <p className="text-body text-mist-500">Searching…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No species match." />
        ) : null}
        {list.items.length > 0 ? (
          <SpeciesList items={list.items} showTraitRecords={Boolean(form.traitId)} />
        ) : null}
        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>
      {creating ? (
        <SpeciesDialog
          onClose={() => setCreating(false)}
          onSaved={(s) => {
            setCreating(false);
            navigate({ to: '/app/species/$id', params: { id: s.id } });
          }}
        />
      ) : null}
    </>
  );
}
