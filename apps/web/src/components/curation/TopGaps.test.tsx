import { QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppQueryClient } from '../../lib/session.ts';
import {
  COVERAGE_TOP_LEAST_VALIDATED,
  COVERAGE_TOP_MISSING,
  COVERAGE_TRAIT_SEED_MASS,
} from '../../test/coverage-fixtures.ts';
import { TopGaps } from './TopGaps.tsx';

const coverage = vi.hoisted(() => ({ fetchCoverageTop: vi.fn() }));
vi.mock('../../api/coverage.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/coverage.ts')>()),
  ...coverage,
}));

function renderInRouter(ui: ReactElement) {
  const { queryClient } = createAppQueryClient({ retry: false });
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
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  coverage.fetchCoverageTop
    .mockReset()
    .mockImplementation(({ mode } = {}) =>
      Promise.resolve(
        mode === 'least_validated' ? COVERAGE_TOP_LEAST_VALIDATED : COVERAGE_TOP_MISSING,
      ),
    );
});

describe('RFC-69 R7 TopGaps', () => {
  it('defaults to "missing" mode and lists the ranked traits with "no record yet" wording', async () => {
    renderInRouter(<TopGaps />);
    expect(await screen.findByRole('link', { name: 'seed mass' })).toBeInTheDocument();
    expect(coverage.fetchCoverageTop).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'missing' }),
    );
    const missing = COVERAGE_TRAIT_SEED_MASS.cells - COVERAGE_TRAIT_SEED_MASS.withData;
    expect(
      screen.getByText(new RegExp(`${missing} species.*no record yet`, 'i')),
    ).toBeInTheDocument();
  });

  it('switching to "least validated" refetches with that mode and shows validated percentages', async () => {
    renderInRouter(<TopGaps />);
    await screen.findByRole('link', { name: 'seed mass' });
    await userEvent.click(screen.getByRole('button', { name: /lowest validated share/i }));
    expect(
      await screen.findByText(`${COVERAGE_TRAIT_SEED_MASS.percentValidated}% validated`),
    ).toBeInTheDocument();
    expect(coverage.fetchCoverageTop).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'least_validated' }),
    );
    expect(screen.getByRole('button', { name: /lowest validated share/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows an empty state when nothing lacks a record', async () => {
    coverage.fetchCoverageTop.mockResolvedValue([]);
    renderInRouter(<TopGaps />);
    expect(await screen.findByText('Nothing lacks a record.')).toBeInTheDocument();
  });
});
