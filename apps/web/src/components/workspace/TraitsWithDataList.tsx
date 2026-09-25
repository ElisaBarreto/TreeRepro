import { Link } from '@tanstack/react-router';
import type { Dashboard } from '@treerepro/contracts';
import { formatNumber, humaniseKey } from '../../lib/format.ts';

/**
 * The traits with the most species holding data, ranked (RFC-72 R3,
 * spec R-18). Each one opens its trait page; under it a bar measures its
 * count against the top trait's. The bar is a native `<meter>` hidden from
 * assistive tech: the "N species" beside it already says the number.
 * @rfc RFC-72 R3
 */
export function TraitsWithDataList({
  traits,
}: {
  traits: Dashboard['contributor']['topTraitsWithData'];
}) {
  const max = Math.max(...traits.map((entry) => entry.speciesCount));
  return (
    <ol className="flex flex-col gap-3.5">
      {traits.map((entry, index) => (
        <li
          key={entry.trait.id}
          className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5"
        >
          <span className="text-meta tabular-nums text-mist-500">{index + 1}</span>
          <Link
            to="/app/traits/$id"
            params={{ id: entry.trait.id }}
            className="text-cell font-semibold text-canopy-800 underline-offset-2 hover:underline"
          >
            {humaniseKey(entry.trait.key)}
          </Link>
          <span className="text-right text-meta tabular-nums text-canopy-800">
            {formatNumber(entry.speciesCount)} species
          </span>
          <meter
            aria-hidden="true"
            value={entry.speciesCount}
            max={max}
            className="meter-bar col-span-2 col-start-2"
          />
        </li>
      ))}
    </ol>
  );
}
