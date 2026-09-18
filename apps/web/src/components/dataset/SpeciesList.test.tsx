import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import type { SpeciesListItem } from '@treerepro/contracts';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { SpeciesList } from './SpeciesList.tsx';

// The canonical name is a router `Link`, so the list mounts inside a
// minimal router whose only page is the list itself.
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

const FAMILY = { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d01', name: 'Fabaceae' };
const GENUS = { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d02', name: 'Adenanthera' };
const ADENANTHERA: SpeciesListItem = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d03',
  canonicalName: 'Adenanthera pavonina',
  nameSource: 'wcvp',
  active: true,
  genus: GENUS,
  family: FAMILY,
  matchedName: null,
  unresolvedTaxon: false,
  traitCount: 12,
  traitRecordCount: null,
};

describe('RFC-13 R2, RFC-33 R7 SpeciesList', () => {
  it('shows no badge for an active species', async () => {
    renderInRouter(<SpeciesList items={[ADENANTHERA]} />);
    expect(await screen.findByText('Adenanthera pavonina')).toBeInTheDocument();
    expect(screen.queryByText('inactive')).not.toBeInTheDocument();
  });

  it('RFC-33 R7 marks an inactive species', async () => {
    renderInRouter(<SpeciesList items={[{ ...ADENANTHERA, active: false }]} />);
    expect(await screen.findByText('inactive')).toBeInTheDocument();
  });
});

describe('RFC-60 R6 SpeciesList coverage columns', () => {
  it('shows the trait count in a Traits column and no Records column by default', async () => {
    renderInRouter(<SpeciesList items={[ADENANTHERA]} />);
    const table = await screen.findByRole('table');
    const [head, row] = within(table).getAllByRole('row');
    expect(
      within(head as HTMLElement).getByRole('columnheader', { name: 'Traits' }),
    ).toBeInTheDocument();
    expect(
      within(head as HTMLElement).queryByRole('columnheader', { name: 'Records' }),
    ).not.toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('12')).toBeInTheDocument();
  });

  it('adds a Records column with the trait record count when asked', async () => {
    renderInRouter(
      <SpeciesList items={[{ ...ADENANTHERA, traitRecordCount: 7 }]} showTraitRecords />,
    );
    const table = await screen.findByRole('table');
    const [head, row] = within(table).getAllByRole('row');
    expect(
      within(head as HTMLElement).getByRole('columnheader', { name: 'Records' }),
    ).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('7')).toBeInTheDocument();
  });

  it('prints a zero trait record count, the missing-mode value, as 0 and not as a dash', async () => {
    renderInRouter(
      <SpeciesList items={[{ ...ADENANTHERA, traitRecordCount: 0 }]} showTraitRecords />,
    );
    const table = await screen.findByRole('table');
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    const cells = within(row).getAllByRole('cell');
    expect(cells[4]).toHaveTextContent('0');
    expect(cells[4]).not.toHaveTextContent('—');
  });

  it('reads a null trait record count as a dash', async () => {
    renderInRouter(<SpeciesList items={[ADENANTHERA]} showTraitRecords />);
    const table = await screen.findByRole('table');
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    const cells = within(row).getAllByRole('cell');
    expect(cells).toHaveLength(6);
    expect(cells[3]).toHaveTextContent('12');
    expect(cells[4]).toHaveTextContent('—');
  });
});
