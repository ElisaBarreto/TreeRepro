import type { ReactNode } from 'react';

/** @rfc RFC-13 R5 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-canopy-700/25 px-6 py-12 text-center">
      <p className="font-display text-card font-semibold text-canopy-950">{title}</p>
      {description ? <p className="max-w-md text-body text-mist-500">{description}</p> : null}
      {action}
    </div>
  );
}
