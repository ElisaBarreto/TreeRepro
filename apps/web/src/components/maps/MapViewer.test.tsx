import { render, screen, within } from '@testing-library/react';
import type { MapEntry } from '@treerepro/contracts';
import { describe, expect, it, vi } from 'vitest';
import { mapFileUrl } from '../../api/maps.ts';
import { MapViewer } from './MapViewer.tsx';

const ENTRY: MapEntry = {
  traitId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d01',
  kind: 'completeness',
  levelId: null,
  file: 'flower_colour_completeness.svg',
  dataVersion: '2026-09-01',
};
const ITEMS = [{ entry: ENTRY, heading: 'Data completeness', alt: 'Data completeness map of x' }];

describe('RFC-76 R7 MapViewer', () => {
  it('is closed while no index is given', () => {
    render(<MapViewer items={ITEMS} index={null} onIndexChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the map at the index, its heading and alt text', () => {
    render(<MapViewer items={ITEMS} index={0} onIndexChange={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Data completeness' });
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', mapFileUrl(ENTRY.file));
    expect(within(dialog).getByText('Data completeness map of x')).toBeInTheDocument();
  });

  it('bounds the image to the dialog so a short landscape viewport never clips it', () => {
    render(<MapViewer items={ITEMS} index={0} onIndexChange={vi.fn()} onClose={vi.fn()} />);
    const image = within(screen.getByRole('dialog')).getByRole('img');
    // `flex-1 min-h-0` inside the dialog's flex column lets the image shrink
    // to whatever height is left under the header, rather than the dialog's
    // `overflow-hidden` clipping an unbounded natural height — the bug on a
    // landscape phone (844×390), where the map's own legend sits at the
    // bottom of the image.
    expect(image.className).toContain('flex-1');
    expect(image.className).toContain('min-h-0');
    expect(image.className).toContain('object-contain');
  });
});
