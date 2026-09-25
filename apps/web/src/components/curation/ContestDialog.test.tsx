import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordDetail, SpeciesTraits } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  DICTIONARY,
  DICTIONARY_SEED_MASS,
  DICTIONARY_SEXUAL_SYSTEM,
  PENDING_RECORD,
  RECORD_DETAIL,
} from '../../test/dataset-fixtures.ts';
import { ME, USER } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { ContestDialog } from './ContestDialog.tsx';

const curation = vi.hoisted(() => ({
  createRecords: vi.fn(),
  resolveDoi: vi.fn(),
  invalidateAfterRecordWrite: vi.fn(async () => undefined),
}));
const dataset = vi.hoisted(() => ({ fetchDictionary: vi.fn(), fetchSpeciesTraits: vi.fn() }));
vi.mock('../../api/curation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/curation.ts')>()),
  ...curation,
}));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

const SCIENTIST = { ...ME, permissions: ['dataset.read', 'records.create'] } as never;
const HERMAPHRODITE = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e11';
const DIOECIOUS = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e12';

// The record being answered: its trait is the dictionary's, so the dialog's
// level select is filled from the same query the API validates against.
const TARGET: RecordDetail = {
  ...RECORD_DETAIL,
  trait: DICTIONARY_SEXUAL_SYSTEM,
  level: { id: HERMAPHRODITE, key: 'hermaphrodite' },
  valueText: 'hermaphrodite',
};

// The same, for a trait whose value is a number rather than a level.
const QUANTITATIVE_TARGET: RecordDetail = {
  ...RECORD_DETAIL,
  trait: DICTIONARY_SEED_MASS,
  level: null,
  numericValue: 1.25,
  valueText: '1.25',
};

// The species' summary: only the target's level has visible records, so E =
// { hermaphrodite } (RFC-63 R14).
const SUMMARY: SpeciesTraits = [
  {
    category: { key: 'sexual_system', label: 'Sexual system' },
    traits: [
      {
        trait: DICTIONARY_SEXUAL_SYSTEM,
        recordCount: 1,
        harmonisationCounts: {
          harmonised: 1,
          unknownLevel: 0,
          multiValue: 0,
          notNumeric: 0,
          empty: 0,
        },
        levels: [
          {
            levelId: HERMAPHRODITE,
            key: 'hermaphrodite',
            count: 1,
            validationCount: 0,
            contested: false,
          },
        ],
        numeric: null,
        validated: false,
        contested: false,
      },
    ],
  },
];

const CREATED = { created: [RECORD_DETAIL], validated: [], duplicates: [] };

const CONTEST_LABEL = 'Contest — The existing value is wrong; mine should replace it.';
const COMPLEMENT_LABEL =
  'Complement — The existing value is also correct; I am adding another observation.';

beforeEach(() => {
  curation.createRecords.mockReset();
  curation.resolveDoi.mockReset();
  curation.invalidateAfterRecordWrite.mockClear();
  dataset.fetchDictionary.mockReset().mockResolvedValue(DICTIONARY);
  dataset.fetchSpeciesTraits.mockReset().mockResolvedValue(SUMMARY);
});

function mount(record: RecordDetail = TARGET) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const onOpenRecord = vi.fn();
  renderWithProviders(
    <ContestDialog
      record={record}
      onClose={onClose}
      onCreated={onCreated}
      onOpenRecord={onOpenRecord}
    />,
    { me: SCIENTIST },
  );
  return { onClose, onCreated, onOpenRecord };
}

const levelSelect = () => screen.getByRole('combobox', { name: 'Level' });
const submit = () => screen.getByRole('button', { name: 'Add record' });

