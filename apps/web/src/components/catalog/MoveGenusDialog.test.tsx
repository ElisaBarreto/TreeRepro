import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Genus } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FAMILIES, FAMILY, GENERA, GENUS, MALVACEAE } from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { MoveGenusDialog } from './MoveGenusDialog.tsx';

const catalog = vi.hoisted(() => ({
  updateGenus: vi.fn(),
  invalidateAfterCatalogWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/catalog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/catalog.ts')>()),
  ...catalog,
}));

const me = { ...ME, permissions: ['dataset.read', 'taxa.manage'] } as never;

beforeEach(() => {
  catalog.updateGenus.mockReset();
  catalog.invalidateAfterCatalogWrite.mockClear();
});

function mount(genus: Genus) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderWithProviders(
    <MoveGenusDialog genus={genus} families={FAMILIES} onClose={onClose} onSaved={onSaved} />,
    { me },
  );
  const dialog = screen.getByRole('dialog', { name: `Move ${genus.name}` });
  return { dialog, onClose, onSaved };
}

describe('RFC-60 R9 MoveGenusDialog', () => {
  it('patches the chosen family, null for "No family", and closes unchanged without a request', async () => {
    catalog.updateGenus.mockResolvedValue({ ...GENUS, family: MALVACEAE });
    const first = mount(GENERA[0] as Genus);
    expect(within(first.dialog).getByRole('combobox', { name: /family/i })).toHaveValue(FAMILY.id);
    await userEvent.click(within(first.dialog).getByRole('button', { name: 'Move' }));
    expect(catalog.updateGenus).not.toHaveBeenCalled();
    expect(first.onClose).toHaveBeenCalled();
    cleanup();
    const second = mount(GENERA[0] as Genus);
    await userEvent.selectOptions(
      within(second.dialog).getByRole('combobox', { name: /family/i }),
      MALVACEAE.id,
    );
    await userEvent.click(within(second.dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(catalog.updateGenus).toHaveBeenCalledWith(GENUS.id, { familyId: MALVACEAE.id }),
    );
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'taxa');
    expect(second.onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: GENUS.id }));
    cleanup();
    const third = mount(GENERA[0] as Genus);
    await userEvent.selectOptions(
      within(third.dialog).getByRole('combobox', { name: /family/i }),
      '',
    );
    await userEvent.click(within(third.dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(catalog.updateGenus).toHaveBeenCalledWith(GENUS.id, { familyId: null }),
    );
  });
});
