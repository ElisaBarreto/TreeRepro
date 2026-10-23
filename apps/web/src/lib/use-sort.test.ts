import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { compareCells, toggleSort, useSort } from './use-sort.ts';

describe('RFC-13 R13 compareCells', () => {
  it('compares text by locale ignoring case, numbers by value, and puts an empty cell last', () => {
    expect(['b', 'A', 'c'].sort(compareCells)).toEqual(['A', 'b', 'c']);
    expect([10, 9, 100].sort(compareCells)).toEqual([9, 10, 100]);
    expect(['item10', 'item9'].sort(compareCells)).toEqual(['item9', 'item10']);
    expect([null, 2, undefined, 1].sort(compareCells)).toEqual([1, 2, null, undefined]);
  });
});

describe('RFC-13 R13 useSort', () => {
  const rows = [
    { name: 'beta', n: 2 },
    { name: 'Alpha', n: null },
    { name: 'gamma', n: 1 },
  ];
  const columns = {
    name: (r: (typeof rows)[number]) => r.name,
    n: (r: (typeof rows)[number]) => r.n,
  };

  it('keeps the given order until a column is chosen, then sorts it ascending and flips it on a second click', () => {
    const { result } = renderHook(() => useSort(rows, columns));
    expect(result.current.rows.map((r) => r.name)).toEqual(['beta', 'Alpha', 'gamma']);
    expect(result.current.header('name').direction).toBeNull();

    act(() => result.current.header('name').onSort());
    expect(result.current.rows.map((r) => r.name)).toEqual(['Alpha', 'beta', 'gamma']);
    expect(result.current.header('name').direction).toBe('asc');

    act(() => result.current.header('name').onSort());
    expect(result.current.rows.map((r) => r.name)).toEqual(['gamma', 'beta', 'Alpha']);

    // An empty cell stays last whichever way the column runs.
    act(() => result.current.header('n').onSort());
    expect(result.current.rows.map((r) => r.n)).toEqual([1, 2, null]);
    act(() => result.current.header('n').onSort());
    expect(result.current.rows.map((r) => r.n)).toEqual([2, 1, null]);
    expect(result.current.header('name').direction).toBeNull();
  });
});

describe('RFC-13 R13 toggleSort', () => {
  it('sorts a new column ascending and flips the same column', () => {
    expect(toggleSort({ sort: 'name', order: 'asc' }, 'year')).toEqual({
      sort: 'year',
      order: 'asc',
    });
    expect(toggleSort({ sort: 'year', order: 'asc' }, 'year')).toEqual({
      sort: 'year',
      order: 'desc',
    });
    expect(toggleSort({ sort: 'year', order: 'desc' }, 'year')).toEqual({
      sort: 'year',
      order: 'asc',
    });
  });
});
