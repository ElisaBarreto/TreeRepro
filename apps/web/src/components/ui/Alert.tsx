import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';

type Tone = 'error' | 'success' | 'info';

const TONES: Record<Tone, { className: string; icon: IconName }> = {
  error: { className: 'border-red-300 bg-red-50 text-red-800', icon: 'alert' },
  success: { className: 'border-canopy-300 bg-canopy-200/40 text-canopy-900', icon: 'check' },
  info: { className: 'border-pollen-400/60 bg-pollen-300/20 text-bark-700', icon: 'info' },
};

/** @rfc RFC-13 R5, R6 */
export function Alert({ tone, children }: { tone: Tone; children: ReactNode }) {
  const { className, icon } = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-[10px] border px-4 py-3 text-cell ${className}`}
    >
      <Icon name={icon} className="mt-0.5" />
      <span>{children}</span>
    </div>
  );
}
