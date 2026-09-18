import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type {
  Genus,
  SpeciesSort,
  SpeciesStatus,
  TaxonRef,
  TraitDataMode,
} from '@treerepro/contracts';
import { type ReactNode, useId, useState } from 'react';
import { datasetKeys, fetchDictionary, fetchFamilies, fetchGenera } from '../../api/dataset.ts';
import { listPlots, plotKeys } from '../../api/plots.ts';
import { humaniseKey } from '../../lib/format.ts';
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
  categoryKey?: string;
  traitId?: string;
  traitData?: TraitDataMode;
  sort?: SpeciesSort;
}

const FIELDSET = 'flex flex-col gap-4 rounded-[12px] border border-canopy-700/15 px-4 pb-4';
const LEGEND = 'px-1.5 text-label font-bold uppercase tracking-[0.08em] text-canopy-800';
const CHECK = 'flex h-11 items-center gap-2.5 text-body text-canopy-900';

// A titled fieldset: the legend is the group's accessible name, so each of
// the three filter groups is one landmark a reader can jump to.
function Group({
  title,
  columns,
  children,
}: {
  title: string;
  columns: string;
  children: ReactNode;
}) {
  return (
    <fieldset className={FIELDSET}>
      <legend className={LEGEND}>{title}</legend>
      <div className={`grid gap-4 md:items-start ${columns}`}>{children}</div>
    </fieldset>
  );
}

