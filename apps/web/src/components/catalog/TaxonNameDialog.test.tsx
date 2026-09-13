import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { FAMILY } from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { TaxonNameDialog } from './TaxonNameDialog.tsx';

const catalog = vi.hoisted(() => ({ invalidateAfterCatalogWrite: vi.fn(async () => undefined) }));
vi.mock('../../api/catalog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/catalog.ts')>()),
  ...catalog,
}));

const me = { ...ME, permissions: ['dataset.read', 'taxa.manage'] } as never;

beforeEach(() => {
  catalog.invalidateAfterCatalogWrite.mockClear();
});

function mount(props: Omit<Parameters<typeof TaxonNameDialog>[0], 'onClose' | 'onSaved'>) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderWithProviders(<TaxonNameDialog {...props} onClose={onClose} onSaved={onSaved} />, { me });
  const dialog = screen.getByRole('dialog', { name: props.title });
  return { dialog, onClose, onSaved };
}

describe('RFC-60 R9 TaxonNameDialog', () => {
  it('requires a name, saves through the bound callback and reports success', async () => {
    const save = vi.fn(async () => FAMILY);
    const { dialog, onSaved } = mount({
      title: 'New family',
      label: 'Family name',
      submitLabel: 'Create',
      takenMessage: 'A family with this name already exists.',
      save,
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(within(dialog).getByText('Enter a name.')).toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Family name' }),
      '  Fabaceae ',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('Fabaceae'));
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'taxa');
    expect(onSaved).toHaveBeenCalled();
  });

  it('an unchanged rename closes without saving; a 409 shows the taken sentence under the field', async () => {
    const save = vi.fn().mockRejectedValue(new ApiError(409, 'GENUS_NAME_TAKEN', 'taken'));
    const first = mount({
      title: 'Rename genus',
      label: 'Genus name',
      initial: 'Adenanthera',
      submitLabel: 'Rename',
      takenMessage: 'A genus with this name already exists.',
      save,
    });
    await userEvent.click(within(first.dialog).getByRole('button', { name: 'Rename' }));
    expect(save).not.toHaveBeenCalled();
    expect(first.onClose).toHaveBeenCalled();
    cleanup();
    const second = mount({
      title: 'Rename genus',
      label: 'Genus name',
      initial: 'Adenanthera',
      submitLabel: 'Rename',
      takenMessage: 'A genus with this name already exists.',
      save,
    });
    const input = within(second.dialog).getByRole('textbox', { name: 'Genus name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Adansonia');
    await userEvent.click(within(second.dialog).getByRole('button', { name: 'Rename' }));
    expect(
      await within(second.dialog).findByText('A genus with this name already exists.'),
    ).toBeInTheDocument();
  });
});
