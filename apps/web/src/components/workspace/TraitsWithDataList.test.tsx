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

  it('draws a bar per trait against the largest count, hidden from assistive tech', async () => {
    const { container } = renderInRouter(<TraitsWithDataList traits={TOP_TRAITS_WITH_DATA} />);
    await screen.findByRole('link', { name: 'seed mass' });
    const bars = [...container.querySelectorAll('meter')];
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAttribute('value', '40');
    expect(bars[0]).toHaveAttribute('max', '40');
    expect(bars[1]).toHaveAttribute('value', '12');
    expect(bars[1]).toHaveAttribute('max', '40');
    for (const bar of bars) expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryAllByRole('meter')).toHaveLength(0);
  });
});
