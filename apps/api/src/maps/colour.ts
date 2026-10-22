import type { MapKind } from '@treerepro/contracts';

/**
 * The six-colour viridisLite ramps, reversed so dark is high
 * (`viridisLite::viridis(6, option, direction = -1)`).
 * @rfc RFC-76 R4
 */
export const RAMPS = {
  magma: ['#FCFDBF', '#FE9F6D', '#DE4968', '#8C2981', '#3B0F70', '#000004'],
  mako: ['#DEF5E5', '#60CEAC', '#3497A9', '#395D9C', '#382A54', '#0B0405'],
  viridis: ['#FDE725', '#7AD151', '#22A884', '#2A788E', '#414487', '#440154'],
  cividis: ['#FFEA46', '#CBBA69', '#958F78', '#666970', '#31446B', '#00204D'],
} as const;

/** Each kind's ramp, whether it is a percentage, and its legend label. @rfc RFC-76 R4, R6 */
export const KIND_STYLE: Record<MapKind, { ramp: keyof typeof RAMPS; percent: boolean; label: string }> = {
  completeness: { ramp: 'magma', percent: true, label: '% of species with data' },
  mean: { ramp: 'mako', percent: false, label: 'mean of species medians' },
  median: { ramp: 'mako', percent: false, label: 'median of species medians' },
  sd: { ramp: 'viridis', percent: false, label: 'sd of species medians' },
  cv: { ramp: 'viridis', percent: false, label: 'cv of species medians (%)' },
  min: { ramp: 'cividis', percent: false, label: 'lowest species median' },
  max: { ramp: 'cividis', percent: false, label: 'highest species median' },
  prevalence: { ramp: 'magma', percent: true, label: '% of species with the state' },
};

/** No data (`grey92`). @rfc RFC-76 R4 */
export const NO_DATA = '#EBEBEB';

type Lab = [number, number, number];

// sRGB (D65) <-> CIELAB, the conversion farver uses for `scales::gradient_n_pal`.
const WHITE = [0.95047, 1, 1.08883] as const;
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : (903.3 * t + 16) / 116);
const fInv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (116 * t - 16) / 903.3);

function hexToLab(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(Number.parseInt(hex.slice(i, i + 2), 16) / 255)) as [
    number,
    number,
    number,
  ];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WHITE[0];
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / WHITE[1];
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / WHITE[2];
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function labToHex([l, a, bLab]: Lab): string {
  const fy = (l + 16) / 116;
  const x = fInv(fy + a / 500) * WHITE[0];
  const y = (l > 903.3 * 0.008856 ? fy ** 3 : l / 903.3) * WHITE[1];
  const z = fInv(fy - bLab / 200) * WHITE[2];
  const rgb = [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
  return `#${rgb
    .map((c) => Math.round(Math.min(1, Math.max(0, fromLinear(c))) * 255))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

const LABS = Object.fromEntries(
  Object.entries(RAMPS).map(([name, stops]) => [name, stops.map(hexToLab)]),
) as Record<keyof typeof RAMPS, Lab[]>;

/**
 * The colour at `x` in [0, 1] of a ramp: linear interpolation in CIELAB
 * between its six evenly spaced colours, as `scales::gradient_n_pal`.
 * @rfc RFC-76 R4
 */
export function rampColour(ramp: keyof typeof RAMPS, x: number): string {
  const labs = LABS[ramp];
  const position = Math.min(1, Math.max(0, x)) * (labs.length - 1);
  const i = Math.min(labs.length - 2, Math.floor(position));
  const t = position - i;
  const [p, q] = [labs[i] as Lab, labs[i + 1] as Lab];
  return labToHex([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
}

/** A map's scale (RFC-76 R4). @rfc RFC-76 R4 */
export interface ColourScale {
  limits: [number, number];
  log: boolean;
  percent: boolean;
}

/**
 * The scale of a map from its values: 0–100 for a percentage, else the
 * values' range, on log10 when at least two values are all positive and span
 * a factor of 100 or more.
 * @rfc RFC-76 R4
 */
export function colourScale(kind: MapKind, values: readonly number[]): ColourScale {
  const { percent } = KIND_STYLE[kind];
  if (percent) return { limits: [0, 100], log: false, percent };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const log = values.length > 1 && lo > 0 && hi / lo >= 100;
  return { limits: [lo, hi], log, percent };
}

/**
 * A region's fill: no data for a null value; otherwise the value clamped to
 * the scale, placed on it (log10 when the scale is), the middle when both ends
 * are equal, and coloured on the kind's ramp.
 * @rfc RFC-76 R4
 */
export function fillColour(kind: MapKind, value: number | null, scale: ColourScale): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA;
  const t = scale.log ? Math.log10 : (v: number) => v;
  const [lo, hi] = [t(scale.limits[0]), t(scale.limits[1])];
  const v = t(Math.min(Math.max(value, scale.limits[0]), scale.limits[1]));
  return rampColour(KIND_STYLE[kind].ramp, hi > lo ? (v - lo) / (hi - lo) : 0.5);
}
