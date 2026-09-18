import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Dashboard } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.ts';
import {
  AWAITING_VALIDATION,
  CURATED_RECORD_DETAIL,
  DASHBOARD,
  DASHBOARD_CURATION,
  NO_PLOTS_DASHBOARD,
  REVIEWER_DASHBOARD,
} from '../test/dataset-fixtures.ts';
import { ME } from '../test/fixtures.ts';
import { renderAt } from '../test/router.tsx';

const auth = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  login: vi.fn(),
  loginTotp: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
  changePassword: vi.fn(),
  totpSetup: vi.fn(),
  totpConfirm: vi.fn(),
  totpDisable: vi.fn(),
}));
const dashboard = vi.hoisted(() => ({ fetchDashboard: vi.fn() }));
const dataset = vi.hoisted(() => ({ fetchRecord: vi.fn() }));
vi.mock('../api/auth.ts', () => auth);
vi.mock('../api/dashboard.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/dashboard.ts')>()),
  ...dashboard,
}));
vi.mock('../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/dataset.ts')>()),
  ...dataset,
}));

function hrefUrl(href: string | null) {
  return new URL(href ?? '', 'https://example.org');
}

beforeEach(() => {
  for (const mock of [
    ...Object.values(auth),
    ...Object.values(dashboard),
    ...Object.values(dataset),
  ]) {
    mock.mockReset();
  }
  auth.fetchMe.mockResolvedValue({ ...ME, permissions: ['dataset.read'] });
  dashboard.fetchDashboard.mockResolvedValue(DASHBOARD);
  dataset.fetchRecord.mockResolvedValue(CURATED_RECORD_DETAIL);
});

