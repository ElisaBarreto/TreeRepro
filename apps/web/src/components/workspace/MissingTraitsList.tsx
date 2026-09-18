import { Link } from '@tanstack/react-router';
import type { Dashboard } from '@treerepro/contracts';
import { formatNumber, humaniseKey } from '../../lib/format.ts';

/**
 * The traits with the most species still missing data, ranked (spec §4).
 * Each one links into the species list already filtered on it; `hasPlots`
 * decides whether that link also carries `scope=plots` — a viewer without
 * plots has nothing to scope to, so the link stays global, matching how
 * `topMissingTraits` itself was computed for them (RFC-72 R1).
 * @rfc RFC-72 R3
 */
export function MissingTraitsList({
  traits,
  hasPlots,
}: {
  traits: Dashboard['contributor']['topMissingTraits'];
  hasPlots: boolean;
}) {
  return (
    <ol className="flex flex-col divide-y divide-canopy-700/10">
      {traits.map((entry, index) => (
        <li key={entry.trait.id} className="flex items-center justify-between gap-4 py-2.5">
          <span className="flex items-center gap-3">
            <span className="text-meta tabular-nums text-mist-500">{index + 1}</span>
            <Link
              to="/app/species"
              search={
                hasPlots
                  ? { traitId: entry.trait.id, traitData: 'missing', scope: 'plots' }
                  : { traitId: entry.trait.id, traitData: 'missing' }
              }
              className="font-medium text-canopy-900 underline-offset-2 hover:underline"
            >
              {humaniseKey(entry.trait.key)}
            </Link>
          </span>
          <span className="text-meta tabular-nums text-mist-500">
            {formatNumber(entry.missingSpeciesCount)} species
          </span>
        </li>
      ))}
    </ol>
  );
}