describe('RFC-70 R1 ContestDialog step one', () => {
  it('asks what the value means, with an example of each answer', async () => {
    mount();
    await screen.findByRole('group', { name: 'What does your value mean?' });
    expect(screen.getByRole('radio', { name: CONTEST_LABEL })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: COMPLEMENT_LABEL })).not.toBeChecked();
    expect(
      screen.getByText('Existing: biotic; yours: abiotic — the mode is abiotic, not biotic.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Existing: biotic; yours: abiotic — it can be both.'),
    ).toBeInTheDocument();
  });

  it('keeps every field of the record step out of reach until one is chosen', async () => {
    mount();
    await screen.findByRole('combobox', { name: 'Level' });
    expect(levelSelect()).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'DOI' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add another reference' })).toBeDisabled();
    expect(submit()).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: CONTEST_LABEL }));
    expect(levelSelect()).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'DOI' })).toBeEnabled();
    await waitFor(() => expect(submit()).toBeEnabled());
  });

  it('keeps what was already filled when the intent is changed', async () => {
    mount();
    await screen.findByRole('combobox', { name: 'Level' });
    await userEvent.click(screen.getByRole('radio', { name: CONTEST_LABEL }));
    await userEvent.selectOptions(levelSelect(), DIOECIOUS);
    await userEvent.click(screen.getByRole('radio', { name: COMPLEMENT_LABEL }));
    expect(levelSelect()).toHaveValue(DIOECIOUS);
  });
});

describe('RFC-70 R1 ContestDialog submission', () => {
  it('sends the value, the sources, the intent and the record it responds to', async () => {
    curation.createRecords.mockResolvedValue(CREATED);
    const { onCreated } = mount();
    await screen.findByRole('combobox', { name: 'Level' });
    await userEvent.click(screen.getByRole('radio', { name: COMPLEMENT_LABEL }));
    await userEvent.selectOptions(levelSelect(), DIOECIOUS);
    expect(screen.getByText(`Recorded as ${USER.name}`)).toBeInTheDocument();
    await userEvent.click(submit());

    await waitFor(() =>
      expect(curation.createRecords).toHaveBeenCalledWith({
        speciesId: TARGET.speciesId,
        traitId: DICTIONARY_SEXUAL_SYSTEM.id,
        value: { levelIds: [DIOECIOUS] },
        sources: { personalObservation: true },
        intent: 'complement',
        respondsToRecordId: TARGET.id,
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
  });

  it('RFC-70 R1 a categorical contest names the levels it contests, E \\ S, and no responded record', async () => {
    curation.createRecords.mockResolvedValue(CREATED);
    mount();
    await screen.findByRole('combobox', { name: 'Level' });
    await userEvent.click(screen.getByRole('radio', { name: CONTEST_LABEL }));
    await userEvent.selectOptions(levelSelect(), DIOECIOUS);
    await waitFor(() => expect(submit()).toBeEnabled());
    await userEvent.click(submit());
    await waitFor(() =>
      expect(curation.createRecords).toHaveBeenCalledWith({
        speciesId: TARGET.speciesId,
        traitId: DICTIONARY_SEXUAL_SYSTEM.id,
        value: { levelIds: [DIOECIOUS] },
        sources: { personalObservation: true },
        intent: 'contest',
        contestedLevelIds: [HERMAPHRODITE],
      }),
    );
  });

  it('RFC-70 R10 a categorical contest that contests no level cannot be sent', async () => {
    mount();
    await screen.findByRole('combobox', { name: 'Level' });
    await userEvent.click(screen.getByRole('radio', { name: CONTEST_LABEL }));
    await userEvent.selectOptions(levelSelect(), HERMAPHRODITE);
    expect(
      await screen.findByText('A contest must contest at least one level; this is a complement'),
    ).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: COMPLEMENT_LABEL }));
    expect(submit()).toBeEnabled();
  });

  it('sends the DOI it resolved as the source of a contest', async () => {
    curation.resolveDoi.mockResolvedValue({
      status: 'resolvable',
      reference: null,
      preview: { title: 'Seed size', authors: null, year: 2023, journal: null },
    });
    curation.createRecords.mockResolvedValue(CREATED);
    mount();
    await screen.findByRole('combobox', { name: 'Level' });
    await userEvent.click(screen.getByRole('radio', { name: CONTEST_LABEL }));
    await userEvent.selectOptions(levelSelect(), DIOECIOUS);
    await userEvent.type(screen.getByRole('textbox', { name: 'DOI' }), '10.1111/geb.13000');
    await userEvent.tab();
    expect(await screen.findByText('Resolved: Seed size (2023)')).toBeInTheDocument();
    await userEvent.click(submit());
    await waitFor(() =>
      expect(curation.createRecords).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: { references: [{ doi: '10.1111/geb.13000' }] },
          intent: 'contest',
        }),
      ),
    );
  });

  it('asks for a level before sending anything, and clears the message once one is chosen', async () => {
    mount();
    await screen.findByRole('combobox', { name: 'Level' });
    await userEvent.click(screen.getByRole('radio', { name: CONTEST_LABEL }));
    await userEvent.click(submit());
    expect(screen.getByText('Choose a level.')).toBeInTheDocument();
    expect(curation.createRecords).not.toHaveBeenCalled();

    await userEvent.selectOptions(levelSelect(), DIOECIOUS);
    expect(screen.queryByText('Choose a level.')).not.toBeInTheDocument();
    expect(levelSelect()).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('asks for a number before sending anything, and clears the message once one is typed', async () => {
    mount(QUANTITATIVE_TARGET);
    await screen.findByRole('spinbutton', { name: /number/i });
    await userEvent.click(screen.getByRole('radio', { name: CONTEST_LABEL }));
    await userEvent.click(submit());
    expect(screen.getByText('Enter a number.')).toBeInTheDocument();
    expect(curation.createRecords).not.toHaveBeenCalled();

    const number = screen.getByRole('spinbutton', { name: /number/i });
    await userEvent.type(number, '2.5');
    expect(screen.queryByText('Enter a number.')).not.toBeInTheDocument();
    expect(number).not.toHaveAttribute('aria-invalid', 'true');
  });
});

