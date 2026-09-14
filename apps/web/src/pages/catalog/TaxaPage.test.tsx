import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { FAMILIES, FAMILY, GENERA, GENUS, MALVACEAE } from '../../test/dataset-fixtures.ts';
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
const dataset = vi.hoisted(() => ({ fetchFamilies: vi.fn(), fetchGenera: vi.fn() }));
const catalog = vi.hoisted(() => ({
  createFamily: vi.fn(),
  updateFamily: vi.fn(),
  createGenus: vi.fn(),
  updateGenus: vi.fn(),
}));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));
vi.mock('../../api/catalog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/catalog.ts')>()),
  ...catalog,
}));

beforeEach(() => {
  auth.fetchMe
    .mockReset()
    .mockResolvedValue({ ...ME, permissions: ['dataset.read', 'taxa.manage'] });
  dataset.fetchFamilies.mockReset().mockResolvedValue(FAMILIES);
  dataset.fetchGenera
    .mockReset()
    .mockResolvedValue({ data: [GENERA[0]], meta: { nextCursor: null } });
  catalog.createFamily.mockReset();
  catalog.updateFamily.mockReset();
  catalog.createGenus.mockReset();
  catalog.updateGenus.mockReset();
});

describe('RFC-60 R9 TaxaPage', () => {
  it('lists the families, selects the first, and lists its genera with the family column', async () => {
    renderAt('/app/taxa');
    expect(
      await screen.findByRole('button', { name: /Fabaceae/, pressed: true }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Malvaceae/, pressed: false })).toBeInTheDocument();
    await waitFor(() =>
      expect(dataset.fetchGenera).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: FAMILY.id }),
      ),
    );
    const row = (await screen.findAllByRole('row'))[1] as HTMLElement;
    expect(within(row).getByText('Adenanthera')).toBeInTheDocument();
    expect(within(row).getByText('Fabaceae')).toBeInTheDocument();
  });

  it('filters families client-side and switches the genera list on selection', async () => {
    renderAt('/app/taxa');
    await screen.findByRole('button', { name: /Fabaceae/ });
    await userEvent.type(screen.getByRole('searchbox', { name: /filter families/i }), 'malv');
    expect(screen.queryByRole('button', { name: /Fabaceae/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Malvaceae/ }));
    await waitFor(() =>
      expect(dataset.fetchGenera).toHaveBeenLastCalledWith(
        expect.objectContaining({ familyId: MALVACEAE.id }),
      ),
    );
    expect(screen.getByRole('heading', { name: 'Malvaceae' })).toBeInTheDocument();
  });

  it('searches genera across every family when a term is typed', async () => {
    dataset.fetchGenera.mockResolvedValue({ data: GENERA, meta: { nextCursor: null } });
    renderAt('/app/taxa');
    await screen.findByRole('button', { name: /Fabaceae/ });
    await userEvent.type(screen.getByRole('searchbox', { name: /search genera/i }), 'Adan');
    await waitFor(() =>
      expect(dataset.fetchGenera).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Adan' })),
    );
    expect(dataset.fetchGenera.mock.calls.at(-1)?.[0]).not.toHaveProperty('familyId');
    expect(
      await screen.findByRole('heading', { name: 'Genera matching “Adan”' }),
    ).toBeInTheDocument();
    const rows = await screen.findAllByRole('row');
    // Adansonia has no family.
    expect(within(rows[2] as HTMLElement).getByText('—')).toBeInTheDocument();
  });

  it('creates a family, renames the selected one, creates and renames a genus, moves a genus', async () => {
    catalog.createFamily.mockResolvedValue({ id: 'f-new', name: 'Novaceae' });
    catalog.updateFamily.mockResolvedValue({ ...FAMILY, name: 'Fabaceae s.l.' });
    catalog.createGenus.mockResolvedValue({ id: 'g-new', name: 'Novus', family: FAMILY });
    catalog.updateGenus.mockResolvedValue({ ...GENUS, name: 'Adenantherum', family: FAMILY });
    renderAt('/app/taxa');
    await screen.findByRole('button', { name: /Fabaceae/ });
    await userEvent.click(screen.getByRole('button', { name: 'New family' }));
    await userEvent.type(
      within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Family name' }),
      'Novaceae',
    );
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Create' }),
    );
    await waitFor(() => expect(catalog.createFamily).toHaveBeenCalledWith({ name: 'Novaceae' }));
    // Each dialog unmounts on success; waiting for that makes the intent
    // explicit and keeps the next `getByRole('dialog')` from racing it.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(await screen.findByRole('button', { name: 'Rename family' }));
    const rename = within(screen.getByRole('dialog', { name: 'Rename family' })).getByRole(
      'textbox',
      { name: 'Family name' },
    );
    await userEvent.type(rename, ' s.l.');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() =>
      expect(catalog.updateFamily).toHaveBeenCalledWith(FAMILY.id, { name: 'Fabaceae s.l.' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(await screen.findByRole('button', { name: 'New genus' }));
    await userEvent.type(
      within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Genus name' }),
      'Novus',
    );
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Create' }),
    );
    await waitFor(() =>
      expect(catalog.createGenus).toHaveBeenCalledWith({ name: 'Novus', familyId: FAMILY.id }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Adenanthera' }));
    const renameGenus = within(screen.getByRole('dialog', { name: 'Rename genus' })).getByRole(
      'textbox',
      { name: 'Genus name' },
    );
    await userEvent.clear(renameGenus);
    await userEvent.type(renameGenus, 'Adenantherum');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() =>
      expect(catalog.updateGenus).toHaveBeenCalledWith(GENUS.id, { name: 'Adenantherum' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(await screen.findByRole('button', { name: 'Move Adenanthera' }));
    await userEvent.selectOptions(
      within(screen.getByRole('dialog')).getByRole('combobox', { name: /family/i }),
      MALVACEAE.id,
    );
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(catalog.updateGenus).toHaveBeenCalledWith(GENUS.id, { familyId: MALVACEAE.id }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('says so when there is no family yet, and still offers New family', async () => {
    dataset.fetchFamilies.mockResolvedValue([]);
    renderAt('/app/taxa');
    expect(await screen.findByText('No family yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New family' })).toBeInTheDocument();
  });

  it('RFC-13 R3 shows the permission sentence without taxa.manage', async () => {
    auth.fetchMe.mockResolvedValue({ ...ME, permissions: ['dataset.read'] });
    renderAt('/app/taxa');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open this area.',
    );
    expect(dataset.fetchFamilies).not.toHaveBeenCalled();
  });

  it('RFC-13 R4 a 403 on the families shows the permission sentence', async () => {
    dataset.fetchFamilies.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    renderAt('/app/taxa');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    expect(screen.queryByText('No family yet.')).not.toBeInTheDocument();
  });

  it('RFC-13 R4 a 401 ends the session and returns to /', async () => {
    dataset.fetchFamilies.mockRejectedValue(
      new ApiError(401, 'AUTH_UNAUTHENTICATED', 'Authentication required'),
    );
    const { router } = renderAt('/app/taxa');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
