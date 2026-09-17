import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Genus, SpeciesStatus, TaxonRef } from '@treerepro/contracts';
import { useId, useState } from 'react';
import { datasetKeys, fetchFamilies, fetchGenera } from '../../api/dataset.ts';
import { listPlots, plotKeys } from '../../api/plots.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { useDebouncedValue } from '../../lib/use-debounced-value.ts';
import { Badge, Button, Field, Input, Select } from '../ui/index.ts';

export interface SpeciesSearchValue {
  q: string;
  familyId?: string;
  genusId?: string;
  unresolved: boolean;
  status?: SpeciesStatus;
  scope?: 'plots' | 'all';
  plotId?: string;
}

/**
 * The filters of the species search: a name box, a family select, a genus
 * combobox fed by the genera prefix search, and the unresolved-taxa toggle.
 * Fully controlled — the page owns the value and the debounce of the name.
 * A genus belongs to a family, so changing the family drops the chosen genus.
 * With `dataset.read_inactive`, a Status select (All / Active / Inactive)
 * also renders (RFC-33 R7); without it the filter is neither shown nor
 * reachable, so the value simply never carries a status.
 * With assigned plots or `plots.manage`, a Plot filter and an outside-plots
 * toggle render (RFC-33 R6, RFC-67 R8).
 * @rfc RFC-13 R2
 * @rfc RFC-60 R6, R8
 * @rfc RFC-33 R6, R7, R8
 */
