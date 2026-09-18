import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { SEXUAL_SYSTEM_TRAIT } from '../../test/dataset-fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { LevelsEditor } from './LevelsEditor.tsx';

const catalog = vi.hoisted(() => ({
  createLevel: vi.fn(),
  updateLevel: vi.fn(),
  invalidateAfterCatalogWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/catalog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/catalog.ts')>()),
  ...catalog,
}));

beforeEach(() => {
  catalog.createLevel.mockReset();
  catalog.updateLevel.mockReset();
  catalog.invalidateAfterCatalogWrite.mockClear();
});

describe('RFC-62 R6 LevelsEditor', () => {
  it('renders the levels in order, inactive struck through, with no controls for a reader', () => {
    renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage={false} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'hermaphrodite',
      'dioecious',
      'polygamous (inactive)',
    ]);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('wraps the levels in a row for a reader and gives each a line of its own to manage', () => {
    // Spec §6 asks for chips wrapping in rows. With `traits.manage` each
    // level also carries Rename, Move up, Move down and Deactivate, which do
    // not fit beside a chip, so the row becomes a column — the one place the
    // two viewers differ, pinned here so the divergence stays deliberate.
    const label = `Levels of ${SEXUAL_SYSTEM_TRAIT.key.replaceAll('_', ' ')}`;
    const reader = renderWithProviders(
      <LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage={false} />,
    );
    const row = screen.getByRole('list', { name: label });
    expect(row.className).toContain('flex-wrap');
    expect(within(row).getByText('hermaphrodite').className).toContain('rounded-full');
    // A fresh render, not a rerender: the editor needs its query provider,
    // which `rerender` would drop.
    reader.unmount();

    renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage />);
    const list = screen.getByRole('list', { name: label });
    expect(list.className).toContain('flex-col');
    expect(list.className).not.toContain('flex-wrap');
    expect(within(list).getAllByRole('button', { name: /^Rename/ })).toHaveLength(3);
  });

  it('adds a level through the dialog and invalidates the dictionary', async () => {
    catalog.createLevel.mockResolvedValue(SEXUAL_SYSTEM_TRAIT);
    renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add level' }));
    const dialog = screen.getByRole('dialog', { name: 'Add level' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^key/i }), 'monoecious');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add level' }));
    await waitFor(() =>
      expect(catalog.createLevel).toHaveBeenCalledWith(SEXUAL_SYSTEM_TRAIT.id, {
        key: 'monoecious',
      }),
    );
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'traits');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('renames a level, shows the seed warning, and maps LEVEL_KEY_TAKEN under the field', async () => {
    catalog.updateLevel
      .mockRejectedValueOnce(new ApiError(409, 'LEVEL_KEY_TAKEN', 'taken'))
      .mockResolvedValue(SEXUAL_SYSTEM_TRAIT);
    renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage />);
    await userEvent.click(screen.getByRole('button', { name: 'Rename dioecious' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename level' });
    expect(within(dialog).getByRole('status')).toHaveTextContent(/seed:traits re-inserts/);
    const key = within(dialog).getByRole('textbox', { name: /^key/i });
    expect(key).toHaveValue('dioecious');
    await userEvent.clear(key);
    await userEvent.type(key, 'hermaphrodite');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    expect(
      await within(dialog).findByText('A level with this key already exists.'),
    ).toBeInTheDocument();
    await userEvent.clear(key);
    await userEvent.type(key, 'dioecy');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() =>
      expect(catalog.updateLevel).toHaveBeenLastCalledWith(
        SEXUAL_SYSTEM_TRAIT.id,
        SEXUAL_SYSTEM_TRAIT.levels[1]?.id,
        { key: 'dioecy' },
      ),
    );
  });

  it('an unchanged rename closes without a request', async () => {
    renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage />);
    await userEvent.click(screen.getByRole('button', { name: 'Rename dioecious' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename level' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    expect(catalog.updateLevel).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('moves a level down by swapping the two sortOrders, moved level first; the ends are disabled', async () => {
    catalog.updateLevel.mockResolvedValue(SEXUAL_SYSTEM_TRAIT);
    renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage />);
    expect(screen.getByRole('button', { name: 'Move up hermaphrodite' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move down polygamous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move down hermaphrodite' }));
    const [first, second] = SEXUAL_SYSTEM_TRAIT.levels;
    await waitFor(() => expect(catalog.updateLevel).toHaveBeenCalledTimes(2));
    expect(catalog.updateLevel.mock.calls[0]).toEqual([
      SEXUAL_SYSTEM_TRAIT.id,
      first?.id,
      { sortOrder: second?.sortOrder },
    ]);
    expect(catalog.updateLevel.mock.calls[1]).toEqual([
      SEXUAL_SYSTEM_TRAIT.id,
      second?.id,
      { sortOrder: first?.sortOrder },
    ]);
  });

  it('refetches the dictionary even when the second PATCH of a move fails', async () => {
    catalog.updateLevel
      .mockResolvedValueOnce(SEXUAL_SYSTEM_TRAIT)
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'boom'));
    renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage />);
    await userEvent.click(screen.getByRole('button', { name: 'Move down hermaphrodite' }));
    await waitFor(() => expect(catalog.updateLevel).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'traits');
  });

  it('disables the row buttons while a move or toggle is pending', async () => {
    catalog.updateLevel.mockReturnValueOnce(new Promise(() => {}));
    renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage />);
    await userEvent.click(screen.getByRole('button', { name: 'Move down hermaphrodite' }));
    expect(screen.getByRole('button', { name: 'Move up dioecious' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rename dioecious' })).toBeDisabled();
  });

  it('sends a single patch with a shifted sortOrder when the neighbours tie', async () => {
    catalog.updateLevel.mockResolvedValue(SEXUAL_SYSTEM_TRAIT);
    const tied = {
      ...SEXUAL_SYSTEM_TRAIT,
      levels: SEXUAL_SYSTEM_TRAIT.levels.map((l) => ({ ...l, sortOrder: 0 })),
    };
    renderWithProviders(<LevelsEditor trait={tied} canManage />);
    await userEvent.click(screen.getByRole('button', { name: 'Move down dioecious' }));
    await waitFor(() => expect(catalog.updateLevel).toHaveBeenCalledTimes(1));
    expect(catalog.updateLevel).toHaveBeenCalledWith(tied.id, tied.levels[1]?.id, { sortOrder: 1 });
  });

  it('moving up across a tie at sortOrder 0 pushes the neighbour down instead', async () => {
    catalog.updateLevel.mockResolvedValue(SEXUAL_SYSTEM_TRAIT);
    const tied = {
      ...SEXUAL_SYSTEM_TRAIT,
      levels: SEXUAL_SYSTEM_TRAIT.levels.map((l) => ({ ...l, sortOrder: 0 })),
    };
    renderWithProviders(<LevelsEditor trait={tied} canManage />);
    await userEvent.click(screen.getByRole('button', { name: 'Move up dioecious' }));
    await waitFor(() => expect(catalog.updateLevel).toHaveBeenCalledTimes(1));
    expect(catalog.updateLevel).toHaveBeenCalledWith(tied.id, tied.levels[0]?.id, { sortOrder: 1 });
  });

  it('deactivates and activates with one patch each', async () => {
    catalog.updateLevel.mockResolvedValue(SEXUAL_SYSTEM_TRAIT);
    renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage />);
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate dioecious' }));
    await waitFor(() =>
      expect(catalog.updateLevel).toHaveBeenCalledWith(
        SEXUAL_SYSTEM_TRAIT.id,
        SEXUAL_SYSTEM_TRAIT.levels[1]?.id,
        { active: false },
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Activate polygamous' }));
    await waitFor(() =>
      expect(catalog.updateLevel).toHaveBeenCalledWith(
        SEXUAL_SYSTEM_TRAIT.id,
        SEXUAL_SYSTEM_TRAIT.levels[2]?.id,
        { active: true },
      ),
    );
  });

  it('shows the generic sentence when a toggle fails', async () => {
    catalog.updateLevel.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    renderWithProviders(<LevelsEditor trait={SEXUAL_SYSTEM_TRAIT} canManage />);
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate dioecious' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });
});
