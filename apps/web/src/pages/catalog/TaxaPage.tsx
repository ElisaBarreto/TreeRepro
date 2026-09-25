import { useQuery } from '@tanstack/react-query';
import type { Genus, TaxonRef } from '@treerepro/contracts';
import { useEffect, useId, useState } from 'react';
import { createFamily, createGenus, updateFamily, updateGenus } from '../../api/catalog.ts';
import { datasetKeys, fetchFamilies, fetchGenera } from '../../api/dataset.ts';
import { MoveGenusDialog } from '../../components/catalog/MoveGenusDialog.tsx';
import { TaxonNameDialog } from '../../components/catalog/TaxonNameDialog.tsx';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import { NoPermission } from '../../components/shell/NoPermission.tsx';
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { useDebouncedValue } from '../../lib/use-debounced-value.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

const DASH = <span className="text-mist-500">—</span>;
const FAMILY_TAKEN = 'A family with this name already exists.';
const GENUS_TAKEN = 'A genus with this name already exists.';

type TaxaDialog =
  | { kind: 'newFamily' }
  | { kind: 'renameFamily'; family: TaxonRef }
  | { kind: 'newGenus'; family: TaxonRef }
  | { kind: 'renameGenus'; genus: Genus }
  | { kind: 'move'; genus: Genus };

/**
 * The one place a family or a genus is created, renamed or moved (RFC-60
 * R9, curation spec 10.4). Gate first — `taxa.manage` on the client side
 * only, the API decides — then the editor, whose hooks may not follow an
 * early return.
 * @rfc RFC-13 R2, R3, R4
 * @rfc RFC-60 R8, R9
 */
export function TaxaPage() {
  if (!hasPermission(useMe(), 'taxa.manage')) return <NoPermission />;
  return <TaxaEditor />;
}

/**
 * Two columns: every family (name order, filtered client-side) with New
 * family above; the selected family's genera with Rename family and New
 * genus, or — while a search term is typed — the genera matching it across
 * every family, the only way to reach a genus that has none. The selection
 * holds the id, so a rename re-renders the name from the refetched list.
 */
