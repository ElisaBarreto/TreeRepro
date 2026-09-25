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
const plots = vi.hoisted(() => ({ fetchAllPlots: vi.fn() }));
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
  plots.fetchAllPlots.mockReset().mockResolvedValue([DASHBOARD_PLOT]);
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

  it('renders the headline tiles with the counts and the two meters from the API', async () => {
    renderAt('/app/curation/coverage');
    const tiles = await screen.findByRole('list', { name: 'Coverage totals' });
    expect(within(tiles).getByText(String(COVERAGE.species))).toBeInTheDocument();
    expect(within(tiles).getByText(String(COVERAGE.traits))).toBeInTheDocument();
    expect(within(tiles).getByText(String(COVERAGE.cells))).toBeInTheDocument();
    expect(within(tiles).getByText(`${COVERAGE.percentWithData}%`)).toBeInTheDocument();
    expect(within(tiles).getByText(`${COVERAGE.percentValidated}%`)).toBeInTheDocument();
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

  it('choosing a category writes it to the URL and refetches coverage with it', async () => {
    const { router } = renderAt('/app/curation/coverage');
    const category = await screen.findByLabelText('Category');
    const label = DICTIONARY[0]?.label as string;
    const key = DICTIONARY[0]?.key as string;
    await within(category).findByRole('option', { name: label });
    await userEvent.selectOptions(category, label);
    await waitFor(() =>
      expect(coverage.fetchCoverage).toHaveBeenLastCalledWith(
        expect.objectContaining({ categoryKey: key }),
      ),
    );
    expect(router.state.location.search).toMatchObject({ categoryKey: key });
  });

  it('choosing a plot writes it to the URL and refetches coverage with it', async () => {
    auth.fetchMe.mockResolvedValue({
      ...ME,
      permissions: ['coverage.read'],
      scope: { plots: [DASHBOARD_PLOT], restricted: true },
    });
    const { router } = renderAt('/app/curation/coverage');
    const plot = await screen.findByLabelText('Plot');
    const option = await within(plot).findByRole('option', {
      name: new RegExp(DASHBOARD_PLOT.name),
    });
    await userEvent.selectOptions(plot, option);
    await waitFor(() =>
      expect(coverage.fetchCoverage).toHaveBeenLastCalledWith(
        expect.objectContaining({ plotId: DASHBOARD_PLOT.id }),
      ),
    );
    expect(router.state.location.search).toMatchObject({ plotId: DASHBOARD_PLOT.id });
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
