import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordItem, SpeciesTraits } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  DICTIONARY,
  DICTIONARY_SEED_MASS,
  DICTIONARY_SEXUAL_SYSTEM,
  PENDING_RECORD,
  RECORD,
  RECORD_DETAIL,
  SPECIES,
} from '../../test/dataset-fixtures.ts';
import { ME, USER } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { withRouter } from '../../test/router.tsx';
import { AddEntriesDialog } from './AddEntriesDialog.tsx';

const curation = vi.hoisted(() => ({
  createRecords: vi.fn(),
  resolveDoi: vi.fn(),
  invalidateAfterRecordWrite: vi.fn(async () => undefined),
}));
const dataset = vi.hoisted(() => ({
  fetchDictionary: vi.fn(),
  fetchRecords: vi.fn(),
  fetchSpeciesTraits: vi.fn(),
}));
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
const HERMAPHRODITE = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e11';
const DIOECIOUS = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e12';
const CONTEST_LABEL = 'Contest — The existing value is wrong; mine should replace it.';
const COMPLEMENT_LABEL =
  'Complement — The existing value is also correct; I am adding another observation.';
const page = (data: RecordItem[]) => ({ data, meta: { nextCursor: null } });
const CREATED = {
  created: [{ ...RECORD_DETAIL, recordCode: 'TR_9' }],
  validated: [],
  duplicates: [],
};

// A record the species already has for the dictionary's sexual system.
const EXISTING: RecordItem = {
  ...RECORD,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e90',
  recordCode: 'EB_3',
  trait: DICTIONARY_SEXUAL_SYSTEM,
  level: { id: HERMAPHRODITE, key: 'hermaphrodite' },
};
// Another, of the other active level.
const EXISTING_DIOECIOUS: RecordItem = {
  ...EXISTING,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e91',
  recordCode: 'EB_4',
  level: { id: DIOECIOUS, key: 'dioecious' },
};
// One it already has for the dictionary's seed mass.
const EXISTING_MASS: RecordItem = {
  ...PENDING_RECORD,
  recordCode: 'TR_4',
  trait: DICTIONARY_SEED_MASS,
  level: null,
  quantitative: { single: 1.25 },
};

// The species' summary: the levels with visible records, which make E
// (RFC-63 R14) once the inactive ones are dropped.
function summary(levels: { levelId: string; key: string }[]): SpeciesTraits {
  return [
    {
      category: { key: 'reproductive_system', label: 'Reproductive system' },
      traits: [
        {
          trait: DICTIONARY_SEXUAL_SYSTEM,
          recordCount: levels.length,
          harmonisationCounts: {
            harmonised: levels.length,
            unknownLevel: 0,
            multiValue: 0,
            notNumeric: 0,
            empty: 0,
          },
          levels: levels.map((level) => ({
            ...level,
            count: 1,
            validationCount: 0,
            contested: false,
          })),
          numeric: null,
          validated: false,
          contested: false,
        },
      ],
    },
  ];
}
const BOTH = summary([
  { levelId: HERMAPHRODITE, key: 'hermaphrodite' },
  { levelId: DIOECIOUS, key: 'dioecious' },
]);
const CONFIRM_CONTEST = 'Confirm: Validate dioecious · Contest hermaphrodite';

beforeEach(() => {
  curation.createRecords.mockReset();
  curation.resolveDoi.mockReset();
  curation.invalidateAfterRecordWrite.mockClear();
  dataset.fetchDictionary.mockReset().mockResolvedValue(DICTIONARY);
  dataset.fetchRecords.mockReset().mockResolvedValue(page([]));
  dataset.fetchSpeciesTraits.mockReset().mockResolvedValue([]);
});

