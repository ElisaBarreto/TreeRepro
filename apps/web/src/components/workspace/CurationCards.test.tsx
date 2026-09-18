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
import { DASHBOARD_CURATION } from '../../test/dataset-fixtures.ts';
import { CurationCards } from './CurationCards.tsx';

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

describe('RFC-72 R3 CurationCards', () => {
  it('renders two meters for the coverage percentages', async () => {
    renderInRouter(<CurationCards curation={DASHBOARD_CURATION} canReadCoverage={false} />);
    const meters = await screen.findAllByRole('meter');
    expect(meters).toHaveLength(2);
    expect(meters[0]).toHaveAttribute('value', String(DASHBOARD_CURATION.coverage.withData));
    expect(meters[0]).toHaveAttribute('max', String(DASHBOARD_CURATION.coverage.cells));
    expect(meters[1]).toHaveAttribute('value', String(DASHBOARD_CURATION.coverage.accepted));
    expect(meters[1]).toHaveAttribute('max', String(DASHBOARD_CURATION.coverage.cells));
  });

  it('shows the percentages the API computed, not its own float rounding', async () => {
    renderInRouter(<CurationCards curation={DASHBOARD_CURATION} canReadCoverage={false} />);
    await screen.findAllByRole('meter');
    expect(screen.getByText(`${DASHBOARD_CURATION.coverage.percentWithData}%`)).toBeInTheDocument();
    expect(screen.getByText(`${DASHBOARD_CURATION.coverage.percentAccepted}%`)).toBeInTheDocument();
    // What the browser would have computed from the same two counts.
    expect(screen.queryByText('57%')).not.toBeInTheDocument();
    expect(screen.queryByText('28%')).not.toBeInTheDocument();
  });

  it('names both meters as dataset-wide, since the coverage totals are plot-blind', async () => {
    renderInRouter(<CurationCards curation={DASHBOARD_CURATION} canReadCoverage={false} />);
    const meters = await screen.findAllByRole('meter');
    for (const meter of meters) {
      expect(meter.getAttribute('aria-label')).toMatch(/dataset-wide/);
    }
  });

  it('links the queue tiles to pending, disputed and disputed?intent=contest', async () => {
    renderInRouter(<CurationCards curation={DASHBOARD_CURATION} canReadCoverage={false} />);
    expect(await screen.findByRole('link', { name: /^Pending/ })).toHaveAttribute(
      'href',
      '/app/curation/pending',
    );
    expect(screen.getByRole('link', { name: /^Disputed/ })).toHaveAttribute(
      'href',
      '/app/curation/disputed',
    );
    const contested = hrefUrl(
      screen.getByRole('link', { name: /^Contested/ }).getAttribute('href'),
    );
    expect(contested.pathname).toBe('/app/curation/disputed');
    expect(contested.searchParams.get('intent')).toBe('contest');
  });

  it('shows the proposals tile only when there are open proposals', async () => {
    const first = renderInRouter(
      <CurationCards curation={DASHBOARD_CURATION} canReadCoverage={false} />,
    );
    await screen.findByRole('link', { name: /^Pending/ });
    expect(screen.queryByText(/^Proposals/)).not.toBeInTheDocument();
    first.unmount();

    const withProposals = {
      ...DASHBOARD_CURATION,
      queues: { ...DASHBOARD_CURATION.queues, proposals: 3 },
    };
    renderInRouter(<CurationCards curation={withProposals} canReadCoverage={false} />);
    const proposals = await screen.findByRole('link', { name: /^Proposals/ });
    expect(proposals).toHaveAttribute('href', '/app/curation/proposals');
    expect(proposals).toHaveTextContent('3');
  });

  it('shows the coverage link only when the viewer holds coverage.read', async () => {
    const first = renderInRouter(
      <CurationCards curation={DASHBOARD_CURATION} canReadCoverage={false} />,
    );
    await screen.findByRole('link', { name: /^Pending/ });
    expect(screen.queryByRole('link', { name: 'View coverage' })).not.toBeInTheDocument();
    first.unmount();

    renderInRouter(<CurationCards curation={DASHBOARD_CURATION} canReadCoverage={true} />);
    expect(await screen.findByRole('link', { name: 'View coverage' })).toHaveAttribute(
      'href',
      '/app/curation/coverage',
    );
  });
});
