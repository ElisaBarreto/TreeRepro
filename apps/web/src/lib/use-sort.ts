import { useMemo, useState } from 'react';

/** A cell a table sorts by: text, a number, or nothing. @rfc RFC-13 R13 */
export type Cell = string | number | null | undefined;

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Two cells in ascending order: text by locale ignoring case (digits by
 * value), numbers by value, an empty cell after any other.
 * @rfc RFC-13 R13
 */
export function compareCells(a: Cell, b: Cell): number {
  const emptyA = a === null || a === undefined || a === '';
  const emptyB = b === null || b === undefined || b === '';
  if (emptyA || emptyB) return Number(emptyA) - Number(emptyB);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * The rows ordered by `read` in `order`, an empty cell last in either
 * direction; a stable sort, so equal cells keep their order.
 * @rfc RFC-13 R13
 */
export function sortRows<T>(
  rows: readonly T[],
  read: (row: T) => Cell,
  order: 'asc' | 'desc',
): T[] {
  const sign = order === 'asc' ? 1 : -1;
  const empty = (c: Cell) => c === null || c === undefined || c === '';
  return [...rows].sort((x, y) => {
    const a = read(x);
    const b = read(y);
    return empty(a) || empty(b) ? compareCells(a, b) : sign * compareCells(a, b);
  });
}

/**
 * Sorts a table's whole list in the browser (RFC-13 R13). `columns` names
 * each sortable column and how to read its cell; an ISO timestamp sorts
 * correctly as text. Until a header is clicked the rows keep the order they
 * came in. `header(key)` gives a `SortTh` its direction and click handler;
 * `sort` is the current choice, for nested rows that follow it.
 * @rfc RFC-13 R13
 */
export function useSort<T, K extends string>(
  rows: readonly T[],
  columns: Record<K, (row: T) => Cell>,
) {
  const [sort, setSort] = useState<{ by: K; order: 'asc' | 'desc' } | null>(null);
  const sorted = useMemo(
    () => (sort ? sortRows(rows, columns[sort.by], sort.order) : [...rows]),
    [rows, columns, sort],
  );
  return {
    rows: sorted,
    sort,
    header: (by: K) => ({
      direction: sort?.by === by ? sort.order : null,
      onSort: () =>
        setSort((prev) =>
          prev?.by === by && prev.order === 'asc' ? { by, order: 'desc' } : { by, order: 'asc' },
        ),
    }),
  };
}

/**
 * The next sort of a paginated table (RFC-13 R13) when header `by` is
 * clicked: a new column ascending, the same column again flipped. `current`
 * is what the URL holds, its defaults filled in by the caller.
 * @rfc RFC-13 R13
 */
export function toggleSort<K extends string>(
  current: { sort: K; order: 'asc' | 'desc' },
  by: K,
): { sort: K; order: 'asc' | 'desc' } {
  return { sort: by, order: current.sort === by && current.order === 'asc' ? 'desc' : 'asc' };
}

/**
 * The sort of a paginated table that keeps its filters in component state
 * (RFC-13 R13): `params` for the route (both undefined until a header is
 * clicked, so the route's default order applies) and `header(by)` for a
 * `SortTh`. `fallback` is the route's default, from which the first click
 * on its own column flips.
 * @rfc RFC-13 R13
 */
export function useServerSort<K extends string>(fallback: { sort: K; order: 'asc' | 'desc' }) {
  const [sort, setSort] = useState<{ sort: K; order: 'asc' | 'desc' } | null>(null);
  return {
    params: { sort: sort?.sort, order: sort?.order },
    header: (by: K) => ({
      direction: sort?.sort === by ? sort.order : null,
      onSort: () => setSort(toggleSort(sort ?? fallback, by)),
    }),
  };
}
