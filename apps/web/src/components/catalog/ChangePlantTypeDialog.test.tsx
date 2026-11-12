import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SPECIES } from '../../test/dataset-fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { ChangePlantTypeDialog } from './ChangePlantTypeDialog.tsx';

const catalog = vi.hoisted(() => ({
  changePlantType: vi.fn(),
  invalidateAfterCatalogWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/catalog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/catalog.ts')>()),
  ...catalog,
}));

beforeEach(() => {
  catalog.changePlantType.mockReset();
  catalog.invalidateAfterCatalogWrite.mockClear();
});

describe('RFC-65 R19 ChangePlantTypeDialog', () => {
  it('starts on the current type, posts the chosen one and reports the species', async () => {
    const saved = { ...SPECIES, plantType: 'not_tree' as const };
    catalog.changePlantType.mockResolvedValue(saved);
    const onSaved = vi.fn();
    renderWithProviders(
      <ChangePlantTypeDialog species={SPECIES} onClose={() => {}} onSaved={onSaved} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Change plant type' });
    const select = within(dialog).getByLabelText('Plant type');
    expect(select).toHaveValue('tree');
    await userEvent.selectOptions(select, 'not_tree');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save and mark reviewed' }));
    await waitFor(() =>
      expect(catalog.changePlantType).toHaveBeenCalledWith(SPECIES.id, 'not_tree'),
    );
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'taxa');
    expect(onSaved).toHaveBeenCalledWith(saved);
  });
});
