import type { ReactNode } from 'react';

/** @rfc RFC-13 R5 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  /** Usually a string; inline markup (an italic species name, a badge) is allowed. */
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-canopy-950">{title}</h1>
        {description ? <p className="mt-1 text-sm text-mist-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </header>
  );
}
