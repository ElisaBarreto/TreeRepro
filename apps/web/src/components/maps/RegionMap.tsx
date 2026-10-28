import type { MapEntry, MapValues } from '@treerepro/contracts';
import { useId } from 'react';
import { useMapValues } from '../../api/maps.ts';
import { formatNumber } from '../../lib/format.ts';
import { BORDER, legendUnit, NO_DATA, OUTLINES } from './map-svg.ts';

function regionTitle(
  name: string,
  region: MapValues['regions'][number] | undefined,
  legend: MapValues['legend'],
) {
  if (!region || region.value === null) return `${name}: no data`;
  const unit = legendUnit(legend);
  const suffix = unit === '%' || !unit ? unit : ` ${unit}`;
  const species = `${region.nSpecies} species`;
  return `${name}: ${formatNumber(Math.round(region.value * 100) / 100)}${suffix} (${species})`;
}

/**
 * One trait map drawn in the browser (RFC-76 R7): the TDWG level-3 outlines
 * (RFC-76 R2) filled with the API's colours (R6), a region with no row or no
 * value in the no-data grey, each region titled with its name, value and
 * species, and a legend below — the ramp, its two ends, the unit, and "log
 * scale" when it is one. Colours are SVG attributes, never style attributes
 * (RFC-13 R5).
 * @rfc RFC-76 R2, R6, R7
 */
export function RegionMap({ entry, alt }: { entry: MapEntry; alt: string }) {
  const values = useMapValues(entry);
  const gradientId = useId();
  if (values.isPending) return <p className="text-meta text-mist-500">Loading map…</p>;
  if (values.isError)
    return <p className="text-meta text-mist-500">The map could not be loaded.</p>;
  const { regions, legend } = values.data;
  const byCode = new Map(regions.map((r) => [r.code, r]));
  const [lo, hi] = legend.limits;
  const unit = legendUnit(legend);
  return (
    <div className="flex size-full flex-col gap-1">
      <svg viewBox={OUTLINES.viewBox} role="img" aria-label={alt} className="min-h-0 w-full flex-1">
        {Object.entries(OUTLINES.regions).map(([code, d]) => {
          const region = byCode.get(code);
          return (
            <path key={code} d={d} fill={region?.fill ?? NO_DATA} stroke={BORDER} strokeWidth={4}>
              <title>{regionTitle(region?.name ?? code, region, legend)}</title>
            </path>
          );
        })}
      </svg>
      <figure
        aria-label={`Legend: ${legend.label}`}
        className="flex items-center gap-2 text-meta text-mist-500"
      >
        <span className="tabular-nums">{formatNumber(lo)}</span>
        <svg
          viewBox="0 0 100 4"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="h-2.5 w-32"
        >
          <defs>
            <linearGradient id={gradientId}>
              {legend.stops.map((stop, i) => (
                <stop
                  key={stop}
                  offset={`${(i * 100) / (legend.stops.length - 1)}%`}
                  stopColor={stop}
                />
              ))}
            </linearGradient>
          </defs>
          <rect width="100" height="4" fill={`url(#${gradientId})`} />
        </svg>
        <span className="tabular-nums">
          {formatNumber(hi)}
          {unit ? ` ${unit}` : ''}
        </span>
        <span>
          {legend.label}
          {legend.log ? ' (log scale)' : ''}
        </span>
      </figure>
    </div>
  );
}
