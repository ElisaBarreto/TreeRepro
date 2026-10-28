import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { MapEntry } from '@treerepro/contracts';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAP_VALUES } from '../test/map-fixtures.ts';
import { mapsKeys, useHasMaps, useMapValues, usePrefetchTraitMaps } from './maps.ts';

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const ENTRY: MapEntry = {
  traitId: 't1',
  kind: 'completeness',
  levelId: null,
  regions: 3,
  computedAt: '2026-10-23T03:00:00.000Z',
};

/**
 * `useHasMaps` is the real hook `TraitCard`, `EmptyTraitCard` and
 * `TraitsPage` share (RFC-76 R8) — exercised directly, through a real
 * `QueryClient`, since the components' own tests mock it at the boundary
 * instead (a same-module reference to `useMaps` would bypass any mock of
 * `useMaps` set from another module, so those tests mock `useHasMaps`
 * itself; this file is where the hook's own logic gets checked for real).
 * @rfc RFC-76 R8
 */
// `staleTime: Infinity` keeps `useQuery` reading the seeded cache instead of
// refetching on mount (its default staleTime is 0), so these tests never
// reach `fetchMaps`'s real `fetch` call.
function seededClient(entries: MapEntry[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(mapsKeys.all, entries);
  return client;
}

describe('RFC-76 R8 useHasMaps', () => {
  it('is true only for a trait the cached map list names', () => {
    const wrapper = createWrapper(seededClient([ENTRY]));
    expect(renderHook(() => useHasMaps('t1'), { wrapper }).result.current).toBe(true);
    expect(renderHook(() => useHasMaps('t2'), { wrapper }).result.current).toBe(false);
  });

  it('is false for an empty map list', () => {
    const wrapper = createWrapper(seededClient([]));
    expect(renderHook(() => useHasMaps('t1'), { wrapper }).result.current).toBe(false);
  });
});

const { computedAt, ...VALUES } = MAP_VALUES;
const TRAIT_MAPS = {
  maps: [
    { kind: 'completeness' as const, levelId: null, ...VALUES },
    {
      kind: 'mean' as const,
      levelId: null,
      ...VALUES,
      legend: { ...VALUES.legend, label: 'mean' },
    },
  ],
  computedAt,
};

describe('RFC-76 R10 maps read per trait', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('useMapValues picks its map out of the trait answer, cached by trait and snapshot', async () => {
    const client = seededClient([]);
    client.setQueryData(mapsKeys.trait('t1', computedAt), TRAIT_MAPS);
    const wrapper = createWrapper(client);
    const mean = renderHook(() => useMapValues({ ...ENTRY, kind: 'mean' }), { wrapper });
    await waitFor(() => expect(mean.result.current.data?.legend.label).toBe('mean'));
    expect(mean.result.current.data?.computedAt).toBe(computedAt);
    const max = renderHook(() => useMapValues({ ...ENTRY, kind: 'max' }), { wrapper });
    await waitFor(() => expect(max.result.current.isError).toBe(true));
  });

  it('usePrefetchTraitMaps asks once per trait, however many maps it has', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL) => Response.json({ data: TRAIT_MAPS }));
    vi.stubGlobal('fetch', fetch);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const entries = [ENTRY, { ...ENTRY, kind: 'mean' as const }, { ...ENTRY, traitId: 't2' }];
    const hook = renderHook(() => usePrefetchTraitMaps(entries), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('/maps/trait-values?traitId=t1'),
      expect.stringContaining('/maps/trait-values?traitId=t2'),
    ]);
    hook.rerender();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(mapsKeys.trait('t2', computedAt))).toEqual(TRAIT_MAPS);
  });
});
