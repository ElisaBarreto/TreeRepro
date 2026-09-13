import type { ReactNode } from 'react';

type Tone = 'neutral' | 'amber' | 'green' | 'red';
const TONES: Record<Tone, string> = {
  neutral: 'bg-mist-100 text-canopy-900',
  amber: 'bg-pollen-300/40 text-bark-700',
  green: 'bg-canopy-200 text-canopy-900',
  red: 'bg-red-100 text-red-800',
};

/** @rfc RFC-13 R5 */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}
