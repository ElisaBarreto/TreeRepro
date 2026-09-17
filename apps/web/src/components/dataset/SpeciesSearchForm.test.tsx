import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse } from '@treerepro/contracts';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { SpeciesSearchForm, type SpeciesSearchValue } from './SpeciesSearchForm.tsx';

const dataset = vi.hoisted(() => ({ fetchFamilies: vi.fn(), fetchGenera: vi.fn() }));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

const READER: MeResponse = { ...ME, permissions: ['dataset.read'] };

beforeEach(() => {
  dataset.fetchFamilies.mockReset();
  dataset.fetchGenera.mockReset();
  dataset.fetchFamilies.mockResolvedValue([]);
  dataset.fetchGenera.mockResolvedValue({ data: [], meta: { nextCursor: null } });
});

// The form is fully controlled; this wrapper stands in for the page that
// owns `value` so `onChange` has somewhere to land.
function Controlled({ initial }: { initial: SpeciesSearchValue }) {
  const [value, setValue] = useState(initial);
  return <SpeciesSearchForm value={value} onChange={setValue} />;
}

describe('RFC-13 R2, RFC-60 R6 SpeciesSearchForm genus chip', () => {
  it('shows a neutral fallback chip when genusId is set without a resolved genus name, and Clear removes it', async () => {
    renderWithProviders(<Controlled initial={{ q: '', unresolved: false, genusId: 'g1' }} />, {
      me: READER,
    });
    expect(screen.getByText('Selected genus')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear genus' }));
    expect(screen.queryByText('Selected genus')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear genus' })).not.toBeInTheDocument();
  });
});

describe('RFC-60 R6 SpeciesSearchForm status filter', () => {
  it('RFC-60 R6 shows the status select only with dataset.read_inactive', async () => {
    renderWithProviders(
      <SpeciesSearchForm value={{ q: '', unresolved: false }} onChange={() => {}} />,
      { me: READER },
    );
    expect(screen.queryByLabelText('Status')).toBeNull();

    const onChange = vi.fn();
    renderWithProviders(
      <SpeciesSearchForm value={{ q: '', unresolved: false }} onChange={onChange} />,
      { me: { ...READER, permissions: ['dataset.read', 'dataset.read_inactive'] } },
    );
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'inactive');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'inactive' }));
  });
});

describe('RFC-33 R6, RFC-67 R8 SpeciesSearchForm plot scope & filter', () => {
  const PLOT_A = { id: 'p-1', code: 'PLT-A', name: 'Plot Alpha' };
  const PLOT_B = { id: 'p-2', code: 'PLT-B', name: 'Plot Beta' };

  it('renders no scope group when user has no plots and no plots.manage', () => {
    renderWithProviders(
      <SpeciesSearchForm value={{ q: '', unresolved: false }} onChange={() => {}} />,
      { me: READER },
    );
    expect(screen.queryByLabelText('Plot')).toBeNull();
    expect(screen.queryByLabelText(/show species outside my plots/i)).toBeNull();
  });

  it('renders outside-plots checkbox and plot select when user has plots and is not restricted', async () => {
    const onChange = vi.fn();
    const meWithPlots: MeResponse = {
      ...READER,
      scope: { plots: [PLOT_A, PLOT_B], restricted: false },
    };

    renderWithProviders(
      <SpeciesSearchForm
        value={{ q: '', unresolved: false, scope: 'plots' }}
        onChange={onChange}
      />,
      { me: meWithPlots },
    );

    const checkbox = screen.getByLabelText(/show species outside my plots/i);
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();

    await userEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ scope: 'all' }));

    const plotSelect = screen.getByLabelText('Plot');
    expect(plotSelect).toBeInTheDocument();
    await userEvent.selectOptions(plotSelect, PLOT_A.id);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ plotId: PLOT_A.id }));
  });

  it('hides outside-plots checkbox when user is restricted', () => {
    const meRestricted: MeResponse = {
      ...READER,
      scope: { plots: [PLOT_A], restricted: true },
    };

    renderWithProviders(
      <SpeciesSearchForm value={{ q: '', unresolved: false }} onChange={() => {}} />,
      { me: meRestricted },
    );

    expect(screen.getByLabelText('Plot')).toBeInTheDocument();
    expect(screen.queryByLabelText(/show species outside my plots/i)).toBeNull();
  });
});
