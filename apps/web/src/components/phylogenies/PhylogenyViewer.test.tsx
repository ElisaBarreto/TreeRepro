import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhylogenyViewer } from './PhylogenyViewer.tsx';

const ITEMS = [
  { figure: { key: 'fruit_type', traitId: null, version: '7' }, heading: 'Fruit type' },
  { figure: { key: 'seed_mass', traitId: null, version: '8' }, heading: 'Seed mass' },
];

function open(index = 0, onIndexChange = vi.fn()) {
  render(
    <PhylogenyViewer items={ITEMS} index={index} onIndexChange={onIndexChange} onClose={vi.fn()} />,
  );
  const dialog = screen.getByRole('dialog', { name: ITEMS[index]?.heading });
  return { dialog, figure: within(dialog).getByRole('img', { name: /phylogeny/i }) };
}

const scaleOf = (el: HTMLElement) => /scale\(([\d.]+)\)/.exec(el.style.transform)?.[1];

describe('RFC-79 R6 PhylogenyViewer', () => {
  it('is closed while no index is given', () => {
    render(
      <PhylogenyViewer items={ITEMS} index={null} onIndexChange={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on the display copy and swaps to the full PNG once it loads', () => {
    const { dialog, figure } = open();
    expect(figure).toHaveAttribute('src', '/api/phylogenies/files/fruit_type?size=display&v=7');
    const preload = dialog.querySelector('img[data-preload]') as HTMLImageElement;
    expect(preload).toHaveAttribute('src', '/api/phylogenies/files/fruit_type?size=full&v=7');
    fireEvent.load(preload);
    expect(within(dialog).getByRole('img', { name: /phylogeny/i })).toHaveAttribute(
      'src',
      '/api/phylogenies/files/fruit_type?size=full&v=7',
    );
  });

  it('keeps the display copy when the full PNG fails to load', () => {
    const { dialog } = open();
    fireEvent.error(dialog.querySelector('img[data-preload]') as HTMLImageElement);
    expect(within(dialog).getByRole('img', { name: /phylogeny/i })).toHaveAttribute(
      'src',
      '/api/phylogenies/files/fruit_type?size=display&v=7',
    );
  });

  it('+ and − zoom from 1× to 4× by ×1.5 steps, and 0 resets', async () => {
    const { dialog, figure } = open();
    expect(scaleOf(figure)).toBe('1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zoom in' }));
    expect(scaleOf(figure)).toBe('1.5');
    for (let i = 0; i < 5; i++) fireEvent.keyDown(dialog, { key: '+' });
    expect(scaleOf(figure)).toBe('4');
    fireEvent.keyDown(dialog, { key: '-' });
    expect(Number(scaleOf(figure))).toBeCloseTo(4 / 1.5);
    fireEvent.keyDown(dialog, { key: '0' });
    expect(scaleOf(figure)).toBe('1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zoom out' }));
    expect(scaleOf(figure)).toBe('1');
  });

  it('the wheel zooms, and a drag pans while zoomed', () => {
    const { figure } = open();
    fireEvent.wheel(figure, { deltaY: -100 });
    expect(scaleOf(figure)).toBe('1.5');
    fireEvent.pointerDown(figure, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(figure, { pointerId: 1, clientX: 40, clientY: 30 });
    fireEvent.pointerUp(figure, { pointerId: 1 });
    expect(figure.style.transform).toContain('translate(30px, 20px)');
    fireEvent.wheel(figure, { deltaY: 100 });
    expect(scaleOf(figure)).toBe('1');
    expect(figure.style.transform).toContain('translate(0px, 0px)');
  });

  it('one wheel gesture is one ×1.5 step, however many events it sends', () => {
    const { figure } = open();
    for (let i = 0; i < 10; i++) fireEvent.wheel(figure, { deltaY: -4 });
    expect(scaleOf(figure)).toBe('1.5');
  });

  it('the wheel never scrolls or zooms the page behind the viewer', () => {
    const { figure } = open();
    const event = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    figure.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('drags from the frame, so an image panned far away can be brought back', () => {
    const { figure } = open();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: '+' });
    const frame = figure.parentElement as HTMLElement;
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 50, clientY: 0 });
    fireEvent.pointerUp(frame, { pointerId: 1 });
    expect(figure.style.transform).toContain('translate(50px, 0px)');
  });

  it('does not pan at 1×', () => {
    const { figure } = open();
    fireEvent.pointerDown(figure, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(figure, { pointerId: 1, clientX: 40, clientY: 30 });
    expect(figure.style.transform).toContain('translate(0px, 0px)');
  });

  it('ArrowLeft and ArrowRight move between items, wrapping', () => {
    const onIndexChange = vi.fn();
    const { dialog } = open(0, onIndexChange);
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
  });

  it('resets the zoom when the item changes', () => {
    const { rerender } = render(
      <PhylogenyViewer items={ITEMS} index={0} onIndexChange={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: '+' });
    rerender(<PhylogenyViewer items={ITEMS} index={1} onIndexChange={vi.fn()} onClose={vi.fn()} />);
    const figure = within(screen.getByRole('dialog', { name: 'Seed mass' })).getByRole('img', {
      name: /phylogeny/i,
    });
    expect(scaleOf(figure)).toBe('1');
  });

  it('Close closes it', async () => {
    const onClose = vi.fn();
    render(<PhylogenyViewer items={ITEMS} index={0} onIndexChange={vi.fn()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
