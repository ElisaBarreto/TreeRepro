import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

/** @rfc RFC-13 R5 */
export function Table({ children }: { children: ReactNode }) {
  // `relative`: an absolutely positioned cell child (`sr-only` "Actions")
  // would otherwise escape the scroll container and widen the page.
  return (
    <div className="relative overflow-x-auto rounded-xl border border-canopy-700/15 bg-white">
      <table className="w-full text-left text-cell">{children}</table>
    </div>
  );
}
/** @rfc RFC-13 R5 */
export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-mist-50 text-label font-bold uppercase tracking-[0.06em] text-canopy-800">
      {children}
    </thead>
  );
}
/** @rfc RFC-13 R5 */
export function Tbody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-canopy-700/10">{children}</tbody>;
}
/** @rfc RFC-13 R5 */
export function Tr(props: HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} />;
}
/** @rfc RFC-13 R5 */
export function Th({ className = '', ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={`px-[18px] py-3.5 font-bold ${className}`} {...rest} />;
}
/** @rfc RFC-13 R5 */
export function Td({ className = '', ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-[18px] py-3.5 align-top ${className}`} {...rest} />;
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;
const ARROWS = { asc: '↑', desc: '↓' } as const;

/**
 * A column header that sorts: a button naming the column, the direction as a
 * decorative arrow and as `aria-sort` on the header itself (`none` while
 * another column sorts).
 * @rfc RFC-13 R5
 */
export function SortTh({
  label,
  direction,
  onSort,
}: {
  label: string;
  direction: 'asc' | 'desc' | null;
  onSort: () => void;
}) {
  return (
    <Th aria-sort={direction ? ARIA_SORT[direction] : 'none'}>
      <button
        type="button"
        onClick={onSort}
        className="inline-flex items-center gap-1 font-bold uppercase tracking-[0.06em] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
      >
        {label}
        <span aria-hidden="true" className={direction ? 'text-canopy-900' : 'text-mist-500'}>
          {direction ? ARROWS[direction] : '↕'}
        </span>
      </button>
    </Th>
  );
}