/**
 * The filters of the species search, in three groups.
 *
 * **Taxonomy** — a name box, a family select, a genus combobox fed by the
 * genera prefix search, and the unresolved-taxa toggle. A genus belongs to a
 * family, so changing the family drops the chosen genus.
 *
 * **Traits** (RFC-60 R6 amendment) — a category select fed by the trait
 * dictionary, a trait select filtered to that category (disabled until a
 * category is chosen) and a "Has data" / "Missing data" radio pair (disabled
 * until a category or trait is chosen). A value that names a trait and no
 * category — what `/app/species?traitId=…` deep links carry — shows the
 * trait's own category, read out of the dictionary, so the filter in force
 * is visible and clearable. Choosing another category drops the trait, which
 * belonged to the old one; going back to "All categories" clears the whole
 * group, the derived category included, and so does going back to "All
 * traits" when the category was the trait's own — the mode never outlives
 * both of its companions. The radio shows "Has data" while nothing is
 * chosen because that is the API's default mode; the value only carries
 * `traitData` once the contributor picks a side.
 *
 * **Scope** — the plot select, the outside-plots toggle and, with
 * `dataset.read_inactive`, the Status select (RFC-33 R6, R7, RFC-67 R8);
 * without either the group is neither shown nor reachable, so the value
 * simply never carries a status or a plot.
 *
 * Below the groups, **Order by** chooses between the name order and
 * "Most incomplete first" (`sort=completeness`). Fully controlled — the page
 * owns the value, the debounce of the name and the mirror into the URL.
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
    category: useId(),
    trait: useId(),
    traitData: useId(),
    sort: useId(),
  };
  const families = useQuery({ queryKey: datasetKeys.families, queryFn: fetchFamilies });
  const dictionary = useQuery({ queryKey: datasetKeys.dictionary, queryFn: fetchDictionary });

  const hasPlots = Boolean(me.scope?.plots && me.scope.plots.length > 0);
  const canManagePlots = hasPermission(me, 'plots.manage');
  const canReadInactive = hasPermission(me, 'dataset.read_inactive');
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

  // A deep link may name a trait and no category — `/app/species?traitId=…`
  // is the link the trait page and the dashboard send people to (RFC-60 R6
  // amendment). The category the trait belongs to is then read out of the
  // dictionary, so the group shows the filter that is actually in force
  // instead of "All categories / All traits", and the contributor can see it
  // and clear it. Until the dictionary arrives there is nothing to derive
  // from; the selects fill in once it does.
  const derivedCategory = value.traitId
    ? dictionary.data?.find((category) =>
        category.traits.some((trait) => trait.id === value.traitId),
      )?.key
    : undefined;
  const effectiveCategory = value.categoryKey ?? derivedCategory;
  const categoryTraits =
    dictionary.data?.find((category) => category.key === effectiveCategory)?.traits ?? [];
  // The API's default is `with`; the radio shows it before a side is picked.
  const traitData = value.traitData ?? 'with';
  const traitFilterChosen = Boolean(effectiveCategory ?? value.traitId);

  return (
    <div className="flex flex-col gap-4">
      <Group title="Taxonomy" columns="md:grid-cols-[2fr_1fr_1fr_auto]">
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
        <label className={CHECK}>
          <input
            type="checkbox"
            className="size-5 accent-canopy-700"
            checked={value.unresolved}
            onChange={(event) => onChange({ ...value, unresolved: event.target.checked })}
          />
          Unresolved taxa only
        </label>
      </Group>

      <Group title="Traits" columns="md:grid-cols-[1fr_1fr_auto]">
        <Field
          id={ids.category}
          label="Category"
          error={dictionary.isError ? 'Could not load the trait dictionary.' : undefined}
        >
          <Select
            id={ids.category}
            value={effectiveCategory ?? ''}
            onChange={(event) => {
              const categoryKey = event.target.value || undefined;
              onChange({
                ...value,
                categoryKey,
                // The trait belonged to the old category, and with no
                // category left there is nothing for a mode to apply to.
                traitId: undefined,
                traitData: categoryKey ? value.traitData : undefined,
              });
            }}
          >
            <option value="">All categories</option>
            {dictionary.data?.map((category) => (
              <option key={category.key} value={category.key}>
                {category.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={ids.trait} label="Trait">
          <Select
            id={ids.trait}
            disabled={!effectiveCategory}
            value={value.traitId ?? ''}
            onChange={(event) => {
              const traitId = event.target.value || undefined;
              // When the category was derived from the trait, clearing the
              // trait clears the category with it, and a mode with neither
              // companion has nothing to apply to — the same rule the
              // category select applies when it goes back to all. A category
              // the contributor chose outright survives, and so does the mode.
              const stillFiltered = traitId !== undefined || value.categoryKey !== undefined;
              onChange({
                ...value,
                traitId,
                traitData: stillFiltered ? value.traitData : undefined,
              });
            }}
          >
            <option value="">All traits</option>
            {categoryTraits.map((trait) => (
              <option key={trait.id} value={trait.id}>
                {humaniseKey(trait.key)}
              </option>
            ))}
          </Select>
        </Field>
        <fieldset disabled={!traitFilterChosen} className="flex flex-col gap-2">
          <legend className={LEGEND}>Data</legend>
          <div className="flex flex-wrap items-center gap-6">
            <label className={CHECK}>
              <input
                type="radio"
                className="size-5 accent-canopy-700"
                name={ids.traitData}
                value="with"
                checked={traitData === 'with'}
                onChange={() => onChange({ ...value, traitData: 'with' })}
              />
              Has data
            </label>
            <label className={CHECK}>
              <input
                type="radio"
                className="size-5 accent-canopy-700"
                name={ids.traitData}
                value="missing"
                checked={traitData === 'missing'}
                onChange={() => onChange({ ...value, traitData: 'missing' })}
              />
              Missing data
            </label>
          </div>
        </fieldset>
      </Group>

      {showScopeGroup || canReadInactive ? (
        <Group title="Scope" columns="md:grid-cols-[1fr_1fr_auto]">
          {showScopeGroup ? (
            <Field id={ids.plot} label="Plot">
              <Select
                id={ids.plot}
                value={value.plotId ?? ''}
                onChange={(event) =>
                  onChange({ ...value, plotId: event.target.value || undefined })
                }
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
          {hasPlots && !me.scope.restricted ? (
            <label className={CHECK}>
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
        </Group>
      ) : null}

      <div className="md:w-64">
        <Field id={ids.sort} label="Order by">
          <Select
            id={ids.sort}
            value={value.sort ?? 'name'}
            onChange={(event) =>
              onChange({
                ...value,
                // `name` is the API's default order; leaving it off keeps
                // the URL to the filters that actually narrow the list.
                sort: event.target.value === 'completeness' ? 'completeness' : undefined,
              })
            }
          >
            <option value="name">Name</option>
            <option value="completeness">Most incomplete first</option>
          </Select>
        </Field>
      </div>
    </div>
  );
}
