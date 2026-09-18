import type { ReactNode } from 'react';

const FIELDSET = 'flex flex-col gap-4 rounded-[12px] border border-canopy-700/15 px-4 pb-4';

/** The dress of a group's legend, for a fieldset nested inside one. @rfc RFC-13 R5 */
export const FILTER_LEGEND =
  'px-1.5 text-label font-bold uppercase tracking-[0.08em] text-canopy-800';

/** The dress of a checkbox sitting in a filter group, beside its label. @rfc RFC-13 R5 */
export const FILTER_CHECK = 'flex h-11 items-center gap-2.5 text-body text-canopy-900';

/**
 * A titled group of filters: the legend is the group's accessible name, so
 * each group is one landmark a reader can jump to. Shared by the species
 * search form and the trait page, which render the same Taxonomy group.
 * @rfc RFC-13 R5
 */
export function FilterGroup({
  title,
  columns,
  children,
}: {
  title: string;
  /** The grid template of the group's row, e.g. `md:grid-cols-[2fr_1fr_1fr]`. */
  columns: string;
  children: ReactNode;
}) {
  return (
    <fieldset className={FIELDSET}>
      <legend className={FILTER_LEGEND}>{title}</legend>
      <div className={`grid gap-4 md:items-start ${columns}`}>{children}</div>
    </fieldset>
  );
}
