import type { ReactNode } from 'react';

type Tone = 'error' | 'success' | 'info';

const TONES: Record<Tone, string> = {
  error: 'border-red-300 bg-red-50 text-red-800',
  success: 'border-canopy-300 bg-canopy-200/40 text-canopy-900',
  info: 'border-pollen-400/60 bg-pollen-300/20 text-bark-700',
};

/** @rfc RFC-13 R5, R6 */
export function Alert({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-3 py-2 text-sm ${TONES[tone]}`}
    >
      {children}
    </p>
  );
}
