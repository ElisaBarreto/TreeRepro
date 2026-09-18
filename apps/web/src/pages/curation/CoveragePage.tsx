import { useQuery } from '@tanstack/react-query';
import { coverageKeys, fetchCoverage } from '../../api/coverage.ts';
import {
  CoverageFilters,
  type CoverageSearch,
} from '../../components/curation/CoverageFilters.tsx';
import { CoverageTable } from '../../components/curation/CoverageTable.tsx';
import { TopGaps } from '../../components/curation/TopGaps.tsx';
import { NoPermission } from '../../components/shell/NoPermission.tsx';
import { Alert, Meter, PageHeader } from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { formatNumber } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';

export type { CoverageSearch } from '../../components/curation/CoverageFilters.tsx';

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
 * Coverage metrics for managers (RFC-69 R5–R7, spec §5): `CoverageFilters`
 * (family, category, plot), headline tiles, the category → trait
 * `CoverageTable` and the unfiltered `TopGaps` list. Requires
 * `coverage.read`; shows `NoPermission` otherwise — the same client-side
 * gate `PlotsPage` uses for `plots.manage` — before any of the three
 * sibling components mount, so a viewer who cannot see coverage never fires
 * a single request.
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
        <CoverageFilters search={search} onSearchChange={onSearchChange} />

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
