import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  CURATED_RECORD_DETAIL,
  DICTIONARY,
  DICTIONARY_SEXUAL_SYSTEM,
  PRIMARY_REFERENCE,
  RECORD_DETAIL,
  SPECIES,
} from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { AddEntriesDialog } from './AddEntriesDialog.tsx';

const curation = vi.hoisted(() => ({
  createRecords: vi.fn(),
  resolveDoi: vi.fn(),
  invalidateAfterRecordWrite: vi.fn(async () => undefined),
}));
const dataset = vi.hoisted(() => ({ fetchDictionary: vi.fn() }));
vi.mock('../../api/curation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/curation.ts')>()),
  ...curation,
}));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

const TITLE = 'Add entries for another trait';
const SEED_MASS = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e02';
const DIOECIOUS = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e12';
const DOI = '10.1111/geb.13000';
const RESOLVED = {
  status: 'resolvable',
  reference: null,
  preview: { title: 'Seed size', authors: 'Moles, A.', year: 2023, journal: 'GEB' },
};
const CREATED = { created: [RECORD_DETAIL], duplicates: [] };

beforeEach(() => {
  curation.createRecords.mockReset();
  curation.resolveDoi.mockReset();
  curation.invalidateAfterRecordWrite.mockClear();
  dataset.fetchDictionary.mockReset().mockResolvedValue(DICTIONARY);
});

function mount(props: Partial<Parameters<typeof AddEntriesDialog>[0]> = {}) {
  const onCreated = vi.fn();
  const onOpenRecord = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <AddEntriesDialog
      speciesId={SPECIES.id}
      onClose={onClose}
      onCreated={onCreated}
      onOpenRecord={onOpenRecord}
      {...props}
    />,
    { me: ME },
  );
  return { onCreated, onOpenRecord, onClose };
}

const categorySelect = (dialog: HTMLElement) =>
  within(dialog).getByRole('combobox', { name: 'Broad trait category' });
const traitSelect = (dialog: HTMLElement) =>
  within(dialog).getByRole('combobox', { name: 'Trait' });
const submit = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: 'Add record(s)' });

/** Waits for the dictionary, then picks a category and one of its traits. */
async function openWith(categoryKey: string, traitId: string): Promise<HTMLElement> {
  const dialog = await screen.findByRole('dialog', { name: TITLE });
  await within(dialog).findByRole('option', { name: 'Seed' });
  await userEvent.selectOptions(categorySelect(dialog), categoryKey);
  await userEvent.selectOptions(traitSelect(dialog), traitId);
  return dialog;
}

