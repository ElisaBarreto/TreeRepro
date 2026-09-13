import { hashKey, type QueryKey, useQuery } from '@tanstack/react-query';
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
 * over at page 1. The page size is shared by every list and remembered in
 * `localStorage`.
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
  // The stack is remembered together with the key it belongs to; when the
  // key changes the stale stack is ignored on that very render instead of
  // one effect later, so the old page is never requested with new filters.
  const [stack, setStack] = useState<{ key: string; cursors: (string | undefined)[] }>({
    key: filterKey,
    cursors: [undefined],
  });
  const cursors = stack.key === filterKey ? stack.cursors : [undefined];
  const page = cursors.length;
  const cursor = cursors[page - 1];

  const query = useQuery({
    queryKey: [...queryKeyBase, { cursor, limit: pageSize }],
    queryFn: () => fetchPage(cursor, pageSize),
    enabled: options.enabled ?? true,
  });
  const nextCursor = query.data?.meta.nextCursor ?? null;

  return {
    items: query.data?.data ?? [],
    page,
    pageSize,
    hasPrev: page > 1,
    hasNext: nextCursor !== null,
    next: () => {
      if (nextCursor !== null) setStack({ key: filterKey, cursors: [...cursors, nextCursor] });
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
    error: query.error,
  };
}