describe('RFC-70 R2 ContestDialog refusals', () => {
  it('shows a contest that repeats the value under the value control, not as a page error', async () => {
    curation.createRecords.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [
        { path: 'value', message: 'A contest carries a different value' },
      ]),
    );
    mount(QUANTITATIVE_TARGET);
    const number = await screen.findByRole('spinbutton', { name: /number/i });
    await userEvent.click(screen.getByRole('radio', { name: CONTEST_LABEL }));
    await userEvent.type(number, '1.25');
    await userEvent.click(submit());

    expect(await screen.findByText('A contest carries a different value')).toBeInTheDocument();
    expect(number).toHaveAccessibleDescription('A contest carries a different value');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(curation.createRecords).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'contest', respondsToRecordId: QUANTITATIVE_TARGET.id }),
    );
  });

  it('lands the API message of a DOI row under that row', async () => {
    curation.resolveDoi.mockResolvedValue({
      status: 'resolvable',
      reference: null,
      preview: null,
    });
    curation.createRecords.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [
        { path: 'sources.references.0.doi', message: 'DOI does not resolve' },
      ]),
    );
    mount();
    await screen.findByRole('combobox', { name: 'Level' });
    await userEvent.click(screen.getByRole('radio', { name: CONTEST_LABEL }));
    await userEvent.selectOptions(levelSelect(), DIOECIOUS);
    await userEvent.type(screen.getByRole('textbox', { name: 'DOI' }), '10.1111/geb.13000');
    await userEvent.tab();
    await screen.findByText(/^Resolved:/);
    await userEvent.click(submit());
    expect(await screen.findByText('DOI does not resolve')).toBeInTheDocument();
  });

  it('shows a refusal that binds to no field in its own words', async () => {
    curation.createRecords.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [
        { path: 'respondsToRecordId', message: 'The record answered belongs to another trait' },
      ]),
    );
    mount();
    await screen.findByRole('combobox', { name: 'Level' });
    await userEvent.click(screen.getByRole('radio', { name: CONTEST_LABEL }));
    await userEvent.selectOptions(levelSelect(), DIOECIOUS);
    await userEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The record answered belongs to another trait',
    );
    expect(screen.queryByText('Check the highlighted fields.')).not.toBeInTheDocument();
  });

  it('says so when the trait has no level to choose from', async () => {
    dataset.fetchDictionary.mockResolvedValue([]);
    mount();
    expect(await screen.findByText('This trait has no level to choose from.')).toBeInTheDocument();
  });

  it('says so when the levels could not be loaded at all', async () => {
    dataset.fetchDictionary.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    mount();
    expect(
      await screen.findByText('Could not load the levels. Reload the page.'),
    ).toBeInTheDocument();
  });

  it('RFC-80 R4 says why it will not send while a DOI has not resolved', async () => {
    curation.resolveDoi.mockResolvedValue({ status: 'not_found', reference: null });
    mount();
    await screen.findByRole('combobox', { name: 'Level' });
    await userEvent.click(screen.getByRole('radio', { name: CONTEST_LABEL }));
    await userEvent.selectOptions(levelSelect(), DIOECIOUS);
    await userEvent.type(screen.getByRole('textbox', { name: 'DOI' }), '10.1111/geb.13000');
    await userEvent.tab();
    expect(await screen.findByText('DOI not found')).toBeInTheDocument();
    // The button stays live: a dead control explains nothing, and the sentence
    // is what ties the refusal to the row (as in `AddEntriesDialog`).
    expect(submit()).toBeEnabled();
    await userEvent.click(submit());
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Each DOI must resolve before the record can be added.',
    );
    expect(curation.createRecords).not.toHaveBeenCalled();
  });
});

