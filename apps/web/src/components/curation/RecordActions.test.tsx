import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Annotation, RecordDetail } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  ACCEPTED_STATE,
  CURATED_RECORD_DETAIL,
  DICTIONARY,
  DICTIONARY_SEXUAL_SYSTEM,
  RECORD_DETAIL,
} from '../../test/dataset-fixtures.ts';
import { ME, USER } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { withRouter } from '../../test/router.tsx';
import { RecordActions } from './RecordActions.tsx';

const curation = vi.hoisted(() => ({
  annotateRecord: vi.fn(),
  setAccepted: vi.fn(),
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

const perms = (...keys: string[]) => ({ ...ME, permissions: keys }) as never;
const CONTRIBUTOR = perms('dataset.read', 'records.annotate', 'records.create');
const REVIEWER = perms('dataset.read', 'records.annotate', 'records.create', 'records.review');

const DOI = '10.1111/geb.13000';
const VALIDATE = '✓ Validate';
const ADD = '+ Add different record';

// A manual record by the signed-in user, not yet reviewed, not accepted.
const MINE: RecordDetail = {
  ...CURATED_RECORD_DETAIL,
  trait: DICTIONARY_SEXUAL_SYSTEM,
  harmonisation: 'harmonised',
  level: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e11', key: 'hermaphrodite' },
  numericValue: null,
  valueText: 'hermaphrodite',
  review: 'unreviewed',
  annotations: [],
  acceptedHistory: [],
  createdBy: { id: USER.id, name: USER.name },
};
// The same record entered by someone else, so Withdraw stays out of the way.
const THEIRS: RecordDetail = { ...MINE, createdBy: { id: 'someone-else', name: 'Grace' } };

let annotationSeq = 0;
function annotation(over: Partial<Annotation>): Annotation {
  annotationSeq += 1;
  return {
    id: `018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c9${String(annotationSeq).padStart(3, '0')}`,
    kind: 'confirm',
    note: null,
    actor: { id: USER.id, name: USER.name },
    createdAt: '2026-09-05T10:00:00.000Z',
    reference: null,
    generated: false,
    ...over,
  };
}

beforeEach(() => {
  annotationSeq = 0;
  curation.annotateRecord.mockReset();
  curation.setAccepted.mockReset();
  curation.createRecords.mockReset();
  // Leaving the DOI field always asks the registry; a test that does not care
  // what came back still needs an answer to come back.
  curation.resolveDoi
    .mockReset()
    .mockResolvedValue({ status: 'resolvable', reference: null, preview: null });
  curation.invalidateAfterRecordWrite.mockClear();
  dataset.fetchDictionary.mockReset().mockResolvedValue(DICTIONARY);
});

describe('RFC-70 R4 RecordActions by permission', () => {
  it('renders nothing without any curation permission', () => {
    renderWithProviders(<RecordActions record={MINE} />, { me: perms('dataset.read') });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('gives a contributor the two decisions and neither reviewer action', () => {
    renderWithProviders(<RecordActions record={THEIRS} />, { me: CONTRIBUTOR });
    expect(screen.getByRole('button', { name: VALIDATE })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ADD })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Neutral' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dispute' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set as accepted' })).not.toBeInTheDocument();
  });

  it('adds Neutral and Dispute for a reviewer, after the two decisions', () => {
    renderWithProviders(<RecordActions record={THEIRS} />, { me: REVIEWER });
    const row = screen.getByRole('button', { name: VALIDATE }).parentElement as HTMLElement;
    const names = within(row)
      .getAllByRole('button')
      .map((button) => button.textContent)
      // The `?` help triggers of the two decisions carry an icon, not text.
      .filter((text) => text !== '');
    expect(names).toEqual([VALIDATE, ADD, 'Neutral', 'Dispute']);
  });

  it('withholds Add different record from a viewer the API would refuse', () => {
    // The button's only action is `POST /api/records`, which needs
    // `records.create`; validating only needs `records.annotate`.
    renderWithProviders(<RecordActions record={THEIRS} />, {
      me: perms('dataset.read', 'records.annotate'),
    });
    expect(screen.getByRole('button', { name: VALIDATE })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ADD })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'What does Add different record mean?' }),
    ).not.toBeInTheDocument();
  });

  it('spec 7.1 gives Add different record a red outline, not the solid red of Withdraw', () => {
    renderWithProviders(<RecordActions record={MINE} />, { me: CONTRIBUTOR });
    const add = screen.getByRole('button', { name: ADD });
    const withdraw = screen.getByRole('button', { name: 'Withdraw' });
    // The contributor's main action: red, but an outline — the solid red fill
    // belongs to the one destructive control on the screen.
    expect(add.className).toContain('text-red-700');
    expect(add.className).not.toContain('bg-red-700');
    expect(withdraw.className).toContain('bg-red-700');
    // And still not the primary Validate.
    expect(add.className).not.toContain('bg-pollen-500');
    expect(screen.getByRole('button', { name: VALIDATE }).className).toContain('bg-pollen-500');
  });

  it('still offers Set as accepted to an accepted.manage holder', () => {
    renderWithProviders(<RecordActions record={THEIRS} />, {
      me: perms('dataset.read', 'records.annotate', 'accepted.manage'),
    });
    expect(screen.getByRole('button', { name: 'Set as accepted' })).toBeInTheDocument();
  });

  // Mounted through a router: each tip carries a "Learn more" link into the
  // help topic (RFC-73 R4), and a router `Link` needs one.
  it('explains each decision in its own words, and links on to the help topic', async () => {
    renderWithProviders(withRouter(<RecordActions record={THEIRS} />), { me: CONTRIBUTOR });
    await userEvent.click(await screen.findByRole('button', { name: 'What does Validate mean?' }));
    expect(
      screen.getByText(
        'Records that you agree with this value as it stands. Nothing is changed; your confirmation is attached to the record.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Learn more' })).toHaveAttribute(
      'href',
      '/app/help/workflow#validate',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'What does Add different record mean?' }),
    );
    expect(
      screen.getByText(
        'Opens a form for a different or additional value. You will say whether it contests this record (it is wrong) or complements it (both are true).',
      ),
    ).toBeInTheDocument();
  });

  it('has no action at all on a withdrawn record', () => {
    renderWithProviders(<RecordActions record={{ ...MINE, review: 'withdrawn' }} />, {
      me: perms('records.annotate', 'accepted.manage', 'records.create'),
    });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('This record is withdrawn.')).toBeInTheDocument();
  });
});