function mount(props: Partial<Parameters<typeof AddEntriesDialog>[0]> = {}) {
  const onCreated = vi.fn();
  const onOpenRecord = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    withRouter(
      <AddEntriesDialog
        speciesId={SPECIES.id}
        onClose={onClose}
        onCreated={onCreated}
        onOpenRecord={onOpenRecord}
        {...props}
      />,
    ),
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

async function openWith(categoryKey: string, traitId: string): Promise<HTMLElement> {
  const dialog = await screen.findByRole('dialog', { name: TITLE });
  await within(dialog).findByRole('option', { name: 'Seed' });
  await userEvent.selectOptions(categorySelect(dialog), categoryKey);
  await userEvent.selectOptions(traitSelect(dialog), traitId);
  return dialog;
}

/** A fixed-trait dialog whose record fields are open (no existing record). */
async function openFixed(title = 'Add entries for sexual system') {
  const dialog = await screen.findByRole('dialog', { name: title });
  await waitFor(() => expect(submit(dialog)).toBeEnabled());
  return dialog;
}

describe('RFC-70 R1 AddEntriesDialog trait choice', () => {
  it('fills the trait select with the active traits of the chosen category only', async () => {
    mount();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    await within(dialog).findByRole('option', { name: 'Seed' });
    expect(traitSelect(dialog)).toBeDisabled();
    await userEvent.selectOptions(categorySelect(dialog), 'seed');
    const trait = traitSelect(dialog);
    expect(within(trait).getByRole('option', { name: 'seed mass (mg)' })).toBeInTheDocument();
    expect(within(trait).queryByRole('option', { name: /seed colour/ })).not.toBeInTheDocument();
  });

  it('clears the trait and the value when the category changes', async () => {
    mount();
    const dialog = await openWith('seed', SEED_MASS);
    const single = await within(dialog).findByRole('spinbutton', { name: 'Single value (mg)' });
    await waitFor(() => expect(single).toBeEnabled());
    await userEvent.type(single, '12.5');
    await userEvent.selectOptions(categorySelect(dialog), 'reproductive_system');
    expect(traitSelect(dialog)).toHaveValue('');
    expect(within(dialog).queryByRole('spinbutton')).not.toBeInTheDocument();
    await userEvent.selectOptions(categorySelect(dialog), 'seed');
    await userEvent.selectOptions(traitSelect(dialog), SEED_MASS);
    expect(
      await within(dialog).findByRole('spinbutton', { name: 'Single value (mg)' }),
    ).toHaveValue(null);
  });

  it('fixes the trait when opened from a card, without the selects, and names it in the title', async () => {
    mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await openFixed();
    expect(within(dialog).queryByRole('combobox', { name: 'Trait' })).toBeNull();
    expect(within(dialog).getByText('Reproductive system › sexual system')).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Levels' })).toBeInTheDocument();
  });

  it('RFC-13 R11 explains the chosen trait from the dictionary', async () => {
    mount();
    const dialog = await openWith('seed', SEED_MASS);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'What does this trait mean?' }),
    );
    expect(within(dialog).getByRole('tooltip')).toHaveTextContent('Dry mass of one seed.');
  });
});

