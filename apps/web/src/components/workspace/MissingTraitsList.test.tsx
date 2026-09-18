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
import { TOP_MISSING_TRAITS } from '../../test/dataset-fixtures.ts';
import { MissingTraitsList } from './MissingTraitsList.tsx';

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

describe('RFC-72 R3 MissingTraitsList', () => {
  it('ranks the traits with their missing-species count, linking with scope=plots when the viewer has plots', async () => {
    renderInRouter(<MissingTraitsList traits={TOP_MISSING_TRAITS} hasPlots />);
    const first = TOP_MISSING_TRAITS[0];
    if (!first) throw new Error('fixture has no traits');
    const link = await screen.findByRole('link', { name: 'seed mass' });
    const url = hrefUrl(link.getAttribute('href'));
    expect(url.pathname).toBe('/app/species');
    expect(url.searchParams.get('traitId')).toBe(first.trait.id);
    expect(url.searchParams.get('traitData')).toBe('missing');
    expect(url.searchParams.get('scope')).toBe('plots');
    expect(screen.getByText('5 species')).toBeInTheDocument();
  });

  it('omits scope from the link when the viewer has no plots', async () => {
    renderInRouter(<MissingTraitsList traits={TOP_MISSING_TRAITS} hasPlots={false} />);
    const link = await screen.findByRole('link', { name: 'seed mass' });
    const url = hrefUrl(link.getAttribute('href'));
    expect(url.searchParams.has('scope')).toBe(false);
    expect(url.searchParams.get('traitData')).toBe('missing');
  });
});
