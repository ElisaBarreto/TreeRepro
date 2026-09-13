import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  DICTIONARY,
  DICTIONARY_SEXUAL_SYSTEM,
  PRIMARY_REFERENCE,
  RECORD_DETAIL,
  REFERENCE,
  REFERENCE_DETAIL,
  SPECIES,
} from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { AddValueDialog } from './AddValueDialog.tsx';

const curation = vi.hoisted(() => ({
  createRecord: vi.fn(),
  createReference: vi.fn(),
  invalidateAfterRecordWrite: vi.fn(async () => undefined),
}));
const dataset = vi.hoisted(() => ({ fetchDictionary: vi.fn(), searchReferences: vi.fn() }));
vi.mock('../../api/curation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/curation.ts')>()),
  ...curation,
}));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

const SCIENTIST = { ...ME, permissions: ['dataset.read', 'records.create'] as const };
const LIBRARIAN = {
  ...ME,
  permissions: ['dataset.read', 'records.create', 'references.manage'] as const,
};

beforeEach(() => {
  curation.createRecord.mockReset();
  curation.createReference.mockReset();
  curation.invalidateAfterRecordWrite.mockClear();
  dataset.fetchDictionary.mockReset().mockResolvedValue(DICTIONARY);
  dataset.searchReferences.mockReset().mockResolvedValue({
    data: [{ ...REFERENCE, id: PRIMARY_REFERENCE.id, citationKey: PRIMARY_REFERENCE.citationKey }],
    meta: { nextCursor: null },
  });
});

function mount(
  props: Partial<Parameters<typeof AddValueDialog>[0]> = {},
  me: typeof SCIENTIST | typeof LIBRARIAN = SCIENTIST,
) {
  const onCreated = vi.fn();
  const onOpenRecord = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <AddValueDialog
      speciesId={SPECIES.id}
      onClose={onClose}
      onCreated={onCreated}
      onOpenRecord={onOpenRecord}
      {...props}
    />,
    { me: me as never },
  );
  return { onCreated, onOpenRecord, onClose };
}

async function pickPrimaryReference() {
  const primary = screen.getByRole('combobox', { name: /primary reference/i });
  await userEvent.type(primary, 'Re');
  await userEvent.click(await screen.findByRole('option', { name: /Renner2014/ }));
}

