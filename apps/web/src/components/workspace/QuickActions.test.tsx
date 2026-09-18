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
import { QuickActions } from './QuickActions.tsx';

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

function hrefUrl(href: string | null) {
  return new URL(href ?? '', 'https://example.org');
}

describe('RFC-72 R3 QuickActions', () => {
  it('Validate records goes to the plot species sorted by completeness', async () => {
    renderInRouter(<QuickActions />);
    const link = await screen.findByRole('link', { name: 'Validate records' });
    const url = hrefUrl(link.getAttribute('href'));
    expect(url.pathname).toBe('/app/species');
    expect(url.searchParams.get('scope')).toBe('plots');
    expect(url.searchParams.get('sort')).toBe('completeness');
  });

  it('Enter new data goes to the plot species missing that trait data', async () => {
    renderInRouter(<QuickActions />);
    const link = await screen.findByRole('link', { name: 'Enter new data' });
    const url = hrefUrl(link.getAttribute('href'));
    expect(url.pathname).toBe('/app/species');
    expect(url.searchParams.get('traitData')).toBe('missing');
    expect(url.searchParams.get('scope')).toBe('plots');
  });

  it('Browse species goes to the plain species list', async () => {
    renderInRouter(<QuickActions />);
    const link = await screen.findByRole('link', { name: 'Browse species' });
    expect(link).toHaveAttribute('href', '/app/species');
  });
});
