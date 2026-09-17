import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { SpeciesListItem } from '@treerepro/contracts';
import { useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { searchSpecies } from '../../api/dataset.ts';
import { addPlotSpecies, fetchPlotSpecies, plotKeys, removePlotSpecies } from '../../api/plots.ts';
import { useDebouncedValue } from '../../lib/use-debounced-value.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';
import { Pagination } from '../dataset/Pagination.tsx';
import {
  Alert,
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Section,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../ui/index.ts';

/**
 * Section on PlotPage: lists species in the plot, adds new species via combobox,
 * removes species behind a confirmation dialog.
 * @rfc RFC-67 R4, R5
 */
export function PlotSpeciesSection({
  plotId,
  canManage,
  onSpeciesChanged,
}: {
  plotId: string;
  canManage: boolean;
  onSpeciesChanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q.trim(), 300);
  const filter = { q: debouncedQ || undefined };

  const list = usePagedList(plotKeys.species(plotId, filter), (cursor, limit) =>
    fetchPlotSpecies(plotId, { ...filter, cursor, limit }),
  );

  const [selectedToAdd, setSelectedToAdd] = useState<ComboboxOption | null>(null);
  const [removingSpecies, setRemovingSpecies] = useState<SpeciesListItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: (speciesId: string) => addPlotSpecies(plotId, { speciesId }),
    onSuccess: () => {
      setSelectedToAdd(null);
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: plotKeys.detail(plotId) });
      void queryClient.invalidateQueries({ queryKey: ['plots', plotId, 'species'] });
      onSpeciesChanged?.();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'PLOT_SPECIES_EXISTS') {
        setActionError('This species is already in the plot.');
      } else {
        setActionError(err instanceof Error ? err.message : 'Could not add species to plot.');
      }
    },
  });

  const remove = useMutation({
    mutationFn: (speciesId: string) => removePlotSpecies(plotId, speciesId),
    onSuccess: () => {
      setRemovingSpecies(null);
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: plotKeys.detail(plotId) });
      void queryClient.invalidateQueries({ queryKey: ['plots', plotId, 'species'] });
      onSpeciesChanged?.();
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : 'Could not remove species from plot.');
    },
  });

  const searchCandidateSpecies = async (term: string): Promise<ComboboxOption[]> => {
    if (!term.trim()) return [];
    const page = await searchSpecies({ scope: 'all', q: term.trim(), limit: 20 });
    return page.data.map((s) => ({
      id: s.id,
      label: s.canonicalName,
      hint: s.family?.name,
    }));
  };

  return (
    <Section
      id="species"
      title="Species"
      description="Taxa observed or recorded in this field plot."
    >
      <div className="flex flex-col gap-4">
        {canManage ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full max-w-md">
              <Field id="add-plot-species" label="Add species to plot">
                <Combobox
                  id="add-plot-species"
                  value={selectedToAdd}
                  onChange={(opt) => {
                    setSelectedToAdd(opt);
                    if (opt) add.mutate(opt.id);
                  }}
                  search={searchCandidateSpecies}
                  searchKey="add-plot-species-combobox"
                  listLabel="Species candidates"
                  placeholder="Search species across entire dataset…"
                />
              </Field>
            </div>
            {add.isPending ? <p className="text-meta text-mist-500 pb-2">Adding species…</p> : null}
          </div>
        ) : null}

        {actionError ? <Alert tone="error">{actionError}</Alert> : null}

        <div className="max-w-xs">
          <Input
            type="search"
            placeholder="Filter plot species…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {list.error ? <Alert tone="error">Could not load species in plot.</Alert> : null}
        {list.isLoading ? <p className="text-body text-mist-500">Loading species…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No species in this plot match." />
        ) : null}

        {list.items.length > 0 ? (
          <Table>
            <Thead>
              <Tr>
                <Th>Canonical name</Th>
                <Th>Family</Th>
                <Th>Status</Th>
                {canManage ? <Th className="w-20">Actions</Th> : null}
              </Tr>
            </Thead>
            <Tbody>
              {list.items.map((sp) => (
                <Tr key={sp.id}>
                  <Td>
                    <Link
                      to="/app/species/$id"
                      params={{ id: sp.id }}
                      className="font-medium italic text-canopy-900 underline-offset-2 hover:underline"
                    >
                      {sp.canonicalName}
                    </Link>
                    {!sp.active ? (
                      <span className="ml-2">
                        <Badge tone="neutral">inactive</Badge>
                      </span>
                    ) : null}
                  </Td>
                  <Td>{sp.family?.name ?? '—'}</Td>
                  <Td>
                    {sp.unresolvedTaxon ? (
                      <Badge tone="amber">unresolved</Badge>
                    ) : (
                      <Badge tone="neutral">resolved</Badge>
                    )}
                  </Td>
                  {canManage ? (
                    <Td>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Remove ${sp.canonicalName}`}
                        onClick={() => setRemovingSpecies(sp)}
                      >
                        Remove
                      </Button>
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </Tbody>
          </Table>
        ) : null}

        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>

      {removingSpecies ? (
        <ConfirmDialog
          title={`Remove ${removingSpecies.canonicalName}?`}
          message="This species will be removed from this field plot."
          confirmLabel="Remove"
          danger
          pending={remove.isPending}
          onConfirm={() => remove.mutate(removingSpecies.id)}
          onClose={() => setRemovingSpecies(null)}
        />
      ) : null}
    </Section>
  );
}
