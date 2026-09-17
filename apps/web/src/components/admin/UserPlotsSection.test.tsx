import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Plot } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_USER } from '../../test/admin-fixtures.ts';
import { ADMIN_ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { UserPlotsSection } from './UserPlotsSection.tsx';

const admin = vi.hoisted(() => ({
  setUserPlots: vi.fn(),
}));
vi.mock('../../api/admin.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/admin.ts')>()),
  ...admin,
}));

const plotsApi = vi.hoisted(() => ({
  listPlots: vi.fn(),
}));
vi.mock('../../api/plots.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/plots.ts')>()),
  ...plotsApi,
}));

const PLOT_A: Plot = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d21',
  code: 'PLOT-A',
  name: 'Plot Alpha',
  description: '',
  latitude: null,
  longitude: null,
  country: null,
  biome: null,
  speciesCount: 5,
  createdAt: '2026-09-17T00:00:00.000Z',
  updatedAt: '2026-09-17T00:00:00.000Z',
};

const PLOT_B: Plot = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d22',
  code: 'PLOT-B',
  name: 'Plot Beta',
  description: '',
  latitude: null,
  longitude: null,
  country: null,
  biome: null,
  speciesCount: 10,
  createdAt: '2026-09-17T00:00:00.000Z',
  updatedAt: '2026-09-17T00:00:00.000Z',
};

beforeEach(() => {
  admin.setUserPlots.mockReset();
  plotsApi.listPlots.mockReset();
  plotsApi.listPlots.mockResolvedValue({
    data: [PLOT_A, PLOT_B],
    meta: { nextCursor: null, hasMore: false },
  });
});

describe('RFC-67 R6 UserPlotsSection', () => {
  it('renders plot checkboxes, disables restriction when no plots checked, calls setUserPlots on save', async () => {
    admin.setUserPlots.mockResolvedValue({
      ...ADMIN_USER,
      plots: [{ id: PLOT_A.id, code: PLOT_A.code, name: PLOT_A.name }],
      restrictToAssignedPlots: true,
    });

    renderWithProviders(<UserPlotsSection user={ADMIN_USER} canEdit />, {
      me: ADMIN_ME,
    });

    const plotACheckbox = await screen.findByRole('checkbox', {
      name: /PLOT-A/i,
    });
    const plotBCheckbox = screen.getByRole('checkbox', {
      name: /PLOT-B/i,
    });
    const restrictCheckbox = screen.getByRole('checkbox', {
      name: /restrict to assigned plots/i,
    });

    // ADMIN_USER has no plots initially: restriction checkbox is disabled
    expect(plotACheckbox).not.toBeChecked();
    expect(plotBCheckbox).not.toBeChecked();
    expect(restrictCheckbox).toBeDisabled();
    expect(restrictCheckbox).not.toBeChecked();

    // Check Plot A -> restriction checkbox enabled
    await userEvent.click(plotACheckbox);
    expect(plotACheckbox).toBeChecked();
    expect(restrictCheckbox).not.toBeDisabled();

    // Check restriction
    await userEvent.click(restrictCheckbox);
    expect(restrictCheckbox).toBeChecked();

    // Save
    const saveButton = screen.getByRole('button', { name: /save plots/i });
    await userEvent.click(saveButton);

    expect(admin.setUserPlots).toHaveBeenCalledWith(ADMIN_USER.id, {
      plotIds: [PLOT_A.id],
      restrictToAssignedPlots: true,
    });
  });

  it('renders view-only badges when canEdit is false', () => {
    const userWithPlots = {
      ...ADMIN_USER,
      plots: [{ id: PLOT_A.id, code: PLOT_A.code, name: PLOT_A.name }],
      restrictToAssignedPlots: true,
    };
    renderWithProviders(<UserPlotsSection user={userWithPlots} canEdit={false} />, {
      me: ADMIN_ME,
    });

    expect(screen.getByText('PLOT-A — Plot Alpha')).toBeInTheDocument();
    expect(screen.getByText(/restricted to assigned plots/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save plots/i })).not.toBeInTheDocument();
  });
});
