import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordItem } from '@treerepro/contracts';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PENDING_RECORD, RECORD, SECONDARY_REFERENCE } from '../../test/dataset-fixtures.ts';
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
    expect(screen.queryByText('sexual system')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'about two' }));
    expect(onSelect).toHaveBeenCalledWith(PENDING_RECORD);
  });

  it('names the secondary reference only when it differs from the primary', () => {
    const same: RecordItem = { ...RECORD, secondaryReference: RECORD.primaryReference };
    const secondaryOnly: RecordItem = {
      ...PENDING_RECORD,
      primaryReference: null,
      secondaryReference: SECONDARY_REFERENCE,
    };
    render(<RecordTable records={[same, secondaryOnly]} onSelect={vi.fn()} />);
    const rows = screen.getAllByRole('row');
    const cells = (row: HTMLElement) => within(row).getAllByRole('cell');
    expect(cells(rows[1] as HTMLElement)[1]).toHaveTextContent(/^Renner2014$/);
    expect(cells(rows[2] as HTMLElement)[1]).toHaveTextContent(/^via TRY-6.0$/);
  });

  it('with showSpecies and showTrait, leading columns name the species (as a link) and the trait', async () => {
    const onSelect = vi.fn();
    renderInRouter(
      <RecordTable records={[RECORD, PENDING_RECORD]} onSelect={onSelect} showSpecies showTrait />,
    );
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers).toEqual([
      'Species',
      'Trait',
      'Value',
      'References',
      'Origin',
      'Harmonisation',
      'Review',
      'Added',
    ]);
    const links = screen.getAllByRole('link', { name: 'Adenanthera pavonina' });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', `/app/species/${RECORD.species.id}`);
    expect(links[0]).toHaveClass('italic');
    const rows = screen.getAllByRole('row');
    const firstCells = within(rows[1] as HTMLElement).getAllByRole('cell');
    expect(firstCells[0]).toContainElement(links[0] as HTMLElement);
    expect(firstCells[1]).toHaveTextContent('sexual system');
    expect(within(rows[2] as HTMLElement).getAllByRole('cell')[1]).toHaveTextContent('seed mass');

    await userEvent.click(screen.getByRole('button', { name: 'dioecious' }));
    expect(onSelect).toHaveBeenCalledWith(RECORD);
  });

  it('shows the trait column alone when only showTrait is set', () => {
    render(<RecordTable records={[RECORD]} onSelect={vi.fn()} showTrait />);
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers.slice(0, 2)).toEqual(['Trait', 'Value']);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
