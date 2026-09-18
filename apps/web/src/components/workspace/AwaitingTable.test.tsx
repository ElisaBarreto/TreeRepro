import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PENDING_RECORD, RECORD } from '../../test/dataset-fixtures.ts';
import { AwaitingTable } from './AwaitingTable.tsx';

function renderInRouter(ui: ReactElement) {
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
  return render(<RouterProvider router={router} />);
}

const rows = async () => screen.findAllByRole('row');

describe('RFC-72 R3 AwaitingTable', () => {
  it('lists species, trait, value and source; the value opens the record', async () => {
    const onSelect = vi.fn();
    renderInRouter(<AwaitingTable records={[RECORD, PENDING_RECORD]} onSelect={onSelect} />);
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers).toEqual(['Species', 'Trait', 'Value', 'Source']);
    const body = (await rows()).slice(1);
    expect(body).toHaveLength(2);
    const first = body[0] as HTMLElement;
    expect(within(first).getByRole('link', { name: RECORD.species.canonicalName })).toHaveAttribute(
      'href',
      `/app/species/${RECORD.species.id}`,
    );
    expect(first).toHaveTextContent('sexual system');
    await userEvent.click(within(first).getByRole('button', { name: 'dioecious' }));
    expect(onSelect).toHaveBeenCalledWith(RECORD);
  });

  it('renders a dash when a record carries no reference in either role', async () => {
    const noSource = { ...PENDING_RECORD, primaryReference: null, secondaryReference: null };
    renderInRouter(<AwaitingTable records={[noSource]} onSelect={vi.fn()} />);
    const body = (await rows()).slice(1);
    expect(within(body[0] as HTMLElement).getByText('—')).toBeInTheDocument();
  });
});
