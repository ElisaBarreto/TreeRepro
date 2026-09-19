// The interactions that mean "the visitor is driving the scroll now". A
// correction after any of these would yank the page out from under them.
const USER_SCROLL_EVENTS = ['wheel', 'touchmove', 'keydown'] as const;

// How long the landing stays under correction. Long enough for a font swap
// on a cold cache, short enough that it is over before anyone reads far.
const CORRECTION_WINDOW_MS = 2000;

/**
 * Keeps the `#anchor` the page was opened on aligned while the layout is
 * still settling. Returns its own cleanup, so a caller can hand it straight
 * to `useEffect`.
 *
 * `@fontsource-variable` serves Manrope and Sora with `font-display: swap`,
 * so the first paint lays the prose out in the fallback family. The router
 * scrolls to the hash as soon as the route has rendered
 * (`setupScrollRestoration` → `scrollIntoView`), which on a cold cache
 * happens before the real faces arrive. The swap then re-wraps every
 * paragraph above the target — the glyph advances change, and
 * `.prose-treerepro` is `max-width: 72ch`, so the column width changes with
 * them — and the target slides up by the lines that stopped existing while
 * the scroll offset stays where the router put it. Nothing corrects the
 * offset afterwards, so the landing is wrong for good: on
 * `/app/help/workflow#contest` this left the Contest heading ~48px above the
 * top of the viewport, the reader looking at a paragraph whose heading was
 * off-screen.
 *
 * The correction watches for the reflow rather than trying to predict when
 * it lands. A `ResizeObserver` on the body fires when the layout actually
 * changes, whatever caused it, so — unlike a single `fonts.ready` await,
 * which resolves immediately when it is consulted before layout has even
 * asked for the faces — it can be neither early nor late, and it re-aligns
 * on every reflow in the window rather than once. `scrollIntoView` changes
 * the scroll offset, not the body's box, so a correction cannot retrigger
 * the observer.
 *
 * Called from the page that owns the anchors, so the headings are in the DOM
 * by the time it runs. Nothing happens with no hash, and nothing happens
 * once the visitor has started scrolling — this corrects a landing, it does
 * not take the page over.
 * @rfc RFC-73 R2
 */
export function realignHashWhileSettling(): () => void {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (!id) return () => {};

  let cancelled = false;
  let visitorScrolled = false;
  const noteVisitorScrolled = () => {
    visitorScrolled = true;
  };
  for (const name of USER_SCROLL_EVENTS) {
    window.addEventListener(name, noteVisitorScrolled, { passive: true, once: true });
  }

  const align = () => {
    if (cancelled || visitorScrolled) return;
    document.getElementById(id)?.scrollIntoView();
  };

  // The element exists now, which is the whole point of arming this from the
  // page; harmless when the router has already put it in the right place.
  align();
  void document.fonts?.ready.then(align).catch(() => {
    // Faces that never load never shift anything; there is nothing to fix.
  });

  // Guarded: jsdom has no `ResizeObserver`, and the correction above still
  // stands without it.
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(align);
  observer?.observe(document.body);
  const stop = window.setTimeout(() => observer?.disconnect(), CORRECTION_WINDOW_MS);

  return () => {
    cancelled = true;
    observer?.disconnect();
    window.clearTimeout(stop);
    for (const name of USER_SCROLL_EVENTS) {
      window.removeEventListener(name, noteVisitorScrolled);
    }
  };
}
