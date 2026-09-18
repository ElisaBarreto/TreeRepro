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
import { DASHBOARD_SCOPE } from '../../test/dataset-fixtures.ts';
import { ScopeCard } from './ScopeCard.tsx';

// The "Browse species" action is a router `Link`, so the card mounts inside
// a minimal router whose only page is the card itself.
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

describe('RFC-72 R3 ScopeCard', () => {
  it('renders a chip per plot with its species count, and a Browse species button', async () => {
    renderInRouter(<ScopeCard scope={DASHBOARD_SCOPE} />);
    const plots = await screen.findByRole('list', { name: 'Your plots' });
    expect(plots).toHaveTextContent('Riverside plot');
    expect(plots).toHaveTextContent('8 species');
    expect(screen.getByRole('link', { name: 'Browse species' })).toHaveAttribute(
      'href',
      '/app/species',
    );
  });

  it('shows the restricted note only when the scope is restricted', async () => {
    const first = renderInRouter(<ScopeCard scope={{ ...DASHBOARD_SCOPE, restricted: true }} />);
    expect(await screen.findByText('Restricted to your plots.')).toBeInTheDocument();
    first.unmount();

    renderInRouter(<ScopeCard scope={{ ...DASHBOARD_SCOPE, restricted: false }} />);
    expect(await screen.findByRole('heading', { name: 'Your scope' })).toBeInTheDocument();
    expect(screen.queryByText('Restricted to your plots.')).not.toBeInTheDocument();
  });
});
