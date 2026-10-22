import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MAP_VALUES, mapEntry } from '../../test/map-fixtures.ts';
import { MapFigure } from './MapFigure.tsx';
import outlines from './tdwg-l3.json';

const api = vi.hoisted(() => ({ useMapValues: vi.fn() }));
vi.mock('../../api/maps.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/maps.ts')>()),
  ...api,
}));
api.useMapValues.mockReturnValue({ isPending: false, isError: false, data: MAP_VALUES });

const ENTRY = mapEntry();
const ALT = 'Data completeness map of Flower colour';

describe('RFC-76 R7 MapFigure and RegionMap', () => {
  it('draws every TDWG level-3 region, filled with the API colour or the no-data grey', () => {
    render(<MapFigure entry={ENTRY} alt={ALT} />);
    const map = screen.getByRole('img', { name: ALT });
    const paths = map.querySelectorAll('path');
    expect(paths).toHaveLength(Object.keys(outlines.regions).length);
    const titled = (text: string) =>
      [...paths].find((p) => p.querySelector('title')?.textContent?.startsWith(text));
    expect(titled('Brazil West-Central')).toHaveAttribute('fill', '#B63875');
    expect(titled('Brazil West-Central')?.textContent).toBe('Brazil West-Central: 42.5% (120 species)');
    expect(titled('Peru')).toHaveAttribute('fill', '#EBEBEB');
    expect(titled('Peru')?.textContent).toBe('Peru: no data');
    // a region with no row in the snapshot is no data too, under its code
    expect(titled('ABT')).toHaveAttribute('fill', '#EBEBEB');
    expect(map.parentElement?.querySelector('[style]')).toBeNull();
  });

  it('draws the legend: the two ends, the unit and the label', () => {
    render(<MapFigure entry={ENTRY} alt={ALT} />);
    const legend = screen.getByRole('figure', { name: 'Legend: % of species with data' });
    expect(legend).toHaveTextContent('0');
    expect(legend).toHaveTextContent('100 %');
    expect(legend.querySelectorAll('stop')).toHaveLength(6);
  });

  it('says "log scale" on a log map', () => {
    api.useMapValues.mockReturnValueOnce({
      isPending: false,
      isError: false,
      data: { ...MAP_VALUES, legend: { ...MAP_VALUES.legend, percent: false, log: true, unit: 'mg', label: 'mean of species medians' } },
    });
    render(<MapFigure entry={mapEntry({ kind: 'mean' })} alt={ALT} />);
    expect(screen.getByText('mean of species medians (log scale)')).toBeInTheDocument();
  });

  it('renders a caption in a figcaption when given one', () => {
    render(<MapFigure entry={ENTRY} alt={ALT} caption="TDWG level 3 regions · snapshot 2026-10-23" />);
    expect(screen.getByText('TDWG level 3 regions · snapshot 2026-10-23').tagName).toBe('FIGCAPTION');
  });

  it('without onOpen renders only the map, no button and no dialog', () => {
    render(<MapFigure entry={ENTRY} alt={ALT} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(document.querySelector('dialog')).not.toBeInTheDocument();
  });

  it('with onOpen wraps the map in a button that calls it, named that it opens the full size', async () => {
    const onOpen = vi.fn();
    render(<MapFigure entry={ENTRY} alt={ALT} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: `${ALT}, open full size` }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
