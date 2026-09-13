import { useId } from 'react';
import { PAGE_SIZES, type Pager, type PageSize } from '../../lib/use-paged-list.ts';
import { Button } from '../ui/index.ts';

const SELECT =
  'h-10 rounded-lg border border-canopy-700/25 bg-white px-3 text-sm text-canopy-950 outline-none transition-colors focus:border-pollen-500';

/**
 * Footer of a paged list: Previous / Next (disabled at either end), the
 * page number and the rows-per-page choice. A keyset API knows only the
 * next cursor, so there are no numbered jumps — the hook counts the pages
 * it walked.
 * @rfc RFC-11 R6
 */
export function Pagination({ pager }: { pager: Pager }) {
  const sizeId = useId();
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-canopy-700/10 pt-4"
    >
      <div className="flex items-center gap-3">
        <Button variant="secondary" disabled={!pager.hasPrev} onClick={() => pager.prev()}>
          Previous
        </Button>
        <span className="text-sm tabular-nums text-canopy-900">Page {pager.page}</span>
        <Button variant="secondary" disabled={!pager.hasNext} onClick={() => pager.next()}>
          Next
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={sizeId} className="text-sm text-mist-500">
          Rows per page
        </label>
        <select
          id={sizeId}
          className={SELECT}
          value={pager.pageSize}
          onChange={(event) => pager.setPageSize(Number(event.target.value) as PageSize)}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>
    </nav>
  );
}
