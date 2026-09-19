import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse } from '@treerepro/contracts';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ME_QUERY_KEY } from '../../lib/session.ts';
import {
  COVERAGE,
  COVERAGE_TRAIT_SEED_MASS,
  COVERAGE_TRAIT_SEXUAL_SYSTEM,
} from '../../test/coverage-fixtures.ts';
import { DASHBOARD_PLOT, MALVACEAE } from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { CoverageTable } from './CoverageTable.tsx';

function renderInRouter(ui: ReactElement, me: MeResponse = ME) {
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(ME_QUERY_KEY, me);
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function hrefUrl(href: string | null) {
  return new URL(href ?? '', 'https://example.org');
}

describe('RFC-69 R5 CoverageTable', () => {
  it('lists a row per category with the API percentages, not a browser recomputation', async () => {
    renderInRouter(
      <CoverageTable byCategory={COVERAGE.byCategory} byTrait={COVERAGE.byTrait} search={{}} />,
    );
    expect(await screen.findByText('Reproductive system')).toBeInTheDocument();
    const meters = screen.getAllByRole('meter');
    expect(meters).toHaveLength(2);
    expect(meters[0]).toHaveAttribute('value', String(COVERAGE.byCategory[0]?.withData));
    expect(meters[0]).toHaveAttribute('max', String(COVERAGE.byCategory[0]?.cells));
    expect(screen.getByText(`${COVERAGE.byCategory[0]?.percentWithData}%`)).toBeInTheDocument();
    expect(screen.getByText(`${COVERAGE.byCategory[0]?.percentAccepted}%`)).toBeInTheDocument();
  });

  it('the chevron expands a category to its trait rows, each with two meters and both links', async () => {
    renderInRouter(
      <CoverageTable byCategory={COVERAGE.byCategory} byTrait={COVERAGE.byTrait} search={{}} />,
    );
    const toggle = await screen.findByRole('button', { name: /expand reproductive system/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('sexual system')).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const traitLink = await screen.findByRole('link', { name: 'sexual system' });
    expect(traitLink).toHaveAttribute(
      'href',
      `/app/traits/${COVERAGE_TRAIT_SEXUAL_SYSTEM.trait.id}`,
    );

    const sexualSystemRow = traitLink.closest('tr') as HTMLElement;
    const speciesLink = within(sexualSystemRow).getByRole('link', { name: /no record yet/i });
    const url = hrefUrl(speciesLink.getAttribute('href'));
    expect(url.pathname).toBe('/app/species');
    expect(url.searchParams.get('traitId')).toBe(COVERAGE_TRAIT_SEXUAL_SYSTEM.trait.id);
    expect(url.searchParams.get('traitData')).toBe('missing');

    // Every trait row carries its own two meters, in addition to the
    // category row's own pair.
    expect(screen.getAllByRole('meter')).toHaveLength(2 + 2 * COVERAGE.byTrait.length);
  });

  it('RFC-69 R2 a trait with no record anywhere in the selection reads "No record yet"', async () => {
    renderInRouter(
      <CoverageTable byCategory={COVERAGE.byCategory} byTrait={COVERAGE.byTrait} search={{}} />,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: /expand reproductive system/i }),
    );
    const row = (await screen.findByText('seed mass')).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('No record yet')).toBeInTheDocument();
    expect(COVERAGE_TRAIT_SEED_MASS.withData).toBe(0);
  });

  /**
   * The row is computed over the page's selection, so the list it opens must
   * be too — and over the same species, which for a grid with no `plotId` is
   * every visible species, not the viewer's plots (RFC-33 R6's default).
   * An unrestricted viewer's own drill-down list matches that dataset-wide
   * row, so the link both asks for it and says so.
   */
  it('RFC-13 R2 the missing-species link carries the page filters and asks for the dataset-wide list', async () => {
    renderInRouter(
      <CoverageTable
        byCategory={COVERAGE.byCategory}
        byTrait={COVERAGE.byTrait}
        search={{ familyId: MALVACEAE.id, categoryKey: 'reproductive_system' }}
      />,
      { ...ME, scope: { plots: [], restricted: false } },
    );
    await userEvent.click(
      await screen.findByRole('button', { name: /expand reproductive system/i }),
    );
    const row = (await screen.findByText('sexual system')).closest('tr') as HTMLElement;
    const link = within(row).getByRole('link', { name: 'Species with no record yet' });
    const url = hrefUrl(link.getAttribute('href'));
    expect(url.searchParams.get('traitId')).toBe(COVERAGE_TRAIT_SEXUAL_SYSTEM.trait.id);
    expect(url.searchParams.get('traitData')).toBe('missing');
    expect(url.searchParams.get('familyId')).toBe(MALVACEAE.id);
    expect(url.searchParams.get('categoryKey')).toBe('reproductive_system');
    expect(url.searchParams.get('scope')).toBe('all');
    expect(url.searchParams.get('plotId')).toBeNull();
  });

  /**
   * A plot-restricted viewer may see the dataset-wide row (aggregate
   * statistics are not the trait data the restriction protects), but they
   * can only act on species in their own plots. Sending `scope=all` for
   * them would be refused outright (`PERMISSION_DENIED`); omitting `scope`
   * lets `GET /api/species` fall back to its own default for a restricted
   * viewer, `scope=plots` (RFC-33 R6).
   */
  it('omits scope for a plot-restricted viewer with no plot filter, and labels the link as theirs', async () => {
    renderInRouter(
      <CoverageTable byCategory={COVERAGE.byCategory} byTrait={COVERAGE.byTrait} search={{}} />,
      { ...ME, scope: { plots: [DASHBOARD_PLOT], restricted: true } },
    );
    await userEvent.click(
      await screen.findByRole('button', { name: /expand reproductive system/i }),
    );
    const row = (await screen.findByText('sexual system')).closest('tr') as HTMLElement;
    const link = within(row).getByRole('link', {
      name: 'Species in your plots with no record yet',
    });
    const url = hrefUrl(link.getAttribute('href'));
    expect(url.searchParams.get('traitId')).toBe(COVERAGE_TRAIT_SEXUAL_SYSTEM.trait.id);
    expect(url.searchParams.get('traitData')).toBe('missing');
    expect(url.searchParams.has('scope')).toBe(false);
    expect(url.searchParams.get('plotId')).toBeNull();
  });

  it('RFC-33 R6 scopes that link to the plot the page filters by, and drops scope beside it, even for a restricted viewer', async () => {
    renderInRouter(
      <CoverageTable
        byCategory={COVERAGE.byCategory}
        byTrait={COVERAGE.byTrait}
        search={{ plotId: DASHBOARD_PLOT.id }}
      />,
      { ...ME, scope: { plots: [DASHBOARD_PLOT], restricted: true } },
    );
    await userEvent.click(
      await screen.findByRole('button', { name: /expand reproductive system/i }),
    );
    const row = (await screen.findByText('sexual system')).closest('tr') as HTMLElement;
    const link = within(row).getByRole('link', { name: 'Species with no record yet' });
    const url = hrefUrl(link.getAttribute('href'));
    expect(url.searchParams.get('plotId')).toBe(DASHBOARD_PLOT.id);
    expect(url.searchParams.get('scope')).toBeNull();
  });

  it('shows the "No record yet" empty state when nothing is in scope', async () => {
    renderInRouter(<CoverageTable byCategory={[]} byTrait={[]} search={{}} />);
    expect(await screen.findByText('No record yet.')).toBeInTheDocument();
  });
});
