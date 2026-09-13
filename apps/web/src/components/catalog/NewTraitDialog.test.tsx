import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { DICTIONARY, NEW_TRAIT } from '../../test/dataset-fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { NewTraitDialog } from './NewTraitDialog.tsx';

const catalog = vi.hoisted(() => ({
  createTrait: vi.fn(),
  invalidateAfterCatalogWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/catalog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/catalog.ts')>()),
  ...catalog,
}));

const CATEGORIES = DICTIONARY.map((c) => ({ key: c.key, label: c.label }));

beforeEach(() => {
  catalog.createTrait.mockReset();
  catalog.invalidateAfterCatalogWrite.mockClear();
});

function mount() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderWithProviders(
    <NewTraitDialog categories={CATEGORIES} onClose={onClose} onSaved={onSaved} />,
  );
  return { onClose, onSaved, dialog: screen.getByRole('dialog', { name: 'New trait' }) };
}

describe('RFC-62 R6 NewTraitDialog', () => {
  it('posts key, category, value type, unit and description, then invalidates traits and reports the trait', async () => {
    catalog.createTrait.mockResolvedValue(NEW_TRAIT);
    const { dialog, onSaved } = mount();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^key/i }), 'flower_colour');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /category/i }),
      'seed',
    );
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /value type/i }),
      'quantitative',
    );
    await userEvent.type(within(dialog).getByRole('textbox', { name: /unit/i }), 'mm');
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /description/i }),
      'Colour of the petals.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create trait' }));
    await waitFor(() =>
      expect(catalog.createTrait).toHaveBeenCalledWith({
        key: 'flower_colour',
        categoryKey: 'seed',
        valueType: 'quantitative',
        unit: 'mm',
        description: 'Colour of the petals.',
      }),
    );
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'traits');
    expect(onSaved).toHaveBeenCalledWith(NEW_TRAIT);
  });

  it('requires key and category before sending; an empty unit is not sent', async () => {
    catalog.createTrait.mockResolvedValue(NEW_TRAIT);
    const { dialog } = mount();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create trait' }));
    expect(within(dialog).getByText('Enter a key.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a category.')).toBeInTheDocument();
    expect(catalog.createTrait).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^key/i }), 'flower_colour');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /category/i }),
      'reproductive_system',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create trait' }));
    await waitFor(() =>
      expect(catalog.createTrait).toHaveBeenCalledWith({
        key: 'flower_colour',
        categoryKey: 'reproductive_system',
        valueType: 'categorical',
      }),
    );
  });

  it('maps TRAIT_KEY_TAKEN under the key field and VALIDATION_FAILED details by path', async () => {
    catalog.createTrait.mockRejectedValueOnce(new ApiError(409, 'TRAIT_KEY_TAKEN', 'taken'));
    const { dialog } = mount();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^key/i }), 'sexual_system');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /category/i }),
      'seed',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create trait' }));
    expect(
      await within(dialog).findByText('A trait with this key already exists.'),
    ).toBeInTheDocument();
    catalog.createTrait.mockRejectedValueOnce(
      new ApiError(400, 'VALIDATION_FAILED', 'bad', [
        { path: 'categoryKey', message: 'Unknown category' },
      ]),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create trait' }));
    expect(await within(dialog).findByText('Unknown category')).toBeInTheDocument();
  });
});