describe('RFC-70 R1 AddEntriesDialog submission', () => {
  it('R-3 sends every ticked level with no DOI as a personal observation', async () => {
    curation.createRecords.mockResolvedValue(CREATED);
    const { onCreated } = mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await openFixed();
    expect(dataset.fetchRecords).toHaveBeenCalledWith({
      speciesId: SPECIES.id,
      traitId: DICTIONARY_SEXUAL_SYSTEM.id,
      limit: 200,
    });
    // No existing record: no intent step.
    expect(within(dialog).queryByRole('group', { name: 'What does your value mean?' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'hermaphrodite' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'dioecious' }));
    expect(within(dialog).getByText(`Recorded as ${USER.name}`)).toBeInTheDocument();
    await userEvent.click(submit(dialog));
    await waitFor(() =>
      expect(curation.createRecords).toHaveBeenCalledWith({
        speciesId: SPECIES.id,
        traitId: DICTIONARY_SEXUAL_SYSTEM.id,
        value: { levelIds: [HERMAPHRODITE, DIOECIOUS] },
        sources: { personalObservation: true },
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
  });

  it('R-5 sends only the quantitative fields that were filled', async () => {
    curation.createRecords.mockResolvedValue(CREATED);
    mount({ initialTrait: DICTIONARY_SEED_MASS });
    const dialog = await openFixed('Add entries for seed mass (mg)');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Min (mg)' }), '0.5');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Max (mg)' }), '3');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'n' }), '12');
    await userEvent.click(submit(dialog));
    await waitFor(() =>
      expect(curation.createRecords).toHaveBeenCalledWith(
        expect.objectContaining({ value: { quantitative: { min: 0.5, max: 3, n: 12 } } }),
      ),
    );
  });

  it('RFC-13 R6 asks for the category, the trait and the value before sending anything', async () => {
    mount();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    await userEvent.click(submit(dialog));
    expect(within(dialog).getByText('Choose a broad trait category.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a trait.')).toBeInTheDocument();
    expect(curation.createRecords).not.toHaveBeenCalled();
  });

  it('RFC-13 R6 asks for at least one level, and clears the message once one is ticked', async () => {
    mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await openFixed();
    await userEvent.click(submit(dialog));
    expect(within(dialog).getByText('Choose at least one level.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'dioecious' }));
    expect(within(dialog).queryByText('Choose at least one level.')).not.toBeInTheDocument();
    expect(curation.createRecords).not.toHaveBeenCalled();
  });

  it('RFC-13 R6 asks for one of single, min, max or mean before sending a quantitative claim', async () => {
    mount({ initialTrait: DICTIONARY_SEED_MASS });
    const dialog = await openFixed('Add entries for seed mass (mg)');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'SD (mg)' }), '1');
    await userEvent.click(submit(dialog));
    expect(
      within(dialog).getByText('Enter at least one of single, min, max or mean.'),
    ).toBeInTheDocument();
    expect(curation.createRecords).not.toHaveBeenCalled();
  });

  it('RFC-13 R6 shows an API field error under the field its path names', async () => {
    curation.createRecords.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Request validation failed', [
        { path: 'value.quantitative.single', message: 'Number is out of range' },
        { path: 'traitId', message: 'Trait is inactive' },
      ]),
    );
    mount({ initialTrait: DICTIONARY_SEED_MASS });
    const dialog = await openFixed('Add entries for seed mass (mg)');
    await userEvent.type(
      within(dialog).getByRole('spinbutton', { name: 'Single value (mg)' }),
      '1',
    );
    await userEvent.click(submit(dialog));
    expect(
      await within(dialog).findByRole('spinbutton', { name: 'Single value (mg)' }),
    ).toHaveAccessibleDescription(expect.stringContaining('Number is out of range'));
    expect((await within(dialog).findByText('Trait is inactive')).tagName).toBe('P');
  });

  it('RFC-13 R6 says a fixed trait has no level to choose from', async () => {
    dataset.fetchDictionary.mockResolvedValue([]);
    mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    expect(
      await within(dialog).findByText('This trait has no level to choose from.'),
    ).toBeInTheDocument();
  });
});

