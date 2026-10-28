import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordGroup, RecordItem, TraitSummary } from '@treerepro/contracts';
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

const dataset = vi.hoisted(() => ({ fetchRecords: vi.fn(), fetchRecordGroups: vi.fn() }));
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

const GIFT = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d01',
  citationKey: 'Weigelt_et_al_2020',
  kind: 'publication' as const,
  observer: null,
  shortCitation: 'Weigelt et al. 2020',
};
const [DIOECIOUS, MONOECIOUS] = SEXUAL_SYSTEM_SUMMARY.levels ?? [];
const SEVERAL: RecordGroup = {
  level: { id: DIOECIOUS?.levelId ?? '', key: 'dioecious' },
  secondaryReference: GIFT,
  recordCode: 'EB_1',
  origin: 'import',
  harmonisation: 'harmonised',
  createdAt: '2026-10-28T00:00:00.000Z',
  nRecords: 3,
  nReferences: 2,
  validationCount: 1,
  contestCount: 0,
  contested: false,
  record: null,
};
const ALONE: RecordGroup = {
  level: { id: MONOECIOUS?.levelId ?? '', key: 'monoecious' },
  secondaryReference: null,
  recordCode: 'EB_9',
  origin: 'import',
  harmonisation: 'harmonised',
  createdAt: '2026-10-28T00:00:00.000Z',
  nRecords: 1,
  nReferences: 1,
  validationCount: 0,
  contestCount: 0,
  contested: false,
  record: {
    ...RECORD,
    recordCode: 'EB_9',
    level: { id: MONOECIOUS?.levelId ?? '', key: 'monoecious' },
  },
};
const groups = (data: RecordGroup[]) => ({ data, meta: { nextCursor: null } });

beforeEach(() => {
  dataset.fetchRecords.mockReset().mockResolvedValue(page([MASS]));
  dataset.fetchRecordGroups.mockReset().mockResolvedValue(groups([SEVERAL, ALONE]));
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
    mount(SEXUAL_SYSTEM_SUMMARY, { onValidateRecord: vi.fn(), onRespondRecord: vi.fn() });
    const panel = await screen.findByRole('dialog', { name: 'sexual system' });
    await within(panel).findByText('EB_9');
    expect(within(panel).queryByRole('button', { name: /^Validate/ })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });
});

