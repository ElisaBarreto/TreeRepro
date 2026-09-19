import { afterEach, describe, expect, it, vi } from 'vitest';
import { realignHashWhileSettling } from './hashAnchor.ts';

// jsdom has no layout, so the reflow the real observer waits for has to be
// delivered by hand. This stands in for it and hands the callback back.
let notifyReflow: (() => void) | undefined;

class CapturingResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    notifyReflow = () => this.callback([], this as unknown as ResizeObserver);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    notifyReflow = undefined;
  }
}

function armed(): { scrollIntoView: ReturnType<typeof vi.fn>; stop: () => void } {
  const heading = document.createElement('h2');
  heading.id = 'contest';
  const scrollIntoView = vi.fn();
  heading.scrollIntoView = scrollIntoView;
  document.body.append(heading);
  return { scrollIntoView, stop: realignHashWhileSettling() };
}

const RealResizeObserver = globalThis.ResizeObserver;

afterEach(() => {
  globalThis.ResizeObserver = RealResizeObserver;
  notifyReflow = undefined;
  document.body.innerHTML = '';
  window.location.hash = '';
  vi.restoreAllMocks();
});

describe('RFC-73 R2 hash anchor realignment', () => {
  it('aligns the hash target as soon as it is armed, then again on every reflow', () => {
    globalThis.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver;
    window.location.hash = '#contest';
    const { scrollIntoView, stop } = armed();

    // The element is in the DOM by the time the page arms this, so the first
    // alignment is not a silent no-op.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // The reflow a font swap causes, whenever it lands.
    notifyReflow?.();
    notifyReflow?.();
    expect(scrollIntoView).toHaveBeenCalledTimes(3);
    stop();
  });

  it('stops aligning once the visitor has started scrolling', () => {
    globalThis.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver;
    window.location.hash = '#contest';
    const { scrollIntoView, stop } = armed();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('wheel'));
    notifyReflow?.();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does nothing at all when the URL carries no hash', () => {
    globalThis.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver;
    const { scrollIntoView, stop } = armed();

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(notifyReflow).toBeUndefined();
    stop();
  });

  it('cleanup stops the observer, so a later reflow aligns nothing', () => {
    globalThis.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver;
    window.location.hash = '#contest';
    const { scrollIntoView, stop } = armed();
    const afterArming = scrollIntoView.mock.calls.length;

    stop();
    notifyReflow?.();
    expect(scrollIntoView).toHaveBeenCalledTimes(afterArming);
  });
});
