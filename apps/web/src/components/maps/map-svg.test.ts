import { describe, expect, it } from 'vitest';
import { MAP_VALUES } from '../../test/map-fixtures.ts';
import { mapFileName, mapSvg, NO_DATA, OUTLINES } from './map-svg.ts';

describe('RFC-76 R11 a map as a standalone SVG', () => {
  const svg = mapSvg(
    MAP_VALUES,
    'Data completeness map of Seed <mass> & size',
    'snapshot 2026-10-23',
  );
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');

  it('is a well-formed SVG with the escaped title and every region outline', () => {
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(doc.querySelector('title')?.textContent).toBe(
      'Data completeness map of Seed <mass> & size',
    );
    expect(doc.querySelectorAll('path')).toHaveLength(Object.keys(OUTLINES.regions).length);
  });

  it('fills a region with its colour and one with no row in the no-data grey', () => {
    const fill = (code: string) =>
      [...doc.querySelectorAll('path')]
        .find((p) => p.getAttribute('d') === OUTLINES.regions[code])
        ?.getAttribute('fill');
    expect(fill('BZL')).toBe('#B63875');
    expect(fill('FRA')).toBe(NO_DATA);
  });

  it('carries the legend label, its ends with the unit, the six stops and the caption', () => {
    const texts = [...doc.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts).toEqual(['% of species with data', '0', '100 %', 'snapshot 2026-10-23']);
    expect(doc.querySelectorAll('stop')).toHaveLength(6);
    const log = mapSvg({ ...MAP_VALUES, legend: { ...MAP_VALUES.legend, log: true } }, 't', 'c');
    expect(log).toContain('% of species with data (log scale)');
  });

  it('names the file after the alt text', () => {
    expect(mapFileName('Prevalence map of Flower color: red')).toBe(
      'prevalence-map-of-flower-color-red.svg',
    );
  });
});
