import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ContestedQueueItem, RecordItem } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  CONTESTED_ITEM,
  CURATED_RECORD_DETAIL,
  PENDING_RECORD,
  SEED_MASS,
} from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { renderAt } from '../../test/router.tsx';

const auth = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  login: vi.fn(),
  loginTotp: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
  changePassword: vi.fn(),
  totpSetup: vi.fn(),
  totpConfirm: vi.fn(),
  totpDisable: vi.fn(),
}));
const dataset = vi.hoisted(() => ({ fetchRecord: vi.fn() }));
const curation = vi.hoisted(() => ({
  fetchContested: vi.fn(),
  resolveContest: vi.fn(),
  withdrawContest: vi.fn(),
  withdrawLevel: vi.fn(),
  annotateRecord: vi.fn(),
}));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));
vi.mock('../../api/curation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/curation.ts')>()),
  ...curation,
}));

// A quantitative contest: `levels: null`, `target` is the record it
// responds to, `records` is empty (this contest created none) so the
// "no record" text has something to cover.
const QUANT_TARGET: RecordItem = {
  ...PENDING_RECORD,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e01',
  recordCode: 'TR_9',
  valueText: '5.2',
  createdBy: CONTESTED_ITEM.createdBy,
};
const QUANT_ITEM: ContestedQueueItem = {
  ...CONTESTED_ITEM,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e02',
  trait: SEED_MASS,
  levels: null,
  target: QUANT_TARGET,
  records: [],
};

// Two named levels, one still contested and one cleared (Task 8's fixture
// shape: emptied levels stay named with `contested: false`).
const MULTI_LEVEL_ITEM: ContestedQueueItem = {
  ...CONTESTED_ITEM,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e03',
  levels: [
    { levelId: 'l-alpha', key: 'alpha', contested: true },
    { levelId: 'l-gamma', key: 'gamma', contested: false },
  ],
  records: [],
};

const REVIEWER_PERMISSIONS = [
  'dataset.read',
  'records.review',
  'records.annotate',
  'records.withdraw',
];

beforeEach(() => {
  auth.fetchMe.mockReset().mockResolvedValue({ ...ME, permissions: REVIEWER_PERMISSIONS });
  dataset.fetchRecord.mockReset().mockResolvedValue(CURATED_RECORD_DETAIL);
  curation.fetchContested
    .mockReset()
    .mockResolvedValue({ data: [CONTESTED_ITEM], meta: { nextCursor: null } });
  curation.resolveContest.mockReset().mockResolvedValue(undefined);
  curation.withdrawContest.mockReset().mockResolvedValue(undefined);
  curation.withdrawLevel.mockReset().mockResolvedValue({ withdrawn: [], remaining: [] });
  curation.annotateRecord.mockReset().mockResolvedValue(null);
});

