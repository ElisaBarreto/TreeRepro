import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordDetail, SpeciesTraits } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { datasetKeys } from '../../api/dataset.ts';
import {
  DICTIONARY,
  DICTIONARY_SEED_MASS,
  DICTIONARY_SEXUAL_SYSTEM,
  RECORD_DETAIL,
  RESPONDED_RECORD_DETAIL,
} from '../../test/dataset-fixtures.ts';
import { ME, USER } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { withRouter } from '../../test/router.tsx';
import { RecordActions } from './RecordActions.tsx';

const curation = vi.hoisted(() => ({
  annotateRecord: vi.fn(),
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

const perms = (...keys: string[]) => ({ ...ME, permissions: keys }) as never;
const CONTRIBUTOR = perms('dataset.read', 'records.annotate', 'records.create');
const HERMAPHRODITE = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e11';
const DIOECIOUS = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e12';
const CONTEST_LABEL = 'Contest — The existing value is wrong; mine should replace it.';
const COMPLEMENT_LABEL =
  'Complement — The existing value is also correct; I am adding another observation.';

// A manual record by someone else, on the dictionary's trait.
const THEIRS: RecordDetail = {
  ...RECORD_DETAIL,
  recordCode: 'TR_5',
  origin: 'manual',
  trait: DICTIONARY_SEXUAL_SYSTEM,
  level: { id: HERMAPHRODITE, key: 'hermaphrodite' },
  valueText: 'hermaphrodite',
  annotations: [],
  createdBy: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9f', name: 'Grace' },
};
// Another record of the species, of the other active level.
const THEIRS_DIOECIOUS: RecordDetail = {
  ...THEIRS,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e91',
  recordCode: 'TR_6',
  level: { id: DIOECIOUS, key: 'dioecious' },
  valueText: 'dioecious',
};
// A quantitative record by someone else.
const MEASURED: RecordDetail = {
  ...THEIRS,
  recordCode: 'TR_7',
  trait: DICTIONARY_SEED_MASS,
  level: null,
  valueText: '1.25',
  quantitative: { single: 1.25 },
};
const MINE: RecordDetail = { ...THEIRS, createdBy: { id: USER.id, name: USER.name } };
const IMPORTED: RecordDetail = { ...THEIRS, origin: 'import', createdBy: null };
// THEIRS once the viewer validated it: every annotation of the shared
// fixture, re-signed as the viewer's `confirm`.
const VALIDATED: RecordDetail = {
  ...THEIRS,
  annotations: RESPONDED_RECORD_DETAIL.annotations.map((annotation) => ({
    ...annotation,
    kind: 'confirm' as const,
    actor: { id: USER.id, name: USER.name },
  })),
};
// The species' summary: both levels have visible records, so both are in E.
const SUMMARY: SpeciesTraits = [
  {
    category: { key: 'reproductive_system', label: 'Reproductive system' },
    traits: [
      {
        trait: DICTIONARY_SEXUAL_SYSTEM,
        recordCount: 2,
        harmonisationCounts: {
          harmonised: 2,
          unknownLevel: 0,
          multiValue: 0,
          notNumeric: 0,
          empty: 0,
        },
        levels: [
          { levelId: HERMAPHRODITE, key: 'hermaphrodite' },
          { levelId: DIOECIOUS, key: 'dioecious' },
        ].map((level) => ({ ...level, count: 1, validationCount: 0, contested: false })),
        numeric: null,
        validated: false,
        contested: false,
      },
    ],
  },
];

beforeEach(() => {
  curation.annotateRecord.mockReset().mockResolvedValue(THEIRS);
  curation.createRecords.mockReset();
  curation.resolveDoi.mockReset();
  curation.invalidateAfterRecordWrite.mockClear();
  dataset.fetchDictionary.mockReset().mockResolvedValue(DICTIONARY);
  dataset.fetchRecords
    .mockReset()
    .mockResolvedValue({ data: [THEIRS, THEIRS_DIOECIOUS], meta: { nextCursor: null } });
  dataset.fetchSpeciesTraits.mockReset().mockResolvedValue(SUMMARY);
});

function mount(record: RecordDetail, me: never, props: { onGone?: () => void } = {}) {
  return renderWithProviders(withRouter(<RecordActions record={record} {...props} />), { me });
}

describe('spec §2 RecordActions by permission', () => {
  it('renders nothing without records.annotate', async () => {
    mount(THEIRS, perms('dataset.read'));
    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument());
  });

  it('gives a contributor Validate, Contest and Complement on someone else’s record, and no Withdraw', async () => {
    mount(THEIRS, CONTRIBUTOR);
    const validate = await screen.findByRole('button', { name: 'Validate' });
    expect(validate).toBeEnabled();
    for (const name of ['Validate', 'Contest', 'Complement']) {
      // The glyph is decorative; the word carries the name.
      expect(
        screen.getByRole('button', { name }).querySelector('svg[aria-hidden="true"]'),
      ).not.toBeNull();
    }
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    for (const gone of ['Neutral', 'Dispute', 'Set as accepted', '+ Add different record']) {
      expect(screen.queryByRole('button', { name: gone })).not.toBeInTheDocument();
    }
  });

  it('withholds Contest and Complement without records.create', async () => {
    mount(THEIRS, perms('dataset.read', 'records.annotate'));
    expect(await screen.findByRole('button', { name: 'Validate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Contest' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complement' })).not.toBeInTheDocument();
  });

  it('R-6 offers no Validate on the viewer’s own record, which they may withdraw', async () => {
    mount(MINE, CONTRIBUTOR);
    expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Validate' })).not.toBeInTheDocument();
  });

  it('R-6 is out of reach once the viewer validated, and says why', async () => {
    mount(VALIDATED, CONTRIBUTOR);
    const validate = await screen.findByRole('button', { name: 'Validate' });
    expect(validate).toBeDisabled();
    expect(validate).toHaveAccessibleDescription('You validated this record');
  });

  it('R-12 offers Withdraw by origin: records.withdraw for manual, records.withdraw_imported for imported', async () => {
    const withdraw = perms('dataset.read', 'records.annotate', 'records.withdraw');
    const imported = perms('dataset.read', 'records.annotate', 'records.withdraw_imported');
    const first = mount(THEIRS, withdraw);
    expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    first.unmount();
    const second = mount(IMPORTED, withdraw);
    await screen.findByRole('button', { name: 'Validate' });
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    second.unmount();
    mount(IMPORTED, imported);
    expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });
});

describe('RFC-70 R4 RecordActions validate', () => {
  it('asks the question, then confirms the record as it stands', async () => {
    mount(THEIRS, CONTRIBUTOR);
    await userEvent.click(await screen.findByRole('button', { name: 'Validate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Validate TR_5' });
    expect(
      within(dialog).getByText('Do you confirm that this record is correct?'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Validate' }));
    await waitFor(() =>
      expect(curation.annotateRecord).toHaveBeenCalledWith(THEIRS.id, { kind: 'confirm' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Validate TR_5' })).not.toBeInTheDocument(),
    );
  });
});

describe('RFC-70 R1, R9 RecordActions contest and complement', () => {
  it('contests a categorical record: Contest chosen, its level unchecked, no "Responding to"', async () => {
    mount(THEIRS, CONTRIBUTOR);
    await userEvent.click(await screen.findByRole('button', { name: 'Contest' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    await within(dialog).findByRole('checkbox', { name: /^Confirm: / });
    expect(within(dialog).getByRole('radio', { name: CONTEST_LABEL })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'hermaphrodite' })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'dioecious' })).toBeChecked();
    expect(within(dialog).queryByRole('combobox', { name: 'Responding to' })).toBeNull();
  });

  it('contests a quantitative record by responding to it', async () => {
    dataset.fetchRecords.mockResolvedValue({ data: [MEASURED], meta: { nextCursor: null } });
    mount(MEASURED, CONTRIBUTOR);
    await userEvent.click(await screen.findByRole('button', { name: 'Contest' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for seed mass (mg)' });
    expect(await within(dialog).findByRole('radio', { name: CONTEST_LABEL })).toBeChecked();
    expect(within(dialog).getByRole('combobox', { name: 'Responding to' })).toHaveValue(
      MEASURED.id,
    );
  });

  it('complements without choosing the intent, the target already this record’s level', async () => {
    mount(THEIRS, CONTRIBUTOR);
    await userEvent.click(await screen.findByRole('button', { name: 'Complement' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    const complement = await within(dialog).findByRole('radio', { name: COMPLEMENT_LABEL });
    expect(complement).not.toBeChecked();
    expect(within(dialog).getByRole('radio', { name: CONTEST_LABEL })).not.toBeChecked();
    await userEvent.click(complement);
    expect(within(dialog).getByRole('combobox', { name: 'Responding to' })).toHaveValue(
      HERMAPHRODITE,
    );
  });
});

describe('R-12 RecordActions withdraw', () => {
  it('asks for confirmation only, sends no note, drops the cached record, and closes the drawer', async () => {
    curation.annotateRecord.mockResolvedValue(null);
    const onGone = vi.fn();
    const { queryClient } = mount(MINE, CONTRIBUTOR, { onGone });
    // Seeded as the drawer's own record query would have it: a withdraw must
    // drop this, not leave it to be refetched into a 404 the drawer would
    // flash as an error Alert before onGone closes it.
    queryClient.setQueryData(datasetKeys.record(MINE.id), MINE);
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw this record?' });
    expect(
      within(dialog).getByText(
        'The record leaves the dataset for every viewer. It stays in the database for audit only.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() =>
      expect(curation.annotateRecord).toHaveBeenCalledWith(MINE.id, { kind: 'withdraw' }),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(datasetKeys.record(MINE.id))).toBeUndefined(),
    );
    await waitFor(() => expect(onGone).toHaveBeenCalled());
  });

  it('a failed withdrawal shows its error once, inside the confirm dialog, not again in the drawer', async () => {
    curation.annotateRecord.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));
    mount(MINE, CONTRIBUTOR);
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw this record?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    expect(await within(dialog).findByText('Something went wrong. Try again.')).toBeInTheDocument();
    expect(screen.getAllByText('Something went wrong. Try again.')).toHaveLength(1);
  });

  it('RFC-13 R6 maps a refusal to a sentence and stays open', async () => {
    curation.annotateRecord.mockRejectedValue(new ApiError(409, 'RECORD_NOT_WITHDRAWABLE', 'x'));
    mount(MINE, CONTRIBUTOR);
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw this record?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    expect(
      await within(dialog).findByText('You may not withdraw this record.'),
    ).toBeInTheDocument();
  });
});
