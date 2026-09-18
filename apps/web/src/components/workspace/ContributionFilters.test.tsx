import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DICTIONARY, SPECIES } from '../../test/dataset-fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { ContributionFilters } from './ContributionFilters.tsx';

const dataset = vi.hoisted(() => ({ fetchDictionary: vi.fn(), searchSpecies: vi.fn() }));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

const SEED_MASS_ID = DICTIONARY[1]?.traits[0]?.id as string;

beforeEach(() => {
  dataset.fetchDictionary.mockReset();
  dataset.searchSpecies.mockReset();
  dataset.fetchDictionary.mockResolvedValue(DICTIONARY);
  dataset.searchSpecies.mockResolvedValue({ data: [SPECIES], meta: { nextCursor: null } });
});

describe('RFC-71 R1 ContributionFilters', () => {
  it('fills the trait select from the dictionary, grouped by category, and reports the choice', async () => {
    const onChange = vi.fn();
    renderWithProviders(<ContributionFilters kind="records" value={{}} onChange={onChange} />);
    const trait = await screen.findByLabelText('Trait');
    expect(within(trait).getByRole('option', { name: 'All traits' })).toBeInTheDocument();
    await waitFor(() =>
      expect(within(trait).getByRole('option', { name: 'seed mass' })).toBeInTheDocument(),
    );
    // Grouped by the dictionary's categories, so a long list stays readable.
    expect(trait.querySelectorAll('optgroup')).toHaveLength(DICTIONARY.length);
    await userEvent.selectOptions(trait, SEED_MASS_ID);
    expect(onChange).toHaveBeenCalledWith({ traitId: SEED_MASS_ID });
  });

  it('searches species through the API and reports the chosen one', async () => {
    const onChange = vi.fn();
    renderWithProviders(<ContributionFilters kind="records" value={{}} onChange={onChange} />);
    await userEvent.type(await screen.findByLabelText('Species'), 'Aden');
    await userEvent.click(await screen.findByRole('option', { name: /Adenanthera pavonina/ }));
    expect(dataset.searchSpecies).toHaveBeenCalledWith(expect.objectContaining({ q: 'Aden' }));
    expect(onChange).toHaveBeenCalledWith({ speciesId: SPECIES.id });
  });

  it('offers to clear a species the URL named but nothing has named on screen', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ContributionFilters kind="records" value={{ speciesId: SPECIES.id }} onChange={onChange} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith({ speciesId: undefined });
  });

  it('reports the review and intent choices (RFC-63 R6, RFC-70 R1)', async () => {
    const onChange = vi.fn();
    renderWithProviders(<ContributionFilters kind="records" value={{}} onChange={onChange} />);
    await userEvent.selectOptions(await screen.findByLabelText('Review'), 'disputed');
    expect(onChange).toHaveBeenLastCalledWith({ review: 'disputed' });
    await userEvent.selectOptions(await screen.findByLabelText('Intent'), 'none');
    expect(onChange).toHaveBeenLastCalledWith({ intent: 'none' });
  });

  it('reports the two day bounds and clears one that is emptied', async () => {
    const onChange = vi.fn();
    const { unmount } = renderWithProviders(
      <ContributionFilters kind="records" value={{}} onChange={onChange} />,
    );
    const from = await screen.findByLabelText('Record added from');
    expect(from).toHaveAttribute('type', 'date');
    fireEvent.change(from, { target: { value: '2026-09-01' } });
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-09-01' });
    unmount();

    renderWithProviders(
      <ContributionFilters kind="records" value={{ from: '2026-09-01' }} onChange={onChange} />,
    );
    const filled = await screen.findByLabelText('Record added from');
    expect(filled).toHaveValue('2026-09-01');
    fireEvent.change(filled, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ from: undefined });
  });

  it('RFC-71 R3 says on the annotations tab that the filters are on the annotated record', async () => {
    const { unmount } = renderWithProviders(
      <ContributionFilters kind="annotations" value={{}} onChange={vi.fn()} />,
    );
    expect(
      await screen.findByText(
        'These filters apply to the annotated record, not to the annotation itself.',
      ),
    ).toBeInTheDocument();
    // The dates are the record's, on either tab: no label may claim the
    // annotation's own date is what they narrow.
    expect(screen.getByLabelText('Record added from')).toBeInTheDocument();
    expect(screen.getByLabelText('Record added to')).toBeInTheDocument();
    expect(screen.queryByLabelText(/annotated from/i)).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<ContributionFilters kind="records" value={{}} onChange={vi.fn()} />);
    expect(
      screen.queryByText(
        'These filters apply to the annotated record, not to the annotation itself.',
      ),
    ).not.toBeInTheDocument();
  });

  it('keeps the filters it was given while changing one', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ContributionFilters
        kind="records"
        value={{ traitId: SEED_MASS_ID, from: '2026-09-01' }}
        onChange={onChange}
      />,
    );
    await userEvent.selectOptions(await screen.findByLabelText('Review'), 'confirmed');
    expect(onChange).toHaveBeenCalledWith({
      traitId: SEED_MASS_ID,
      from: '2026-09-01',
      review: 'confirmed',
    });
  });
});
