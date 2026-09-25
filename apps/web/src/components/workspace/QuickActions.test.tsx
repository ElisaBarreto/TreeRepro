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

describe('RFC-72 R3 QuickActions', () => {
  it.each([
    ['Browse species', '/app/species'],
    ['Browse traits', '/app/traits'],
    ['Browse references', '/app/references'],
  ])('%s goes to %s', async (name, href) => {
    renderInRouter(<QuickActions />);
    expect(await screen.findByRole('link', { name })).toHaveAttribute('href', href);
  });

  it('offers exactly those three links', async () => {
    renderInRouter(<QuickActions />);
    await screen.findByRole('link', { name: 'Browse species' });
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });
});
