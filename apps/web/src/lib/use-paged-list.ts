import { hashKey, keepPreviousData, type QueryKey, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Page } from '../api/dataset.ts';

/** The row counts a list offers per page. @rfc RFC-11 R6 */
export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/** Where the chosen page size is remembered, shared by every list. @rfc RFC-11 R6 */
export const PAGE_SIZE_STORAGE_KEY = 'treerepro.pageSize';

const DEFAULT_PAGE_SIZE: PageSize = 50;

function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value);
}

// Storage can be missing, full or blocked (private windows, a strict CSP on
// an embedded view); a failure either way just means the default size.
function readStoredPageSize(): PageSize | undefined {
  try {
    const stored = Number(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
    return isPageSize(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

function storePageSize(size: PageSize): void {
  try {
    window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size));
  } catch {
    // The choice then lasts for the session only.
  }
}

/** The controls a pagination footer needs; `PagedList` provides them. */
export interface Pager {
  page: number;
  pageSize: PageSize;
  hasPrev: boolean;
  hasNext: boolean;
  prev: () => void;
  next: () => void;
  setPageSize: (size: PageSize) => void;
}

export interface PagedList<T> extends Pager {
  items: T[];
  isLoading: boolean;
  /** A fetch (including a background one behind the previous page) is in flight. */
  isFetching: boolean;
  error: unknown;
  reset: () => void;
}

/**
 * One page at a time over an RFC-11 R6 cursor endpoint. The API only hands
 * out a cursor to the next page, so the hook keeps the stack of cursors it
 * walked: `cursors[page - 1]` loaded page `page`; `next()` pushes the
 * current page's `nextCursor`, `prev()` pops. Each page is its own query
 * (`[...queryKeyBase, { cursor, limit }]`), so stepping back shows the cached
 * page. A change of `queryKeyBase` (new filters) or of the page size starts
 * over at page 1; that reset is written back to state during the same render
 * (React's adjust-state-during-render pattern), not only on the next click,
 * so restoring an earlier key later can never resurrect its old stack. The
 * page size is shared by every list and remembered in `localStorage`.
 *
 * `placeholderData: keepPreviousData` keeps the previous page on screen
 * while the next one loads (no blank flash); `hasNext` is false during that
 * window (`query.isPlaceholderData`) so a click cannot push a cursor read
 * off the stale, still-displayed page.
 * @rfc RFC-11 R6
 */
export function usePagedList<T>(
  queryKeyBase: QueryKey,
  fetchPage: (cursor: string | undefined, limit: number) => Promise<Page<T>>,
  options: { pageSize?: PageSize; enabled?: boolean } = {},
): PagedList<T> {
  const [pageSize, setPageSizeState] = useState<PageSize>(
    () => readStoredPageSize() ?? options.pageSize ?? DEFAULT_PAGE_SIZE,
  );
  const filterKey = hashKey(queryKeyBase);
  // The stack is remembered together with the key it belongs to.
  const [stack, setStack] = useState<{ key: string; cursors: (string | undefined)[] }>({
    key: filterKey,
    cursors: [undefined],
  });
  if (stack.key !== filterKey) {
    // A key change (new filters, or a page size change via setPageSize
    // below) resets the stack right here, during render, rather than
    // waiting for a click on Next/Previous. That makes the reset durable:
    // without it, switching filters A -> B -> A with no clicks in between
    // would still have `stack.key === A` on the way back, so the old,
    // stale cursor stack for A would resurface instead of starting at
    // page 1. Guarded by the key comparison, so this runs once per key
    // change instead of looping (React's adjust-state-during-render
    // pattern: https://react.dev/learn/you-might-not-need-an-effect).
    setStack({ key: filterKey, cursors: [undefined] });
  }
  const cursors = stack.key === filterKey ? stack.cursors : [undefined];
  const page = cursors.length;
  const cursor = cursors[page - 1];

  const query = useQuery({
    queryKey: [...queryKeyBase, { cursor, limit: pageSize }],
    queryFn: () => fetchPage(cursor, pageSize),
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  });
  const nextCursor = query.data?.meta.nextCursor ?? null;
  // `query.data` still holds the previous page while the next one loads, so
  // its `nextCursor` is stale until the fetch for the current cursor settles.
  const hasNext = !query.isPlaceholderData && nextCursor !== null;

  return {
    items: query.data?.data ?? [],
    page,
    pageSize,
    hasPrev: page > 1,
    hasNext,
    next: () => {
      // Mirrors `hasNext`: a call reaching here while `data` is still the
      // previous page (a stale `nextCursor`) is a no-op too.
      if (nextCursor !== null && !query.isPlaceholderData) {
        setStack({ key: filterKey, cursors: [...cursors, nextCursor] });
      }
    },
    prev: () => {
      if (page > 1) setStack({ key: filterKey, cursors: cursors.slice(0, -1) });
    },
    setPageSize: (size) => {
      if (!isPageSize(size)) return;
      storePageSize(size);
      setPageSizeState(size);
      setStack({ key: filterKey, cursors: [undefined] });
    },
    reset: () => setStack({ key: filterKey, cursors: [undefined] }),
    isLoading: query.isPending,
    isFetching: query.isFetching,
    error: query.error,
  };
}
