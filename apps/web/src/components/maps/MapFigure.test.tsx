import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MapEntry } from '@treerepro/contracts';
import { describe, expect, it, vi } from 'vitest';
import { mapFileUrl } from '../../api/maps.ts';
import { MapFigure } from './MapFigure.tsx';

const ENTRY: MapEntry = {
  traitId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d01',
  kind: 'completeness',
  levelId: null,
  file: 'flower_colour_completeness.svg',
  dataVersion: '2026-09-01',
};

describe('RFC-76 R6, R7 MapFigure', () => {
  it('renders a lazy-loaded img at the file URL with the given alt', () => {
    render(<MapFigure entry={ENTRY} alt="Data completeness map of Flower colour" />);
    const img = screen.getByRole('img', { name: 'Data completeness map of Flower colour' });
    expect(img).toHaveAttribute('src', mapFileUrl(ENTRY.file));
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('renders a caption in a figcaption when given one', () => {
    render(
      <MapFigure
        entry={ENTRY}
        alt="Data completeness map of Flower colour"
        caption="TDWG level 3 regions · 2026-09-01"
      />,
    );
    expect(screen.getByText('TDWG level 3 regions · 2026-09-01').tagName).toBe('FIGCAPTION');
  });

  it('without onOpen renders only the image, no button and no dialog', () => {
    render(<MapFigure entry={ENTRY} alt="Data completeness map of Flower colour" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(document.querySelector('dialog')).not.toBeInTheDocument();
  });

  it('with onOpen wraps the image in a button that calls it, named that it opens the full size', async () => {
    const onOpen = vi.fn();
    render(
      <MapFigure entry={ENTRY} alt="Data completeness map of Flower colour" onOpen={onOpen} />,
    );
    const button = screen.getByRole('button', {
      name: 'Data completeness map of Flower colour, open full size',
    });
    await userEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