export function SpeciesSearchForm({
  value,
  onChange,
}: {
  value: SpeciesSearchValue;
  onChange: (next: SpeciesSearchValue) => void;
}) {
  const me = useMe();
  const ids = {
    q: useId(),
    family: useId(),
    genus: useId(),
    genera: useId(),
    status: useId(),
    plot: useId(),
  };
  const families = useQuery({ queryKey: datasetKeys.families, queryFn: fetchFamilies });

  const hasPlots = Boolean(me.scope?.plots && me.scope.plots.length > 0);
  const canManagePlots = hasPermission(me, 'plots.manage');
  const showScopeGroup = hasPlots || canManagePlots;

  const allPlotsQuery = useQuery({
    queryKey: plotKeys.list({ limit: 200 }),
    queryFn: () => listPlots({ limit: 200 }),
    enabled: canManagePlots,
  });
  const availablePlots = canManagePlots
    ? (allPlotsQuery.data?.data ?? me.scope?.plots ?? [])
    : (me.scope?.plots ?? []);

  const [genusText, setGenusText] = useState('');
  const [chosenGenus, setChosenGenus] = useState<TaxonRef | null>(null);
  const genusTerm = useDebouncedValue(genusText.trim(), 300);
  const generaParams = { familyId: value.familyId, q: genusTerm, limit: 20 };
  const genera = useQuery({
    queryKey: datasetKeys.genera(generaParams),
    queryFn: () => fetchGenera(generaParams),
    enabled: genusTerm.length >= 1,
    // Keeps the current suggestions on screen while the next prefix loads.
    placeholderData: keepPreviousData,
  });
  const suggestions = genusText.trim().length >= 1 ? genera.data?.data : undefined;

  function chooseGenus(genus: Genus) {
    setChosenGenus({ id: genus.id, name: genus.name });
    setGenusText('');
    onChange({ ...value, genusId: genus.id });
  }
  function clearGenus() {
    setChosenGenus(null);
    onChange({ ...value, genusId: undefined });
  }

  const canReadInactive = hasPermission(me, 'dataset.read_inactive');

  return (
    <div
      className={`grid gap-4 md:items-start ${
        canReadInactive && showScopeGroup
          ? 'md:grid-cols-[2fr_1fr_1fr_1fr_1fr]'
          : canReadInactive || showScopeGroup
            ? 'md:grid-cols-[2fr_1fr_1fr_1fr]'
            : 'md:grid-cols-[2fr_1fr_1fr]'
      }`}
    >
      <Field id={ids.q} label="Search species">
        <Input
          id={ids.q}
          type="search"
          autoComplete="off"
          maxLength={100}
          placeholder="Canonical or alternative name"
          value={value.q}
          onChange={(event) => onChange({ ...value, q: event.target.value })}
        />
      </Field>
      <Field
        id={ids.family}
        label="Family"
        error={families.isError ? 'Could not load families.' : undefined}
      >
        <Select
          id={ids.family}
          value={value.familyId ?? ''}
          onChange={(event) => {
            setChosenGenus(null);
            onChange({ ...value, familyId: event.target.value || undefined, genusId: undefined });
          }}
        >
          <option value="">All families</option>
          {families.data?.map((family) => (
            <option key={family.id} value={family.id}>
              {family.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-col gap-2">
        <Field
          id={ids.genus}
          label="Genus"
          error={genera.isError ? 'Could not load genera.' : undefined}
        >
          <Input
            id={ids.genus}
            role="combobox"
            autoComplete="off"
            maxLength={100}
            aria-autocomplete="list"
            aria-expanded={suggestions !== undefined}
            aria-controls={suggestions !== undefined ? ids.genera : undefined}
            placeholder="Type to search genera"
            value={genusText}
            onChange={(event) => setGenusText(event.target.value)}
          />
        </Field>
        {suggestions !== undefined ? (
          suggestions.length > 0 ? (
            <div
              id={ids.genera}
              role="listbox"
              aria-label="Genus suggestions"
              className="max-h-64 overflow-y-auto rounded-[10px] border border-canopy-700/15 bg-white py-1 text-cell shadow-sm"
            >
              {suggestions.map((genus) => (
                <button
                  key={genus.id}
                  type="button"
                  role="option"
                  aria-selected={genus.id === value.genusId}
                  className="flex w-full items-baseline gap-2 px-3.5 py-2.5 text-left hover:bg-mist-50 focus-visible:bg-mist-50 focus-visible:outline-none"
                  onClick={() => chooseGenus(genus)}
                >
                  <span className="italic">{genus.name}</span>
                  {genus.family ? (
                    <span className="text-meta text-mist-500">{genus.family.name}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-meta text-mist-500">No genus matches.</p>
          )
        ) : null}
        {value.genusId ? (
          <div className="flex items-center gap-2">
            <Badge tone="green">
              <span className="italic">{chosenGenus?.name ?? 'Selected genus'}</span>
            </Badge>
            <Button variant="secondary" size="sm" aria-label="Clear genus" onClick={clearGenus}>
              Clear
            </Button>
          </div>
        ) : null}
      </div>
      {showScopeGroup ? (
        <Field id={ids.plot} label="Plot">
          <Select
            id={ids.plot}
            value={value.plotId ?? ''}
            onChange={(event) => onChange({ ...value, plotId: event.target.value || undefined })}
          >
            <option value="">All plots</option>
            {availablePlots.map((plot) => (
              <option key={plot.id} value={plot.id}>
                {plot.code} — {plot.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {canReadInactive ? (
        <Field id={ids.status} label="Status">
          <Select
            id={ids.status}
            value={value.status ?? 'all'}
            onChange={(event) =>
              onChange({ ...value, status: event.target.value as SpeciesStatus })
            }
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
      ) : null}
      <div
        className={`flex flex-wrap items-center gap-6 ${
          canReadInactive && showScopeGroup
            ? 'md:col-span-5'
            : canReadInactive || showScopeGroup
              ? 'md:col-span-4'
              : 'md:col-span-3'
        }`}
      >
        <label className="flex h-11 items-center gap-2.5 text-body text-canopy-900">
          <input
            type="checkbox"
            className="size-5 accent-canopy-700"
            checked={value.unresolved}
            onChange={(event) => onChange({ ...value, unresolved: event.target.checked })}
          />
          Unresolved taxa only
        </label>
        {hasPlots && !me.scope.restricted ? (
          <label className="flex h-11 items-center gap-2.5 text-body text-canopy-900">
            <input
              type="checkbox"
              className="size-5 accent-canopy-700"
              checked={value.scope ? value.scope === 'all' : canReadInactive}
              onChange={(event) =>
                onChange({ ...value, scope: event.target.checked ? 'all' : 'plots' })
              }
            />
            Show species outside my plots
          </label>
        ) : null}
      </div>
    </div>
  );
}
