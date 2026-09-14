import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  CURATED_RECORD_DETAIL,
  DICTIONARY,
  MAP_RESULT,
  PENDING_GROUPS,
  PENDING_TRAITS,
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
const dataset = vi.hoisted(() => ({ fetchDictionary: vi.fn(), fetchRecord: vi.fn() }));
const curation = vi.hoisted(() => ({
  fetchPendingTraits: vi.fn(),
  fetchPendingGroups: vi.fn(),
  mapPending: vi.fn(),
  invalidateAfterRecordWrite: vi.fn(async () => undefined),
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

beforeEach(() => {
  auth.fetchMe
    .mockReset()
    .mockResolvedValue({ ...ME, permissions: ['dataset.read', 'records.create'] });
  dataset.fetchDictionary.mockReset().mockResolvedValue(DICTIONARY);
  dataset.fetchRecord.mockReset().mockResolvedValue(CURATED_RECORD_DETAIL);
  curation.fetchPendingTraits.mockReset().mockResolvedValue(PENDING_TRAITS);
  curation.fetchPendingGroups
    .mockReset()
    .mockResolvedValue({ data: PENDING_GROUPS, meta: { nextCursor: null } });
  curation.mapPending.mockReset().mockResolvedValue(MAP_RESULT);
});

describe('RFC-65 R7–R9 PendingPage', () => {
  it('lists the traits with counts, selects the first, shows its groups, opens a sample and maps a group', async () => {
    renderAt('/app/curation/pending');
    const traits = await screen.findByRole('list', { name: 'Traits with pending values' });
    expect(within(traits).getByRole('button', { name: /sexual system.*3/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(traits).getByRole('button', { name: /seed mass.*1/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(curation.fetchPendingGroups).toHaveBeenCalledWith(
        expect.objectContaining({ traitId: PENDING_TRAITS[0]?.trait.id }),
      ),
    );
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows[0]).toHaveTextContent('dioecious');
    expect(rows[0]).toHaveTextContent('2');
    await userEvent.click(
      within(rows[0] as HTMLElement).getByRole('button', { name: 'View sample' }),
    );
    expect(await screen.findByRole('dialog', { name: 'Record' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: 'Map' }));
    const dialog = await screen.findByRole('dialog', { name: /map/i });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'dioecious' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Map records' }));
    expect(await screen.findByRole('status')).toHaveTextContent('2 records created, 0 skipped');
  });

  it('switches trait on click and hides Map without records.create', async () => {
    auth.fetchMe.mockResolvedValue({ ...ME, permissions: ['dataset.read'] });
    renderAt('/app/curation/pending');
    const traits = await screen.findByRole('list', { name: 'Traits with pending values' });
    await userEvent.click(within(traits).getByRole('button', { name: /seed mass/ }));
    await waitFor(() =>
      expect(curation.fetchPendingGroups).toHaveBeenLastCalledWith(
        expect.objectContaining({ traitId: PENDING_TRAITS[1]?.trait.id }),
      ),
    );
    await screen.findAllByRole('row');
    expect(screen.queryByRole('button', { name: 'Map' })).not.toBeInTheDocument();
  });

  it('RFC-65 R8 ?traitId= opens the queue on that trait, and choosing a trait writes it to the URL', async () => {
    const seedMass = PENDING_TRAITS[1]?.trait.id ?? '';
    const { router } = renderAt(`/app/curation/pending?traitId=${seedMass}`);
    const traits = await screen.findByRole('list', { name: 'Traits with pending values' });
    expect(within(traits).getByRole('button', { name: /seed mass/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() =>
      expect(curation.fetchPendingGroups).toHaveBeenCalledWith(
        expect.objectContaining({ traitId: seedMass }),
      ),
    );
    expect(curation.fetchPendingGroups).not.toHaveBeenCalledWith(
      expect.objectContaining({ traitId: PENDING_TRAITS[0]?.trait.id }),
    );
    await userEvent.click(within(traits).getByRole('button', { name: /sexual system/ }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ traitId: PENDING_TRAITS[0]?.trait.id }),
    );
    expect(within(traits).getByRole('button', { name: /sexual system/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('RFC-65 R8 an unknown ?traitId= falls back to the first trait without touching the URL', async () => {
    const { router } = renderAt('/app/curation/pending?traitId=nope');
    const traits = await screen.findByRole('list', { name: 'Traits with pending values' });
    expect(within(traits).getByRole('button', { name: /sexual system/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(router.state.location.search).toEqual({ traitId: 'nope' });
  });

  it('offers "Manage levels" to a traits.manage holder as a link to /app/traits', async () => {
    auth.fetchMe.mockResolvedValue({
      ...ME,
      permissions: ['dataset.read', 'records.create', 'traits.manage'],
    });
    renderAt('/app/curation/pending');
    await userEvent.click(await screen.findByRole('button', { name: /sexual system/i }));
    const link = await screen.findByRole('link', { name: 'Manage levels' });
    expect(link).toHaveAttribute('href', '/app/traits');
    expect(link.className).toContain('rounded-full');
  });

  it('shows the empty state when nothing is pending', async () => {
    curation.fetchPendingTraits.mockResolvedValue([]);
    renderAt('/app/curation/pending');
    expect(await screen.findByText('Nothing is pending harmonisation.')).toBeInTheDocument();
  });

  it('RFC-13 R4 a 403 shows the permission sentence; other failures the generic one', async () => {
    curation.fetchPendingTraits.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    const first = renderAt('/app/curation/pending');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    expect(screen.queryByText('Nothing is pending harmonisation.')).not.toBeInTheDocument();
    first.unmount();

    curation.fetchPendingTraits.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    renderAt('/app/curation/pending');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });

  it('RFC-13 R8 a 401 on the list ends the session and returns to /', async () => {
    curation.fetchPendingTraits.mockRejectedValue(
      new ApiError(401, 'AUTH_UNAUTHENTICATED', 'Authentication required'),
    );
    const { router } = renderAt('/app/curation/pending');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
