import type { ReactNode } from 'react';

/**
 * A titled block inside a drawer: a small-caps heading over its content.
 * Shared by the record drawer and the record actions, so a section renders
 * only where it has something to show.
 * @rfc RFC-13 R5
 */
export function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-label font-bold uppercase tracking-[0.08em] text-mist-500">{title}</h3>
      {children}
    </section>
  );
}