describe('RFC-70 R1 AddEntriesDialog', () => {
  it('RFC-70 R1 fills the trait select with the active traits of the chosen category only', async () => {
    mount();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    await within(dialog).findByRole('option', { name: 'Seed' });
    expect(traitSelect(dialog)).toBeDisabled();
    await userEvent.selectOptions(categorySelect(dialog), 'seed');
    const trait = traitSelect(dialog);
    expect(trait).toBeEnabled();
    // The unit rides on the option; seed_colour is inactive and is not offered.
    expect(within(trait).getByRole('option', { name: 'seed mass (mg)' })).toBeInTheDocument();
    expect(within(trait).queryByRole('option', { name: /seed colour/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: 'sexual system' })).not.toBeInTheDocument();
  });

  it('RFC-70 R1 clears the trait and the value when the category changes', async () => {
    mount();
    const dialog = await openWith('seed', SEED_MASS);
    await userEvent.type(
      await within(dialog).findByRole('spinbutton', { name: /number/i }),
      '12.5',
    );
    await userEvent.selectOptions(categorySelect(dialog), 'reproductive_system');
    expect(traitSelect(dialog)).toHaveValue('');
    expect(within(dialog).queryByRole('spinbutton')).not.toBeInTheDocument();
    // Back to the same trait: the number it had is gone, not remembered.
    await userEvent.selectOptions(categorySelect(dialog), 'seed');
    await userEvent.selectOptions(traitSelect(dialog), SEED_MASS);
    expect(await within(dialog).findByRole('spinbutton', { name: /number/i })).toHaveValue(null);
  });

  it('RFC-70 R1 fixes the trait when it was opened from a trait card, without the selects, and names it in the title', async () => {
    mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    expect(within(dialog).queryByRole('combobox', { name: 'Broad trait category' })).toBeNull();
    expect(within(dialog).queryByRole('combobox', { name: 'Trait' })).toBeNull();
    expect(
      await within(dialog).findByText('Reproductive system › sexual system'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Level' })).toBeInTheDocument();
  });

  it('RFC-13 R11 explains the chosen trait from the dictionary', async () => {
    mount();
    const dialog = await openWith('seed', SEED_MASS);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'What does this trait mean?' }),
    );
    expect(within(dialog).getByRole('tooltip')).toHaveTextContent('Dry mass of one seed.');
  });

  it('RFC-70 R1 sends the claim with the DOI that resolved', async () => {
    curation.resolveDoi.mockResolvedValue(RESOLVED);
    curation.createRecords.mockResolvedValue(CREATED);
    const { onCreated } = mount();
    const dialog = await openWith('reproductive_system', DICTIONARY_SEXUAL_SYSTEM.id);
    await userEvent.selectOptions(
      await within(dialog).findByRole('combobox', { name: 'Level' }),
      DIOECIOUS,
    );
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'DOI' }), DOI);
    await userEvent.tab();
    expect(await within(dialog).findByText('Resolved: Seed size (2023)')).toBeInTheDocument();
    await userEvent.click(submit(dialog));
    await waitFor(() => expect(curation.createRecords).toHaveBeenCalledTimes(1));
    expect(curation.createRecords.mock.calls[0]?.[0]).toEqual({
      speciesId: SPECIES.id,
      traitId: DICTIONARY_SEXUAL_SYSTEM.id,
      value: { levelId: DIOECIOUS },
      sources: { references: [{ doi: DOI }] },
    });
    expect(curation.invalidateAfterRecordWrite).toHaveBeenCalled();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
  });

  it('RFC-80 R5 sends a claim with no DOI as a personal observation', async () => {
    curation.createRecords.mockResolvedValue(CREATED);
    mount();
    const dialog = await openWith('seed', SEED_MASS);
    await userEvent.type(
      await within(dialog).findByRole('spinbutton', { name: /number/i }),
      '12.5',
    );
    expect(
      within(dialog).getByText('This will be recorded as your personal observation'),
    ).toBeInTheDocument();
    await userEvent.click(submit(dialog));
    await waitFor(() => expect(curation.createRecords).toHaveBeenCalledTimes(1));
    expect(curation.createRecords.mock.calls[0]?.[0]).toEqual({
      speciesId: SPECIES.id,
      traitId: SEED_MASS,
      value: { numeric: 12.5 },
      sources: { personalObservation: true },
    });
    expect(curation.resolveDoi).not.toHaveBeenCalled();
  });

  it('RFC-13 R6 asks for the category, the trait and the value before sending anything', async () => {
    mount();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    await userEvent.click(submit(dialog));
    expect(within(dialog).getByText('Choose a broad trait category.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a trait.')).toBeInTheDocument();
    await userEvent.selectOptions(categorySelect(dialog), 'reproductive_system');
    await userEvent.selectOptions(traitSelect(dialog), DICTIONARY_SEXUAL_SYSTEM.id);
    await userEvent.click(submit(dialog));
    expect(within(dialog).getByText('Choose a level.')).toBeInTheDocument();
    expect(curation.createRecords).not.toHaveBeenCalled();
  });

  it('RFC-13 R6 asks for a number before sending a quantitative claim with none', async () => {
    mount();
    const dialog = await openWith('seed', SEED_MASS);
    await userEvent.click(submit(dialog));
    expect(within(dialog).getByText('Enter a number.')).toBeInTheDocument();
    expect(curation.createRecords).not.toHaveBeenCalled();
  });

  it('RFC-70 R1 clears "Choose a trait." once a trait is chosen, before any submit', async () => {
    mount();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    await within(dialog).findByRole('option', { name: 'Seed' });
    await userEvent.selectOptions(categorySelect(dialog), 'reproductive_system');
    await userEvent.click(submit(dialog));
    expect(within(dialog).getByText('Choose a trait.')).toBeInTheDocument();
    await userEvent.selectOptions(traitSelect(dialog), DICTIONARY_SEXUAL_SYSTEM.id);
    expect(within(dialog).queryByText('Choose a trait.')).not.toBeInTheDocument();
    expect(traitSelect(dialog)).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('RFC-80 R4 refuses to send while a DOI has not resolved', async () => {
    curation.resolveDoi.mockResolvedValue({ status: 'not_found', reference: null });
    mount();
    const dialog = await openWith('seed', SEED_MASS);
    await userEvent.type(
      await within(dialog).findByRole('spinbutton', { name: /number/i }),
      '12.5',
    );
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'DOI' }), DOI);
    await userEvent.tab();
    expect(await within(dialog).findByText('DOI not found')).toBeInTheDocument();
    await userEvent.click(submit(dialog));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Each DOI must resolve before the record can be added.',
    );
    expect(curation.createRecords).not.toHaveBeenCalled();
  });

  it('RFC-13 R6 shows an API field error under the field its path names', async () => {
    curation.createRecords.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Request validation failed', [
        { path: 'sources.references.0.doi', message: 'This DOI is already listed.' },
        { path: 'traitId', message: 'Trait is inactive' },
      ]),
    );
    curation.resolveDoi.mockResolvedValue(RESOLVED);
    mount();
    const dialog = await openWith('seed', SEED_MASS);
    await userEvent.type(
      await within(dialog).findByRole('spinbutton', { name: /number/i }),
      '12.5',
    );
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'DOI' }), DOI);
    await userEvent.tab();
    expect(await within(dialog).findByText('Resolved: Seed size (2023)')).toBeInTheDocument();
    await userEvent.click(submit(dialog));
    expect(await within(dialog).findByText('This DOI is already listed.')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'DOI' })).toHaveAccessibleDescription(
      expect.stringContaining('This DOI is already listed.'),
    );
    expect(traitSelect(dialog)).toHaveAccessibleDescription(
      expect.stringContaining('Trait is inactive'),
    );
  });

  it('RFC-13 R6 shows a traitId API error under the fixed-trait paragraph, not a select', async () => {
    curation.createRecords.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Request validation failed', [
        { path: 'traitId', message: 'Trait is inactive' },
      ]),
    );
    mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    await userEvent.selectOptions(
      await within(dialog).findByRole('combobox', { name: 'Level' }),
      DIOECIOUS,
    );
    expect(within(dialog).queryByRole('combobox', { name: 'Trait' })).not.toBeInTheDocument();
    await userEvent.click(submit(dialog));
    const message = await within(dialog).findByText('Trait is inactive');
    expect(message.tagName).toBe('P');
    expect(within(dialog).queryByRole('combobox', { name: 'Trait' })).not.toBeInTheDocument();
  });

  it('RFC-13 R6 hints that the dictionary failed to load, under the category field', async () => {
    dataset.fetchDictionary.mockReset().mockRejectedValue(new Error('network down'));
    mount();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    expect(await within(dialog).findByText('Could not load the dictionary.')).toBeInTheDocument();
  });

  it('RFC-70 R3 links to every existing record when the claim was a duplicate of all of them', async () => {
    curation.createRecords.mockRejectedValue(
      new ApiError(409, 'RECORD_DUPLICATE', 'Every claim already exists', [
        { path: 'sources.references.0', message: RECORD_DETAIL.id },
        { path: 'sources.references.1', message: CURATED_RECORD_DETAIL.id },
      ]),
    );
    const { onOpenRecord, onCreated } = mount();
    const dialog = await openWith('seed', SEED_MASS);
    await userEvent.type(
      await within(dialog).findByRole('spinbutton', { name: /number/i }),
      '12.5',
    );
    await userEvent.click(submit(dialog));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(
      'Every reference already supports this exact claim. Validate the existing record instead.',
    );
    const links = within(alert).getAllByRole('button', { name: 'Open existing record' });
    expect(links).toHaveLength(2);
    await userEvent.click(links[1] as HTMLElement);
    expect(onOpenRecord).toHaveBeenCalledWith(CURATED_RECORD_DETAIL.id);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('RFC-70 R3 stays open and names the claim that already existed when only some records were created', async () => {
    curation.createRecords.mockResolvedValue({
      created: [RECORD_DETAIL],
      duplicates: [{ recordId: CURATED_RECORD_DETAIL.id, referenceId: PRIMARY_REFERENCE.id }],
    });
    const { onCreated, onOpenRecord } = mount();
    const dialog = await openWith('seed', SEED_MASS);
    await userEvent.type(
      await within(dialog).findByRole('spinbutton', { name: /number/i }),
      '12.5',
    );
    await userEvent.click(submit(dialog));
    const note = await within(dialog).findByText(/One of these claims already existed/);
    expect(note).toHaveTextContent('Added 1 record. One of these claims already existed.');
    // The answer is not a plain success: the dialog does not close on its own.
    expect(onCreated).not.toHaveBeenCalled();
    await userEvent.click(within(note).getByRole('button', { name: 'Open existing record' }));
    expect(onOpenRecord).toHaveBeenCalledWith(CURATED_RECORD_DETAIL.id);
  });

  it('RFC-70 R1 names the contributor the records are recorded as', async () => {
    mount();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    expect(within(dialog).getByText('Recorded as Ada')).toBeInTheDocument();
  });
});
