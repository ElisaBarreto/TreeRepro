import { useQuery } from '@tanstack/react-query';
import type { SpeciesSort, SpeciesStatus, TraitDataMode } from '@treerepro/contracts';
import { useId } from 'react';
import { datasetKeys, fetchDictionary } from '../../api/dataset.ts';
import { listPlots, plotKeys } from '../../api/plots.ts';
import { humaniseKey } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { Field, Select } from '../ui/index.ts';
import { FILTER_CHECK, FILTER_LEGEND, FilterGroup } from './FilterGroup.tsx';
import { TaxonomyFilters } from './TaxonomyFilters.tsx';

export interface SpeciesSearchValue {
  q: string;
  familyId?: string;
  genusId?: string;
  unresolved: boolean;
  contested: boolean;
  unknownLevels: boolean;
  status?: SpeciesStatus;
  scope?: 'plots' | 'all';
  plotId?: string;
  categoryKey?: string;
  traitId?: string;
  traitData?: TraitDataMode;
  sort?: SpeciesSort;
}

/**
 * The filters of the species search, in three groups.
 *
 * **Taxonomy** — {@link TaxonomyFilters}, the group the trait page renders
 * too, with the unresolved-taxa toggle this form alone offers.
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
 * `dataset.read_inactive`, the Status select (RFC-33 R6, R7, RFC-67 R8),
 * plus **Contested only** for everyone and **Has unknown levels** with
 * `records.review` (spec R-15); the unresolved toggle of the Taxonomy group
 * is shown with `records.review` only. The group itself always renders, so
 * the two checkboxes it offers every viewer are always reachable.
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
    status: useId(),
    plot: useId(),
    category: useId(),
    trait: useId(),
    traitData: useId(),
    sort: useId(),
  };
  const dictionary = useQuery({
    queryKey: datasetKeys.dictionary(),
    queryFn: () => fetchDictionary(),
  });

  const hasPlots = Boolean(me.scope?.plots && me.scope.plots.length > 0);
  const canManagePlots = hasPermission(me, 'plots.manage');
  const canReadInactive = hasPermission(me, 'dataset.read_inactive');
  const canReview = hasPermission(me, 'records.review');
  const showScopeGroup = hasPlots || canManagePlots;

  const allPlotsQuery = useQuery({
    queryKey: plotKeys.list({ limit: 200 }),
    queryFn: () => listPlots({ limit: 200 }),
    enabled: canManagePlots,
  });
  const availablePlots = canManagePlots
    ? (allPlotsQuery.data?.data ?? me.scope?.plots ?? [])
    : (me.scope?.plots ?? []);

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
      <TaxonomyFilters
        showUnresolved={canReview}
        value={{
          q: value.q,
          familyId: value.familyId,
          genusId: value.genusId,
          unresolved: value.unresolved,
        }}
        onChange={(next) => onChange({ ...value, ...next, unresolved: next.unresolved === true })}
      />

      <FilterGroup title="Traits" columns="md:grid-cols-[1fr_1fr_auto]">
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
          <legend className={FILTER_LEGEND}>Data</legend>
          <div className="flex flex-wrap items-center gap-6">
            <label className={FILTER_CHECK}>
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
            <label className={FILTER_CHECK}>
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
      </FilterGroup>

      <FilterGroup title="Scope" columns="md:grid-cols-[1fr_1fr_auto]">
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
        {hasPlots && !me.scope.restricted ? (
          <label className={FILTER_CHECK}>
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
        <label className={FILTER_CHECK}>
          <input
            type="checkbox"
            className="size-5 accent-canopy-700"
            checked={value.contested}
            onChange={(event) => onChange({ ...value, contested: event.target.checked })}
          />
          Contested only
        </label>
        {canReview ? (
          <label className={FILTER_CHECK}>
            <input
              type="checkbox"
              className="size-5 accent-canopy-700"
              checked={value.unknownLevels}
              onChange={(event) => onChange({ ...value, unknownLevels: event.target.checked })}
            />
            Has unknown levels
          </label>
        ) : null}
      </FilterGroup>

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
