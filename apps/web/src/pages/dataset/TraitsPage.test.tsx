import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Dictionary, MapEntry, MeResponse } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  DICTIONARY,
  NEW_TRAIT,
  SEED_MASS_TRAIT,
  SEXUAL_SYSTEM_TRAIT,
} from '../../test/dataset-fixtures.ts';
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
const dataset = vi.hoisted(() => ({ fetchDictionary: vi.fn() }));
const catalog = vi.hoisted(() => ({
  createTrait: vi.fn(),
  updateTrait: vi.fn(),
  createLevel: vi.fn(),
}));
// `TraitRows` calls `useMaps()` itself (RFC-76 R8); mocked directly, the same
// way `MapsPage.test.tsx` does — `fetchMaps` is defined in the same module
// and a same-module reference `vi.mock` never reaches.
const maps = vi.hoisted(() => ({ useMaps: vi.fn() }));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));
vi.mock('../../api/catalog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/catalog.ts')>()),
  ...catalog,
}));
vi.mock('../../api/maps.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/maps.ts')>()),
  ...maps,
}));

function mapsResult(data: MapEntry[]) {
  return { data, isPending: false, isSuccess: true, isError: false, error: null };
}

const READER: MeResponse = { ...ME, permissions: ['dataset.read'] };
const MANAGER: MeResponse = { ...ME, permissions: ['dataset.read', 'traits.manage'] };

beforeEach(() => {
  auth.fetchMe.mockReset();
  dataset.fetchDictionary.mockReset();
  catalog.createTrait.mockReset();
  catalog.updateTrait.mockReset();
  catalog.createLevel.mockReset();
  maps.useMaps.mockReset();
  auth.fetchMe.mockResolvedValue(READER);
  dataset.fetchDictionary.mockResolvedValue(DICTIONARY);
  maps.useMaps.mockReturnValue(mapsResult([]));
});

async function openPage() {
  const utils = renderAt('/app/traits');
  expect(await screen.findByRole('heading', { name: 'Traits' })).toBeInTheDocument();
  return utils;
}

