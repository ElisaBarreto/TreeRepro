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
import { RecordTable } from './RecordTable.tsx';

// The species column is a router `Link`, so the table mounts inside a minimal
// router whose only page is the table itself.
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

describe('RFC-63 R8 RecordTable', () => {
  it('lists value, references, origin, both chips and the date; the value selects the row', async () => {
    const onSelect = vi.fn();
    render(<RecordTable records={[RECORD, PENDING_RECORD]} onSelect={onSelect} />);
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual(['Value', 'References', 'Origin', 'Harmonisation', 'Review', 'Added']);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('Renner2014 via TRY-6.0');
    expect(rows[1]).toHaveTextContent('import');
    expect(within(rows[1] as HTMLElement).getByText('harmonised')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('confirmed')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('2026-09-01');
    expect(rows[2]).toHaveTextContent('manual');
    expect(within(rows[2] as HTMLElement).getByText('not a number')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'about two' }));
    expect(onSelect).toHaveBeenCalledWith(PENDING_RECORD);
  });

  it('with showSpecies, a first column links every row to its species', async () => {
    const onSelect = vi.fn();
    renderInRouter(
      <RecordTable records={[RECORD, PENDING_RECORD]} onSelect={onSelect} showSpecies />,
    );
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers[0]).toBe('Species');
    expect(headers).toHaveLength(7);
    const links = screen.getAllByRole('link', { name: 'Open species' });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', `/app/species/${RECORD.speciesId}`);
    const rows = screen.getAllByRole('row');
    expect(within(rows[1] as HTMLElement).getAllByRole('cell')[0]).toContainElement(
      links[0] as HTMLElement,
    );

    await userEvent.click(screen.getByRole('button', { name: 'dioecious' }));
    expect(onSelect).toHaveBeenCalledWith(RECORD);
  });
});