function TaxaEditor() {
  const ids = { filter: useId(), search: useId() };
  const families = useQuery({ queryKey: datasetKeys.families, queryFn: fetchFamilies });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 300);
  const [dialog, setDialog] = useState<TaxaDialog | null>(null);

  const first = families.data?.[0];
  useEffect(() => {
    if (selectedId === null && first) setSelectedId(first.id);
  }, [selectedId, first]);

  const selected = families.data?.find((family) => family.id === selectedId);
  const needle = filter.trim().toLowerCase();
  const shown = families.data?.filter((family) => family.name.toLowerCase().includes(needle)) ?? [];
  // Nothing to list before a family is selected or a term is typed.
  const listing = term !== '' || selectedId !== null;
  const genera = usePagedList(
    datasetKeys.genera(term ? { q: term } : { familyId: selectedId ?? '' }),
    (cursor, limit) =>
      fetchGenera(
        term ? { q: term, cursor, limit } : { familyId: selectedId ?? undefined, cursor, limit },
      ),
    { enabled: listing },
  );
  const closeDialog = () => setDialog(null);

  return (
    <>
      <PageHeader
        title="Taxa"
        description="Families and genera of the catalog: create, rename and move. Species are edited on their own page."
      />
      {families.isError ? <Alert tone="error">{pageErrorMessage(families.error)}</Alert> : null}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Button onClick={() => setDialog({ kind: 'newFamily' })}>New family</Button>
          <Field id={ids.filter} label="Filter families">
            <Input
              id={ids.filter}
              type="search"
              autoComplete="off"
              maxLength={200}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </Field>
          {families.isSuccess && families.data.length === 0 ? (
            <EmptyState title="No family yet." />
          ) : null}
          {families.isSuccess && families.data.length > 0 && shown.length === 0 ? (
            <EmptyState title="No family matches." />
          ) : null}
          {shown.length > 0 ? (
            <ul aria-label="Families" className="flex flex-col gap-1">
              {shown.map((family) => (
                <li key={family.id}>
                  <button
                    type="button"
                    aria-pressed={family.id === selectedId}
                    onClick={() => setSelectedId(family.id)}
                    className="flex w-full items-center rounded-lg px-3 py-2 text-left text-body text-canopy-900 hover:bg-mist-100 aria-pressed:bg-canopy-200/60 aria-pressed:font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
                  >
                    {family.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {term ? (
              <h2 className="font-display text-section font-semibold text-canopy-950">
                Genera matching “{term}”
              </h2>
            ) : selected ? (
              <>
                <h2 className="font-display text-section font-semibold text-canopy-950">
                  {selected.name}
                </h2>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setDialog({ kind: 'renameFamily', family: selected })}
                  >
                    Rename family
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setDialog({ kind: 'newGenus', family: selected })}
                  >
                    New genus
                  </Button>
                </div>
              </>
            ) : null}
          </div>
          <div className="max-w-md">
            <Field id={ids.search} label="Search genera">
              <Input
                id={ids.search}
                type="search"
                autoComplete="off"
                maxLength={100}
                placeholder="Genus name, across every family"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
          </div>
          {genera.error ? <Alert tone="error">{pageErrorMessage(genera.error)}</Alert> : null}
          {listing && genera.isLoading ? (
            <p className="text-body text-mist-500">Loading genera…</p>
          ) : null}
          {genera.items.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Family</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {genera.items.map((genus) => (
                  <Tr key={genus.id}>
                    <Td className="font-medium text-canopy-950">{genus.name}</Td>
                    <Td>{genus.family?.name ?? DASH}</Td>
                    <Td>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={`Rename ${genus.name}`}
                          onClick={() => setDialog({ kind: 'renameGenus', genus })}
                        >
                          Rename
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={`Move ${genus.name}`}
                          onClick={() => setDialog({ kind: 'move', genus })}
                        >
                          Move
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : null}
          {listing && !genera.isLoading && !genera.error && genera.items.length === 0 ? (
            <EmptyState title={term ? 'No genus matches.' : 'No genus in this family yet.'} />
          ) : null}
          {genera.items.length > 0 || genera.page > 1 ? <Pagination pager={genera} /> : null}
        </div>
      </div>
      {dialog?.kind === 'newFamily' ? (
        <TaxonNameDialog
          title="New family"
          label="Family name"
          submitLabel="Create"
          takenMessage={FAMILY_TAKEN}
          save={(name) => createFamily({ name })}
          onClose={closeDialog}
          onSaved={closeDialog}
        />
      ) : null}
      {dialog?.kind === 'renameFamily' ? (
        <TaxonNameDialog
          title="Rename family"
          label="Family name"
          initial={dialog.family.name}
          submitLabel="Rename"
          takenMessage={FAMILY_TAKEN}
          save={(name) => updateFamily(dialog.family.id, { name })}
          onClose={closeDialog}
          onSaved={closeDialog}
        />
      ) : null}
      {dialog?.kind === 'newGenus' ? (
        <TaxonNameDialog
          title="New genus"
          label="Genus name"
          submitLabel="Create"
          takenMessage={GENUS_TAKEN}
          save={(name) => createGenus({ name, familyId: dialog.family.id })}
          onClose={closeDialog}
          onSaved={closeDialog}
        />
      ) : null}
      {dialog?.kind === 'renameGenus' ? (
        <TaxonNameDialog
          title="Rename genus"
          label="Genus name"
          initial={dialog.genus.name}
          submitLabel="Rename"
          takenMessage={GENUS_TAKEN}
          save={(name) => updateGenus(dialog.genus.id, { name })}
          onClose={closeDialog}
          onSaved={closeDialog}
        />
      ) : null}
      {dialog?.kind === 'move' ? (
        <MoveGenusDialog
          genus={dialog.genus}
          families={families.data ?? []}
          onClose={closeDialog}
          onSaved={closeDialog}
        />
      ) : null}
    </>
  );
}
