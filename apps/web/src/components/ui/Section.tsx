import type { ReactNode } from 'react';

export interface SectionProps {
  /** Prefix of the heading id (`<id>-heading`), which labels the region. */
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

/**
 * A titled block of a page: heading and description on the left, content
 * on the right, a hairline above. Settings and other form pages stack
 * several; the region is labelled by its heading.
 * @rfc RFC-13 R5
 */
export function Section({ id, title, description, children }: SectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-6 border-t border-canopy-700/10 py-8 md:grid-cols-[280px_minmax(0,1fr)] md:gap-10"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id={headingId} className="font-display text-section font-semibold text-canopy-950">
          {title}
        </h2>
        {description ? <p className="text-meta text-mist-500">{description}</p> : null}
      </div>
      <div className="flex max-w-xl flex-col gap-5">{children}</div>
    </section>
  );
}
