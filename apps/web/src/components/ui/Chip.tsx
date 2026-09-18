import type { ReactNode } from 'react';

type Tone = 'neutral' | 'muted' | 'amber';

// The kit's pill, fixed by the browsing design: the default tone emits it
// unchanged. The other tones repeat its shape and bring their own surface
// instead of layering one over this one — two background utilities on one
// element would have Tailwind pick the winner by stylesheet order rather
// than by what was written here.
const NEUTRAL =
  'inline-flex items-center rounded-full border border-canopy-700/15 bg-mist-50 px-2.5 py-0.5 text-label';
const SHAPE = 'inline-flex items-center rounded-full border px-2.5 py-0.5 text-label';

const TONES: Record<Tone, string> = {
  neutral: NEUTRAL,
  muted: `${SHAPE} border-canopy-700/10 bg-mist-100 text-mist-500`,
  amber: `${SHAPE} border-pollen-500/30 bg-pollen-300/40 text-bark-700`,
};

/**
 * A value out of a controlled vocabulary — a trait level, a distribution
 * figure — as an outlined pill. Chips sit in wrapping rows, so a trait with
 * twenty levels stays a paragraph of values instead of twenty table rows.
 * `muted` is for a value that is no longer current (an inactive level),
 * `amber` for one that wants attention; `Badge` stays the component that
 * carries a status.
 * @rfc RFC-13 R5
 */
export function Chip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={TONES[tone]}>{children}</span>;
}
