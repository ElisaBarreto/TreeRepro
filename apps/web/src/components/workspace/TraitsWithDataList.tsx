import { Link } from '@tanstack/react-router';
import type { Dashboard } from '@treerepro/contracts';
import { formatNumber, humaniseKey } from '../../lib/format.ts';

/**
 * The traits with the most species holding data, ranked (RFC-72 R3,
 * spec R-18). Each one opens its trait page.
 * @rfc RFC-72 R3
 */
export function TraitsWithDataList({
  traits,
}: {
  traits: Dashboard['contributor']['topTraitsWithData'];
}) {
  return (
    <ol className="flex flex-col divide-y divide-canopy-700/10">
      {traits.map((entry, index) => (
        <li key={entry.trait.id} className="flex items-center justify-between gap-4 py-2.5">
          <span className="flex items-center gap-3">
            <span className="text-meta tabular-nums text-mist-500">{index + 1}</span>
            <Link
              to="/app/traits/$id"
              params={{ id: entry.trait.id }}
              className="font-medium text-canopy-900 underline-offset-2 hover:underline"
            >
              {humaniseKey(entry.trait.key)}
            </Link>
          </span>
          <span className="text-meta tabular-nums text-mist-500">
            {formatNumber(entry.speciesCount)} species
          </span>
        </li>
      ))}
    </ol>
  );
}