describe('RFC-70 R3 ContestDialog duplicates', () => {
  it('names the claims that already existed before handing the new record up', async () => {
    curation.createRecords.mockResolvedValue({
      created: [RECORD_DETAIL],
      validated: [],
      duplicates: [{ recordId: PENDING_RECORD.id, recordCode: 'TR_9' }],
    });
    const { onCreated, onOpenRecord } = mount();
    await screen.findByRole('combobox', { name: 'Level' });
    await userEvent.click(screen.getByRole('radio', { name: COMPLEMENT_LABEL }));
    await userEvent.selectOptions(levelSelect(), DIOECIOUS);
    await userEvent.click(submit());

    expect(await screen.findByText('One of these claims already existed.')).toBeInTheDocument();
    // A partial success is not a failure: nothing is announced as an error.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole('button', { name: `Open record …${PENDING_RECORD.id.slice(-6)}` }),
    );
    expect(onOpenRecord).toHaveBeenCalledWith(PENDING_RECORD.id);
    await userEvent.click(screen.getByRole('button', { name: 'Open the record you added' }));
    expect(onCreated).toHaveBeenCalledWith({
      created: [RECORD_DETAIL],
      validated: [],
      duplicates: [{ recordId: PENDING_RECORD.id, recordCode: 'TR_9' }],
    });
  });
});

describe('RFC-70 R3 ContestDialog validations', () => {
  it('says a matched level counted as a validation, with a link to the record', async () => {
    curation.createRecords.mockResolvedValue({
      created: [],
      validated: [{ recordId: PENDING_RECORD.id, recordCode: 'TR_9' }],
      duplicates: [],
    });
    const { onCreated, onOpenRecord } = mount();
    await screen.findByRole('combobox', { name: 'Level' });
    await userEvent.click(screen.getByRole('radio', { name: COMPLEMENT_LABEL }));
    await userEvent.selectOptions(levelSelect(), DIOECIOUS);
    await userEvent.click(submit());

    expect(
      await screen.findByText('Matches an existing record — counted as your validation.'),
    ).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole('button', { name: `Open record …${PENDING_RECORD.id.slice(-6)}` }),
    );
    expect(onOpenRecord).toHaveBeenCalledWith(PENDING_RECORD.id);
  });
});