describe('spec §2 item 2.1 AddEntriesDialog intent first', () => {
  it('asks Contest or Complement first when records exist, and keeps everything else shut until answered', async () => {
    dataset.fetchRecords.mockResolvedValue(page([EXISTING]));
    mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    const intent = await within(dialog).findByRole('group', { name: 'What does your value mean?' });
    expect(
      within(intent).getByText(
        'This species already has records for this trait. Say first what your value means, and which value it answers.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'dioecious' })).toBeDisabled();
    expect(submit(dialog)).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('radio', { name: COMPLEMENT_LABEL }));
    expect(submit(dialog)).toBeDisabled();
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Responding to' }),
      'hermaphrodite',
    );
    expect(within(dialog).getByRole('checkbox', { name: 'dioecious' })).toBeEnabled();
    expect(submit(dialog)).toBeEnabled();
  });

  it('RFC-70 R9 comes from a level with Contest chosen, that level unchecked and the other levels with records checked', async () => {
    dataset.fetchRecords.mockResolvedValue(page([EXISTING, EXISTING_DIOECIOUS]));
    dataset.fetchSpeciesTraits.mockResolvedValue(BOTH);
    curation.createRecords.mockResolvedValue(CREATED);
    mount({
      initialTrait: DICTIONARY_SEXUAL_SYSTEM,
      respondTo: { intent: 'contest', levelId: HERMAPHRODITE },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    const confirm = await within(dialog).findByRole('checkbox', { name: CONFIRM_CONTEST });
    expect(within(dialog).getByRole('radio', { name: CONTEST_LABEL })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'hermaphrodite' })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'dioecious' })).toBeChecked();
    // A categorical contest responds to no record (RFC-70 R1).
    expect(within(dialog).queryByRole('combobox', { name: 'Responding to' })).toBeNull();
    expect(submit(dialog)).toBeDisabled();
    await userEvent.click(confirm);
    expect(submit(dialog)).toBeEnabled();
    await userEvent.click(submit(dialog));
    await waitFor(() =>
      expect(curation.createRecords).toHaveBeenCalledWith({
        speciesId: SPECIES.id,
        traitId: DICTIONARY_SEXUAL_SYSTEM.id,
        value: { levelIds: [DIOECIOUS] },
        sources: { personalObservation: true },
        intent: 'contest',
        contestedLevelIds: [HERMAPHRODITE],
      }),
    );
  });

  it('RFC-70 R10 asks for the confirmation again once the levels change', async () => {
    dataset.fetchRecords.mockResolvedValue(page([EXISTING, EXISTING_DIOECIOUS]));
    dataset.fetchSpeciesTraits.mockResolvedValue(BOTH);
    mount({
      initialTrait: DICTIONARY_SEXUAL_SYSTEM,
      respondTo: { intent: 'contest', levelId: HERMAPHRODITE },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: CONFIRM_CONTEST }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'dioecious' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'dioecious' }));
    expect(within(dialog).getByRole('checkbox', { name: CONFIRM_CONTEST })).not.toBeChecked();
    expect(submit(dialog)).toBeDisabled();
  });

  it('RFC-70 R10 a contest that contests no level cannot be sent', async () => {
    dataset.fetchRecords.mockResolvedValue(page([EXISTING]));
    dataset.fetchSpeciesTraits.mockResolvedValue(
      summary([{ levelId: HERMAPHRODITE, key: 'hermaphrodite' }]),
    );
    mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    await userEvent.click(await within(dialog).findByRole('radio', { name: CONTEST_LABEL }));
    // Contest checks every level of E, so nothing is left to contest.
    expect(
      await within(dialog).findByText(
        'A contest must contest at least one level; this is a complement',
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /^Confirm: / }));
    expect(submit(dialog)).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('radio', { name: COMPLEMENT_LABEL }));
    expect(
      within(dialog).queryByText('A contest must contest at least one level; this is a complement'),
    ).toBeNull();
  });

  it('RFC-70 R10 a 400 on contestedLevelIds reloads the levels and asks for the confirmation again', async () => {
    dataset.fetchRecords.mockResolvedValue(page([EXISTING, EXISTING_DIOECIOUS]));
    dataset.fetchSpeciesTraits.mockResolvedValue(BOTH);
    curation.createRecords.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Request validation failed', [
        { path: 'contestedLevelIds', message: 'The contested levels changed; reload them' },
      ]),
    );
    mount({
      initialTrait: DICTIONARY_SEXUAL_SYSTEM,
      respondTo: { intent: 'contest', levelId: HERMAPHRODITE },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: CONFIRM_CONTEST }));
    const loads = dataset.fetchSpeciesTraits.mock.calls.length;
    const dictionaryLoads = dataset.fetchDictionary.mock.calls.length;
    await userEvent.click(submit(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The contested levels changed; reload them',
    );
    await waitFor(() =>
      expect(dataset.fetchSpeciesTraits.mock.calls.length).toBeGreaterThan(loads),
    );
    await waitFor(() =>
      expect(dataset.fetchDictionary.mock.calls.length).toBeGreaterThan(dictionaryLoads),
    );
    expect(within(dialog).getByRole('checkbox', { name: CONFIRM_CONTEST })).not.toBeChecked();
    expect(submit(dialog)).toBeDisabled();
  });

  it('comes pre-answered from a quantitative row, naming the record by its ID', async () => {
    // A second record with a mean, an SD and an n but no single value: its
    // option reads as the record table's value column does (RFC-63 R8).
    const summarised: RecordItem = {
      ...EXISTING_MASS,
      id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e92',
      recordCode: 'TR_8',
      quantitative: { mean: 1.25, sd: 0.2, n: 4 },
    };
    dataset.fetchRecords.mockResolvedValue(page([EXISTING_MASS, summarised]));
    curation.createRecords.mockResolvedValue(CREATED);
    mount({
      initialTrait: DICTIONARY_SEED_MASS,
      respondTo: { recordId: EXISTING_MASS.id },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for seed mass (mg)' });
    // ＋ sets the responded record; the choice of intent stays the user's (RFC-70 R9).
    const complement = await within(dialog).findByRole('radio', { name: COMPLEMENT_LABEL });
    expect(complement).not.toBeChecked();
    expect(submit(dialog)).toBeDisabled();
    await userEvent.click(complement);
    await waitFor(() => expect(submit(dialog)).toBeEnabled());
    const target = within(dialog).getByRole('combobox', { name: 'Responding to' });
    expect(target).toHaveValue(EXISTING_MASS.id);
    expect(within(target).getByRole('option', { name: 'TR_4 · 1.25 mg' })).toBeInTheDocument();
    expect(
      within(target).getByRole('option', { name: 'TR_8 · mean 1.25 · SD 0.2 mg (n = 4)' }),
    ).toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByRole('spinbutton', { name: 'Single value (mg)' }),
      '2',
    );
    await userEvent.click(submit(dialog));
    await waitFor(() =>
      expect(curation.createRecords).toHaveBeenCalledWith(
        expect.objectContaining({ intent: 'complement', respondsToRecordId: EXISTING_MASS.id }),
      ),
    );
  });
});

