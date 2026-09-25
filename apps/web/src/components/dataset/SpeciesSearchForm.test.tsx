import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse } from '@treerepro/contracts';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DICTIONARY, GENERA } from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { SpeciesSearchForm, type SpeciesSearchValue } from './SpeciesSearchForm.tsx';

const dataset = vi.hoisted(() => ({
  fetchFamilies: vi.fn(),
  fetchGenera: vi.fn(),
  fetchDictionary: vi.fn(),
}));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

const READER: MeResponse = { ...ME, permissions: ['dataset.read'] };

beforeEach(() => {
  dataset.fetchFamilies.mockReset();
  dataset.fetchGenera.mockReset();
  dataset.fetchDictionary.mockReset();
  dataset.fetchFamilies.mockResolvedValue([]);
  dataset.fetchGenera.mockResolvedValue({ data: [], meta: { nextCursor: null } });
  dataset.fetchDictionary.mockResolvedValue(DICTIONARY);
});

// The form is fully controlled; this wrapper stands in for the page that
// owns `value` so `onChange` has somewhere to land. `onChange` is the spy a
// test reads; the wrapper is what makes the next render show the change,
// which `rerender` could not do (it would drop the query provider).
function Controlled({
  initial,
  onChange,
}: {
  initial: SpeciesSearchValue;
  onChange?: (next: SpeciesSearchValue) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SpeciesSearchForm
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const SEED_MASS_ID = DICTIONARY[1]?.traits[0]?.id as string;

describe('RFC-13 R2, RFC-60 R6 SpeciesSearchForm genus chip', () => {
  it('shows a neutral fallback chip when genusId is set without a resolved genus name, and Clear removes it', async () => {
    renderWithProviders(
      <Controlled
        initial={{
          q: '',
          unresolved: false,
          contested: false,
          unknownLevels: false,
          genusId: 'g1',
        }}
      />,
      {
        me: READER,
      },
    );
    expect(screen.getByText('Selected genus')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear genus' }));
    expect(screen.queryByText('Selected genus')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear genus' })).not.toBeInTheDocument();
  });
});

describe('RFC-13 R8 SpeciesSearchForm genus combobox ARIA', () => {
  it('leaves aria-expanded false and drops aria-controls when the genus query matches nothing', async () => {
    dataset.fetchGenera.mockResolvedValue({ data: [], meta: { nextCursor: null } });
    renderWithProviders(
      <Controlled initial={{ q: '', unresolved: false, contested: false, unknownLevels: false }} />,
      { me: READER },
    );

    const combobox = screen.getByRole('combobox', { name: 'Genus' });
    await userEvent.type(combobox, 'Zzz');
    await screen.findByText('No genus matches.');

    expect(combobox).toHaveAttribute('aria-expanded', 'false');
    expect(combobox).not.toHaveAttribute('aria-controls');
  });

  it('sets aria-expanded true and points aria-controls at the listbox when suggestions exist', async () => {
    dataset.fetchGenera.mockResolvedValue({ data: GENERA, meta: { nextCursor: null } });
    renderWithProviders(
      <Controlled initial={{ q: '', unresolved: false, contested: false, unknownLevels: false }} />,
      { me: READER },
    );

    const combobox = screen.getByRole('combobox', { name: 'Genus' });
    await userEvent.type(combobox, 'Aden');
    const listbox = await screen.findByRole('listbox', { name: 'Genus suggestions' });

    expect(combobox).toHaveAttribute('aria-expanded', 'true');
    expect(combobox).toHaveAttribute('aria-controls', listbox.id);
  });
});

describe('RFC-60 R6 SpeciesSearchForm status filter', () => {
  it('RFC-60 R6 shows the status select only with dataset.read_inactive', async () => {
    renderWithProviders(
      <SpeciesSearchForm
        value={{ q: '', unresolved: false, contested: false, unknownLevels: false }}
        onChange={() => {}}
      />,
      { me: READER },
    );
    expect(screen.queryByLabelText('Status')).toBeNull();

    const onChange = vi.fn();
    renderWithProviders(
      <SpeciesSearchForm
        value={{ q: '', unresolved: false, contested: false, unknownLevels: false }}
        onChange={onChange}
      />,
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
      <SpeciesSearchForm
        value={{ q: '', unresolved: false, contested: false, unknownLevels: false }}
        onChange={() => {}}
      />,
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
        value={{ q: '', unresolved: false, contested: false, unknownLevels: false, scope: 'plots' }}
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
      <SpeciesSearchForm
        value={{ q: '', unresolved: false, contested: false, unknownLevels: false }}
        onChange={() => {}}
      />,
      { me: meRestricted },
    );

    expect(screen.getByLabelText('Plot')).toBeInTheDocument();
    expect(screen.queryByLabelText(/show species outside my plots/i)).toBeNull();
  });
});

describe('RFC-60 R6 SpeciesSearchForm groups', () => {
  it('renders Taxonomy, Traits and Scope as named groups', async () => {
    renderWithProviders(
      <SpeciesSearchForm
        value={{ q: '', unresolved: false, contested: false, unknownLevels: false }}
        onChange={() => {}}
      />,
      {
        me: {
          ...READER,
          scope: { plots: [{ id: 'p-1', code: 'PLT-A', name: 'Alpha' }], restricted: false },
        },
      },
    );
    expect(await screen.findByRole('group', { name: 'Taxonomy' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Traits' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Scope' })).toBeInTheDocument();
  });

  it('keeps the name, family and genus controls inside Taxonomy', async () => {
    renderWithProviders(
      <SpeciesSearchForm
        value={{ q: '', unresolved: false, contested: false, unknownLevels: false }}
        onChange={() => {}}
      />,
      { me: READER },
    );
    const taxonomy = await screen.findByRole('group', { name: 'Taxonomy' });
    expect(within(taxonomy).getByLabelText('Search species')).toBeInTheDocument();
    expect(within(taxonomy).getByLabelText('Family')).toBeInTheDocument();
    expect(within(taxonomy).getByLabelText('Genus')).toBeInTheDocument();
    // RFC-60 R6: the unresolved toggle is reviewer-only, so a plain
    // `dataset.read` viewer does not see it (see the permissions describe
    // block below for the `records.review` case).
    expect(within(taxonomy).queryByLabelText('Unresolved taxa only')).not.toBeInTheDocument();
  });

  it('shows the unresolved toggle in Taxonomy for a records.review holder', async () => {
    renderWithProviders(
      <SpeciesSearchForm
        value={{ q: '', unresolved: false, contested: false, unknownLevels: false }}
        onChange={() => {}}
      />,
      { me: { ...READER, permissions: ['dataset.read', 'records.review'] } },
    );
    const taxonomy = await screen.findByRole('group', { name: 'Taxonomy' });
    expect(within(taxonomy).getByLabelText('Unresolved taxa only')).toBeInTheDocument();
  });
});

describe('RFC-60 R6 SpeciesSearchForm trait filters', () => {
  it('lists the dictionary categories and reports the chosen one', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <Controlled
        initial={{ q: '', unresolved: false, contested: false, unknownLevels: false }}
        onChange={onChange}
      />,
      {
        me: READER,
      },
    );
    const category = await screen.findByLabelText('Category');
    expect(await within(category).findByRole('option', { name: 'Seed' })).toBeInTheDocument();
    expect(
      within(category).getByRole('option', { name: 'Reproductive system' }),
    ).toBeInTheDocument();
    expect(within(category).getByRole('option', { name: 'All categories' })).toBeInTheDocument();

    await userEvent.selectOptions(category, 'seed');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ categoryKey: 'seed' }));
  });

  it('disables the trait select until a category is chosen and then lists only its traits', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <Controlled
        initial={{ q: '', unresolved: false, contested: false, unknownLevels: false }}
        onChange={onChange}
      />,
      {
        me: READER,
      },
    );
    expect(await screen.findByLabelText('Trait')).toBeDisabled();
    await screen.findByRole('option', { name: 'Seed' });

    await userEvent.selectOptions(screen.getByLabelText('Category'), 'seed');
    const trait = screen.getByLabelText('Trait');
    expect(trait).toBeEnabled();
    expect(within(trait).getByRole('option', { name: 'seed mass' })).toBeInTheDocument();
    expect(within(trait).queryByRole('option', { name: 'sexual system' })).not.toBeInTheDocument();

    await userEvent.selectOptions(trait, SEED_MASS_ID);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ categoryKey: 'seed', traitId: SEED_MASS_ID }),
    );
  });

  it('drops the chosen trait when the category changes', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <Controlled
        initial={{
          q: '',
          unresolved: false,
          contested: false,
          unknownLevels: false,
          categoryKey: 'seed',
          traitId: SEED_MASS_ID,
        }}
        onChange={onChange}
      />,
      { me: READER },
    );
    await screen.findByRole('option', { name: 'Seed' });
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'reproductive_system');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ categoryKey: 'reproductive_system', traitId: undefined }),
    );
  });

  it('enables Has data / Missing data once a category is chosen and reports the choice', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <Controlled
        initial={{ q: '', unresolved: false, contested: false, unknownLevels: false }}
        onChange={onChange}
      />,
      {
        me: READER,
      },
    );
    expect(await screen.findByRole('radio', { name: 'Has data' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Missing data' })).toBeDisabled();
    await screen.findByRole('option', { name: 'Seed' });

    await userEvent.selectOptions(screen.getByLabelText('Category'), 'seed');
    expect(screen.getByRole('radio', { name: 'Has data' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Has data' })).toBeChecked();

    await userEvent.click(screen.getByRole('radio', { name: 'Missing data' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ traitData: 'missing' }));
    expect(screen.getByRole('radio', { name: 'Missing data' })).toBeChecked();

    await userEvent.click(screen.getByRole('radio', { name: 'Has data' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ traitData: 'with' }));
  });

  it("shows the trait's own category on a trait-only value and enables the radios", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <Controlled
        initial={{
          q: '',
          unresolved: false,
          contested: false,
          unknownLevels: false,
          traitId: SEED_MASS_ID,
          traitData: 'missing',
        }}
        onChange={onChange}
      />,
      { me: READER },
    );
    // What `/app/species?traitId=…&traitData=missing` opens with: no category
    // in the value at all, the dictionary supplies it.
    await screen.findByRole('option', { name: 'Seed' });
    expect(screen.getByLabelText('Category')).toHaveValue('seed');
    const trait = screen.getByLabelText('Trait');
    expect(trait).toBeEnabled();
    expect(trait).toHaveValue(SEED_MASS_ID);
    expect(screen.getByRole('radio', { name: 'Missing data' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Missing data' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Has data' })).toBeEnabled();
  });

  it('enables the radios for a value carrying a trait and no category', async () => {
    // The other half of "a trait OR a category": the value names a trait and
    // no category of its own, and the mode is still the user's to pick.
    const onChange = vi.fn();
    renderWithProviders(
      <Controlled
        initial={{
          q: '',
          unresolved: false,
          contested: false,
          unknownLevels: false,
          traitId: SEED_MASS_ID,
        }}
        onChange={onChange}
      />,
      { me: READER },
    );
    const missing = await screen.findByRole('radio', { name: 'Missing data' });
    expect(missing).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Has data' })).toBeChecked();

    await userEvent.click(missing);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ traitId: SEED_MASS_ID, traitData: 'missing' }),
    );
  });

  it('clears the mode when the trait that derived the category is cleared', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <Controlled
        initial={{
          q: '',
          unresolved: false,
          contested: false,
          unknownLevels: false,
          traitId: SEED_MASS_ID,
          traitData: 'missing',
        }}
        onChange={onChange}
      />,
      { me: READER },
    );
    await screen.findByRole('option', { name: 'Seed' });
    // "All traits" here takes the derived category away with the trait, so
    // the mode would otherwise be left filtering nothing.
    await userEvent.selectOptions(screen.getByLabelText('Trait'), '');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ traitId: undefined, traitData: undefined }),
    );
    expect(screen.getByRole('radio', { name: 'Missing data' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Missing data' })).not.toBeChecked();
  });

  it('keeps the mode when the trait is cleared but a chosen category remains', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <Controlled
        initial={{
          q: '',
          unresolved: false,
          contested: false,
          unknownLevels: false,
          categoryKey: 'seed',
          traitId: SEED_MASS_ID,
          traitData: 'missing',
        }}
        onChange={onChange}
      />,
      { me: READER },
    );
    await screen.findByRole('option', { name: 'Seed' });
    await userEvent.selectOptions(screen.getByLabelText('Trait'), '');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        categoryKey: 'seed',
        traitId: undefined,
        traitData: 'missing',
      }),
    );
    expect(screen.getByRole('radio', { name: 'Missing data' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Missing data' })).toBeChecked();
  });

  it('clears the trait when the derived category is cleared', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <Controlled
        initial={{
          q: '',
          unresolved: false,
          contested: false,
          unknownLevels: false,
          traitId: SEED_MASS_ID,
          traitData: 'missing',
        }}
        onChange={onChange}
      />,
      { me: READER },
    );
    await screen.findByRole('option', { name: 'Seed' });
    await userEvent.selectOptions(screen.getByLabelText('Category'), '');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        categoryKey: undefined,
        traitId: undefined,
        traitData: undefined,
      }),
    );
    expect(screen.getByLabelText('Trait')).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Missing data' })).toBeDisabled();
  });

  it('clears the trait filter entirely when the category goes back to all', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <Controlled
        initial={{
          q: '',
          unresolved: false,
          contested: false,
          unknownLevels: false,
          categoryKey: 'seed',
          traitId: SEED_MASS_ID,
          traitData: 'missing',
        }}
        onChange={onChange}
      />,
      { me: READER },
    );
    await screen.findByRole('option', { name: 'Seed' });
    await userEvent.selectOptions(screen.getByLabelText('Category'), '');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        categoryKey: undefined,
        traitId: undefined,
        traitData: undefined,
      }),
    );
  });
});

