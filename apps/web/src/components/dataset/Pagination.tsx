import { useId } from 'react';
import { PAGE_SIZES, type Pager, type PageSize } from '../../lib/use-paged-list.ts';
import { Button, Icon, Select } from '../ui/index.ts';

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
          <Icon name="arrowLeft" size={18} />
          Previous
        </Button>
        <span className="text-body tabular-nums text-canopy-900">Page {pager.page}</span>
        <Button variant="secondary" disabled={!pager.hasNext} onClick={() => pager.next()}>
          Next
          <Icon name="arrowRight" size={18} />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={sizeId} className="whitespace-nowrap text-meta text-mist-500">
          Rows per page
        </label>
        <Select
          id={sizeId}
          className="w-24"
          value={pager.pageSize}
          onChange={(event) => pager.setPageSize(Number(event.target.value) as PageSize)}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
      </div>
    </nav>
  );
}
