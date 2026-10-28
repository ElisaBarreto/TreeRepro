import type { MouseEvent, ReactNode } from 'react';

/**
 * The card chrome `TraitCard` and `EmptyTraitCard` share: the rounded box,
 * border and hover treatment a trait card sits in on the species page,
 * whether it has records or not. With `onOpen`, a click anywhere on the card
 * that is not on a control (a button, a link, the help popover) opens it, as
 * a pointer-only convenience; the card's own button stays the keyboard path
 * (issue #357).
 * @rfc RFC-63 R10
 * @rfc RFC-70 R7
 */
export function CardFrame({ children, onOpen }: { children: ReactNode; onOpen?: () => void }) {
  function onClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    // A portal's click bubbles through React but is not inside the card's DOM.
    if (!onOpen || !(target instanceof Element) || !event.currentTarget.contains(target)) return;
    if (target.closest('button, a, input, select, textarea, [role="tooltip"]')) return;
    if (window.getSelection()?.toString()) return; // the end of a text selection
    onOpen();
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only convenience; the card's own button is the keyboard path
    // biome-ignore lint/a11y/useKeyWithClickEvents: same — Enter and Space on that button open the card
    <div
      onClick={onClick}
      className={`flex items-start gap-3 rounded-xl border border-canopy-700/15 bg-white p-5 shadow-[0_1px_2px_rgba(7,31,28,0.04)] transition-colors hover:border-canopy-600/50 hover:bg-mist-50/60 ${onOpen ? 'cursor-pointer' : ''}`}
    >
      {children}
    </div>
  );
}