describe('RFC-63 R18 TraitPanel of a categorical trait: one table of groups (issue #349)', () => {
  it('shows a lone record as its row and a group of several as an expandable row of totals', async () => {
    dataset.fetchRecords.mockResolvedValue(
      page([
        { ...RECORD, recordCode: 'EB_1', alsoReportedBy: 'Kleyer et al., 2008' },
        { ...RECORD, id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d02', recordCode: 'EB_2' },
      ]),
    );
    mount(SEXUAL_SYSTEM_SUMMARY);
    const panel = await screen.findByRole('dialog', { name: 'sexual system' });
    expect(within(panel).getByText('6 references')).toBeInTheDocument();
    await waitFor(() =>
      expect(dataset.fetchRecordGroups).toHaveBeenCalledWith({
        speciesId: SPECIES.id,
        traitId: SEXUAL_SYSTEM_SUMMARY.trait.id,
        dispersalPhase: undefined,
        cursor: undefined,
        limit: 50,
      }),
    );
    expect(await within(panel).findByText('EB_9')).toBeInTheDocument();
    const group = within(panel).getByRole('button', { name: /3 entries/ });
    expect(group).toHaveAttribute('aria-expanded', 'false');
    const row = group.closest('tr') as HTMLElement;
    expect(within(row).getByText('dioecious')).toBeInTheDocument();
    expect(within(row).getByText('2 references')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Weigelt et al. 2020' })).toBeInTheDocument();
    // a group's entries are fetched only once it opens
    expect(dataset.fetchRecords).not.toHaveBeenCalled();
    await userEvent.click(group);
    expect(group).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() =>
      expect(dataset.fetchRecords).toHaveBeenCalledWith({
        speciesId: SPECIES.id,
        traitId: SEXUAL_SYSTEM_SUMMARY.trait.id,
        dispersalPhase: undefined,
        levelId: DIOECIOUS?.levelId,
        secondaryReferenceId: GIFT.id,
        limit: 200,
      }),
    );
    expect(await within(panel).findByText('EB_1')).toBeInTheDocument();
    expect(within(panel).getByText('EB_2')).toBeInTheDocument();
    expect(within(panel).getByText('Also reported by Kleyer et al., 2008')).toBeInTheDocument();
    await userEvent.click(group);
    expect(within(panel).queryByText('EB_1')).not.toBeInTheDocument();
  });

  it('sorts the groups from any header: a new column ascending, the same one again descending (issue #351)', async () => {
    mount(SEXUAL_SYSTEM_SUMMARY);
    const panel = await screen.findByRole('dialog', { name: 'sexual system' });
    const row = (await within(panel).findByRole('button', { name: /3 entries/ })).closest(
      'tr',
    ) as HTMLElement;
    expect(row).toHaveTextContent('from EB_1');
    expect(row).toHaveTextContent('import');
    expect(row).toHaveTextContent('2026-10-28');
    await userEvent.click(within(panel).getByRole('button', { name: /^References/ }));
    await waitFor(() =>
      expect(dataset.fetchRecordGroups).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'references', order: 'asc' }),
      ),
    );
    await userEvent.click(within(panel).getByRole('button', { name: /^References/ }));
    await waitFor(() =>
      expect(dataset.fetchRecordGroups).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'references', order: 'desc' }),
      ),
    );
    for (const name of [
      'ID',
      'Value',
      'Secondary article',
      'Origin',
      'Harmonisation',
      'Counts',
      'Added',
    ]) {
      expect(
        within(panel).getByRole('button', { name: new RegExp(`^${name}`) }),
      ).toBeInTheDocument();
    }
  });

  it('opens a group with no secondary article on the records that have none', async () => {
    dataset.fetchRecordGroups.mockResolvedValue(groups([{ ...SEVERAL, secondaryReference: null }]));
    mount(SEXUAL_SYSTEM_SUMMARY);
    const panel = await screen.findByRole('dialog', { name: 'sexual system' });
    await userEvent.click(await within(panel).findByRole('button', { name: /3 entries/ }));
    await waitFor(() =>
      expect(dataset.fetchRecords).toHaveBeenCalledWith(
        expect.objectContaining({ secondaryReferenceId: 'none' }),
      ),
    );
  });

  it('opens a record from its row', async () => {
    const onSelectRecord = vi.fn();
    mount(SEXUAL_SYSTEM_SUMMARY, { onSelectRecord });
    const panel = await screen.findByRole('dialog', { name: 'sexual system' });
    await within(panel).findByText('EB_9');
    await userEvent.click(within(panel).getByRole('button', { name: 'monoecious' }));
    expect(onSelectRecord).toHaveBeenCalledWith(RECORD.id);
  });

  it('offers a dispersal-phase filter on a dispersal trait only, and applies it to the groups', async () => {
    mount(SEXUAL_SYSTEM_SUMMARY, { dispersal: true });
    const panel = await screen.findByRole('dialog', { name: 'sexual system' });
    await userEvent.selectOptions(
      within(panel).getByRole('combobox', { name: 'Dispersal phase' }),
      'secondary',
    );
    await waitFor(() =>
      expect(dataset.fetchRecordGroups).toHaveBeenLastCalledWith(
        expect.objectContaining({ dispersalPhase: 'secondary' }),
      ),
    );
  });

  it('has no dispersal-phase filter on another trait', async () => {
    mount(SEXUAL_SYSTEM_SUMMARY);
    const panel = await screen.findByRole('dialog', { name: 'sexual system' });
    expect(
      within(panel).queryByRole('combobox', { name: 'Dispersal phase' }),
    ).not.toBeInTheDocument();
  });
});