describe('RFC-60 R6 SpeciesSearchForm order by', () => {
  it('offers Name and Most incomplete first and reports the chosen order', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <Controlled
        initial={{ q: '', unresolved: false, contested: false, unknownLevels: false }}
        onChange={onChange}
      />,
      {
        me: READER,
      },
    );
    const order = await screen.findByLabelText('Order by');
    expect(within(order).getByRole('option', { name: 'Name' })).toBeInTheDocument();
    expect(
      within(order).getByRole('option', { name: 'Most incomplete first' }),
    ).toBeInTheDocument();
    expect(order).toHaveValue('name');

    await userEvent.selectOptions(order, 'completeness');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'completeness' }));
    expect(screen.getByLabelText('Order by')).toHaveValue('completeness');

    await userEvent.selectOptions(screen.getByLabelText('Order by'), 'name');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ sort: undefined }));
  });
});

describe('RFC-60 R6 SpeciesSearchForm contested and unknownLevels filters', () => {
  it('RFC-60 R6 Contested only for everyone; Has unknown levels and Unresolved taxa only for records.review', async () => {
    const onChange = vi.fn();
    const value = { q: '', unresolved: false, contested: false, unknownLevels: false };
    const first = renderWithProviders(<SpeciesSearchForm value={value} onChange={onChange} />, {
      me: { ...ME, permissions: ['dataset.read'] } as never,
    });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Contested only' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ contested: true }));
    expect(screen.queryByRole('checkbox', { name: 'Has unknown levels' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Unresolved taxa only' }),
    ).not.toBeInTheDocument();
    first.unmount();

    renderWithProviders(<SpeciesSearchForm value={value} onChange={onChange} />, {
      me: { ...ME, permissions: ['dataset.read', 'records.review'] } as never,
    });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Has unknown levels' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ unknownLevels: true }));
    expect(screen.getByRole('checkbox', { name: 'Unresolved taxa only' })).toBeInTheDocument();
  });
});