describe('RFC-13 R2, RFC-62 R5 TraitsPage', () => {
  it('renders the categories in dictionary order with their traits', async () => {
    await openPage();
    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(['Reproductive system', 'Seed']);
    expect(dataset.fetchDictionary).toHaveBeenCalledTimes(1);

    const [reproductive, seed] = screen.getAllByRole('table');
    expect(
      within(reproductive as HTMLElement)
        .getAllByRole('columnheader')
        .map((th) => th.textContent)
        .slice(0, 5),
    ).toEqual(['Trait', 'Type', 'Unit', 'Description', 'Species']);
    const sexual = within(reproductive as HTMLElement).getAllByRole('row')[1] as HTMLElement;
    expect(within(sexual).getByRole('link', { name: 'sexual system' })).toHaveAttribute(
      'href',
      `/app/traits/${SEXUAL_SYSTEM_TRAIT.id}`,
    );
    expect(sexual).toHaveTextContent('Categorical');
    expect(sexual).toHaveTextContent('Distribution of male and female function');
    expect(within(sexual).getAllByRole('cell')[4]).toHaveTextContent('12');
    expect(within(sexual).getByText('—')).toBeInTheDocument();
    // RFC-62 R5 amendment: only `active: false` is worth a badge.
    expect(within(sexual).queryByText('active')).not.toBeInTheDocument();

    const rows = within(seed as HTMLElement).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('seed mass');
    expect(rows[1]).toHaveTextContent('Quantitative');
    expect(rows[1]).toHaveTextContent('mg');
    expect(within(rows[1] as HTMLElement).getAllByRole('cell')[4]).toHaveTextContent('3');
    expect(within(rows[1] as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('inactive')).toBeInTheDocument();
  });

  it('filters traits by key, case-insensitively, and hides emptied categories', async () => {
    await openPage();
    await screen.findByRole('heading', { name: 'Seed' });
    await userEvent.type(screen.getByLabelText('Filter traits'), 'SEED');
    expect(screen.queryByRole('heading', { name: 'Reproductive system' })).not.toBeInTheDocument();
    expect(screen.queryByText('sexual system')).not.toBeInTheDocument();
    expect(screen.getByText('seed mass')).toBeInTheDocument();
    expect(screen.getByText('seed colour')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Filter traits'));
    await userEvent.type(screen.getByLabelText('Filter traits'), 'sexual system');
    expect(screen.getByText('sexual system')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Seed' })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Filter traits'), 'zz');
    expect(screen.getByText('No traits match.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('unfolds and folds a trait’s levels, striking inactive ones through', async () => {
    await openPage();
    const toggle = (
      await screen.findAllByRole('button', { name: 'Show levels' })
    )[0] as HTMLElement;
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Levels of sexual system' })).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveTextContent('Hide levels');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const levels = screen.getByRole('list', { name: 'Levels of sexual system' });
    expect(toggle).toHaveAttribute('aria-controls', levels.closest('tr')?.id);
    // The levels wrap as chips in one row, not as a column of table rows.
    expect(levels.className).toContain('flex-wrap');
    expect(within(levels).queryAllByRole('row')).toHaveLength(0);
    const items = within(levels).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'hermaphrodite',
      'dioecious',
      'polygamous (inactive)',
    ]);
    expect(within(levels).getByText('hermaphrodite')).not.toHaveClass('line-through');
    expect(within(levels).getByText('polygamous')).toHaveClass('line-through');

    await userEvent.click(toggle);
    expect(toggle).toHaveTextContent('Show levels');
    expect(screen.queryByRole('list', { name: 'Levels of sexual system' })).not.toBeInTheDocument();
  });

  it('says so when the dictionary is empty', async () => {
    dataset.fetchDictionary.mockResolvedValue([]);
    await openPage();
    expect(await screen.findByText('The dictionary is empty.')).toBeInTheDocument();
  });

  it('RFC-13 R4 a 403 shows the permission sentence; other failures the generic one', async () => {
    dataset.fetchDictionary.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    const first = await openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    first.unmount();

    dataset.fetchDictionary.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    await openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });
});

describe('RFC-76 R8 TraitsPage maps link', () => {
  it('shows a Maps link named after the trait for one with maps, and none for one without', async () => {
    maps.useMaps.mockReturnValue(
      mapsResult([
        {
          traitId: SEXUAL_SYSTEM_TRAIT.id,
          kind: 'completeness',
          levelId: null,
          file: 'x.svg',
          dataVersion: '2026-09-01',
        },
      ]),
    );
    await openPage();
    const link = await screen.findByRole('link', { name: 'Maps of sexual system' });
    expect(link).toHaveAttribute('href', `/app/maps/${SEXUAL_SYSTEM_TRAIT.id}`);
    expect(screen.queryByRole('link', { name: 'Maps of seed mass' })).not.toBeInTheDocument();
  });
});

describe('RFC-62 R5 TraitsPage filters', () => {
  it('seeds the three selects from the URL and asks the API for the filtered dictionary', async () => {
    dataset.fetchDictionary.mockImplementation(async (params?: { categoryKey?: string }) =>
      params?.categoryKey === 'seed' ? [DICTIONARY[1] as Dictionary[number]] : DICTIONARY,
    );
    renderAt(`/app/traits?categoryKey=seed&valueType=quantitative&traitId=${SEED_MASS_TRAIT.id}`);
    // The selects fill in once the whole dictionary arrives.
    await screen.findByRole('option', { name: 'Reproductive system' });
    expect(screen.getByLabelText('Category')).toHaveValue('seed');
    expect(screen.getByLabelText('Value type')).toHaveValue('quantitative');
    expect(screen.getByLabelText('Trait')).toHaveValue(SEED_MASS_TRAIT.id);
    await waitFor(() =>
      expect(dataset.fetchDictionary).toHaveBeenCalledWith({
        categoryKey: 'seed',
        valueType: 'quantitative',
      }),
    );
    // The selects are fed by the whole dictionary — asked for with no
    // filters at all — so a chosen category can still be swapped for
    // another one (RFC-62 R5).
    expect(dataset.fetchDictionary).toHaveBeenCalledWith();
    // Only the named trait is listed, whatever else its category holds.
    const table = screen.getByRole('table');
    expect(within(table).getByRole('link', { name: 'seed mass' })).toBeInTheDocument();
    expect(within(table).queryByText('seed length')).not.toBeInTheDocument();
  });

  it('writes each filter into the URL and drops the trait when the category changes', async () => {
    const { router } = await openPage();
    await screen.findByRole('option', { name: 'Seed' });
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'seed');
    await waitFor(() =>
      expect(router.state.location.search).toEqual(
        expect.objectContaining({ categoryKey: 'seed' }),
      ),
    );

    await userEvent.selectOptions(screen.getByLabelText('Trait'), SEED_MASS_TRAIT.id);
    await waitFor(() =>
      expect(router.state.location.search).toEqual(
        expect.objectContaining({ categoryKey: 'seed', traitId: SEED_MASS_TRAIT.id }),
      ),
    );

    await userEvent.selectOptions(screen.getByLabelText('Value type'), 'quantitative');
    await waitFor(() =>
      expect(router.state.location.search).toEqual(
        expect.objectContaining({ valueType: 'quantitative' }),
      ),
    );

    await userEvent.selectOptions(screen.getByLabelText('Category'), 'reproductive_system');
    await waitFor(() =>
      expect(router.state.location.search).toEqual(
        expect.not.objectContaining({ traitId: SEED_MASS_TRAIT.id }),
      ),
    );
  });
});

