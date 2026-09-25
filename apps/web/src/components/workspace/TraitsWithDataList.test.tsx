import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { TOP_TRAITS_WITH_DATA } from '../../test/dataset-fixtures.ts';
import { TraitsWithDataList } from './TraitsWithDataList.tsx';

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

describe('RFC-72 R3 TraitsWithDataList', () => {
  it('ranks the traits with their species count, each linking to its trait page', async () => {
    renderInRouter(<TraitsWithDataList traits={TOP_TRAITS_WITH_DATA} />);
    const [first, second] = TOP_TRAITS_WITH_DATA;
    if (!first || !second) throw new Error('fixture has fewer than two traits');
    expect(await screen.findByRole('link', { name: 'seed mass' })).toHaveAttribute(
      'href',
      `/app/traits/${first.trait.id}`,
    );
    expect(screen.getByRole('link', { name: 'pollination mode' })).toHaveAttribute(
      'href',
      `/app/traits/${second.trait.id}`,
    );
    expect(screen.getByText('40 species')).toBeInTheDocument();
    expect(screen.getByText('12 species')).toBeInTheDocument();
  });
});
