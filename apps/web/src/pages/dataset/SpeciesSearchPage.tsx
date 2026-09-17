import { useNavigate } from '@tanstack/react-router';
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
 * Species catalog: the first page lists at once; the form's value, with the
 * name debounced, narrows it and starts over at page 1. A name shorter than
 * the API's minimum of two letters (RFC-60 R6) is not sent. `initialUnresolved`
 * seeds the toggle from the route's `?unresolved=true` (the unresolved-taxa
 * nav entry); the export link is a plain download, gated by dataset.export.
 * With `taxa.manage`, "New species" opens the species editor and a created
 * species opens its own page (RFC-60 R9). The form's status filter is
 * carried through to the search and the query key (RFC-33 R7).
 * @rfc RFC-13 R2, R3, R4
 * @rfc RFC-60 R6, R9
 * @rfc RFC-66 R1
 * @rfc RFC-33 R7
 */
export function SpeciesSearchPage({ initialUnresolved = false }: { initialUnresolved?: boolean }) {
  const me = useMe();
  const navigate = useNavigate();
  const [form, setForm] = useState<SpeciesSearchValue>({ q: '', unresolved: initialUnresolved });
  const [creating, setCreating] = useState(false);
  const term = useDebouncedValue(form.q.trim(), 300);
  const params = {
    q: term.length >= 2 ? term : undefined,
    familyId: form.familyId,
    genusId: form.genusId,
    unresolved: form.unresolved,
    status: form.status,
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
        <SpeciesSearchForm value={form} onChange={setForm} />
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading ? <p className="text-body text-mist-500">Searching…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No species match." />
        ) : null}
        {list.items.length > 0 ? <SpeciesList items={list.items} /> : null}
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
