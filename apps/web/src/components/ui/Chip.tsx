import type { ReactNode } from 'react';

type Tone = 'neutral' | 'muted' | 'amber';

// The tones tint the text only: every chip keeps the same outlined surface,
// so a wrapping row of them reads as one set of values rather than as a row
// of differently coloured badges. `Badge` is the component that changes its
// background to carry a status.
const TONES: Record<Tone, string> = {
  neutral: 'text-canopy-900',
  muted: 'text-mist-500',
  amber: 'text-bark-700',
};

/**
 * A value out of a controlled vocabulary — a trait level, a distribution
 * figure — as an outlined pill. Chips sit in wrapping rows, so a trait with
 * twenty levels stays a paragraph of values instead of twenty table rows.
 * @rfc RFC-13 R5
 */
export function Chip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-canopy-700/15 bg-mist-50 px-2.5 py-0.5 text-label ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
