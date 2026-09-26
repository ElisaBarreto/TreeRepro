import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordItem, TraitSummary } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PENDING_RECORD,
  RECORD,
  SEED_MASS_SUMMARY,
  SEXUAL_SYSTEM_SUMMARY,
  SPECIES,
} from '../../test/dataset-fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { withRouter } from '../../test/router.tsx';
import { TraitPanel } from './TraitPanel.tsx';

const dataset = vi.hoisted(() => ({ fetchRecords: vi.fn() }));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

const MASS: RecordItem = {
  ...PENDING_RECORD,
  recordCode: 'TR_7',
  level: null,
  quantitative: { single: 1.5 },
};
const page = (data: RecordItem[]) => ({ data, meta: { nextCursor: null } });

beforeEach(() => {
  dataset.fetchRecords.mockReset().mockResolvedValue(page([MASS]));
});

function mount(summary: TraitSummary, props: Partial<Parameters<typeof TraitPanel>[0]> = {}) {
  renderWithProviders(
    withRouter(
      <TraitPanel
        speciesId={SPECIES.id}
        summary={summary}
        onClose={vi.fn()}
        onSelectRecord={vi.fn()}
        {...props}
      />,
    ),
  );
}

describe('RFC-63 R9 TraitPanel sorting', () => {
  it('asks for the newest first, then re-sorts on the server from a header', async () => {
    mount(SEED_MASS_SUMMARY);
    const panel = await screen.findByRole('dialog', { name: 'seed mass' });
    await waitFor(() =>
      expect(dataset.fetchRecords).toHaveBeenCalledWith({
        speciesId: SPECIES.id,
        traitId: SEED_MASS_SUMMARY.trait.id,
        sort: 'added',
        order: 'desc',
        cursor: undefined,
        limit: 50,
      }),
    );
    expect(await within(panel).findByRole('columnheader', { name: 'Added' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Value' }));
    await waitFor(() =>
      expect(dataset.fetchRecords).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'value', order: 'asc' }),
      ),
    );
    expect(within(panel).getByRole('columnheader', { name: 'Value' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Value' }));
    await waitFor(() =>
      expect(dataset.fetchRecords).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'value', order: 'desc' }),
      ),
    );
  });
});

describe('spec §2 TraitPanel row actions', () => {
  it('puts Validate, Contest and Complement on each row of a quantitative trait', async () => {
    const onValidateRecord = vi.fn();
    const onRespondRecord = vi.fn();
    mount(SEED_MASS_SUMMARY, { onValidateRecord, onRespondRecord });
    const panel = await screen.findByRole('dialog', { name: 'seed mass' });
    await userEvent.click(await within(panel).findByRole('button', { name: 'Validate TR_7' }));
    expect(onValidateRecord).toHaveBeenCalledWith(MASS);
    await userEvent.click(within(panel).getByRole('button', { name: 'Contest TR_7' }));
    expect(onRespondRecord).toHaveBeenLastCalledWith(MASS, 'contest');
    await userEvent.click(within(panel).getByRole('button', { name: 'Complement TR_7' }));
    expect(onRespondRecord).toHaveBeenLastCalledWith(MASS, 'complement');
  });

  it('offers only what the viewer may do', async () => {
    mount(SEED_MASS_SUMMARY, { onValidateRecord: vi.fn() });
    const panel = await screen.findByRole('dialog', { name: 'seed mass' });
    expect(await within(panel).findByRole('button', { name: 'Validate TR_7' })).toBeVisible();
    expect(within(panel).queryByRole('button', { name: 'Contest TR_7' })).not.toBeInTheDocument();
  });

  it('hides Validate on the viewer’s own row, but keeps it on someone else’s (spec R-6)', async () => {
    const theirs: RecordItem = {
      ...MASS,
      id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e98',
      recordCode: 'TR_8',
      createdBy: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e99', name: 'Grace' },
    };
    dataset.fetchRecords.mockResolvedValue(page([MASS, theirs]));
    mount(SEED_MASS_SUMMARY, {
      onValidateRecord: vi.fn(),
      isOwnRecord: (record) => record.createdBy?.id === MASS.createdBy?.id,
    });
    const panel = await screen.findByRole('dialog', { name: 'seed mass' });
    expect(await within(panel).findByRole('button', { name: 'Validate TR_8' })).toBeVisible();
    expect(within(panel).queryByRole('button', { name: 'Validate TR_7' })).not.toBeInTheDocument();
  });

  it('leaves the rows of a categorical trait alone: its levels carry the actions on the card', async () => {
    dataset.fetchRecords.mockResolvedValue(page([{ ...RECORD, recordCode: 'EB_1' }]));
    mount(SEXUAL_SYSTEM_SUMMARY, { onValidateRecord: vi.fn(), onRespondRecord: vi.fn() });
    const panel = await screen.findByRole('dialog', { name: 'sexual system' });
    await within(panel).findByRole('button', { name: 'dioecious' });
    expect(within(panel).queryByRole('button', { name: /^Validate/ })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });
});
