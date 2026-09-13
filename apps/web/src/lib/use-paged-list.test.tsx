import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '../api/dataset.ts';
import { PAGE_SIZE_STORAGE_KEY, usePagedList } from './use-paged-list.ts';

type Item = { id: string };
type Fetcher = (cursor: string | undefined, limit: number) => Promise<Page<Item>>;

// Created once per test and captured by the closure below, so the same
// client backs every render of the hook; building it inside the component
// would hand React a fresh cache on each re-render the hook triggers.
function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

// Pages stay fresh for the test, so stepping back to a cached page does not
// refetch it and the fetcher's call list reads as the sequence of new pages.
function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
}

const page = (data: Item[], nextCursor: string | null = null): Page<Item> => ({
  data,
  meta: { nextCursor },
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('RFC-11 R6 usePagedList', () => {
  it('loads the first page at once, steps forward with the cursor and back to the cached page', async () => {
    const fetchPage = vi.fn<Fetcher>();
    fetchPage
      .mockResolvedValueOnce(page([{ id: 'a' }, { id: 'b' }], 'c1'))
      .mockResolvedValueOnce(page([{ id: 'c' }]));
    const { result } = renderHook(() => usePagedList(['things'], fetchPage), {
      wrapper: createWrapper(createClient()),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(50);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchPage).toHaveBeenCalledWith(undefined, 50);
    expect(result.current.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(result.current.hasNext).toBe(true);
    expect(result.current.hasPrev).toBe(false);

    act(() => result.current.next());
    expect(result.current.page).toBe(2);
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'c' }]));
    expect(fetchPage).toHaveBeenLastCalledWith('c1', 50);
    expect(result.current.hasNext).toBe(false);
    expect(result.current.hasPrev).toBe(true);

    // Without a next cursor the call is a no-op.
    act(() => result.current.next());
    expect(result.current.page).toBe(2);

    act(() => result.current.prev());
    expect(result.current.page).toBe(1);
    expect(result.current.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(result.current.hasNext).toBe(true);
    expect(result.current.hasPrev).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(2);

    act(() => result.current.prev());
    expect(result.current.page).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('changing the page size starts over at page 1 with the new limit and remembers it', async () => {
    const fetchPage = vi.fn<Fetcher>();
    fetchPage.mockResolvedValue(page([{ id: 'a' }], 'c1'));
    const first = renderHook(() => usePagedList(['things'], fetchPage), {
      wrapper: createWrapper(createClient()),
    });
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    act(() => first.result.current.next());
    expect(first.result.current.page).toBe(2);

    act(() => first.result.current.setPageSize(25));
    expect(first.result.current.page).toBe(1);
    expect(first.result.current.pageSize).toBe(25);
    await waitFor(() => expect(fetchPage).toHaveBeenLastCalledWith(undefined, 25));
    expect(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY)).toBe('25');

    const second = renderHook(() => usePagedList(['others'], fetchPage), {
      wrapper: createWrapper(createClient()),
    });
    expect(second.result.current.pageSize).toBe(25);
    await waitFor(() => expect(fetchPage).toHaveBeenLastCalledWith(undefined, 25));
  });

  it('ignores a stored size that is not offered and falls back to the default', () => {
    window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, '7');
    const fetchPage = vi.fn<Fetcher>().mockResolvedValue(page([]));
    const { result } = renderHook(() => usePagedList(['things'], fetchPage), {
      wrapper: createWrapper(createClient()),
    });
    expect(result.current.pageSize).toBe(50);
  });

  it('returns to page 1 when the key changes and on reset()', async () => {
    const fetchPage = vi.fn<Fetcher>();
    fetchPage.mockResolvedValue(page([{ id: 'a' }], 'c1'));
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => usePagedList(['things', { q }], fetchPage),
      { wrapper: createWrapper(createClient()), initialProps: { q: 'ad' } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.next());
    await waitFor(() => expect(fetchPage).toHaveBeenLastCalledWith('c1', 50));
    expect(result.current.page).toBe(2);

    rerender({ q: 'ade' });
    expect(result.current.page).toBe(1);
    await waitFor(() => expect(fetchPage).toHaveBeenLastCalledWith(undefined, 50));

    act(() => result.current.next());
    expect(result.current.page).toBe(2);
    act(() => result.current.reset());
    expect(result.current.page).toBe(1);
  });

  it('does not fetch while disabled and exposes the error of a failed page', async () => {
    const fetchPage = vi.fn<Fetcher>();
    const disabled = renderHook(() => usePagedList(['things'], fetchPage, { enabled: false }), {
      wrapper: createWrapper(createClient()),
    });
    expect(disabled.result.current.items).toEqual([]);
    expect(fetchPage).not.toHaveBeenCalled();

    fetchPage.mockRejectedValueOnce(new Error('boom'));
    // A separate client from `disabled`'s: sharing one would let this
    // query's error observer bleed into the disabled render's cache entry
    // for the same key.
    const failed = renderHook(() => usePagedList(['things'], fetchPage), {
      wrapper: createWrapper(createClient()),
    });
    await waitFor(() => expect(failed.result.current.error).toBeInstanceOf(Error));
    expect(failed.result.current.items).toEqual([]);
    expect(failed.result.current.hasNext).toBe(false);
  });
});
