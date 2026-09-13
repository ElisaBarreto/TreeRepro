import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordDetail } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  ACCEPTED_STATE,
  CURATED_RECORD_DETAIL,
  RECORD_DETAIL,
} from '../../test/dataset-fixtures.ts';
import { ME, USER } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { RecordActions } from './RecordActions.tsx';

const curation = vi.hoisted(() => ({
  annotateRecord: vi.fn(),
  setAccepted: vi.fn(),
  invalidateAfterRecordWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/curation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/curation.ts')>()),
  ...curation,
}));

const perms = (...keys: string[]) => ({ ...ME, permissions: keys }) as never;
// A manual record by the signed-in user, not yet reviewed, not accepted.
const MINE: RecordDetail = {
  ...CURATED_RECORD_DETAIL,
  harmonisation: 'harmonised',
  numericValue: 2,
  valueText: '2',
  review: 'unreviewed',
  annotations: [],
  acceptedHistory: [],
  createdBy: { id: USER.id, name: USER.name },
};

beforeEach(() => {
  curation.annotateRecord.mockReset();
  curation.setAccepted.mockReset();
  curation.invalidateAfterRecordWrite.mockClear();
});

describe('RFC-65 R3–R6 RecordActions', () => {
  it('renders nothing without any curation permission', () => {
    renderWithProviders(<RecordActions record={MINE} />, { me: perms('dataset.read') });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('confirms and steps back with one click; disputing needs a note', async () => {
    curation.annotateRecord.mockResolvedValue({ ...MINE, review: 'confirmed' });
    renderWithProviders(<RecordActions record={MINE} />, { me: perms('records.annotate') });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(curation.annotateRecord).toHaveBeenCalledWith(MINE.id, { kind: 'confirm' }),
    );
    expect(curation.invalidateAfterRecordWrite).toHaveBeenCalledWith(
      expect.anything(),
      MINE.speciesId,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dispute' }));
    const note = screen.getByRole('textbox', { name: /note/i });
    await userEvent.click(screen.getByRole('button', { name: 'Send dispute' }));
    expect(screen.getByText('A note is required.')).toBeInTheDocument();
    expect(curation.annotateRecord).toHaveBeenCalledTimes(1);
    await userEvent.type(note, 'Table 2 says otherwise');
    await userEvent.click(screen.getByRole('button', { name: 'Send dispute' }));
    await waitFor(() =>
      expect(curation.annotateRecord).toHaveBeenLastCalledWith(MINE.id, {
        kind: 'dispute',
        note: 'Table 2 says otherwise',
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Neutral' }));
    await waitFor(() =>
      expect(curation.annotateRecord).toHaveBeenLastCalledWith(MINE.id, { kind: 'neutral' }),
    );
  });

  it('offers Withdraw to the author or a records.withdraw holder, on manual records only', async () => {
    curation.annotateRecord.mockResolvedValue({ ...MINE, review: 'withdrawn' });
    const { unmount } = renderWithProviders(<RecordActions record={MINE} />, {
      me: perms('records.annotate'),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await userEvent.type(screen.getByRole('textbox', { name: /note/i }), 'Wrong species');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    await waitFor(() =>
      expect(curation.annotateRecord).toHaveBeenCalledWith(MINE.id, {
        kind: 'withdraw',
        note: 'Wrong species',
      }),
    );
    unmount();
    const other = { ...MINE, createdBy: { id: 'someone-else', name: 'Grace' } };
    const second = renderWithProviders(<RecordActions record={other} />, {
      me: perms('records.annotate'),
    });
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    second.unmount();
    renderWithProviders(<RecordActions record={other} />, {
      me: perms('records.annotate', 'records.withdraw'),
    });
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });

  it('never offers Withdraw on an import record; nothing on a withdrawn record; an accepted record shows the badge instead of Set as accepted', () => {
    const { unmount } = renderWithProviders(
      <RecordActions record={{ ...RECORD_DETAIL, review: 'unreviewed' }} />,
      { me: perms('records.annotate', 'records.withdraw') },
    );
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    unmount();
    const w = renderWithProviders(<RecordActions record={{ ...MINE, review: 'withdrawn' }} />, {
      me: perms('records.annotate', 'accepted.manage'),
    });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('This record is withdrawn.')).toBeInTheDocument();
    w.unmount();
    renderWithProviders(<RecordActions record={CURATED_RECORD_DETAIL} />, {
      me: perms('accepted.manage'),
    });
    expect(screen.getByText('accepted value')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set as accepted' })).not.toBeInTheDocument();
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
