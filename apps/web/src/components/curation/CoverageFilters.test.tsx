import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DASHBOARD_PLOT, DICTIONARY, FAMILIES, MALVACEAE } from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { CoverageFilters } from './CoverageFilters.tsx';

const dataset = vi.hoisted(() => ({ fetchFamilies: vi.fn(), fetchDictionary: vi.fn() }));
const plots = vi.hoisted(() => ({ listPlots: vi.fn() }));

vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));
vi.mock('../../api/plots.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/plots.ts')>()),
  ...plots,
}));

beforeEach(() => {
  dataset.fetchFamilies.mockReset().mockResolvedValue(FAMILIES);
  dataset.fetchDictionary.mockReset().mockResolvedValue(DICTIONARY);
  plots.listPlots
    .mockReset()
    .mockResolvedValue({ data: [DASHBOARD_PLOT], meta: { nextCursor: null } });
});

describe('RFC-69 R5 CoverageFilters', () => {
  it('renders the family and category filters, and no plot filter without plots.manage or an assigned plot', async () => {
    renderWithProviders(<CoverageFilters search={{}} onSearchChange={vi.fn()} />, {
      me: { ...ME, permissions: ['coverage.read'] },
    });
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
    renderWithProviders(<CoverageFilters search={{}} onSearchChange={vi.fn()} />, {
      me: {
        ...ME,
        permissions: ['coverage.read'],
        scope: { plots: [DASHBOARD_PLOT], restricted: true },
      },
    });
    const plot = await screen.findByLabelText('Plot');
    expect(within(plot).getByRole('option', { name: /Riverside plot/ })).toBeInTheDocument();
    expect(plots.listPlots).not.toHaveBeenCalled();
  });

  it('shows the plot filter, fed by listPlots, for a plots.manage holder without assigned plots', async () => {
    renderWithProviders(<CoverageFilters search={{}} onSearchChange={vi.fn()} />, {
      me: { ...ME, permissions: ['coverage.read', 'plots.manage'] },
    });
    const plot = await screen.findByLabelText('Plot');
    await waitFor(() => expect(plots.listPlots).toHaveBeenCalled());
    expect(await within(plot).findByRole('option', { name: /Riverside plot/ })).toBeInTheDocument();
  });

  it('choosing a family calls onSearchChange with the family id, the rest of the search kept', async () => {
    const onSearchChange = vi.fn();
    renderWithProviders(
      <CoverageFilters
        search={{ categoryKey: 'reproductive_system' }}
        onSearchChange={onSearchChange}
      />,
      { me: { ...ME, permissions: ['coverage.read'] } },
    );
    const family = await screen.findByLabelText('Family');
    await within(family).findByRole('option', { name: MALVACEAE.name });
    await userEvent.selectOptions(family, MALVACEAE.name);
    expect(onSearchChange).toHaveBeenCalledWith({
      categoryKey: 'reproductive_system',
      familyId: MALVACEAE.id,
    });
  });

  it('clearing a filter calls onSearchChange with it undefined rather than an empty string', async () => {
    const onSearchChange = vi.fn();
    renderWithProviders(
      <CoverageFilters search={{ familyId: MALVACEAE.id }} onSearchChange={onSearchChange} />,
      { me: { ...ME, permissions: ['coverage.read'] } },
    );
    const family = await screen.findByLabelText('Family');
    await within(family).findByRole('option', { name: MALVACEAE.name });
    await userEvent.selectOptions(family, 'All families');
    expect(onSearchChange).toHaveBeenCalledWith({ familyId: undefined });
  });
});