describe('RFC-72 R1, R3 WorkspacePage', () => {
  it('shows a loading state while the query is pending, then the intro paragraph with counts substituted and the contact e-mail linked', async () => {
    let resolveDashboard: ((value: Dashboard) => void) | undefined;
    dashboard.fetchDashboard.mockImplementation(
      () =>
        new Promise<Dashboard>((resolve) => {
          resolveDashboard = resolve;
        }),
    );
    renderAt('/app/');
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    resolveDashboard?.(DASHBOARD);
    expect(
      await screen.findByText(/TreeRepro is a collective data assembly of reproductive trait data/),
    ).toHaveTextContent(
      `spanning ${DASHBOARD.dataset.referenceCount} references and ${DASHBOARD.dataset.recordCount} records over ${DASHBOARD.dataset.speciesCount} species`,
    );
    expect(screen.getByRole('link', { name: 'elisabpereira@gmail.com' })).toHaveAttribute(
      'href',
      'mailto:elisabpereira@gmail.com',
    );
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('shows the viewer scope as plot chips when scope is present, and nothing when it is null', async () => {
    const first = renderAt('/app/');
    expect(await screen.findByRole('heading', { name: 'Your scope' })).toBeInTheDocument();
    expect(screen.getByText(/Riverside plot/)).toBeInTheDocument();
    first.unmount();

    dashboard.fetchDashboard.mockResolvedValue(NO_PLOTS_DASHBOARD);
    renderAt('/app/');
    await screen.findByText(/TreeRepro is a collective data assembly/);
    expect(screen.queryByRole('heading', { name: 'Your scope' })).not.toBeInTheDocument();
  });

  it('quick actions link to their exact URLs', async () => {
    renderAt('/app/');
    const quickActions = await screen.findByRole('navigation', { name: 'Quick actions' });
    const validate = hrefUrl(
      within(quickActions).getByRole('link', { name: 'Validate records' }).getAttribute('href'),
    );
    expect(validate.pathname).toBe('/app/species');
    expect(validate.searchParams.get('scope')).toBe('plots');
    expect(validate.searchParams.get('sort')).toBe('completeness');

    const enterData = hrefUrl(
      within(quickActions).getByRole('link', { name: 'Enter new data' }).getAttribute('href'),
    );
    expect(enterData.searchParams.get('traitData')).toBe('missing');
    expect(enterData.searchParams.get('scope')).toBe('plots');

    // "Browse species" also appears on the scope card (its own way into the
    // species list), so this one is found within Quick actions specifically.
    expect(within(quickActions).getByRole('link', { name: 'Browse species' })).toHaveAttribute(
      'href',
      '/app/species',
    );
  });

  it('lists records awaiting validation with the count in the heading, and opens the drawer from a row', async () => {
    renderAt('/app/');
    const heading = await screen.findByRole('heading', {
      name: `Records awaiting your validation (${AWAITING_VALIDATION.count})`,
    });
    expect(heading).toBeInTheDocument();
    const row = (await screen.findAllByRole('row'))[1] as HTMLElement;
    await userEvent.click(within(row).getByRole('button'));
    expect(await screen.findByRole('dialog', { name: 'Record' })).toBeInTheDocument();
  });

  it('shows the empty state when nothing awaits validation', async () => {
    dashboard.fetchDashboard.mockResolvedValue({
      ...DASHBOARD,
      contributor: {
        ...DASHBOARD.contributor,
        awaitingValidation: { count: 0, records: [] },
      },
    });
    renderAt('/app/');
    expect(
      await screen.findByText('Everything in your plots has been validated.'),
    ).toBeInTheDocument();
  });

  it('links the top missing traits with scope=plots when the viewer has plots, and without it when they do not', async () => {
    const first = renderAt('/app/');
    expect(
      await screen.findByRole('heading', { name: 'Top traits missing data in your plots' }),
    ).toBeInTheDocument();
    const withPlots = hrefUrl(screen.getByRole('link', { name: 'seed mass' }).getAttribute('href'));
    expect(withPlots.searchParams.get('scope')).toBe('plots');
    first.unmount();

    dashboard.fetchDashboard.mockResolvedValue(NO_PLOTS_DASHBOARD);
    renderAt('/app/');
    expect(
      await screen.findByRole('heading', { name: 'Top traits missing data in the dataset' }),
    ).toBeInTheDocument();
    const withoutPlots = hrefUrl(
      screen.getByRole('link', { name: 'seed mass' }).getAttribute('href'),
    );
    expect(withoutPlots.searchParams.has('scope')).toBe(false);
  });

  it('shows the empty state when no trait is missing data', async () => {
    dashboard.fetchDashboard.mockResolvedValue({
      ...DASHBOARD,
      contributor: {
        ...DASHBOARD.contributor,
        topMissingTraits: [],
      },
    });
    renderAt('/app/');
    expect(await screen.findByText('Every trait in your plots has data.')).toBeInTheDocument();
  });

  it('shows the empty state without plots when no trait is missing data', async () => {
    dashboard.fetchDashboard.mockResolvedValue({
      ...NO_PLOTS_DASHBOARD,
      contributor: {
        ...NO_PLOTS_DASHBOARD.contributor,
        topMissingTraits: [],
      },
    });
    renderAt('/app/');
    expect(await screen.findByText('Every trait in the dataset has data.')).toBeInTheDocument();
  });

  it('shows the contribution summary as tiles linking to /app/contributions', async () => {
    renderAt('/app/');
    const tiles = await screen.findByRole('list', { name: 'Your contributions' });
    expect(tiles).toHaveTextContent('Records');
    expect(tiles).toHaveTextContent(String(DASHBOARD.contributor.summary.records));
    expect(screen.getByRole('link', { name: 'View your contributions' })).toHaveAttribute(
      'href',
      '/app/contributions',
    );
  });

  it('renders the curation section only when curation is present', async () => {
    const first = renderAt('/app/');
    await screen.findByText(/TreeRepro is a collective data assembly/);
    expect(screen.queryByRole('heading', { name: 'Curation' })).not.toBeInTheDocument();
    first.unmount();

    dashboard.fetchDashboard.mockResolvedValue(REVIEWER_DASHBOARD);
    renderAt('/app/');
    expect(await screen.findByRole('heading', { name: 'Curation' })).toBeInTheDocument();
    const meters = screen.getAllByRole('meter');
    expect(meters).toHaveLength(2);
    expect(screen.getByRole('link', { name: /^Disputed/ })).toHaveAttribute(
      'href',
      '/app/curation/disputed',
    );
    expect(screen.queryByText(/^Proposals/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View coverage' })).not.toBeInTheDocument();
  });

  it('shows the coverage link only for a viewer with coverage.read', async () => {
    auth.fetchMe.mockResolvedValue({
      ...ME,
      permissions: ['dataset.read', 'records.review', 'coverage.read'],
    });
    dashboard.fetchDashboard.mockResolvedValue(REVIEWER_DASHBOARD);
    renderAt('/app/');
    expect(await screen.findByRole('link', { name: 'View coverage' })).toHaveAttribute(
      'href',
      '/app/curation/coverage',
    );
  });

  it('shows the proposals tile only once there are open proposals', async () => {
    dashboard.fetchDashboard.mockResolvedValue({
      ...REVIEWER_DASHBOARD,
      curation: {
        ...DASHBOARD_CURATION,
        queues: { ...DASHBOARD_CURATION.queues, proposals: 2 },
      },
    });
    renderAt('/app/');
    const proposals = await screen.findByRole('link', { name: /^Proposals/ });
    expect(proposals).toHaveAttribute('href', '/app/curation/proposals');
  });

  it('shows an error alert on failure', async () => {
    dashboard.fetchDashboard.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    renderAt('/app/');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });
});
