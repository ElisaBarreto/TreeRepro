import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Page } from '../api/dataset.ts';
import { useCursorList } from './use-cursor-list.ts';

// Created once per test and captured by the closure below, so the same
// client backs every render of the hook; building it inside the component
// would hand React a fresh cache — and lose the one just populated — on
// each re-render the hook triggers.
function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('RFC-11 R6 useCursorList', () => {
  it('flattens pages, loads the next one with its cursor and stops when there is none', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchPage = vi.fn<(cursor: string | undefined) => Promise<Page<{ id: string }>>>();
    fetchPage
      .mockResolvedValueOnce({ data: [{ id: 'a' }, { id: 'b' }], meta: { nextCursor: 'c1' } })
      .mockResolvedValueOnce({ data: [{ id: 'c' }], meta: { nextCursor: null } });

    const { result } = renderHook(() => useCursorList(['things'], fetchPage), {
      wrapper: createWrapper(client),
    });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(result.current.hasMore).toBe(true);
    expect(fetchPage).toHaveBeenLastCalledWith(undefined);

    act(() => {
      void result.current.loadMore();
    });
    // The observer notifies React in a later batch, hence waitFor.
    await waitFor(() =>
      expect(result.current.items).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    );
    expect(fetchPage).toHaveBeenLastCalledWith('c1');
    expect(result.current.hasMore).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch while disabled and exposes the error of a failed page', async () => {
    const fetchPage = vi.fn<(cursor: string | undefined) => Promise<Page<{ id: string }>>>();
    const disabledClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const disabled = renderHook(() => useCursorList(['things'], fetchPage, { enabled: false }), {
      wrapper: createWrapper(disabledClient),
    });
    expect(disabled.result.current.items).toEqual([]);
    expect(fetchPage).not.toHaveBeenCalled();

    fetchPage.mockRejectedValueOnce(new Error('boom'));
    // A separate client from `disabled`'s: sharing one would let this
    // query's error observer bleed into the disabled render's cache entry
    // for the same key.
    const failedClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const failed = renderHook(() => useCursorList(['things'], fetchPage), {
      wrapper: createWrapper(failedClient),
    });
    await waitFor(() => expect(failed.result.current.error).toBeInstanceOf(Error));
    expect(failed.result.current.items).toEqual([]);
  });
});
