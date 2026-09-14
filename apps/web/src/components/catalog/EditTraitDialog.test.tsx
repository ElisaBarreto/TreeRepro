import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { DICTIONARY, SEXUAL_SYSTEM_TRAIT } from '../../test/dataset-fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { EditTraitDialog } from './EditTraitDialog.tsx';

const catalog = vi.hoisted(() => ({
  updateTrait: vi.fn(),
  invalidateAfterCatalogWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/catalog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/catalog.ts')>()),
  ...catalog,
}));

const CATEGORIES = DICTIONARY.map((c) => ({ key: c.key, label: c.label }));

beforeEach(() => {
  catalog.updateTrait.mockReset();
  catalog.invalidateAfterCatalogWrite.mockClear();
});

function mount(trait: typeof SEXUAL_SYSTEM_TRAIT, categoryKey: string) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderWithProviders(
    <EditTraitDialog
      trait={trait}
      categoryKey={categoryKey}
      categories={CATEGORIES}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  return { onClose, onSaved, dialog: screen.getByRole('dialog', { name: 'Edit trait' }) };
}

describe('RFC-62 R6 EditTraitDialog', () => {
  it('shows the immutable fields as text and patches only what changed', async () => {
    catalog.updateTrait.mockResolvedValue({ ...SEXUAL_SYSTEM_TRAIT, active: false });
    const { dialog, onSaved } = mount(SEXUAL_SYSTEM_TRAIT, 'reproductive_system');
    expect(within(dialog).getByText('sexual_system')).toBeInTheDocument();
    expect(within(dialog).getByText(/Categorical/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: /^key/i })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /active/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(catalog.updateTrait).toHaveBeenCalledWith(SEXUAL_SYSTEM_TRAIT.id, { active: false }),
    );
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'traits');
    expect(onSaved).toHaveBeenCalledWith({ ...SEXUAL_SYSTEM_TRAIT, active: false });
  });

  it('an unchanged form closes without a request; a changed category and description are both sent', async () => {
    catalog.updateTrait.mockResolvedValue(SEXUAL_SYSTEM_TRAIT);
    const first = mount(SEXUAL_SYSTEM_TRAIT, 'reproductive_system');
    await userEvent.click(within(first.dialog).getByRole('button', { name: 'Save' }));
    expect(catalog.updateTrait).not.toHaveBeenCalled();
    expect(first.onClose).toHaveBeenCalled();
    cleanup();
    const second = mount(SEXUAL_SYSTEM_TRAIT, 'reproductive_system');
    await userEvent.selectOptions(
      within(second.dialog).getByRole('combobox', { name: /category/i }),
      'seed',
    );
    const description = within(second.dialog).getByRole('textbox', { name: /description/i });
    await userEvent.clear(description);
    await userEvent.type(description, 'Sex distribution.');
    await userEvent.click(within(second.dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(catalog.updateTrait).toHaveBeenCalledWith(SEXUAL_SYSTEM_TRAIT.id, {
        categoryKey: 'seed',
        description: 'Sex distribution.',
      }),
    );
  });

  it('maps TRAIT_NOT_FOUND to its sentence', async () => {
    catalog.updateTrait.mockRejectedValue(new ApiError(404, 'TRAIT_NOT_FOUND', 'gone'));
    const { dialog } = mount(SEXUAL_SYSTEM_TRAIT, 'reproductive_system');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /active/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This trait no longer exists. Reload the page.',
    );
  });

  it('shows a VALIDATION_FAILED field message without the Alert alongside it', async () => {
    catalog.updateTrait.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'bad', [{ path: 'description', message: 'Too long' }]),
    );
    const { dialog } = mount(SEXUAL_SYSTEM_TRAIT, 'reproductive_system');
    const description = within(dialog).getByRole('textbox', { name: /description/i });
    await userEvent.clear(description);
    await userEvent.type(description, 'Sex distribution.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Too long')).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });
});
