// The interactions that mean "the visitor is driving the scroll now". A
// correction after any of these would yank the page out from under them.
const USER_SCROLL_EVENTS = ['wheel', 'touchmove', 'keydown'] as const;

/**
 * Scrolls to the `#anchor` the page was opened on a second time, once the
 * web fonts have finished loading.
 *
 * `@fontsource-variable` serves Manrope and Sora with `font-display: swap`,
 * so the first paint uses the fallback family and the real faces arrive a
 * moment later. The router scrolls to the hash as soon as the route has
 * rendered (`setupScrollRestoration` → `scrollIntoView`), which on a cold
 * cache happens *before* that swap. The swap then re-lays every paragraph
 * above the target — the glyph advances change, and `.prose-treerepro` is
 * `max-w-[72ch]`, so the column width changes with them — and the target
 * slides up by the height of the lines that stopped existing while the
 * scroll offset stays exactly where the router put it. The offset is never
 * corrected, so the landing is wrong for good, not just for a frame: on
 * `/app/help/workflow#contest` this left the Contest heading ~48px above
 * the top of the viewport, the reader looking at a paragraph whose heading
 * was off-screen.
 *
 * Scrolling again once `document.fonts.ready` resolves puts the target back
 * where `scroll-mt-6` asks for it. Nothing happens when the fonts were
 * already cached (the first scroll used the final metrics and the element
 * is where it should be), when there is no hash, or when the visitor has
 * started scrolling on their own — this corrects a landing, it does not
 * take the page over.
 * @rfc RFC-73 R2
 */
export function realignHashOnceFontsLoad(): void {
  const fonts = document.fonts;
  if (!fonts || !window.location.hash) return;

  let visitorScrolled = false;
  const noteVisitorScrolled = () => {
    visitorScrolled = true;
  };
  for (const name of USER_SCROLL_EVENTS) {
    window.addEventListener(name, noteVisitorScrolled, { passive: true, once: true });
  }

  void fonts.ready
    .then(() => {
      if (visitorScrolled) return;
      const id = decodeURIComponent(window.location.hash.slice(1));
      document.getElementById(id)?.scrollIntoView();
    })
    .catch(() => {
      // Fonts that never load never shift anything; there is nothing to fix.
    })
    .finally(() => {
      for (const name of USER_SCROLL_EVENTS) {
        window.removeEventListener(name, noteVisitorScrolled);
      }
    });
}
