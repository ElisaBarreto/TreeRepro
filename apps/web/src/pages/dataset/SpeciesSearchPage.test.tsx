import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse, SpeciesListItem } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { ME } from '../../test/fixtures.ts';
import { renderAt } from '../../test/router.tsx';

const auth = vi.hoisted(() => ({
  login: vi.fn(),
  loginTotp: vi.fn(),
  fetchMe: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
  changePassword: vi.fn(),
  totpSetup: vi.fn(),
  totpConfirm: vi.fn(),
  totpDisable: vi.fn(),
}));
const dataset = vi.hoisted(() => ({
  searchSpecies: vi.fn(),
  fetchFamilies: vi.fn(),
  fetchGenera: vi.fn(),
}));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

const READER: MeResponse = { ...ME, permissions: ['dataset.read'] };
const FAMILY = { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d01', name: 'Fabaceae' };
const GENUS = { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d02', name: 'Adenanthera', family: FAMILY };
const ADENANTHERA: SpeciesListItem = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d03',
  canonicalName: 'Adenanthera pavonina',
  nameSource: 'wcvp',
  genus: { id: GENUS.id, name: GENUS.name },
  family: FAMILY,
  matchedName: null,
};
const ADANSONIA: SpeciesListItem = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d04',
  canonicalName: 'Adansonia digitata',
  nameSource: 'gbif',
  genus: null,
  family: null,
  matchedName: 'Adansonia baobab',
};
const page = (data: SpeciesListItem[], nextCursor: string | null = null) => ({
  data,
  meta: { nextCursor },
});

beforeEach(() => {
  auth.fetchMe.mockReset();
  dataset.searchSpecies.mockReset();
  dataset.fetchFamilies.mockReset();
  dataset.fetchGenera.mockReset();
  auth.fetchMe.mockResolvedValue(READER);
  dataset.fetchFamilies.mockResolvedValue([FAMILY]);
  dataset.fetchGenera.mockResolvedValue({ data: [GENUS], meta: { nextCursor: null } });
});

async function openPage() {
  const utils = renderAt('/app/species');
  expect(await screen.findByRole('heading', { name: 'Species' })).toBeInTheDocument();
  return utils;
}

describe('RFC-13 R2, RFC-60 R6 SpeciesSearchPage', () => {
  it('waits for two letters, searches once the typing settles and lists the rows', async () => {
    dataset.searchSpecies.mockResolvedValue(page([ADENANTHERA, ADANSONIA]));
    await openPage();
    expect(
      screen.getByText('Type at least two letters, or choose a family or genus.'),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Search species'), 'ad');
    await waitFor(() =>
      expect(dataset.searchSpecies).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'ad', cursor: undefined, limit: 50 }),
      ),
    );
    expect(dataset.searchSpecies).toHaveBeenCalledTimes(1);

    const link = await screen.findByRole('link', { name: 'Adenanthera pavonina' });
    expect(link).toHaveAttribute('href', `/app/species/${ADENANTHERA.id}`);
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('Fabaceae');
    expect(rows[1]).toHaveTextContent('Adenanthera');
    expect(within(rows[1] as HTMLElement).queryByText('unresolved')).not.toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('matched: Adansonia baobab');
    expect(within(rows[2] as HTMLElement).getByText('unresolved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    dataset.searchSpecies.mockResolvedValue(page([]));
    await openPage();
    await userEvent.type(screen.getByLabelText('Search species'), 'zz');
    expect(await screen.findByText('No species match.')).toBeInTheDocument();
  });

  it('loads the next page with the cursor on "Load more"', async () => {
    dataset.searchSpecies
      .mockResolvedValueOnce(page([ADENANTHERA], 'c1'))
      .mockResolvedValueOnce(page([ADANSONIA]));
    await openPage();
    await userEvent.type(screen.getByLabelText('Search species'), 'ad');
    expect(await screen.findByRole('link', { name: 'Adenanthera pavonina' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('link', { name: 'Adansonia digitata' })).toBeInTheDocument();
    expect(dataset.searchSpecies).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'ad', cursor: 'c1', limit: 50 }),
    );
    expect(screen.getByRole('link', { name: 'Adenanthera pavonina' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('searches by family and by unresolved taxa without a term', async () => {
    dataset.searchSpecies.mockResolvedValue(page([ADANSONIA]));
    await openPage();
    await userEvent.selectOptions(
      screen.getByLabelText('Family'),
      await screen.findByRole('option', { name: 'Fabaceae' }),
    );
    await waitFor(() =>
      expect(dataset.searchSpecies).toHaveBeenLastCalledWith(
        expect.objectContaining({ familyId: FAMILY.id, q: undefined, unresolved: false }),
      ),
    );

    await userEvent.click(screen.getByLabelText('Unresolved taxa only'));
    await waitFor(() =>
      expect(dataset.searchSpecies).toHaveBeenLastCalledWith(
        expect.objectContaining({ familyId: FAMILY.id, unresolved: true }),
      ),
    );
  });

  it('suggests genera for the typed prefix, filters by the chosen one and clears it', async () => {
    dataset.searchSpecies.mockResolvedValue(page([ADENANTHERA]));
    await openPage();
    const genus = screen.getByLabelText('Genus');
    await userEvent.type(genus, 'Ad');
    await waitFor(() =>
      expect(dataset.fetchGenera).toHaveBeenLastCalledWith({
        familyId: undefined,
        q: 'Ad',
        limit: 20,
      }),
    );
    const listbox = await screen.findByRole('listbox');
    await userEvent.click(within(listbox).getByRole('option', { name: /Adenanthera/ }));
    await waitFor(() =>
      expect(dataset.searchSpecies).toHaveBeenLastCalledWith(
        expect.objectContaining({ genusId: GENUS.id }),
      ),
    );
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByText('Adenanthera', { selector: 'span' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear genus' }));
    expect(screen.queryByRole('button', { name: 'Clear genus' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Genus')).toHaveValue('');
    expect(
      await screen.findByText('Type at least two letters, or choose a family or genus.'),
    ).toBeInTheDocument();
  });

  it('RFC-13 R4 a 403 shows the permission sentence; other failures the generic one', async () => {
    dataset.searchSpecies.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    const first = await openPage();
    await userEvent.type(screen.getByLabelText('Search species'), 'ad');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    first.unmount();

    dataset.searchSpecies.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    await openPage();
    await userEvent.type(screen.getByLabelText('Search species'), 'ad');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });

  it('RFC-13 R3 the Species entry appears in the navigation only with dataset.read', async () => {
    const withPermission = await openPage();
    const main = screen.getByRole('navigation', { name: 'Main' });
    expect(within(main).getByRole('link', { name: 'Species' })).toHaveAttribute(
      'href',
      '/app/species',
    );
    expect(within(main).queryByRole('link', { name: 'Imports' })).not.toBeInTheDocument();
    withPermission.unmount();

    auth.fetchMe.mockResolvedValue(ME);
    await openPage();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'Species' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });
});
