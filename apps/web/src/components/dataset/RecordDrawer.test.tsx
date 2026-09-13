import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse } from '@treerepro/contracts';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ME_QUERY_KEY } from '../../lib/session.ts';
import { RECORD, RECORD_DETAIL } from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { RecordDrawer } from './RecordDrawer.tsx';

const dataset = vi.hoisted(() => ({ fetchRecord: vi.fn() }));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

beforeEach(() => dataset.fetchRecord.mockReset());

// The drawer's source links are router `Link`s and `RecordActions` reads the
// session, so this mounts both a router and a query client seeded with `me` —
// `renderWithProviders` alone has no router context for the `Link`s to use.
function renderDrawer(ui: ReactElement, me: MeResponse) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(ME_QUERY_KEY, me);
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => ui,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('RFC-65 R7 RecordDrawer harmonisation section', () => {
  it('links a record to the pending record it harmonises and to the records that harmonise it', async () => {
    dataset.fetchRecord.mockResolvedValue({
      ...RECORD_DETAIL,
      supersedes: { id: 'p-1' },
      supersededBy: [{ id: 'h-1' }, { id: 'h-2' }],
    });
    const onOpenRecord = vi.fn();
    renderDrawer(
      <RecordDrawer recordId={RECORD.id} onClose={() => undefined} onOpenRecord={onOpenRecord} />,
      { ...ME, permissions: ['dataset.read'] },
    );
    const section = await screen.findByRole('region', { name: 'Harmonisation' });
    await userEvent.click(within(section).getByRole('button', { name: 'Harmonises record' }));
    expect(onOpenRecord).toHaveBeenCalledWith('p-1');
    expect(within(section).getAllByRole('button', { name: /Harmonised as record/ })).toHaveLength(
      2,
    );
  });

  it('omits the section when the record neither supersedes nor is superseded', async () => {
    dataset.fetchRecord.mockResolvedValue(RECORD_DETAIL);
    renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={() => undefined} />, {
      ...ME,
      permissions: ['dataset.read'],
    });
    await screen.findByText('Dioecious');
    expect(screen.queryByRole('region', { name: 'Harmonisation' })).not.toBeInTheDocument();
  });
});
