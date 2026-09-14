import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecordWrite } from './use-record-write.ts';

const curation = vi.hoisted(() => ({ invalidateAfterRecordWrite: vi.fn() }));
vi.mock('../api/curation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/curation.ts')>()),
  ...curation,
}));

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  curation.invalidateAfterRecordWrite.mockReset().mockResolvedValue(undefined);
});

describe('RFC-65 useRecordWrite', () => {
  it('writes, seeds with the answer, invalidates for the species, then reports — in that order, pending throughout', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const order: string[] = [];
    let release!: () => void;
    curation.invalidateAfterRecordWrite.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          order.push('invalidate');
          release = resolve;
        }),
    );
    const write = vi.fn(async (note: string) => ({ id: 'r1', note }));
    const onWritten = vi.fn((result: { id: string }, queryClient: QueryClient) => {
      order.push('written');
      queryClient.setQueryData(['record', result.id], result);
    });
    const onInvalidated = vi.fn(() => order.push('invalidated'));
    const { result } = renderHook(
      () => useRecordWrite({ write, speciesId: 's1', onWritten, onInvalidated }),
      { wrapper: createWrapper(client) },
    );
    act(() => result.current.mutate('hello'));
    await waitFor(() => expect(order).toEqual(['written', 'invalidate']));
    expect(curation.invalidateAfterRecordWrite).toHaveBeenCalledWith(client, 's1');
    expect(client.getQueryData(['record', 'r1'])).toEqual({ id: 'r1', note: 'hello' });
    expect(result.current.isPending).toBe(true);
    expect(onInvalidated).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(order).toEqual(['written', 'invalidate', 'invalidated']);
    expect(onInvalidated).toHaveBeenCalledWith({ id: 'r1', note: 'hello' });
  });

  it('without a species id invalidates every species (a bulk mapping); a failed write invalidates nothing', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(
      () => useRecordWrite({ write: async () => ({ created: 2, skipped: 0 }) }),
      { wrapper: createWrapper(client) },
    );
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(curation.invalidateAfterRecordWrite).toHaveBeenCalledWith(client, undefined);

    const failing = renderHook(
      () => useRecordWrite({ write: async () => Promise.reject(new Error('down')) }),
      { wrapper: createWrapper(client) },
    );
    act(() => failing.result.current.mutate());
    await waitFor(() => expect(failing.result.current.isError).toBe(true));
    expect(curation.invalidateAfterRecordWrite).toHaveBeenCalledTimes(1);
  });
});