describe('RFC-70 R4 RecordActions validate', () => {
  it('confirms the record as it stands, with no reference', async () => {
    curation.annotateRecord.mockResolvedValue({ ...MINE, review: 'confirmed' });
    renderWithProviders(<RecordActions record={THEIRS} />, { me: CONTRIBUTOR });
    await userEvent.click(screen.getByRole('button', { name: VALIDATE }));
    await waitFor(() =>
      expect(curation.annotateRecord).toHaveBeenCalledWith(THEIRS.id, { kind: 'confirm' }),
    );
    expect(curation.invalidateAfterRecordWrite).toHaveBeenCalledWith(
      expect.anything(),
      THEIRS.speciesId,
    );
  });

  it('sends the supporting DOI it resolved with the confirmation', async () => {
    curation.resolveDoi.mockResolvedValue({
      status: 'resolvable',
      reference: null,
      preview: { title: 'Seed size', authors: null, year: 2023, journal: null },
    });
    curation.annotateRecord.mockResolvedValue({ ...MINE, review: 'confirmed' });
    renderWithProviders(<RecordActions record={THEIRS} />, { me: CONTRIBUTOR });
    await userEvent.click(screen.getByText('Add a supporting DOI (optional)'));
    await userEvent.type(screen.getByRole('textbox', { name: 'DOI' }), DOI);
    await userEvent.tab();
    expect(await screen.findByText('Resolved: Seed size (2023)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: VALIDATE }));
    await waitFor(() =>
      expect(curation.annotateRecord).toHaveBeenCalledWith(THEIRS.id, {
        kind: 'confirm',
        reference: { doi: DOI },
      }),
    );
  });

  it('lands the API refusal of the supporting reference under the DOI field', async () => {
    curation.annotateRecord.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [
        { path: 'reference.doi', message: 'DOI does not resolve' },
      ]),
    );
    renderWithProviders(<RecordActions record={THEIRS} />, { me: CONTRIBUTOR });
    await userEvent.click(screen.getByText('Add a supporting DOI (optional)'));
    await userEvent.type(screen.getByRole('textbox', { name: 'DOI' }), DOI);
    // Validate waits for the registry, so the check settles before the click.
    await userEvent.tab();
    await screen.findByText(/^Resolved:/);
    await userEvent.click(screen.getByRole('button', { name: VALIDATE }));
    expect(await screen.findByText('DOI does not resolve')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the DOI registry is unreachable when the confirmation cannot be resolved', async () => {
    curation.annotateRecord.mockRejectedValue(
      new ApiError(502, 'DOI_LOOKUP_FAILED', 'The DOI registry could not be reached'),
    );
    renderWithProviders(<RecordActions record={THEIRS} />, { me: CONTRIBUTOR });
    await userEvent.click(screen.getByRole('button', { name: VALIDATE }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The DOI registry could not be reached. Try again in a moment.',
    );
  });

  it('is out of reach once the viewer has validated the record, and says why', () => {
    renderWithProviders(
      <RecordActions record={{ ...THEIRS, annotations: [annotation({ kind: 'confirm' })] }} />,
      { me: CONTRIBUTOR },
    );
    const validate = screen.getByRole('button', { name: VALIDATE });
    expect(validate).toBeDisabled();
    // The hint cannot ride on the disabled button's `title`: a disabled
    // control gets no pointer events, so the tooltip never opens.
    expect(screen.getByText('You validated this record')).toBeInTheDocument();
    expect(validate).toHaveAccessibleDescription('You validated this record');
  });

  it('refuses to send a DOI the registry did not accept', async () => {
    curation.resolveDoi.mockResolvedValue({ status: 'not_found', reference: null });
    renderWithProviders(<RecordActions record={THEIRS} />, { me: CONTRIBUTOR });
    await userEvent.click(screen.getByText('Add a supporting DOI (optional)'));
    await userEvent.type(screen.getByRole('textbox', { name: 'DOI' }), DOI);
    await userEvent.tab();
    expect(await screen.findByText('DOI not found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: VALIDATE })).toBeDisabled();
    // The reason a disabled button is disabled cannot sit behind a collapsed
    // disclosure (`toBeVisible` fails inside a `<details>` without `open`).
    expect(screen.getByText('DOI not found')).toBeVisible();
    expect(curation.annotateRecord).not.toHaveBeenCalled();
  });

  it('drops what the registry said about a DOI once that DOI is edited', async () => {
    curation.resolveDoi.mockResolvedValue({
      status: 'resolvable',
      reference: null,
      preview: { title: 'Seed size', authors: null, year: 2023, journal: null },
    });
    curation.annotateRecord.mockResolvedValue({ ...MINE, review: 'confirmed' });
    renderWithProviders(<RecordActions record={THEIRS} />, { me: CONTRIBUTOR });
    await userEvent.click(screen.getByText('Add a supporting DOI (optional)'));
    const field = screen.getByRole('textbox', { name: 'DOI' });
    await userEvent.type(field, DOI);
    await userEvent.tab();
    expect(await screen.findByText('Resolved: Seed size (2023)')).toBeInTheDocument();

    // A resolved line belongs to the value it resolved, not to the row.
    await userEvent.type(field, '9');
    expect(screen.queryByText('Resolved: Seed size (2023)')).not.toBeInTheDocument();
    await userEvent.tab();
    expect(await screen.findByText('Resolved: Seed size (2023)')).toBeInTheDocument();
    expect(curation.resolveDoi).toHaveBeenLastCalledWith(`${DOI}9`);
    await userEvent.click(screen.getByRole('button', { name: VALIDATE }));
    await waitFor(() =>
      expect(curation.annotateRecord).toHaveBeenCalledWith(THEIRS.id, {
        kind: 'confirm',
        reference: { doi: `${DOI}9` },
      }),
    );
  });

  it('opens the disclosure the contributor had tidied away, to show a refusal', async () => {
    curation.annotateRecord.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [
        { path: 'reference.doi', message: 'DOI does not resolve' },
      ]),
    );
    renderWithProviders(<RecordActions record={THEIRS} />, { me: CONTRIBUTOR });
    const summary = screen.getByText('Add a supporting DOI (optional)');
    await userEvent.click(summary);
    await userEvent.type(screen.getByRole('textbox', { name: 'DOI' }), DOI);
    await userEvent.tab();
    await screen.findByText(/^Resolved:/);

    // Tidied away before submitting: the refusal has to bring it back, or the
    // contributor clicks Validate and sees nothing happen at all — a field
    // error suppresses the alert below the buttons.
    await userEvent.click(summary);
    expect(screen.getByRole('textbox', { name: 'DOI' })).not.toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: VALIDATE }));
    // `waitFor`, not `findBy`: the message lands in the render, the reopening
    // in the effect that follows it.
    await waitFor(() => expect(screen.getByText('DOI does not resolve')).toBeVisible());
  });

  it('opens the disclosure again when the same submission is refused again', async () => {
    curation.annotateRecord.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [
        { path: 'reference.doi', message: 'DOI does not resolve' },
      ]),
    );
    renderWithProviders(<RecordActions record={THEIRS} />, { me: CONTRIBUTOR });
    const summary = screen.getByText('Add a supporting DOI (optional)');
    await userEvent.click(summary);
    await userEvent.type(screen.getByRole('textbox', { name: 'DOI' }), DOI);
    await userEvent.tab();
    await screen.findByText(/^Resolved:/);
    await userEvent.click(screen.getByRole('button', { name: VALIDATE }));
    await waitFor(() => expect(screen.getByText('DOI does not resolve')).toBeVisible());

    // Collapsed, then tried again untouched — suspecting a passing hiccup at
    // the registry. Nothing about the DOI has changed, so only the attempt
    // itself can say the second refusal happened.
    await userEvent.click(summary);
    expect(screen.getByText('DOI does not resolve')).not.toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: VALIDATE }));
    await waitFor(() => expect(screen.getByText('DOI does not resolve')).toBeVisible());
  });

  it('drops the refusal of a DOI as soon as that DOI is edited', async () => {
    curation.annotateRecord.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [
        { path: 'reference.doi', message: 'DOI does not resolve' },
      ]),
    );
    renderWithProviders(<RecordActions record={THEIRS} />, { me: CONTRIBUTOR });
    await userEvent.click(screen.getByText('Add a supporting DOI (optional)'));
    const field = screen.getByRole('textbox', { name: 'DOI' });
    await userEvent.type(field, DOI);
    await userEvent.tab();
    await screen.findByText(/^Resolved:/);
    await userEvent.click(screen.getByRole('button', { name: VALIDATE }));
    expect(await screen.findByText('DOI does not resolve')).toBeVisible();

    // The refusal was about the value that is no longer there.
    await userEvent.clear(field);
    expect(screen.queryByText('DOI does not resolve')).not.toBeInTheDocument();
    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
  });

  it('keeps the very field the contributor is correcting, once a check blocked it', async () => {
    curation.resolveDoi.mockResolvedValue({ status: 'not_found', reference: null });
    renderWithProviders(<RecordActions record={THEIRS} />, { me: CONTRIBUTOR });
    await userEvent.click(screen.getByText('Add a supporting DOI (optional)'));
    const field = screen.getByRole('textbox', { name: 'DOI' });
    await userEvent.type(field, DOI);
    await userEvent.tab();
    expect(await screen.findByText('DOI not found')).toBeInTheDocument();

    // Correcting a blocked DOI clears the block on the very keystroke that
    // starts the correction. The input must survive it: the same node, still
    // focused, still on screen — not torn out and replaced behind a
    // freshly mounted, collapsed disclosure.
    await userEvent.click(field);
    await userEvent.type(field, '9');
    expect(screen.getByRole('textbox', { name: 'DOI' })).toBe(field);
    expect(field).toHaveFocus();
    expect(field).toBeVisible();
    expect(field).toHaveValue(`${DOI}9`);
  });

  it('keeps the refused DOI and its message out from behind the disclosure', async () => {
    curation.annotateRecord.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [
        { path: 'reference.doi', message: 'DOI does not resolve' },
      ]),
    );
    renderWithProviders(<RecordActions record={THEIRS} />, { me: CONTRIBUTOR });
    await userEvent.click(screen.getByText('Add a supporting DOI (optional)'));
    await userEvent.type(screen.getByRole('textbox', { name: 'DOI' }), DOI);
    await userEvent.tab();
    await screen.findByText(/^Resolved:/);
    await userEvent.click(screen.getByRole('button', { name: VALIDATE }));
    // The disclosure is opened for it, so the message is actually on screen.
    expect(await screen.findByText('DOI does not resolve')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'DOI' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'DOI' })).toHaveValue(DOI);
  });

  it('reads only the viewer’s own latest stance, ignoring a withdraw and other people', () => {
    const { unmount } = renderWithProviders(
      <RecordActions
        record={{
          ...THEIRS,
          annotations: [
            annotation({ kind: 'withdraw', note: 'x' }),
            annotation({ kind: 'neutral' }),
            annotation({ kind: 'confirm' }),
          ],
        }}
      />,
      { me: CONTRIBUTOR },
    );
    // The newest non-withdraw stance of this viewer is `neutral`.
    expect(screen.getByRole('button', { name: VALIDATE })).toBeEnabled();
    unmount();

    renderWithProviders(
      <RecordActions
        record={{
          ...THEIRS,
          annotations: [annotation({ kind: 'confirm', actor: { id: 'grace', name: 'Grace' } })],
        }}
      />,
      { me: CONTRIBUTOR },
    );
    expect(screen.getByRole('button', { name: VALIDATE })).toBeEnabled();
  });
});