describe('RFC-70 R3 AddEntriesDialog result (R-7)', () => {
  it('stays open and names what was added, what counted as a validation and what was a duplicate', async () => {
    curation.createRecords.mockResolvedValue({
      created: [{ ...RECORD_DETAIL, recordCode: 'TR_9' }],
      validated: [{ recordId: EXISTING.id, recordCode: 'EB_3' }],
      duplicates: [{ recordId: EXISTING_MASS.id, recordCode: 'TR_4' }],
    });
    const { onCreated, onOpenRecord } = mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await openFixed();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'dioecious' }));
    await userEvent.click(submit(dialog));
    const items = await within(dialog).findAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'TR_9 was added.',
      'EB_3 matches an existing record — counted as your validation.',
      'TR_4 is already your own record — nothing was added.',
    ]);
    // A partial success is not a failure: nothing is announced as an error.
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'EB_3' }));
    expect(onOpenRecord).toHaveBeenCalledWith(EXISTING.id);
  });

  it("RFC-70 R2 shows a refusal of the responded record in the API's own words", async () => {
    dataset.fetchRecords.mockResolvedValue(page([EXISTING_MASS]));
    curation.createRecords.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Request validation failed', [
        { path: 'respondsToRecordId', message: 'The responded record is of another trait' },
      ]),
    );
    mount({ initialTrait: DICTIONARY_SEED_MASS, respondTo: { recordId: EXISTING_MASS.id } });
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for seed mass (mg)' });
    await userEvent.click(await within(dialog).findByRole('radio', { name: COMPLEMENT_LABEL }));
    await userEvent.type(
      within(dialog).getByRole('spinbutton', { name: 'Single value (mg)' }),
      '2',
    );
    await userEvent.click(submit(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The responded record is of another trait',
    );
  });

  it('hands an answer that is not a contest up even when it names nothing', async () => {
    const EMPTY = { created: [], validated: [], duplicates: [] };
    curation.createRecords.mockResolvedValue(EMPTY);
    const { onCreated } = mount({ initialTrait: DICTIONARY_SEXUAL_SYSTEM });
    const dialog = await openFixed();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'dioecious' }));
    await userEvent.click(submit(dialog));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(EMPTY));
    expect(within(dialog).queryByRole('list')).toBeNull();
  });

  it('says a contest that created nothing was recorded, instead of closing silently', async () => {
    dataset.fetchRecords.mockResolvedValue(page([EXISTING, EXISTING_DIOECIOUS]));
    dataset.fetchSpeciesTraits.mockResolvedValue(BOTH);
    curation.createRecords.mockResolvedValue({ created: [], validated: [], duplicates: [] });
    const { onCreated, onClose } = mount({
      initialTrait: DICTIONARY_SEXUAL_SYSTEM,
      respondTo: { intent: 'contest', levelId: HERMAPHRODITE },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: CONFIRM_CONTEST }));
    await userEvent.click(submit(dialog));
    expect(await within(dialog).findByRole('listitem')).toHaveTextContent(
      'Your contest of hermaphrodite was recorded.',
    );
    expect(onCreated).not.toHaveBeenCalled();
    // The footer's Close, after the header's ×.
    const close = within(dialog).getAllByRole('button', { name: 'Close' }).at(-1);
    await userEvent.click(close as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });
});
