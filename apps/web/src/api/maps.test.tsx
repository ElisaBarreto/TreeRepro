import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { MapEntry } from '@treerepro/contracts';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { mapsKeys, useHasMaps } from './maps.ts';

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const ENTRY: MapEntry = {
  traitId: 't1',
  kind: 'completeness',
  levelId: null,
  file: 'x.svg',
  dataVersion: '2026-09-01',
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
  it('is true only for a trait the cached manifest names', () => {
    const wrapper = createWrapper(seededClient([ENTRY]));
    expect(renderHook(() => useHasMaps('t1'), { wrapper }).result.current).toBe(true);
    expect(renderHook(() => useHasMaps('t2'), { wrapper }).result.current).toBe(false);
  });

  it('is false for an empty manifest', () => {
    const wrapper = createWrapper(seededClient([]));
    expect(renderHook(() => useHasMaps('t1'), { wrapper }).result.current).toBe(false);
  });
});
