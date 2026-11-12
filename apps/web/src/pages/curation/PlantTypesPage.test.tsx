import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlantTypeQueueItem } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
const catalog = vi.hoisted(() => ({
  fetchPlantTypeQueue: vi.fn(),
  confirmPlantType: vi.fn(),
}));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/catalog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/catalog.ts')>()),
  ...catalog,
}));

const HERB: PlantTypeQueueItem = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f01',
  canonicalName: 'Herba nova',
  genus: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f02', name: 'Herba' },
  family: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f03', name: 'Poaceae' },
  plantType: 'not_tree',
  createdBy: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f04', name: 'Grace' },
  createdAt: '2026-11-10T12:00:00.000Z',
  note: 'Seen in the field',
};

beforeEach(() => {
  auth.fetchMe
    .mockReset()
    .mockResolvedValue({ ...ME, permissions: ['dataset.read', 'records.review'] });
  catalog.fetchPlantTypeQueue
    .mockReset()
    .mockResolvedValue({ data: [HERB], meta: { nextCursor: null } });
  catalog.confirmPlantType
    .mockReset()
    .mockResolvedValue({ id: HERB.id, plantType: 'not_tree', plantTypeStatus: 'reviewed' });
});

describe('RFC-65 R20 PlantTypesPage is the plant-type review queue', () => {
  it('lists each species with its taxa, stated type, proposer, date and note', async () => {
    renderAt('/app/curation/plant-types');
    expect(await screen.findByRole('heading', { name: 'Plant types' })).toBeInTheDocument();
    const row = (await screen.findAllByRole('row'))[1] as HTMLElement;
    expect(row).toHaveTextContent('Herba nova');
    expect(row).toHaveTextContent('Poaceae');
    expect(row).toHaveTextContent('Not a tree');
    expect(row).toHaveTextContent('Grace');
    expect(row).toHaveTextContent('2026-11-10');
    expect(row).toHaveTextContent('Seen in the field');
  });

  it('Confirm keeps the stated type', async () => {
    renderAt('/app/curation/plant-types');
    const row = (await screen.findAllByRole('row'))[1] as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(catalog.confirmPlantType).toHaveBeenCalledWith(HERB.id, undefined));
    await waitFor(() => expect(catalog.fetchPlantTypeQueue).toHaveBeenCalledTimes(2));
  });

  it('Change type and confirm asks for the type, the stated one preselected', async () => {
    renderAt('/app/curation/plant-types');
    const row = (await screen.findAllByRole('row'))[1] as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Change type and confirm' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change type and confirm' });
    const select = within(dialog).getByLabelText('Plant type');
    expect(select).toHaveValue('not_tree');
    await userEvent.selectOptions(select, 'tree');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(catalog.confirmPlantType).toHaveBeenCalledWith(HERB.id, 'tree'));
  });

  it('says so when no species awaits a review', async () => {
    catalog.fetchPlantTypeQueue.mockResolvedValue({ data: [], meta: { nextCursor: null } });
    renderAt('/app/curation/plant-types');
    expect(
      await screen.findByText('No species is waiting for a plant-type review.'),
    ).toBeInTheDocument();
  });
});
