import type { ReactNode } from 'react';

/**
 * The card chrome `TraitCard` and `EmptyTraitCard` share: the rounded box,
 * border and hover treatment a trait card sits in on the species page,
 * whether it has records or not.
 * @rfc RFC-63 R10
 * @rfc RFC-70 R7
 */
export function CardFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-canopy-700/15 bg-white p-5 shadow-[0_1px_2px_rgba(7,31,28,0.04)] transition-colors hover:border-canopy-600/50 hover:bg-mist-50/60">
      {children}
    </div>
  );
}
