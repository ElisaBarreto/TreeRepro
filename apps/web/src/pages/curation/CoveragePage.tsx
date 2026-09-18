import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { coverageKeys, fetchCoverage } from '../../api/coverage.ts';
import { datasetKeys, fetchDictionary, fetchFamilies } from '../../api/dataset.ts';
import { listPlots, plotKeys } from '../../api/plots.ts';
import { CoverageTable } from '../../components/curation/CoverageTable.tsx';
import { TopGaps } from '../../components/curation/TopGaps.tsx';
import { FilterGroup } from '../../components/dataset/FilterGroup.tsx';
import { NoPermission } from '../../components/shell/NoPermission.tsx';
import { Alert, Field, Meter, PageHeader, Select } from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { formatNumber } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';

/**
 * Every filter of the coverage page as a URL search param (spec §5), so a
 * link from elsewhere (the dashboard's "View coverage") can open it
 * pre-filtered and a filtered view can be shared.
 * @rfc RFC-13 R2
 * @rfc RFC-69 R5
 */
export interface CoverageSearch {
  familyId?: string;
  categoryKey?: string;
  plotId?: string;
}

const TILE_LABEL = 'text-label font-bold uppercase tracking-[0.08em] text-canopy-800';
const TILE_VALUE = 'mt-1 font-display text-section font-bold tabular-nums text-canopy-950';
const TILE_CLASS = 'rounded-xl border border-canopy-700/15 bg-white px-4 py-3';
const SECTION_HEADING = 'font-display text-section font-semibold text-canopy-950';

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <li className={TILE_CLASS}>
      <p className={TILE_LABEL}>{label}</p>
      <p className={TILE_VALUE}>{formatNumber(value)}</p>
    </li>
  );
}

/**
 * Coverage metrics for managers (RFC-69 R5–R7, spec §5): filters (family,
 * category, plot), headline tiles, the category → trait table and the
 * unfiltered top-gaps list. Requires `coverage.read`; shows `NoPermission`
 * otherwise — the same client-side gate `PlotsPage` uses for `plots.manage`,
 * so a viewer who cannot see coverage never fires the request. The plot
 * filter renders only for a viewer who holds `plots.manage` (fed by
 * `listPlots`, every plot) or who has at least one assigned plot
 * (`me.scope.plots`, fed straight from the session, no extra request) —
 * the same rule `SpeciesSearchForm`'s scope group uses. Every control
 * writes straight to the URL; there is no local echo to debounce, since
 * every filter here is a discrete choice, not free text.
 * @rfc RFC-13 R2, R3
 * @rfc RFC-69 R5, R7
 */
export function CoveragePage({
  search,
  onSearchChange,
}: {
  search: CoverageSearch;
  onSearchChange: (next: CoverageSearch) => void;
}) {
  const me = useMe();
  const canRead = hasPermission(me, 'coverage.read');
  const canManagePlots = hasPermission(me, 'plots.manage');
  const hasOwnPlots = me.scope.plots.length > 0;
  const showPlotFilter = canManagePlots || hasOwnPlots;
  const ids = { family: useId(), category: useId(), plot: useId() };

  const families = useQuery({
    queryKey: datasetKeys.families,
    queryFn: fetchFamilies,
    enabled: canRead,
  });
  const dictionary = useQuery({
    queryKey: datasetKeys.dictionary(),
    queryFn: () => fetchDictionary(),
    enabled: canRead,
  });
  const allPlots = useQuery({
    queryKey: plotKeys.list({ limit: 200 }),
    queryFn: () => listPlots({ limit: 200 }),
    enabled: canRead && canManagePlots,
  });
  const availablePlots = canManagePlots ? (allPlots.data?.data ?? me.scope.plots) : me.scope.plots;

  const params = {
    familyId: search.familyId,
    categoryKey: search.categoryKey,
    plotId: search.plotId,
  };
  const coverage = useQuery({
    queryKey: coverageKeys.detail(params),
    queryFn: () => fetchCoverage(params),
    enabled: canRead,
  });

  if (!canRead) return <NoPermission />;

  return (
    <>
      <PageHeader
        title="Coverage"
        description="How far the dataset's species × trait grid is filled, and where the biggest gaps sit."
      />
      <div className="flex flex-col gap-6">
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

        {coverage.error ? <Alert tone="error">{pageErrorMessage(coverage.error)}</Alert> : null}
        {coverage.isLoading ? <p className="text-body text-mist-500">Loading…</p> : null}

        {coverage.data ? (
          <>
            <ul
              aria-label="Coverage totals"
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
            >
              <StatTile label="Species" value={coverage.data.species} />
              <StatTile label="Traits" value={coverage.data.traits} />
              <StatTile label="Cells" value={coverage.data.cells} />
              <li className={TILE_CLASS}>
                <p className={TILE_LABEL}>With data</p>
                <div className="mt-1.5">
                  <Meter
                    value={coverage.data.withData}
                    max={coverage.data.cells}
                    percent={coverage.data.percentWithData}
                    label="Species × trait cells with data"
                  />
                </div>
              </li>
              <li className={TILE_CLASS}>
                <p className={TILE_LABEL}>Accepted</p>
                <div className="mt-1.5">
                  <Meter
                    value={coverage.data.accepted}
                    max={coverage.data.cells}
                    percent={coverage.data.percentAccepted}
                    label="Species × trait cells with an accepted value"
                  />
                </div>
              </li>
            </ul>

            <section aria-labelledby="coverage-table-heading" className="flex flex-col gap-3">
              <h2 id="coverage-table-heading" className={SECTION_HEADING}>
                By category
              </h2>
              <CoverageTable
                byCategory={coverage.data.byCategory}
                byTrait={coverage.data.byTrait}
              />
            </section>
          </>
        ) : null}

        <section aria-labelledby="top-gaps-heading" className="flex flex-col gap-3">
          <h2 id="top-gaps-heading" className={SECTION_HEADING}>
            Top gaps
          </h2>
          <TopGaps />
        </section>
      </div>
    </>
  );
}
