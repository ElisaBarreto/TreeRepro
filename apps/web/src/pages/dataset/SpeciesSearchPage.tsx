import { useState } from 'react';
import { EXPORT_ACCEPTED_URL } from '../../api/curation.ts';
import { datasetKeys, searchSpecies } from '../../api/dataset.ts';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import { SpeciesList } from '../../components/dataset/SpeciesList.tsx';
import {
  SpeciesSearchForm,
  type SpeciesSearchValue,
} from '../../components/dataset/SpeciesSearchForm.tsx';
import { Alert, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { useDebouncedValue } from '../../lib/use-debounced-value.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

/**
 * Species catalog: the first page lists at once; the form's value, with the
 * name debounced, narrows it and starts over at page 1. A name shorter than
 * the API's minimum of two letters (RFC-60 R6) is not sent. `initialUnresolved`
 * seeds the toggle from the route's `?unresolved=true` (the unresolved-taxa
 * nav entry); the export link is a plain download, gated by dataset.export.
 * @rfc RFC-13 R2, R4
 * @rfc RFC-60 R6
 * @rfc RFC-66 R1
 */
export function SpeciesSearchPage({ initialUnresolved = false }: { initialUnresolved?: boolean }) {
  const me = useMe();
  const [form, setForm] = useState<SpeciesSearchValue>({ q: '', unresolved: initialUnresolved });
  const term = useDebouncedValue(form.q.trim(), 300);
  const params = {
    q: term.length >= 2 ? term : undefined,
    familyId: form.familyId,
    genusId: form.genusId,
    unresolved: form.unresolved,
  };
  const list = usePagedList(datasetKeys.species(params), (cursor, limit) =>
    searchSpecies({ ...params, cursor, limit }),
  );

  return (
    <>
      <PageHeader
        title="Species"
        description="Browse the taxonomy catalog, or narrow it by name, family or genus."
        actions={
          hasPermission(me, 'dataset.export') ? (
            <a
              href={EXPORT_ACCEPTED_URL}
              download
              // Dressed as the kit's secondary `Button` (md): a download stays an anchor.
              className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-canopy-700/30 bg-white px-5 font-display text-cell font-semibold text-canopy-900 transition-colors hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
            >
              Export accepted values (CSV)
            </a>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-6">
        <SpeciesSearchForm value={form} onChange={setForm} />
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading ? <p className="text-body text-mist-500">Searching…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No species match." />
        ) : null}
        {list.items.length > 0 ? <SpeciesList items={list.items} /> : null}
        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>
    </>
  );
}
