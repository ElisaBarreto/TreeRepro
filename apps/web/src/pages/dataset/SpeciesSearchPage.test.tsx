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
  unresolvedTaxon: false,
};
const ADANSONIA: SpeciesListItem = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d04',
  canonicalName: 'Adansonia digitata',
  nameSource: 'gbif',
  genus: null,
  family: null,
  matchedName: 'Adansonia baobab',
  unresolvedTaxon: true,
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
  it('lists the first page at once and searches again once the typing settles', async () => {
    dataset.searchSpecies.mockResolvedValue(page([ADENANTHERA, ADANSONIA]));
    await openPage();
    const link = await screen.findByRole('link', { name: 'Adenanthera pavonina' });
    expect(dataset.searchSpecies).toHaveBeenCalledWith({
      q: undefined,
      familyId: undefined,
      genusId: undefined,
      unresolved: false,
      cursor: undefined,
      limit: 50,
    });
    expect(dataset.searchSpecies).toHaveBeenCalledTimes(1);
    expect(link).toHaveAttribute('href', `/app/species/${ADENANTHERA.id}`);
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('Fabaceae');
    expect(rows[1]).toHaveTextContent('Adenanthera');
    expect(within(rows[1] as HTMLElement).queryByText('unresolved')).not.toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('matched: Adansonia baobab');
    expect(within(rows[2] as HTMLElement).getByText('unresolved')).toBeInTheDocument();
    const pagination = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(pagination).getByText('Page 1')).toBeInTheDocument();
    expect(within(pagination).getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(within(pagination).getByRole('button', { name: 'Previous' })).toBeDisabled();

    // One letter is below the API's minimum and asks for nothing new.
    await userEvent.type(screen.getByLabelText('Search species'), 'a');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(dataset.searchSpecies).toHaveBeenCalledTimes(1);

    await userEvent.type(screen.getByLabelText('Search species'), 'd');
    await waitFor(() =>
      expect(dataset.searchSpecies).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'ad', cursor: undefined, limit: 50 }),
      ),
    );
    expect(dataset.searchSpecies).toHaveBeenCalledTimes(2);
  });

  it('says so when nothing matches, and only once the page arrived', async () => {
    let resolvePage: (value: ReturnType<typeof page>) => void = () => {};
    dataset.searchSpecies.mockReturnValue(
      new Promise<ReturnType<typeof page>>((resolve) => {
        resolvePage = resolve;
      }),
    );
    await openPage();
    expect(screen.getByText('Searching…')).toBeInTheDocument();
    expect(screen.queryByText('No species match.')).not.toBeInTheDocument();

    resolvePage(page([]));
    expect(await screen.findByText('No species match.')).toBeInTheDocument();
    expect(screen.queryByText('Searching…')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  it('steps to the next page with the cursor and back to the first', async () => {
    dataset.searchSpecies
      .mockResolvedValueOnce(page([ADENANTHERA], 'c1'))
      .mockResolvedValueOnce(page([ADANSONIA]))
      .mockResolvedValue(page([ADENANTHERA], 'c1'));
    await openPage();
    expect(await screen.findByRole('link', { name: 'Adenanthera pavonina' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('link', { name: 'Adansonia digitata' })).toBeInTheDocument();
    expect(dataset.searchSpecies).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: undefined, cursor: 'c1', limit: 50 }),
    );
    expect(screen.queryByRole('link', { name: 'Adenanthera pavonina' })).not.toBeInTheDocument();
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByRole('link', { name: 'Adenanthera pavonina' })).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('a new filter starts over at page 1, and the page size is applied from page 1', async () => {
    dataset.searchSpecies.mockResolvedValue(page([ADENANTHERA], 'c1'));
    await openPage();
    await screen.findByRole('link', { name: 'Adenanthera pavonina' });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(dataset.searchSpecies).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: 'c1' }),
      ),
    );
    expect(screen.getByText('Page 2')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Unresolved taxa only'));
    await waitFor(() =>
      expect(dataset.searchSpecies).toHaveBeenLastCalledWith(
        expect.objectContaining({ unresolved: true, cursor: undefined, limit: 50 }),
      ),
    );
    expect(screen.getByText('Page 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Rows per page'), '25');
    await waitFor(() =>
      expect(dataset.searchSpecies).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: undefined, limit: 25 }),
      ),
    );
    expect(screen.getByText('Page 1')).toBeInTheDocument();
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
    await waitFor(() =>
      expect(dataset.searchSpecies).toHaveBeenLastCalledWith(
        expect.objectContaining({ genusId: undefined }),
      ),
    );
  });

  it('RFC-13 R4 a 403 shows the permission sentence; other failures the generic one', async () => {
    dataset.searchSpecies.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    const first = await openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    expect(screen.queryByText('No species match.')).not.toBeInTheDocument();
    first.unmount();

    dataset.searchSpecies.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    await openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });

  it('RFC-13 R8 a 401 on the list ends the session and returns to /', async () => {
    dataset.searchSpecies.mockRejectedValue(
      new ApiError(401, 'AUTH_UNAUTHENTICATED', 'Authentication required'),
    );
    const { router } = renderAt('/app/species');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('RFC-13 R3 the Species entry appears in the navigation only with dataset.read', async () => {
    dataset.searchSpecies.mockResolvedValue(page([]));
    const withPermission = await openPage();
    const main = screen.getByRole('navigation', { name: 'Data' });
    expect(within(main).getByRole('link', { name: 'Species' })).toHaveAttribute(
      'href',
      '/app/species',
    );
    expect(within(main).queryByRole('link', { name: 'Imports' })).not.toBeInTheDocument();
    withPermission.unmount();

    auth.fetchMe.mockResolvedValue(ME);
    await openPage();
    // Without a dataset entry the Data group is not rendered at all.
    expect(screen.queryByRole('navigation', { name: 'Data' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Species' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('RFC-60 R6 reads ?unresolved=true into the toggle and sends it on the first search', async () => {
    dataset.searchSpecies.mockResolvedValue(page([]));
    renderAt('/app/species?unresolved=true');
    expect(await screen.findByRole('checkbox', { name: /unresolved/i })).toBeChecked();
    await waitFor(() =>
      expect(dataset.searchSpecies).toHaveBeenLastCalledWith(
        expect.objectContaining({ unresolved: true }),
      ),
    );
  });

  it('RFC-60 R6 switches between Species and Unresolved taxa through the navigation while already on the page', async () => {
    dataset.searchSpecies.mockResolvedValue(page([]));
    await openPage();
    const checkbox = screen.getByRole('checkbox', { name: /unresolved/i });
    expect(checkbox).not.toBeChecked();

    await userEvent.click(screen.getByRole('link', { name: 'Unresolved taxa' }));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /unresolved/i })).toBeChecked(),
    );
    await waitFor(() =>
      expect(dataset.searchSpecies).toHaveBeenLastCalledWith(
        expect.objectContaining({ unresolved: true }),
      ),
    );

    await userEvent.click(screen.getByRole('link', { name: 'Species' }));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /unresolved/i })).not.toBeChecked(),
    );
    await waitFor(() =>
      expect(dataset.searchSpecies).toHaveBeenLastCalledWith(
        expect.objectContaining({ unresolved: false }),
      ),
    );
  });

  it('RFC-66 R1 shows the export link only with dataset.export', async () => {
    dataset.searchSpecies.mockResolvedValue(page([]));
    auth.fetchMe.mockResolvedValue({ ...ME, permissions: ['dataset.read', 'dataset.export'] });
    renderAt('/app/species');
    const link = await screen.findByRole('link', { name: /export accepted values/i });
    expect(link).toHaveAttribute('href', '/api/export/accepted.csv');
    expect(link).toHaveAttribute('download');
  });

  it('hides the export link without dataset.export', async () => {
    dataset.searchSpecies.mockResolvedValue(page([]));
    await openPage();
    await screen.findByRole('heading', { level: 1, name: 'Species' });
    expect(screen.queryByRole('link', { name: /export accepted values/i })).not.toBeInTheDocument();
  });
});
