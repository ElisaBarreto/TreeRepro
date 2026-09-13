import { useState } from 'react';
import { datasetKeys, searchSpecies } from '../../api/dataset.ts';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import { SpeciesList } from '../../components/dataset/SpeciesList.tsx';
import {
  SpeciesSearchForm,
  type SpeciesSearchValue,
} from '../../components/dataset/SpeciesSearchForm.tsx';
import { Alert, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { useDebouncedValue } from '../../lib/use-debounced-value.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

/**
 * Species catalog: the first page lists at once; the form's value, with the
 * name debounced, narrows it and starts over at page 1. A name shorter than
 * the API's minimum of two letters (RFC-60 R6) is not sent.
 * @rfc RFC-13 R2, R4
 * @rfc RFC-60 R6
 */
export function SpeciesSearchPage() {
  const [form, setForm] = useState<SpeciesSearchValue>({ q: '', unresolved: false });
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
