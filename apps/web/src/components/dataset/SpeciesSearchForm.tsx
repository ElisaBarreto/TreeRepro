import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Genus, TaxonRef } from '@treerepro/contracts';
import { useId, useState } from 'react';
import { datasetKeys, fetchFamilies, fetchGenera } from '../../api/dataset.ts';
import { useDebouncedValue } from '../../lib/use-debounced-value.ts';
import { Badge, Button, Field, Input } from '../ui/index.ts';

export interface SpeciesSearchValue {
  q: string;
  familyId?: string;
  genusId?: string;
  unresolved: boolean;
}

const SELECT =
  'h-10 w-full rounded-lg border border-canopy-700/25 bg-white px-3 text-[15px] text-canopy-950 outline-none transition-colors focus:border-pollen-500';

/**
 * The filters of the species search: a name box, a family select, a genus
 * combobox fed by the genera prefix search, and the unresolved-taxa toggle.
 * Fully controlled — the page owns the value and the debounce of the name.
 * A genus belongs to a family, so changing the family drops the chosen genus.
 * @rfc RFC-13 R2
 * @rfc RFC-60 R6, R8
 */
export function SpeciesSearchForm({
  value,
  onChange,
}: {
  value: SpeciesSearchValue;
  onChange: (next: SpeciesSearchValue) => void;
}) {
  const ids = { q: useId(), family: useId(), genus: useId(), genera: useId() };
  const families = useQuery({ queryKey: datasetKeys.families, queryFn: fetchFamilies });

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

  return (
    <div className="grid gap-4 md:grid-cols-[2fr_1fr_1fr] md:items-start">
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
        <select
          id={ids.family}
          className={SELECT}
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
        </select>
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
              className="max-h-64 overflow-y-auto rounded-lg border border-canopy-700/15 bg-white py-1 text-sm shadow-sm"
            >
              {suggestions.map((genus) => (
                // The option is the button itself: it is what a keyboard
                // reaches and what an assistive technology activates.
                <button
                  key={genus.id}
                  type="button"
                  role="option"
                  aria-selected={genus.id === value.genusId}
                  className="flex w-full items-baseline gap-2 px-3 py-2 text-left hover:bg-mist-50 focus-visible:bg-mist-50 focus-visible:outline-none"
                  onClick={() => chooseGenus(genus)}
                >
                  <span className="italic">{genus.name}</span>
                  {genus.family ? (
                    <span className="text-xs text-mist-500">{genus.family.name}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-mist-500">No genus matches.</p>
          )
        ) : null}
        {value.genusId ? (
          <div className="flex items-center gap-2">
            <Badge tone="green">
              <span className="italic">{chosenGenus?.name ?? 'Selected genus'}</span>
            </Badge>
            <Button variant="secondary" aria-label="Clear genus" onClick={clearGenus}>
              Clear
            </Button>
          </div>
        ) : null}
      </div>
      <label className="flex h-10 items-center gap-2 text-sm text-canopy-900 md:col-span-3">
        <input
          type="checkbox"
          className="size-4 accent-pollen-500"
          checked={value.unresolved}
          onChange={(event) => onChange({ ...value, unresolved: event.target.checked })}
        />
        Unresolved taxa only
      </label>
    </div>
  );
}
