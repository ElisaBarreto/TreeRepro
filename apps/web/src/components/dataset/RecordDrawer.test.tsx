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

describe('RFC-65 R3 RecordDrawer actions section', () => {
  it('has no Actions heading for a viewer without a curation permission, and one with records.annotate', async () => {
    dataset.fetchRecord.mockResolvedValue(RECORD_DETAIL);
    const viewer = renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={() => undefined} />, {
      ...ME,
      permissions: ['dataset.read'],
    });
    await screen.findByText('Dioecious');
    expect(screen.queryByRole('heading', { name: 'Actions' })).not.toBeInTheDocument();
    viewer.unmount();

    renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={() => undefined} />, {
      ...ME,
      permissions: ['dataset.read', 'records.annotate'],
    });
    await screen.findByText('Dioecious');
    const heading = screen.getByRole('heading', { name: 'Actions' });
    expect(heading.parentElement).toContainElement(screen.getByRole('button', { name: 'Confirm' }));
  });
});

describe('RFC-65 R7 RecordDrawer harmonisation section', () => {
  it('links a record to the pending record it harmonises and to the records that harmonise it', async () => {
    dataset.fetchRecord.mockResolvedValue({
      ...RECORD_DETAIL,
      supersedes: { id: 'pending-000001' },
      supersededBy: [{ id: 'harmonised-000002' }, { id: 'harmonised-000003' }],
    });
    const onOpenRecord = vi.fn();
    renderDrawer(
      <RecordDrawer recordId={RECORD.id} onClose={() => undefined} onOpenRecord={onOpenRecord} />,
      { ...ME, permissions: ['dataset.read'] },
    );
    const section = await screen.findByRole('region', { name: 'Harmonisation' });
    await userEvent.click(
      within(section).getByRole('button', { name: /^Harmonises record …000001$/ }),
    );
    expect(onOpenRecord).toHaveBeenCalledWith('pending-000001');
    const harmonised = within(section).getAllByRole('button', { name: /^Harmonised as record …/ });
    expect(harmonised.map((b) => b.textContent)).toEqual([
      'Harmonised as record …000002',
      'Harmonised as record …000003',
    ]);
  });

  it('names the linked records without buttons when no onOpenRecord is given', async () => {
    dataset.fetchRecord.mockResolvedValue({
      ...RECORD_DETAIL,
      supersedes: { id: 'pending-000001' },
      supersededBy: [{ id: 'harmonised-000002' }],
    });
    renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={() => undefined} />, {
      ...ME,
      permissions: ['dataset.read'],
    });
    const section = await screen.findByRole('region', { name: 'Harmonisation' });
    expect(section).toHaveTextContent('Harmonises record …000001');
    expect(section).toHaveTextContent('Harmonised as record …000002');
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();
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
