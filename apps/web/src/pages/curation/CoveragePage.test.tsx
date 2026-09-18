import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COVERAGE, COVERAGE_TOP_MISSING } from '../../test/coverage-fixtures.ts';
import { DASHBOARD_PLOT, DICTIONARY, FAMILIES, MALVACEAE } from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { renderAt } from '../../test/router.tsx';

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
const dataset = vi.hoisted(() => ({ fetchFamilies: vi.fn(), fetchDictionary: vi.fn() }));
const plots = vi.hoisted(() => ({ listPlots: vi.fn() }));
const coverage = vi.hoisted(() => ({ fetchCoverage: vi.fn(), fetchCoverageTop: vi.fn() }));

vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));
vi.mock('../../api/plots.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/plots.ts')>()),
  ...plots,
}));
vi.mock('../../api/coverage.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/coverage.ts')>()),
  ...coverage,
}));

beforeEach(() => {
  auth.fetchMe.mockReset().mockResolvedValue({ ...ME, permissions: ['coverage.read'] });
  dataset.fetchFamilies.mockReset().mockResolvedValue(FAMILIES);
  dataset.fetchDictionary.mockReset().mockResolvedValue(DICTIONARY);
  plots.listPlots
    .mockReset()
    .mockResolvedValue({ data: [DASHBOARD_PLOT], meta: { nextCursor: null } });
  coverage.fetchCoverage.mockReset().mockResolvedValue(COVERAGE);
  coverage.fetchCoverageTop.mockReset().mockResolvedValue(COVERAGE_TOP_MISSING);
});

describe('RFC-69 R5-R7 CoveragePage', () => {
  it('RFC-13 R3 shows NoPermission without coverage.read', async () => {
    auth.fetchMe.mockResolvedValue({ ...ME, permissions: [] });
    renderAt('/app/curation/coverage');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open this area.',
    );
    expect(coverage.fetchCoverage).not.toHaveBeenCalled();
  });

  it('RFC-13 R3 breadcrumbs Curation › Coverage', async () => {
    renderAt('/app/curation/coverage');
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(trail).toHaveTextContent('Curation');
    expect(trail).toHaveTextContent('Coverage');
  });

  it('renders the family and category filters, and no plot filter without plots.manage or an assigned plot', async () => {
    renderAt('/app/curation/coverage');
    const family = await screen.findByLabelText('Family');
    expect(await within(family).findByRole('option', { name: 'Fabaceae' })).toBeInTheDocument();
    expect(within(family).getByRole('option', { name: 'Malvaceae' })).toBeInTheDocument();
    const category = screen.getByLabelText('Category');
    expect(
      await within(category).findByRole('option', { name: DICTIONARY[0]?.label }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Plot')).not.toBeInTheDocument();
    expect(plots.listPlots).not.toHaveBeenCalled();
  });

  it('shows the plot filter, fed by the session scope, for a viewer with an assigned plot', async () => {
    auth.fetchMe.mockResolvedValue({
      ...ME,
      permissions: ['coverage.read'],
      scope: { plots: [DASHBOARD_PLOT], restricted: true },
    });
    renderAt('/app/curation/coverage');
    const plot = await screen.findByLabelText('Plot');
    expect(within(plot).getByRole('option', { name: /Riverside plot/ })).toBeInTheDocument();
    expect(plots.listPlots).not.toHaveBeenCalled();
  });

  it('shows the plot filter, fed by listPlots, for a plots.manage holder without assigned plots', async () => {
    auth.fetchMe.mockResolvedValue({ ...ME, permissions: ['coverage.read', 'plots.manage'] });
    renderAt('/app/curation/coverage');
    const plot = await screen.findByLabelText('Plot');
    await waitFor(() => expect(plots.listPlots).toHaveBeenCalled());
    expect(await within(plot).findByRole('option', { name: /Riverside plot/ })).toBeInTheDocument();
  });

  it('renders the headline tiles with the counts and the two meters from the API', async () => {
    renderAt('/app/curation/coverage');
    const tiles = await screen.findByRole('list', { name: 'Coverage totals' });
    expect(within(tiles).getByText(String(COVERAGE.species))).toBeInTheDocument();
    expect(within(tiles).getByText(String(COVERAGE.traits))).toBeInTheDocument();
    expect(within(tiles).getByText(String(COVERAGE.cells))).toBeInTheDocument();
    expect(within(tiles).getByText(`${COVERAGE.percentWithData}%`)).toBeInTheDocument();
    expect(within(tiles).getByText(`${COVERAGE.percentAccepted}%`)).toBeInTheDocument();
  });

  it('renders the category table and the top gaps list', async () => {
    renderAt('/app/curation/coverage');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Reproductive system')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Top gaps' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'seed mass' })).toBeInTheDocument();
  });

  it('choosing a family writes it to the URL and refetches coverage with it', async () => {
    const { router } = renderAt('/app/curation/coverage');
    const family = await screen.findByLabelText('Family');
    await within(family).findByRole('option', { name: MALVACEAE.name });
    await userEvent.selectOptions(family, MALVACEAE.name);
    await waitFor(() =>
      expect(coverage.fetchCoverage).toHaveBeenLastCalledWith(
        expect.objectContaining({ familyId: MALVACEAE.id }),
      ),
    );
    expect(router.state.location.search).toMatchObject({ familyId: MALVACEAE.id });
  });

  it('RFC-13 R4 a 403 on the coverage query shows the permission sentence', async () => {
    const { ApiError } = await import('../../api/client.ts');
    coverage.fetchCoverage.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    renderAt('/app/curation/coverage');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
  });
});