describe('RFC-62 R6 TraitsPage editing', () => {
  it('hides "New trait" and "Edit" from a reader', async () => {
    renderAt('/app/traits');
    await screen.findByText('sexual system');
    expect(screen.queryByRole('button', { name: 'New trait' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument();
  });

  it('creates a trait from the header dialog and refetches the dictionary', async () => {
    auth.fetchMe.mockResolvedValue(MANAGER);
    catalog.createTrait.mockResolvedValue(NEW_TRAIT);
    dataset.fetchDictionary.mockResolvedValueOnce(DICTIONARY).mockResolvedValue([
      DICTIONARY[0] as Dictionary[number],
      {
        ...(DICTIONARY[1] as Dictionary[number]),
        traits: [...(DICTIONARY[1] as Dictionary[number]).traits, NEW_TRAIT],
      },
    ]);
    renderAt('/app/traits');
    await userEvent.click(await screen.findByRole('button', { name: 'New trait' }));
    const dialog = screen.getByRole('dialog', { name: 'New trait' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^key/i }), 'flower_colour');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /category/i }),
      'seed',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create trait' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('flower colour')).toBeInTheDocument();
  });

  it('opens the edit dialog for a trait with its category preselected', async () => {
    auth.fetchMe.mockResolvedValue(MANAGER);
    renderAt('/app/traits');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit sexual system' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit trait' });
    expect(within(dialog).getByRole('combobox', { name: /category/i })).toHaveValue(
      'reproductive_system',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a traits.manage holder can unfold a categorical trait without levels and add one', async () => {
    auth.fetchMe.mockResolvedValue(MANAGER);
    dataset.fetchDictionary.mockResolvedValue([
      { key: 'seed', label: 'Seed', traits: [NEW_TRAIT] },
    ]);
    catalog.createLevel.mockResolvedValue({
      ...NEW_TRAIT,
      levels: [{ id: 'l1', key: 'red', sortOrder: 0, active: true }],
    });
    renderAt('/app/traits');
    await userEvent.click(await screen.findByRole('button', { name: 'Show levels' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add level' }));
    const dialog = screen.getByRole('dialog', { name: 'Add level' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^key/i }), 'red');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add level' }));
    await waitFor(() =>
      expect(catalog.createLevel).toHaveBeenCalledWith(NEW_TRAIT.id, { key: 'red' }),
    );
  });
});
