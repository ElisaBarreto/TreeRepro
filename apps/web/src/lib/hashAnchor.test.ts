import { afterEach, describe, expect, it, vi } from 'vitest';
import { realignHashOnceFontsLoad } from './hashAnchor.ts';

// `document.fonts` does not exist in jsdom, so every test installs the one
// it wants and the hash is set on the real location.
function withFonts(ready: Promise<unknown>): void {
  Object.defineProperty(document, 'fonts', { value: { ready }, configurable: true });
}

function target(id: string): { element: HTMLElement; scrollIntoView: ReturnType<typeof vi.fn> } {
  const element = document.createElement('h2');
  element.id = id;
  const scrollIntoView = vi.fn();
  element.scrollIntoView = scrollIntoView;
  document.body.append(element);
  return { element, scrollIntoView };
}

afterEach(() => {
  document.body.innerHTML = '';
  window.location.hash = '';
  vi.restoreAllMocks();
});

describe('RFC-73 R2 hash anchor realignment', () => {
  it('scrolls to the hash target again once the fonts are ready', async () => {
    window.location.hash = '#contest';
    const { scrollIntoView } = target('contest');
    withFonts(Promise.resolve());

    realignHashOnceFontsLoad();
    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
  });

  it('leaves the page alone when the visitor has already started scrolling', async () => {
    window.location.hash = '#contest';
    const { scrollIntoView } = target('contest');
    let settle = (): void => {};
    withFonts(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );

    realignHashOnceFontsLoad();
    window.dispatchEvent(new Event('wheel'));
    settle();
    await Promise.resolve();
    await Promise.resolve();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('does nothing at all when the URL carries no hash', async () => {
    const { scrollIntoView } = target('contest');
    withFonts(Promise.resolve());

    realignHashOnceFontsLoad();
    await Promise.resolve();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
