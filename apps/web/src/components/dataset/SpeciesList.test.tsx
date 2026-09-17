import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
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
