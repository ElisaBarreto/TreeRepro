import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { CoverageTraitRow } from '@treerepro/contracts';
import { useState } from 'react';
import { coverageKeys, fetchCoverageTop } from '../../api/coverage.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { formatNumber, humaniseKey } from '../../lib/format.ts';
import { Alert, EmptyState } from '../ui/index.ts';

const MODES = [
  { value: 'missing', label: 'Most missing' },
  { value: 'least_validated', label: 'Lowest validated share' },
] as const;

const TOGGLE_BUTTON =
  'rounded-full border border-canopy-700/25 px-3.5 py-1.5 text-meta font-semibold text-canopy-900 transition-colors hover:bg-mist-100 aria-pressed:border-transparent aria-pressed:bg-canopy-900 aria-pressed:text-white';

function GapRow({
  row,
  rank,
  mode,
}: {
  row: CoverageTraitRow;
  rank: number;
  mode: (typeof MODES)[number]['value'];
}) {
  const missing = row.cells - row.withData;
  return (
    <li className="flex items-center justify-between gap-4 py-2.5">
      <span className="flex items-center gap-3">
        <span className="text-meta tabular-nums text-mist-500">{rank}</span>
        <Link
          to="/app/traits/$id"
          params={{ id: row.trait.id }}
          className="font-medium text-canopy-900 underline-offset-2 hover:underline"
        >
          {humaniseKey(row.trait.key)}
        </Link>
      </span>
      <span className="text-meta tabular-nums text-mist-500">
        {mode === 'missing'
          ? `${formatNumber(missing)} species with no record yet`
          : `${row.percentValidated}% validated`}
      </span>
    </li>
  );
}

/**
 * The manager's top gaps (RFC-69 R7): the traits with the most visible
 * species lacking a record, or with the lowest validated share, over the
 * full unfiltered visible grid — unlike {@link CoverageTable} above, this
 * list ignores the page's family/category/plot filters, because that is
 * how the API itself computes it (R7's "full unfiltered visible grid").
 * The mode is local UI state, not a URL param: it re-runs the same query
 * with a different `mode`, nothing else on the page depends on it.
 * @rfc RFC-69 R7
 * @rfc RFC-13 R2
 */
export function TopGaps() {
  const [mode, setMode] = useState<(typeof MODES)[number]['value']>('missing');
  const query = useQuery({
    queryKey: coverageKeys.top({ mode }),
    queryFn: () => fetchCoverageTop({ mode }),
  });

  return (
    <div className="flex flex-col gap-4">
      <fieldset aria-label="Rank by" className="flex gap-2 border-0 p-0">
        {MODES.map((entry) => (
          <button
            key={entry.value}
            type="button"
            aria-pressed={mode === entry.value}
            onClick={() => setMode(entry.value)}
            className={TOGGLE_BUTTON}
          >
            {entry.label}
          </button>
        ))}
      </fieldset>
      {query.error ? <Alert tone="error">{pageErrorMessage(query.error)}</Alert> : null}
      {query.isLoading ? <p className="text-body text-mist-500">Loading…</p> : null}
      {query.isSuccess && query.data.length === 0 ? (
        <EmptyState
          title="Nothing lacks a record."
          description="Every visible species has a record for every visible trait."
        />
      ) : null}
      {query.data && query.data.length > 0 ? (
        <ol className="flex flex-col divide-y divide-canopy-700/10">
          {query.data.map((row, index) => (
            <GapRow key={row.trait.id} row={row} rank={index + 1} mode={mode} />
          ))}
        </ol>
      ) : null}
    </div>
  );
}
