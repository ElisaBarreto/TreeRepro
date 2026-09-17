import { screen } from '@testing-library/react';
import type { Plot } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_ME, ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { PlotsPage } from './PlotsPage.tsx';

const plotsApi = vi.hoisted(() => ({
  listPlots: vi.fn(),
  createPlot: vi.fn(),
}));
vi.mock('../../api/plots.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/plots.ts')>()),
  ...plotsApi,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({
      to,
      params,
      children,
      ...rest
    }: {
      to: string;
      params?: { id: string };
      children: React.ReactNode;
    }) => (
      <a href={to.replace('$id', params?.id ?? '')} {...rest}>
        {children}
      </a>
    ),
  };
});

const PLOT_1: Plot = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d31',
  code: 'AMZ-01',
  name: 'Manaus Tower',
  description: 'Primary rainforest',
  latitude: -3.1,
  longitude: -60.0,
  country: 'Brazil',
  biome: 'Amazon',
  speciesCount: 42,
  createdAt: '2026-09-17T00:00:00.000Z',
  updatedAt: '2026-09-17T00:00:00.000Z',
};

beforeEach(() => {
  plotsApi.listPlots.mockReset();
});

describe('RFC-67 R3 PlotsPage', () => {
  it('renders NoPermission without plots.manage', () => {
    renderWithProviders(<PlotsPage />, { me: ME });
    expect(screen.getByText(/you do not have permission/i)).toBeInTheDocument();
    expect(plotsApi.listPlots).not.toHaveBeenCalled();
  });

  it('renders columns code, name, country, biome, species and New plot button with plots.manage', async () => {
    plotsApi.listPlots.mockResolvedValue({
      data: [PLOT_1],
      meta: { nextCursor: null, hasMore: false },
    });

    renderWithProviders(<PlotsPage />, { me: ADMIN_ME });

    expect(await screen.findByRole('heading', { name: 'Plots' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New plot' })).toBeInTheDocument();

    expect(await screen.findByRole('columnheader', { name: 'Code' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Country' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Biome' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Species' })).toBeInTheDocument();

    expect(screen.getByText('AMZ-01')).toBeInTheDocument();
    expect(screen.getByText('Manaus Tower')).toBeInTheDocument();
    expect(screen.getByText('Brazil')).toBeInTheDocument();
    expect(screen.getByText('Amazon')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
