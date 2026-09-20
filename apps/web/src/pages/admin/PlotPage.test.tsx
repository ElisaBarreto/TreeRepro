import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlotDetail, PlotUser, SpeciesListItem } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_ME } from '../../test/fixtures.ts';
import { renderAt } from '../../test/router.tsx';

const auth = vi.hoisted(() => ({
  login: vi.fn(),
  loginTotp: vi.fn(),
  fetchMe: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
  changePassword: vi.fn(),
  totpSetup: vi.fn(),
  totpConfirm: vi.fn(),
  totpDisable: vi.fn(),
}));
vi.mock('../../api/auth.ts', () => auth);

const plotsApi = vi.hoisted(() => ({
  fetchPlot: vi.fn(),
  updatePlot: vi.fn(),
  fetchPlotSpecies: vi.fn(),
  addPlotSpecies: vi.fn(),
  removePlotSpecies: vi.fn(),
  fetchPlotUsers: vi.fn(),
}));
vi.mock('../../api/plots.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/plots.ts')>()),
  ...plotsApi,
}));

const datasetApi = vi.hoisted(() => ({
  searchSpecies: vi.fn(),
}));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...datasetApi,
}));

const PLOT_DETAIL: PlotDetail = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d41',
  code: 'PLT-01',
  name: 'Cerrado Reserve',
  description: 'Savanna plot description',
  latitude: -15.5,
  longitude: -47.8,
  country: 'Brazil',
  biome: 'Cerrado',
  speciesCount: 1,
  userCount: 1,
  createdAt: '2026-09-17T00:00:00.000Z',
  updatedAt: '2026-09-17T00:00:00.000Z',
};

const SPECIES_ITEM: SpeciesListItem = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d42',
  canonicalName: 'Bowdichia virgilioides',
  nameSource: 'gbif',
  genus: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d00', name: 'Bowdichia' },
  family: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d01', name: 'Fabaceae' },
  matchedName: 'Bowdichia virgilioides Kunth',
  matchedNameType: 'gbif',
  active: true,
  unresolvedTaxon: false,
  traitCount: 4,
  traitRecordCount: null,
};

const PLOT_USER: PlotUser = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d43',
  name: 'Carlos Contributor',
  status: 'active',
  restricted: true,
};

beforeEach(() => {
  auth.fetchMe.mockReset();
  auth.fetchMe.mockResolvedValue(ADMIN_ME);
  plotsApi.fetchPlot.mockReset();
  plotsApi.updatePlot.mockReset();
  plotsApi.fetchPlotSpecies.mockReset();
  plotsApi.addPlotSpecies.mockReset();
  plotsApi.removePlotSpecies.mockReset();
  plotsApi.fetchPlotUsers.mockReset();
  datasetApi.searchSpecies.mockReset();

  plotsApi.fetchPlot.mockResolvedValue(PLOT_DETAIL);
  plotsApi.fetchPlotSpecies.mockResolvedValue({
    data: [SPECIES_ITEM],
    meta: { nextCursor: null, hasMore: false },
  });
  plotsApi.fetchPlotUsers.mockResolvedValue({
    data: [PLOT_USER],
    meta: { nextCursor: null, hasMore: false },
  });
});

describe('RFC-67 R3-R5 PlotPage', () => {
  it('renders plot metadata, species section, and users section with link to user', async () => {
    renderAt(`/app/admin/plots/${PLOT_DETAIL.id}`);

    expect(
      await screen.findByRole('heading', { name: 'PLT-01 — Cerrado Reserve' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Savanna plot description')).toBeInTheDocument();
    expect(screen.getByText('Cerrado')).toBeInTheDocument();

    // Species section
    expect(await screen.findByText('Bowdichia virgilioides')).toBeInTheDocument();

    // Users section: name, status and scope only — the address is users.read
    // data and never part of the item (RFC-02 R14)
    const userLink = screen.getByRole('link', { name: 'Carlos Contributor' });
    expect(userLink).toHaveAttribute('href', `/app/admin/users/${PLOT_USER.id}`);
    expect(screen.queryByRole('columnheader', { name: 'Email' })).not.toBeInTheDocument();
    expect(screen.getByText('Restricted')).toBeInTheDocument();
  });

  it('RFC-02 R14 links the user name only when the viewer holds users.read', async () => {
    auth.fetchMe.mockResolvedValue({
      ...ADMIN_ME,
      permissions: ['admin.access', 'dataset.read', 'plots.manage'],
    });

    renderAt(`/app/admin/plots/${PLOT_DETAIL.id}`);

    expect(await screen.findByText('Carlos Contributor')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Carlos Contributor' })).not.toBeInTheDocument();
  });

  it('removes species after confirmation in confirm dialog', async () => {
    plotsApi.removePlotSpecies.mockResolvedValue({
      ...PLOT_DETAIL,
      speciesCount: 0,
    });

    renderAt(`/app/admin/plots/${PLOT_DETAIL.id}`);

    expect(await screen.findByText('Bowdichia virgilioides')).toBeInTheDocument();

    const removeBtn = screen.getByRole('button', { name: /remove bowdichia virgilioides/i });
    await userEvent.click(removeBtn);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Remove Bowdichia virgilioides\?/i)).toBeInTheDocument();

    const confirmBtn = within(dialog).getByRole('button', { name: 'Remove' });
    await userEvent.click(confirmBtn);

    expect(plotsApi.removePlotSpecies).toHaveBeenCalledWith(PLOT_DETAIL.id, SPECIES_ITEM.id);
  });
});

describe('RFC-13 R3 PlotPage breadcrumb', () => {
  it('registers the plot as the last crumb of Admin › Plots', async () => {
    renderAt(`/app/admin/plots/${PLOT_DETAIL.id}`);
    await screen.findByRole('heading', { name: 'PLT-01 — Cerrado Reserve' });
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByText('PLT-01 — Cerrado Reserve')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(trail).getByRole('link', { name: 'Plots' })).toHaveAttribute(
      'href',
      '/app/admin/plots',
    );
    expect(trail).toHaveTextContent('Admin');
  });
});
