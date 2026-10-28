import type { MapValues } from '@treerepro/contracts';
import { formatNumber } from '../../lib/format.ts';
import outlines from './tdwg-l3.json';

/** No data and borders (RFC-76 R4). @rfc RFC-76 R4 */
export const NO_DATA = '#EBEBEB';
/** @rfc RFC-76 R4 */
export const BORDER = '#8C8C8C';

/** The TDWG level-3 outlines (RFC-76 R2): a viewBox and one path per region code. @rfc RFC-76 R2 */
export const OUTLINES = outlines as { viewBox: string; regions: Record<string, string> };

/** The unit a legend's upper end carries: `%`, the trait's unit, or nothing. @rfc RFC-76 R7 */
export function legendUnit(legend: MapValues['legend']): string {
  return legend.percent ? '%' : (legend.unit ?? '');
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * One map as a standalone SVG document (RFC-76 R11): the outlines in the
 * map's fills, `title` as its `<title>`, and below the map the legend's label
 * (with "log scale"), its gradient between both ends and unit, and `caption`.
 * @rfc RFC-76 R11
 */
export function mapSvg(values: MapValues, title: string, caption: string): string {
  const [x, y, w, h] = OUTLINES.viewBox.split(' ').map(Number) as [number, number, number, number];
  const fills = new Map(values.regions.map((r) => [r.code, r.fill]));
  const { legend } = values;
  const font = w * 0.016;
  const top = y + h + font * 2;
  const barX = x + font * 6;
  const barW = w * 0.25;
  const unit = legendUnit(legend);
  const height = h + font * 8;
  const paths = Object.entries(OUTLINES.regions)
    .map(
      ([code, d]) =>
        `<path d="${d}" fill="${fills.get(code) ?? NO_DATA}" stroke="${BORDER}" stroke-width="4"/>`,
    )
    .join('');
  const stops = legend.stops
    .map(
      (stop, i) =>
        `<stop offset="${(i * 100) / (legend.stops.length - 1)}%" stop-color="${stop}"/>`,
    )
    .join('');
  const text = (tx: number, ty: number, body: string, attrs = '') =>
    `<text x="${tx}" y="${ty}" font-size="${font}"${attrs}>${escapeXml(body)}</text>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${height}" width="2400" height="${Math.round((2400 * height) / w)}" font-family="Helvetica, Arial, sans-serif" fill="#1F2933">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect x="${x}" y="${y}" width="${w}" height="${height}" fill="#FFFFFF"/>`,
    paths,
    `<defs><linearGradient id="legend">${stops}</linearGradient></defs>`,
    text(x + font, top, `${legend.label}${legend.log ? ' (log scale)' : ''}`),
    text(barX - font * 0.5, top + font * 2, formatNumber(legend.limits[0]), ' text-anchor="end"'),
    `<rect x="${barX}" y="${top + font * 1.1}" width="${barW}" height="${font}" fill="url(#legend)"/>`,
    text(
      barX + barW + font * 0.5,
      top + font * 2,
      `${formatNumber(legend.limits[1])}${unit ? ` ${unit}` : ''}`,
    ),
    text(x + font, top + font * 4, caption, ' fill="#6B7280"'),
    '</svg>',
  ].join('');
}

/** The file name of a downloaded map: its alt text, lowercased, non-alphanumerics as hyphens. @rfc RFC-76 R11 */
export function mapFileName(alt: string): string {
  return `${alt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}.svg`;
}