describe('RFC-65 R10 DisputedPage is the contested queue', () => {
  it('lists a categorical contest: species, trait, contested level (marked), contest record, by, date', async () => {
    renderAt('/app/curation/disputed');
    expect(await screen.findByRole('heading', { name: 'Contested records' })).toBeInTheDocument();
    const row = (await screen.findAllByRole('row'))[1] as HTMLElement;
    expect(within(row).getByRole('link', { name: /Adenanthera pavonina/ })).toHaveAttribute(
      'href',
      `/app/species/${CONTESTED_ITEM.species.id}`,
    );
    expect(row).toHaveTextContent('sexual system');
    expect(within(row).getByText('dioecious')).toBeInTheDocument();
    expect(row).toHaveTextContent('Grace');
    expect(row).toHaveTextContent('2026-09-03');
    await userEvent.click(within(row).getByRole('button', { name: 'monoecious' }));
    expect(await screen.findByRole('dialog', { name: 'Record' })).toBeInTheDocument();
    expect(dataset.fetchRecord).toHaveBeenCalledWith(CONTESTED_ITEM.records[0]?.id);
  });

  it('marks a still-contested level differently from one the contest also names but no longer contests', async () => {
    curation.fetchContested.mockResolvedValue({
      data: [MULTI_LEVEL_ITEM],
      meta: { nextCursor: null },
    });
    renderAt('/app/curation/disputed');
    const row = (await screen.findAllByRole('row'))[1] as HTMLElement;
    const contested = (await within(row).findByText('alpha')).parentElement as HTMLElement;
    const cleared = within(row).getByText('gamma').parentElement as HTMLElement;
    expect(contested.className).not.toBe(cleared.className);
    // Not by colour alone (WCAG 1.4.1): the cleared level says so in words.
    expect(contested).toHaveTextContent(/^alpha$/);
    expect(cleared).toHaveTextContent(/^gamma \(cleared\)$/);
  });

  it('a quantitative contest shows the target as the contested value and "No record" for its empty records list', async () => {
    curation.fetchContested.mockResolvedValue({ data: [QUANT_ITEM], meta: { nextCursor: null } });
    renderAt('/app/curation/disputed');
    const row = (await screen.findAllByRole('row'))[1] as HTMLElement;
    expect(row).toHaveTextContent('No record');
    await userEvent.click(within(row).getByRole('button', { name: '5.2' }));
    await waitFor(() => expect(dataset.fetchRecord).toHaveBeenCalledWith(QUANT_TARGET.id));
  });

  it('Keep both resolves the contest after confirmation', async () => {
    renderAt('/app/curation/disputed');
    await userEvent.click(await screen.findByRole('button', { name: 'Keep both' }));
    const dialog = await screen.findByRole('dialog', { name: 'Keep both values?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep both' }));
    await waitFor(() => expect(curation.resolveContest).toHaveBeenCalledWith(CONTESTED_ITEM.id));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('Withdraw contest withdraws every record it created, after confirmation', async () => {
    renderAt('/app/curation/disputed');
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw contest' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw the contest?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(curation.withdrawContest).toHaveBeenCalledWith(CONTESTED_ITEM.id));
  });

  it('hides Withdraw contest without records.annotate; Keep both and Withdraw level still show', async () => {
    auth.fetchMe.mockResolvedValue({ ...ME, permissions: ['dataset.read', 'records.review'] });
    renderAt('/app/curation/disputed');
    expect(await screen.findByRole('button', { name: 'Keep both' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw contest' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw "dioecious"' })).toBeInTheDocument();
  });

  it('Withdraw level withdraws the named level; a refusal stays in the dialog with the error', async () => {
    curation.withdrawLevel.mockRejectedValueOnce(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    renderAt('/app/curation/disputed');
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw "dioecious"' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Withdraw every "dioecious" record?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() =>
      expect(curation.withdrawLevel).toHaveBeenLastCalledWith(
        CONTESTED_ITEM.species.id,
        CONTESTED_ITEM.trait.id,
        CONTESTED_ITEM.levels?.[0]?.levelId,
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('RFC-65 R14 a level withdrawal leaving records behind reports the sentence instead of closing', async () => {
    curation.withdrawLevel.mockResolvedValue({
      withdrawn: [],
      remaining: [{ recordId: 'r1', recordCode: 'IR_1' }],
    });
    renderAt('/app/curation/disputed');
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw "dioecious"' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Withdraw every "dioecious" record?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '1 records remain that you cannot withdraw — an admin can withdraw them, or use Keep both',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('a quantitative contest offers Withdraw record on the target', async () => {
    curation.fetchContested.mockResolvedValue({ data: [QUANT_ITEM], meta: { nextCursor: null } });
    curation.annotateRecord.mockResolvedValue(null);
    renderAt('/app/curation/disputed');
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw record' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw the contested record?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() =>
      expect(curation.annotateRecord).toHaveBeenCalledWith(QUANT_TARGET.id, { kind: 'withdraw' }),
    );
  });

  it('shows the empty state', async () => {
    curation.fetchContested.mockResolvedValue({ data: [], meta: { nextCursor: null } });
    renderAt('/app/curation/disputed');
    expect(await screen.findByText('No open contests.')).toBeInTheDocument();
  });

  it('RFC-13 R8 a 401 on the list ends the session and returns to /', async () => {
    curation.fetchContested.mockRejectedValue(
      new ApiError(401, 'AUTH_UNAUTHENTICATED', 'Authentication required'),
    );
    const { router } = renderAt('/app/curation/disputed');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
