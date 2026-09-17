import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Species } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  FAMILIES,
  FAMILY,
  GENERA,
  GENUS,
  MALVACEAE,
  SPECIES,
} from '../../test/dataset-fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { SpeciesDialog } from './SpeciesDialog.tsx';

const catalog = vi.hoisted(() => ({
  createSpecies: vi.fn(),
  updateSpecies: vi.fn(),
  createGenus: vi.fn(),
  createFamily: vi.fn(),
  invalidateAfterCatalogWrite: vi.fn<
    typeof import('../../api/catalog.ts').invalidateAfterCatalogWrite
  >(async () => undefined),
}));
// The real `invalidateAfterCatalogWrite`, kept aside so a test that needs the
// families query to actually refetch (the inline family create) can delegate
// the mocked call to it instead of asserting on the mock alone.
const catalogOriginal: {
  invalidateAfterCatalogWrite?: typeof import('../../api/catalog.ts').invalidateAfterCatalogWrite;
} = vi.hoisted(() => ({}));
const dataset = vi.hoisted(() => ({ fetchFamilies: vi.fn(), fetchGenera: vi.fn() }));
vi.mock('../../api/catalog.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/catalog.ts')>();
  catalogOriginal.invalidateAfterCatalogWrite = actual.invalidateAfterCatalogWrite;
  return { ...actual, ...catalog };
});
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

beforeEach(() => {
  dataset.fetchFamilies.mockReset().mockResolvedValue(FAMILIES);
  dataset.fetchGenera.mockReset().mockResolvedValue({ data: GENERA, meta: { nextCursor: null } });
  catalog.createSpecies.mockReset();
  catalog.updateSpecies.mockReset();
  catalog.createGenus.mockReset();
  catalog.createFamily.mockReset();
  catalog.invalidateAfterCatalogWrite.mockClear();
});

function mount(species?: Species) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderWithProviders(<SpeciesDialog species={species} onClose={onClose} onSaved={onSaved} />);
  const dialog = screen.getByRole('dialog', { name: species ? 'Edit species' : 'New species' });
  return { dialog, onClose, onSaved };
}

