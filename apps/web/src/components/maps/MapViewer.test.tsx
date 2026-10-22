import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MAP_VALUES, mapEntry } from '../../test/map-fixtures.ts';
import { MapViewer } from './MapViewer.tsx';

const api = vi.hoisted(() => ({ useMapValues: vi.fn() }));
vi.mock('../../api/maps.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/maps.ts')>()),
  ...api,
}));
api.useMapValues.mockReturnValue({ isPending: false, isError: false, data: MAP_VALUES });

const ENTRY = mapEntry();
const ITEMS = [{ entry: ENTRY, heading: 'Data completeness', alt: 'Data completeness map of x' }];

describe('RFC-76 R7 MapViewer', () => {
  it('is closed while no index is given', () => {
    render(<MapViewer items={ITEMS} index={null} onIndexChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the map at the index, its heading and alt text', () => {
    render(<MapViewer items={ITEMS} index={0} onIndexChange={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Data completeness' });
    expect(within(dialog).getByRole('img', { name: 'Data completeness map of x' })).toBeInTheDocument();
    expect(within(dialog).getByText('Data completeness map of x')).toBeInTheDocument();
  });

  it('hides the repeated alt text from screen readers, it is already the map label', () => {
    render(<MapViewer items={ITEMS} index={0} onIndexChange={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Data completeness map of x')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('bounds the map to the dialog so a short landscape viewport never clips it', () => {
    render(<MapViewer items={ITEMS} index={0} onIndexChange={vi.fn()} onClose={vi.fn()} />);
    const frame = within(screen.getByRole('dialog')).getByRole('img').closest('div.flex-1');
    // `flex-1 min-h-0` inside the dialog's flex column lets the map shrink to
    // whatever height is left under the header, rather than the dialog's
    // `overflow-hidden` clipping it — the bug on a landscape phone (844×390).
    expect(frame?.className).toContain('min-h-0');
  });
});
