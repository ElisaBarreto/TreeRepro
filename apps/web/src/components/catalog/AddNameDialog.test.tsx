import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { SPECIES } from '../../test/dataset-fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { AddNameDialog } from './AddNameDialog.tsx';

const catalog = vi.hoisted(() => ({
  addSpeciesName: vi.fn(),
  invalidateAfterCatalogWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/catalog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/catalog.ts')>()),
  ...catalog,
}));

beforeEach(() => {
  catalog.addSpeciesName.mockReset();
  catalog.invalidateAfterCatalogWrite.mockClear();
});

function mount() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderWithProviders(<AddNameDialog species={SPECIES} onClose={onClose} onSaved={onSaved} />);
  const dialog = screen.getByRole('dialog', { name: 'Add alternative name' });
  return { dialog, onClose, onSaved };
}

describe('RFC-60 R9 AddNameDialog', () => {
  it('posts the name and the GBIF key, invalidates taxa and reports the species', async () => {
    catalog.addSpeciesName.mockResolvedValue(SPECIES);
    const { dialog, onSaved } = mount();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /^name/i }),
      'Adenanthera gersenii',
    );
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /gbif usage key/i }),
      '2969393',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add name' }));
    await waitFor(() =>
      expect(catalog.addSpeciesName).toHaveBeenCalledWith(SPECIES.id, {
        name: 'Adenanthera gersenii',
        gbifUsageKey: '2969393',
      }),
    );
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'taxa');
    expect(onSaved).toHaveBeenCalledWith(SPECIES);
  });

  it('requires the name; omits an empty key; maps SPECIES_NAME_TAKEN under the name', async () => {
    catalog.addSpeciesName.mockRejectedValueOnce(new ApiError(409, 'SPECIES_NAME_TAKEN', 'taken'));
    const { dialog } = mount();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add name' }));
    expect(within(dialog).getByText('Enter the name.')).toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /^name/i }),
      'Adenanthera pavonina',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add name' }));
    await waitFor(() =>
      expect(catalog.addSpeciesName).toHaveBeenCalledWith(SPECIES.id, {
        name: 'Adenanthera pavonina',
      }),
    );
    expect(
      await within(dialog).findByText('This species already has that name.'),
    ).toBeInTheDocument();
  });

  it('shows a VALIDATION_FAILED field message without the Alert alongside it', async () => {
    catalog.addSpeciesName.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'bad', [
        { path: 'gbifUsageKey', message: 'Too long' },
      ]),
    );
    const { dialog } = mount();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /^name/i }),
      'Adenanthera gersenii',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add name' }));
    expect(await within(dialog).findByText('Too long')).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });
});