describe('RFC-60 R9 SpeciesDialog', () => {
  it('creates a species with name, source and a searched genus', async () => {
    catalog.createSpecies.mockResolvedValue(SPECIES);
    const { dialog, onSaved } = mount();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /canonical name/i }),
      'Adenanthera pavonina',
    );
    // The option reads as a label, not the wire code.
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /name source/i }),
      within(dialog).getByRole('option', { name: 'WCVP' }),
    );
    await userEvent.type(within(dialog).getByRole('combobox', { name: /^genus/i }), 'Aden');
    await userEvent.click(await screen.findByRole('option', { name: /Adenanthera/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create species' }));
    await waitFor(() =>
      expect(catalog.createSpecies).toHaveBeenCalledWith({
        canonicalName: 'Adenanthera pavonina',
        nameSource: 'wcvp',
        genusId: GENUS.id,
      }),
    );
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'taxa');
    expect(onSaved).toHaveBeenCalledWith(SPECIES);
  });

  it('filters the genus search by the chosen family and creates a genus inline under it', async () => {
    catalog.createGenus.mockResolvedValue({ id: 'g-new', name: 'Novus', family: MALVACEAE });
    const { dialog } = mount();
    await userEvent.selectOptions(
      await within(dialog).findByRole('combobox', { name: /^family/i }),
      MALVACEAE.id,
    );
    dataset.fetchGenera.mockResolvedValue({ data: [], meta: { nextCursor: null } });
    await userEvent.type(within(dialog).getByRole('combobox', { name: /^genus/i }), 'Novus');
    await waitFor(() =>
      expect(dataset.fetchGenera).toHaveBeenLastCalledWith({
        familyId: MALVACEAE.id,
        q: 'Novus',
        limit: 20,
      }),
    );
    await userEvent.click(await screen.findByRole('option', { name: /Create "Novus"/ }));
    await waitFor(() =>
      expect(catalog.createGenus).toHaveBeenCalledWith({ name: 'Novus', familyId: MALVACEAE.id }),
    );
    expect(within(dialog).getByText('Novus')).toBeInTheDocument();
  });

  it('an inline genus create that answers GENUS_NAME_TAKEN says so under the genus field', async () => {
    catalog.createGenus.mockRejectedValue(new ApiError(409, 'GENUS_NAME_TAKEN', 'taken'));
    dataset.fetchGenera.mockResolvedValue({ data: [], meta: { nextCursor: null } });
    const { dialog } = mount();
    const genus = within(dialog).getByRole('combobox', { name: /^genus/i });
    await userEvent.type(genus, 'Adansonia');
    await userEvent.click(await screen.findByRole('option', { name: /Create "Adansonia"/ }));
    expect(
      await within(dialog).findByText('A genus with this name already exists.'),
    ).toBeInTheDocument();
    expect(genus).toHaveAccessibleDescription('A genus with this name already exists.');
  });

  it('the family select is the described control, and the inline family row keeps one Cancel', async () => {
    dataset.fetchFamilies.mockRejectedValue(new Error('down'));
    const { dialog } = mount();
    const family = await within(dialog).findByRole('combobox', { name: /^family/i });
    expect(family).toHaveAccessibleDescription(expect.stringContaining('Could not load families.'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'New family' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    const name = within(dialog).getByRole('textbox', { name: /new family name/i });
    expect(name).toHaveAccessibleDescription('Enter a family name.');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(within(dialog).getByRole('combobox', { name: /^family/i })).toBeInTheDocument();
  });

  it('creates a family inline, invalidates taxa and selects the created family', async () => {
    catalog.createFamily.mockResolvedValue({ id: 'f-new', name: 'Novaceae' });
    // This test's assertion needs the families query to actually refetch, so
    // this mock delegates to the real implementation for this one call
    // instead of the module's usual no-op (Global Constraint: invalidation
    // goes through `invalidateAfterCatalogWrite`, verified below).
    const original = catalogOriginal.invalidateAfterCatalogWrite;
    if (original) {
      catalog.invalidateAfterCatalogWrite.mockImplementationOnce((queryClient, area) =>
        original(queryClient, area),
      );
    }
    dataset.fetchFamilies
      .mockResolvedValueOnce(FAMILIES)
      .mockResolvedValue([...FAMILIES, { id: 'f-new', name: 'Novaceae' }]);
    const { dialog } = mount();
    await within(dialog).findByRole('combobox', { name: /^family/i });
    await userEvent.click(within(dialog).getByRole('button', { name: 'New family' }));
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /new family name/i }),
      'Novaceae',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(catalog.createFamily).toHaveBeenCalledWith({ name: 'Novaceae' }));
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'taxa');
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: /^family/i })).toHaveValue('f-new'),
    );
  });

  it('a pending family create ignores a repeated submit (Enter twice)', async () => {
    catalog.createFamily.mockReturnValue(new Promise(() => {}));
    const { dialog } = mount();
    await within(dialog).findByRole('combobox', { name: /^family/i });
    await userEvent.click(within(dialog).getByRole('button', { name: 'New family' }));
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /new family name/i }),
      'Novaceae{Enter}{Enter}',
    );
    expect(catalog.createFamily).toHaveBeenCalledTimes(1);
  });

  it('Enter in the new family name creates the family, not the species', async () => {
    catalog.createFamily.mockResolvedValue({ id: 'f-new', name: 'Novaceae' });
    catalog.createSpecies.mockResolvedValue(SPECIES);
    const { dialog, onClose } = mount();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /canonical name/i }),
      'Adenanthera pavonina',
    );
    await within(dialog).findByRole('combobox', { name: /^family/i });
    await userEvent.click(within(dialog).getByRole('button', { name: 'New family' }));
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /new family name/i }),
      'Novaceae{Enter}',
    );
    await waitFor(() => expect(catalog.createFamily).toHaveBeenCalledWith({ name: 'Novaceae' }));
    expect(catalog.createSpecies).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('changing the family drops a chosen genus of another family', async () => {
    const { dialog } = mount(SPECIES);
    expect(within(dialog).getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    await userEvent.selectOptions(
      await within(dialog).findByRole('combobox', { name: /^family/i }),
      MALVACEAE.id,
    );
    expect(within(dialog).queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: /^genus/i })).toHaveValue('');
  });

  it('edit: prefilled from the species; detaching the genus sends null; unchanged closes without a request', async () => {
    catalog.updateSpecies.mockResolvedValue({ ...SPECIES, genus: null, family: null });
    const first = mount(SPECIES);
    expect(within(first.dialog).getByRole('textbox', { name: /canonical name/i })).toHaveValue(
      'Adenanthera pavonina',
    );
    expect(within(first.dialog).getByRole('combobox', { name: /name source/i })).toHaveValue(
      'wcvp',
    );
    expect(await within(first.dialog).findByRole('combobox', { name: /^family/i })).toHaveValue(
      FAMILY.id,
    );
    expect(within(first.dialog).getByText('Adenanthera')).toBeInTheDocument();
    await userEvent.click(within(first.dialog).getByRole('button', { name: 'Save' }));
    expect(catalog.updateSpecies).not.toHaveBeenCalled();
    expect(first.onClose).toHaveBeenCalled();
    cleanup();
    const second = mount(SPECIES);
    await userEvent.click(within(second.dialog).getByRole('button', { name: 'Clear' }));
    await userEvent.click(within(second.dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(catalog.updateSpecies).toHaveBeenCalledWith(SPECIES.id, { genusId: null }),
    );
  });

  it('RFC-33 R7 edit shows the active checkbox checked; unchecking sends active: false; create has no checkbox', async () => {
    catalog.updateSpecies.mockResolvedValue({ ...SPECIES, active: false });
    const created = mount();
    expect(within(created.dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    cleanup();

    const { dialog } = mount(SPECIES);
    const checkbox = within(dialog).getByRole('checkbox', {
      name: 'Active — visible to contributors',
    });
    expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(catalog.updateSpecies).toHaveBeenCalledWith(SPECIES.id, { active: false }),
    );
  });

  it('maps SPECIES_NAME_TAKEN under the name and GENUS_NOT_FOUND to its sentence', async () => {
    catalog.updateSpecies
      .mockRejectedValueOnce(new ApiError(409, 'SPECIES_NAME_TAKEN', 'taken'))
      .mockRejectedValueOnce(new ApiError(404, 'GENUS_NOT_FOUND', 'gone'));
    const { dialog } = mount(SPECIES);
    const name = within(dialog).getByRole('textbox', { name: /canonical name/i });
    await userEvent.clear(name);
    await userEvent.type(name, 'Adansonia digitata');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText('A species with this name already exists.'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The chosen taxon no longer exists. Reload the page.',
    );
  });

  it('shows a VALIDATION_FAILED field message without the Alert alongside it', async () => {
    catalog.updateSpecies.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'bad', [
        { path: 'canonicalName', message: 'Too long' },
      ]),
    );
    const { dialog } = mount(SPECIES);
    const name = within(dialog).getByRole('textbox', { name: /canonical name/i });
    await userEvent.clear(name);
    await userEvent.type(name, 'Adansonia digitata');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Too long')).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });
});
