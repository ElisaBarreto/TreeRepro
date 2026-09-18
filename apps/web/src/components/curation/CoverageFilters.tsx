import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { datasetKeys, fetchDictionary, fetchFamilies } from '../../api/dataset.ts';
import { fetchAllPlots, plotKeys } from '../../api/plots.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { FilterGroup } from '../dataset/FilterGroup.tsx';
import { Field, Select } from '../ui/index.ts';

/**
 * Every filter of the coverage page as a URL search param (spec §5), so a
 * link from elsewhere (the dashboard's "View coverage") can open it
 * pre-filtered and a filtered view can be shared. Owned here rather than in
 * the page, since the page only threads it through to this component and to
 * the `/api/coverage` query.
 * @rfc RFC-13 R2
 * @rfc RFC-69 R5
 */
export interface CoverageSearch {
  familyId?: string;
  categoryKey?: string;
  plotId?: string;
}

/**
 * The coverage page's three filters (spec §5), each a URL search param the
 * caller owns: family (`GET /api/families`), category (the trait
 * dictionary) and plot. The plot select renders only for a viewer who holds
 * `plots.manage` (fed by `fetchAllPlots`, every plot, paged to exhaustion) or
 * who has at least one assigned plot (`me.scope.plots`, fed straight from the
 * session, no extra request) — the same rule `SpeciesSearchForm`'s scope
 * group uses. Every control writes straight through `onSearchChange`; there
 * is no local echo to debounce, since every filter here is a discrete choice,
 * not free text.
 * @rfc RFC-13 R2
 * @rfc RFC-69 R5
 */
export function CoverageFilters({
  search,
  onSearchChange,
}: {
  search: CoverageSearch;
  onSearchChange: (next: CoverageSearch) => void;
}) {
  const me = useMe();
  const canManagePlots = hasPermission(me, 'plots.manage');
  const showPlotFilter = canManagePlots || me.scope.plots.length > 0;
  const ids = { family: useId(), category: useId(), plot: useId() };

  const families = useQuery({ queryKey: datasetKeys.families, queryFn: fetchFamilies });
  const dictionary = useQuery({
    queryKey: datasetKeys.dictionary(),
    queryFn: () => fetchDictionary(),
  });
  // Paged to exhaustion, like the `fetchFamilies` query above: a select that
  // holds page one only drops every plot past the limit, and a filter the
  // viewer cannot pick is a filter `/api/coverage` will never be asked for.
  const allPlots = useQuery({
    queryKey: plotKeys.fullList,
    queryFn: fetchAllPlots,
    enabled: canManagePlots,
  });
  const availablePlots = canManagePlots ? (allPlots.data ?? me.scope.plots) : me.scope.plots;

  return (
    <FilterGroup title="Filters" columns={showPlotFilter ? 'md:grid-cols-3' : 'md:grid-cols-2'}>
      <Field
        id={ids.family}
        label="Family"
        error={families.isError ? 'Could not load families.' : undefined}
      >
        <Select
          id={ids.family}
          value={search.familyId ?? ''}
          onChange={(event) =>
            onSearchChange({ ...search, familyId: event.target.value || undefined })
          }
        >
          <option value="">All families</option>
          {families.data?.map((family) => (
            <option key={family.id} value={family.id}>
              {family.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        id={ids.category}
        label="Category"
        error={dictionary.isError ? 'Could not load the trait dictionary.' : undefined}
      >
        <Select
          id={ids.category}
          value={search.categoryKey ?? ''}
          onChange={(event) =>
            onSearchChange({ ...search, categoryKey: event.target.value || undefined })
          }
        >
          <option value="">All categories</option>
          {dictionary.data?.map((category) => (
            <option key={category.key} value={category.key}>
              {category.label}
            </option>
          ))}
        </Select>
      </Field>
      {showPlotFilter ? (
        <Field
          id={ids.plot}
          label="Plot"
          error={allPlots.isError ? 'Could not load plots.' : undefined}
        >
          <Select
            id={ids.plot}
            value={search.plotId ?? ''}
            onChange={(event) =>
              onSearchChange({ ...search, plotId: event.target.value || undefined })
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
    </FilterGroup>
  );
}
