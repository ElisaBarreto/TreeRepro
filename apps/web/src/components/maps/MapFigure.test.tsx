import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MapEntry } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  beforeEach(() => {
    // jsdom lacks a real <dialog>; stub the two calls this component makes,
    // still toggling the `open` attribute the way setup.ts's own polyfill
    // does — jsdom's default stylesheet hides a dialog without it, which
    // would otherwise take the second img out of the accessibility tree —
    // so both the call and the resulting visibility can be asserted.
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  it('renders a lazy-loaded img at the file URL with the given alt', () => {
    render(<MapFigure entry={ENTRY} alt="Data completeness map of Flower colour" size="thumb" />);
    const img = screen.getByRole('img', { name: 'Data completeness map of Flower colour' });
    expect(img).toHaveAttribute('src', mapFileUrl(ENTRY.file));
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('renders a caption in a figcaption when given one', () => {
    render(
      <MapFigure
        entry={ENTRY}
        alt="Data completeness map of Flower colour"
        size="thumb"
        caption="TDWG level 3 regions · 2026-09-01"
      />,
    );
    expect(screen.getByText('TDWG level 3 regions · 2026-09-01').tagName).toBe('FIGCAPTION');
  });

  it('size="thumb" renders only the image, no button and no dialog', () => {
    render(<MapFigure entry={ENTRY} alt="Data completeness map of Flower colour" size="thumb" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(document.querySelector('dialog')).not.toBeInTheDocument();
  });

  it('size="full" (the default): clicking the image button opens a dialog with a second img; Close calls close', async () => {
    const user = userEvent.setup();
    render(<MapFigure entry={ENTRY} alt="Data completeness map of Flower colour" />);
    await user.click(
      screen.getByRole('button', { name: 'Data completeness map of Flower colour' }),
    );
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
    const images = screen.getAllByRole('img', { name: 'Data completeness map of Flower colour' });
    expect(images).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalledTimes(1);
  });

  it('bounds the dialog image to the dialog so a short landscape viewport never clips it', async () => {
    const user = userEvent.setup();
    render(<MapFigure entry={ENTRY} alt="Data completeness map of Flower colour" />);
    await user.click(
      screen.getByRole('button', { name: 'Data completeness map of Flower colour' }),
    );
    const images = screen.getAllByRole('img', { name: 'Data completeness map of Flower colour' });
    const dialogImage = images[1] as HTMLElement;
    // `flex-1 min-h-0` inside the dialog's flex column lets the image shrink
    // to whatever height is left under the close button, rather than the
    // dialog's `overflow-hidden` clipping an unbounded natural height — the
    // bug on a landscape phone (844×390), where the map's own legend sits at
    // the bottom of the image.
    expect(dialogImage.className).toContain('flex-1');
    expect(dialogImage.className).toContain('min-h-0');
    expect(dialogImage.className).toContain('object-contain');
  });
});