describe('RFC-70 R1 RecordActions add a different record', () => {
  it('opens the contest dialog and hands the record it created to the drawer', async () => {
    const created = { ...RECORD_DETAIL, id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8dff' };
    curation.createRecords.mockResolvedValue({ created: [created], duplicates: [] });
    const onOpenRecord = vi.fn();
    renderWithProviders(<RecordActions record={THEIRS} onOpenRecord={onOpenRecord} />, {
      me: CONTRIBUTOR,
    });
    await userEvent.click(screen.getByRole('button', { name: ADD }));
    expect(
      await screen.findByRole('heading', {
        name: `Add a different record for sexual system of ${THEIRS.species.canonicalName}`,
      }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('radio', {
        name: 'Contest — The existing value is wrong; mine should replace it.',
      }),
    );
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Level' }),
      '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e12',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add record' }));

    await waitFor(() =>
      expect(curation.createRecords).toHaveBeenCalledWith(
        expect.objectContaining({ intent: 'contest', respondsToRecordId: THEIRS.id }),
      ),
    );
    await waitFor(() => expect(onOpenRecord).toHaveBeenCalledWith(created.id));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Add record' })).not.toBeInTheDocument(),
    );
  });

  it('closes the dialog again without writing anything', async () => {
    renderWithProviders(<RecordActions record={THEIRS} />, { me: CONTRIBUTOR });
    await userEvent.click(screen.getByRole('button', { name: ADD }));
    await screen.findByRole('button', { name: 'Add record' });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Add record' })).not.toBeInTheDocument();
    expect(curation.createRecords).not.toHaveBeenCalled();
  });
});

describe('RFC-65 R3-R6 RecordActions reviewer and author actions', () => {
  it('steps back with one click; disputing needs a note', async () => {
    curation.annotateRecord.mockResolvedValue({ ...MINE, review: 'disputed' });
    renderWithProviders(<RecordActions record={THEIRS} />, { me: REVIEWER });
    await userEvent.click(screen.getByRole('button', { name: 'Neutral' }));
    await waitFor(() =>
      expect(curation.annotateRecord).toHaveBeenLastCalledWith(THEIRS.id, { kind: 'neutral' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dispute' }));
    const note = screen.getByRole('textbox', { name: /why do you dispute/i });
    await userEvent.click(screen.getByRole('button', { name: 'Send dispute' }));
    expect(screen.getByText('A note is required.')).toBeInTheDocument();
    expect(curation.annotateRecord).toHaveBeenCalledTimes(1);
    await userEvent.type(note, 'Table 2 says otherwise');
    await userEvent.click(screen.getByRole('button', { name: 'Send dispute' }));
    await waitFor(() =>
      expect(curation.annotateRecord).toHaveBeenLastCalledWith(THEIRS.id, {
        kind: 'dispute',
        note: 'Table 2 says otherwise',
      }),
    );
    await waitFor(() => expect(note).not.toBeInTheDocument());
  });

  it('offers Withdraw to the author or a records.withdraw holder, on manual records only', async () => {
    curation.annotateRecord.mockResolvedValue({ ...MINE, review: 'withdrawn' });
    const { unmount } = renderWithProviders(<RecordActions record={MINE} />, {
      me: perms('records.annotate'),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: /why is this record withdrawn/i }),
      'Wrong species',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    await waitFor(() =>
      expect(curation.annotateRecord).toHaveBeenCalledWith(MINE.id, {
        kind: 'withdraw',
        note: 'Wrong species',
      }),
    );
    unmount();
    const second = renderWithProviders(<RecordActions record={THEIRS} />, {
      me: perms('records.annotate'),
    });
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    second.unmount();
    renderWithProviders(<RecordActions record={THEIRS} />, {
      me: perms('records.annotate', 'records.withdraw'),
    });
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });

  it('never offers Withdraw on an import record; an accepted record shows the badge instead of Set as accepted', () => {
    const { unmount } = renderWithProviders(
      <RecordActions record={{ ...RECORD_DETAIL, review: 'unreviewed' }} />,
      { me: perms('records.annotate', 'records.withdraw') },
    );
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    unmount();
    renderWithProviders(<RecordActions record={CURATED_RECORD_DETAIL} />, {
      me: perms('accepted.manage'),
    });
    expect(screen.getByText('accepted value')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set as accepted' })).not.toBeInTheDocument();
  });

  it('resets the note and its error on Cancel or when switching between Dispute and Withdraw', async () => {
    renderWithProviders(<RecordActions record={MINE} />, {
      me: perms('records.annotate', 'records.review'),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Dispute' }));
    await userEvent.type(screen.getByRole('textbox', { name: /why do you dispute/i }), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(screen.getByRole('textbox', { name: /why is this record withdrawn/i })).toHaveValue('');
    expect(screen.queryByText('A note is required.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    expect(screen.getByText('A note is required.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dispute' }));
    expect(screen.getByRole('textbox', { name: /why do you dispute/i })).toHaveValue('');
    expect(screen.queryByText('A note is required.')).not.toBeInTheDocument();
  });

  it('clears a previous failure when a note form opens, and lands a note validation detail under the field', async () => {
    curation.annotateRecord.mockRejectedValueOnce(new ApiError(409, 'RECORD_WITHDRAWN', 'x'));
    renderWithProviders(<RecordActions record={MINE} />, {
      me: perms('records.annotate', 'records.review'),
    });
    await userEvent.click(screen.getByRole('button', { name: VALIDATE }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This record is withdrawn.');
    await userEvent.click(screen.getByRole('button', { name: 'Dispute' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    curation.annotateRecord.mockRejectedValueOnce(
      new ApiError(400, 'VALIDATION_FAILED', 'x', [
        { path: 'note', message: 'Note must be at most 2000 characters.' },
      ]),
    );
    const note = screen.getByRole('textbox', { name: /why do you dispute/i });
    await userEvent.type(note, 'far too long');
    await userEvent.click(screen.getByRole('button', { name: 'Send dispute' }));
    expect(await screen.findByText('Note must be at most 2000 characters.')).toBeInTheDocument();
    expect(note).toHaveAccessibleDescription('Note must be at most 2000 characters.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides Set as accepted on a record that is not harmonised, even with accepted.manage', () => {
    renderWithProviders(<RecordActions record={{ ...MINE, harmonisation: 'not_numeric' }} />, {
      me: perms('accepted.manage'),
    });
    expect(screen.queryByRole('button', { name: 'Set as accepted' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('sets the record as the accepted value with accepted.manage; maps API refusals to sentences', async () => {
    curation.setAccepted.mockResolvedValue(ACCEPTED_STATE);
    renderWithProviders(<RecordActions record={MINE} />, { me: perms('accepted.manage') });
    await userEvent.click(screen.getByRole('button', { name: 'Set as accepted' }));
    await waitFor(() =>
      expect(curation.setAccepted).toHaveBeenCalledWith(MINE.speciesId, MINE.trait.id, {
        decision: 'accepted',
        recordId: MINE.id,
      }),
    );
    curation.setAccepted.mockRejectedValueOnce(new ApiError(409, 'RECORD_NOT_HARMONISED', 'x'));
    await userEvent.click(screen.getByRole('button', { name: 'Set as accepted' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only a harmonised record can be the accepted value.',
    );
  });
});
