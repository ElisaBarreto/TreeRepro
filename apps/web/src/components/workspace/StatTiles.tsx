import { formatNumber } from '../../lib/format.ts';

/** One counter of a summary: what it counts and how many. */
export interface StatTile {
  label: string;
  value: number;
}

/**
 * A row of small counters, one per pair. The list carries `label` as its
 * accessible name, so the tiles read as one named group rather than as
 * loose numbers beside the page title.
 * @rfc RFC-71 R4
 * @rfc RFC-13 R5
 */
export function StatTiles({ label, tiles }: { label: string; tiles: readonly StatTile[] }) {
  return (
    <ul aria-label={label} className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
      {tiles.map((tile) => (
        <li key={tile.label} className="rounded-xl border border-canopy-700/15 bg-white px-4 py-3">
          <p className="text-label font-bold uppercase tracking-[0.08em] text-canopy-800">
            {tile.label}
          </p>
          <p className="mt-1 font-display text-section font-bold tabular-nums text-canopy-950">
            {formatNumber(tile.value)}
          </p>
        </li>
      ))}
    </ul>
  );
}
