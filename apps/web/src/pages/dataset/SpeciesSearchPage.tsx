import { useState } from 'react';
import { datasetKeys, searchSpecies } from '../../api/dataset.ts';
import { LoadMore } from '../../components/dataset/LoadMore.tsx';
import { SpeciesList } from '../../components/dataset/SpeciesList.tsx';
import {
  SpeciesSearchForm,
  type SpeciesSearchValue,
} from '../../components/dataset/SpeciesSearchForm.tsx';
import { Alert, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { useCursorList } from '../../lib/use-cursor-list.ts';
import { useDebouncedValue } from '../../lib/use-debounced-value.ts';

const PAGE_SIZE = 50;

/**
 * Species search: the form's value, with the name debounced, becomes the
 * query parameters; the list only runs once there is something to search by
 * (two letters, a family, a genus or the unresolved toggle).
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
  const enabled = Boolean(params.q || params.familyId || params.genusId || params.unresolved);
  const list = useCursorList(
    datasetKeys.species(params),
    (cursor) => searchSpecies({ ...params, cursor, limit: PAGE_SIZE }),
    { enabled },
  );

  return (
    <>
      <PageHeader
        title="Species"
        description="Search the taxonomy catalog by name, family or genus."
      />
      <div className="flex flex-col gap-6">
        <SpeciesSearchForm value={form} onChange={setForm} />
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {!enabled ? (
          <EmptyState title="Type at least two letters, or choose a family or genus." />
        ) : null}
        {enabled && list.isLoading ? <p className="text-sm text-mist-500">Searching…</p> : null}
        {enabled && !list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No species match." />
        ) : null}
        {list.items.length > 0 ? <SpeciesList items={list.items} /> : null}
        {enabled ? (
          <LoadMore
            hasMore={list.hasMore}
            isLoadingMore={list.isLoadingMore}
            onLoadMore={list.loadMore}
          />
        ) : null}
      </div>
    </>
  );
}