describe('RFC-65 R1 AddValueDialog', () => {
  it('with a preselected categorical trait offers its active levels and posts the level', async () => {
    curation.createRecord.mockResolvedValue(RECORD_DETAIL);
    const { onCreated } = mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await screen.findByRole('dialog', { name: 'Add value' });
    expect(within(dialog).getByText('sexual system')).toBeInTheDocument();
    const level = await within(dialog).findByRole('combobox', { name: /level/i });
    expect(within(level).queryByRole('option', { name: 'polygamous' })).not.toBeInTheDocument();
    await userEvent.selectOptions(level, 'dioecious');
    await pickPrimaryReference();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /as written in the source/i }),
      'Dioecious',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add record' }));
    await waitFor(() => expect(curation.createRecord).toHaveBeenCalledTimes(1));
    expect(curation.createRecord.mock.calls[0]?.[0]).toEqual({
      speciesId: SPECIES.id,
      traitId: DICTIONARY_SEXUAL_SYSTEM.id,
      value: { levelId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e12' },
      primaryReferenceId: PRIMARY_REFERENCE.id,
      rawValue: 'Dioecious',
    });
    expect(curation.invalidateAfterRecordWrite).toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith(RECORD_DETAIL);
  });

  it('lets the user pick a trait from the dictionary; a quantitative trait takes a number with its unit', async () => {
    curation.createRecord.mockResolvedValue(RECORD_DETAIL);
    mount();
    const dialog = await screen.findByRole('dialog', { name: 'Add value' });
    const trait = within(dialog).getByRole('combobox', { name: /trait/i });
    await userEvent.type(trait, 'seed');
    await userEvent.click(await screen.findByRole('option', { name: /seed mass/ }));
    const number = await within(dialog).findByRole('spinbutton', { name: /number/i });
    expect(within(dialog).getByText('mg')).toBeInTheDocument();
    await userEvent.type(number, '12.5');
    await pickPrimaryReference();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add record' }));
    await waitFor(() => expect(curation.createRecord).toHaveBeenCalled());
    expect(curation.createRecord.mock.calls[0]?.[0]).toMatchObject({
      traitId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e02', // the dictionary's seed_mass
      value: { numeric: 12.5 },
    });
  });

  it('validates locally before sending: trait, value and primary reference are required', async () => {
    mount();
    const dialog = await screen.findByRole('dialog', { name: 'Add value' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add record' }));
    expect(within(dialog).getByText('Choose a trait.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose the primary reference.')).toBeInTheDocument();
    expect(curation.createRecord).not.toHaveBeenCalled();
  });

  it('with a quantitative trait and no number, submitting shows "Enter a number." under the field and does not save', async () => {
    mount();
    const dialog = await screen.findByRole('dialog', { name: 'Add value' });
    const trait = within(dialog).getByRole('combobox', { name: /trait/i });
    await userEvent.type(trait, 'seed');
    await userEvent.click(await screen.findByRole('option', { name: /seed mass/ }));
    await within(dialog).findByRole('spinbutton', { name: /number/i });
    await pickPrimaryReference();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add record' }));
    expect(within(dialog).getByText('Enter a number.')).toBeInTheDocument();
    expect(curation.createRecord).not.toHaveBeenCalled();
  });

  it('with a preselected categorical trait and no level chosen, submitting shows "Choose a level."', async () => {
    mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await screen.findByRole('dialog', { name: 'Add value' });
    await pickPrimaryReference();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add record' }));
    expect(within(dialog).getByText('Choose a level.')).toBeInTheDocument();
    expect(curation.createRecord).not.toHaveBeenCalled();
  });

  it('shows API field errors under their fields and maps RECORD_DUPLICATE to a link to the existing record', async () => {
    curation.createRecord.mockRejectedValueOnce(
      new ApiError(400, 'VALIDATION_FAILED', 'Request validation failed', [
        { path: 'value.levelId', message: 'Level is inactive' },
      ]),
    );
    const { onOpenRecord } = mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await screen.findByRole('dialog', { name: 'Add value' });
    await userEvent.selectOptions(
      await within(dialog).findByRole('combobox', { name: /level/i }),
      'dioecious',
    );
    await pickPrimaryReference();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add record' }));
    expect(await within(dialog).findByText('Level is inactive')).toBeInTheDocument();
    curation.createRecord.mockRejectedValueOnce(
      new ApiError(409, 'RECORD_DUPLICATE', 'exists', [
        { path: 'recordId', message: RECORD_DETAIL.id },
      ]),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add record' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This claim already exists. Confirm the existing record instead.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open existing record' }));
    expect(onOpenRecord).toHaveBeenCalledWith(RECORD_DETAIL.id);
  });

  it('with a preselected trait shows a traitId API error under the trait line', async () => {
    curation.createRecord.mockRejectedValueOnce(
      new ApiError(400, 'VALIDATION_FAILED', 'Request validation failed', [
        { path: 'traitId', message: 'Trait is inactive' },
      ]),
    );
    mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await screen.findByRole('dialog', { name: 'Add value' });
    await userEvent.selectOptions(
      await within(dialog).findByRole('combobox', { name: /level/i }),
      'dioecious',
    );
    await pickPrimaryReference();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add record' }));
    const message = await within(dialog).findByText('Trait is inactive');
    expect(message.previousElementSibling).toHaveTextContent('Trait: sexual system');
  });

  it('offers to create a missing reference only with references.manage, and selects the created one', async () => {
    dataset.searchReferences.mockResolvedValue({ data: [], meta: { nextCursor: null } });
    curation.createReference.mockResolvedValue({ ...REFERENCE_DETAIL, citationKey: 'Novo_2026' });
    mount({}, LIBRARIAN);
    const dialog = await screen.findByRole('dialog', { name: 'Add value' });
    await userEvent.type(
      within(dialog).getByRole('combobox', { name: /primary reference/i }),
      'Novo_2026',
    );
    await userEvent.click(await screen.findByRole('option', { name: 'Create "Novo_2026"' }));
    await waitFor(() =>
      expect(curation.createReference).toHaveBeenCalledWith({ citationKey: 'Novo_2026' }),
    );
    expect(await within(dialog).findByText('Novo_2026')).toBeInTheDocument();
  });

  it('without references.manage there is no create option', async () => {
    dataset.searchReferences.mockResolvedValue({ data: [], meta: { nextCursor: null } });
    mount();
    const dialog = await screen.findByRole('dialog', { name: 'Add value' });
    await userEvent.type(
      within(dialog).getByRole('combobox', { name: /primary reference/i }),
      'Novo_2026',
    );
    expect(await within(dialog).findByText('No matches.')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Create/ })).not.toBeInTheDocument();
  });
});
