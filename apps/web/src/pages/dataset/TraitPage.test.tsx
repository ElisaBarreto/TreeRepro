import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse, TraitDetail, TraitSpeciesItem } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  FAMILIES,
  FAMILY,
  SEED_LENGTH_DETAIL,
  SEED_MASS_DETAIL,
  SEXUAL_SYSTEM_DETAIL,
  TRAIT_SPECIES_MISSING,
  TRAIT_SPECIES_UNDECIDED,
  TRAIT_SPECIES_WITH_DATA,
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
const dataset = vi.hoisted(() => ({
  fetchTrait: vi.fn(),
  fetchTraitSpecies: vi.fn(),
  fetchFamilies: vi.fn(),
  fetchGenera: vi.fn(),
}));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

const READER: MeResponse = { ...ME, permissions: ['dataset.read'] };
const page = (data: TraitSpeciesItem[], nextCursor: string | null = null) => ({
  data,
  meta: { nextCursor },
});

beforeEach(() => {
  auth.fetchMe.mockReset();
  dataset.fetchTrait.mockReset();
  dataset.fetchTraitSpecies.mockReset();
  dataset.fetchFamilies.mockReset();
  dataset.fetchGenera.mockReset();
  auth.fetchMe.mockResolvedValue(READER);
  dataset.fetchTrait.mockResolvedValue(SEXUAL_SYSTEM_DETAIL);
  dataset.fetchTraitSpecies.mockResolvedValue(page([TRAIT_SPECIES_WITH_DATA]));
  dataset.fetchFamilies.mockResolvedValue(FAMILIES);
  dataset.fetchGenera.mockResolvedValue({ data: [], meta: { nextCursor: null } });
});

// Opens the trait's own page and waits for the header to name it — the
// pending header reads "Trait", so a heading query without the name would
// return before the trait resolved.
async function openPage(trait: TraitDetail = SEXUAL_SYSTEM_DETAIL, search = '') {
  dataset.fetchTrait.mockResolvedValue(trait);
  const utils = renderAt(`/app/traits/${trait.id}${search}`);
  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: new RegExp(`^${trait.key.replaceAll('_', ' ')}`),
    }),
  ).toBeInTheDocument();
  return utils;
}

function definition(label: string): HTMLElement {
  const dd = screen.getByText(label, { selector: 'dt' }).nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`no <dd> after ${label}`);
  return dd;
}

describe('RFC-62 R7 TraitPage header', () => {
  it('names the trait, its category, unit and counts, and links the category to the filtered list', async () => {
    await openPage(SEED_MASS_DETAIL);
    expect(dataset.fetchTrait).toHaveBeenCalledWith(SEED_MASS_DETAIL.id);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Quantitative');
    expect(screen.getByText('Dry mass of one seed.')).toBeInTheDocument();
    expect(within(definition('Category')).getByRole('link', { name: 'Seed' })).toHaveAttribute(
      'href',
      '/app/traits?categoryKey=seed',
    );
    expect(definition('Unit')).toHaveTextContent('mg');
    expect(definition('Species with data')).toHaveTextContent('3');
    expect(definition('Species missing data')).toHaveTextContent('9');
    expect(definition('Accepted values')).toHaveTextContent('1');
  });

  it('reads "—" for a trait without a unit and flags an inactive one', async () => {
    await openPage({ ...SEXUAL_SYSTEM_DETAIL, active: false });
    expect(definition('Unit')).toHaveTextContent('—');
    expect(within(screen.getByRole('heading', { level: 1 })).getByText('inactive')).toBeVisible();
  });

  it('RFC-13 R4 TRAIT_NOT_FOUND and a rejected id both read as not found; a 403 as the permission sentence', async () => {
    dataset.fetchTrait.mockRejectedValue(new ApiError(404, 'TRAIT_NOT_FOUND', 'x'));
    const first = renderAt(`/app/traits/${SEXUAL_SYSTEM_DETAIL.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('This trait does not exist.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(dataset.fetchTraitSpecies).not.toHaveBeenCalled();
    first.unmount();

    dataset.fetchTrait.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    renderAt(`/app/traits/${SEXUAL_SYSTEM_DETAIL.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
  });
});

describe('RFC-62 R7 TraitPage distribution', () => {
  it('shows one chip per level with its species and record counts', async () => {
    await openPage();
    const levels = screen.getByRole('list', { name: 'Level distribution' });
    expect(levels.className).toContain('flex-wrap');
    expect(
      within(levels)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['hermaphrodite 8 species · 19 records', 'dioecious 4 species · 5 records']);
  });

  it('shows min, median and max with the unit for a quantitative trait', async () => {
    await openPage(SEED_MASS_DETAIL);
    const spread = screen.getByRole('list', { name: 'Numeric distribution' });
    expect(
      within(spread)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['min 0.5 mg', 'median 1.25 mg', 'max 3 mg']);
    expect(screen.getByText('Across 3 species with harmonised records.')).toBeInTheDocument();
  });

  it('says so instead when no record has been harmonised yet, whatever the value type', async () => {
    const quantitative = await openPage(SEED_LENGTH_DETAIL);
    expect(screen.getByText('No harmonised records yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Numeric distribution' })).not.toBeInTheDocument();
    quantitative.unmount();

    dataset.fetchTrait.mockResolvedValue({
      ...SEXUAL_SYSTEM_DETAIL,
      distribution: { levels: [] },
    });
    renderAt(`/app/traits/${SEXUAL_SYSTEM_DETAIL.id}`);
    expect(await screen.findByText('No harmonised records yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Level distribution' })).not.toBeInTheDocument();
  });
});

describe('RFC-62 R8 TraitPage species tabs', () => {
  it('opens on the species with data, one row per species with its records, value and source', async () => {
    await openPage();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Species with data',
      'Species missing data',
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    await waitFor(() =>
      expect(dataset.fetchTraitSpecies).toHaveBeenCalledWith(
        SEXUAL_SYSTEM_DETAIL.id,
        expect.objectContaining({ mode: 'with', cursor: undefined, limit: 50 }),
      ),
    );

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(
      within(rows[0] as HTMLElement)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Species', 'Family', 'Records', 'Accepted value', 'Source']);
    const cells = within(rows[1] as HTMLElement).getAllByRole('cell');
    expect(
      within(cells[0] as HTMLElement).getByRole('link', { name: 'Adenanthera pavonina' }),
    ).toHaveAttribute('href', `/app/species/${TRAIT_SPECIES_WITH_DATA.id}`);
    expect(cells[1]).toHaveTextContent('Fabaceae');
    expect(cells[2]).toHaveTextContent('4');
    expect(cells[2]).toHaveTextContent('dioecious 3 · hermaphrodite 1');
    expect(cells[3]).toHaveTextContent('dioecious');
    expect(
      within(cells[4] as HTMLElement).getByRole('link', { name: 'Renner2014' }),
    ).toHaveAttribute('href', `/app/references/${TRAIT_SPECIES_WITH_DATA.accepted?.reference.id}`);
  });

  it('reads "—" where no value was accepted and prints a numeric summary with the unit', async () => {
    dataset.fetchTraitSpecies.mockResolvedValue(page([TRAIT_SPECIES_UNDECIDED]));
    await openPage(SEED_MASS_DETAIL);
    const cells = within((await screen.findAllByRole('row'))[1] as HTMLElement).getAllByRole(
      'cell',
    );
    expect(cells[2]).toHaveTextContent('0.5 – 3 mg');
    expect(cells[3]).toHaveTextContent('—');
    expect(cells[4]).toHaveTextContent('—');
  });

  it('switches to the species missing data, writes the mode into the URL and offers the first entry', async () => {
    const { router } = await openPage();
    dataset.fetchTraitSpecies.mockResolvedValue(page([TRAIT_SPECIES_MISSING]));
    await userEvent.click(screen.getByRole('tab', { name: 'Species missing data' }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual(expect.objectContaining({ mode: 'missing' })),
    );
    await waitFor(() =>
      expect(dataset.fetchTraitSpecies).toHaveBeenLastCalledWith(
        SEXUAL_SYSTEM_DETAIL.id,
        expect.objectContaining({ mode: 'missing' }),
      ),
    );
    expect(screen.getByRole('tab', { name: 'Species missing data' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(
      within(rows[0] as HTMLElement)
        .getAllByRole('columnheader')
        .map((th) => th.textContent)
        .slice(0, 2),
    ).toEqual(['Species', 'Family']);
    expect(
      within(rows[1] as HTMLElement).getByRole('link', { name: 'Add the first entry' }),
    ).toHaveAttribute('href', `/app/species/${TRAIT_SPECIES_MISSING.id}?missing=true`);
    expect(screen.queryByText('Accepted value')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Species with data' }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual(
        expect.not.objectContaining({ mode: 'missing' }),
      ),
    );
  });

  it('opens on the tab the URL names', async () => {
    dataset.fetchTraitSpecies.mockResolvedValue(page([TRAIT_SPECIES_MISSING]));
    await openPage(SEXUAL_SYSTEM_DETAIL, '?mode=missing');
    expect(screen.getByRole('tab', { name: 'Species missing data' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() =>
      expect(dataset.fetchTraitSpecies).toHaveBeenCalledWith(
        SEXUAL_SYSTEM_DETAIL.id,
        expect.objectContaining({ mode: 'missing' }),
      ),
    );
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute(
      'aria-labelledby',
      screen.getByRole('tab', { name: 'Species missing data' }).id,
    );
  });

  it('narrows both tables by the taxonomy filters and mirrors them in the URL', async () => {
    const { router } = await openPage();
    await screen.findByRole('option', { name: FAMILY.name });
    await userEvent.selectOptions(screen.getByLabelText('Family'), FAMILY.id);
    await waitFor(() =>
      expect(router.state.location.search).toEqual(
        expect.objectContaining({ familyId: FAMILY.id }),
      ),
    );
    await waitFor(() =>
      expect(dataset.fetchTraitSpecies).toHaveBeenLastCalledWith(
        SEXUAL_SYSTEM_DETAIL.id,
        expect.objectContaining({ familyId: FAMILY.id }),
      ),
    );

    await userEvent.type(screen.getByLabelText('Search species'), 'Adenanthera');
    await waitFor(() =>
      expect(router.state.location.search).toEqual(
        expect.objectContaining({ q: 'Adenanthera', familyId: FAMILY.id }),
      ),
    );
    await waitFor(() =>
      expect(dataset.fetchTraitSpecies).toHaveBeenLastCalledWith(
        SEXUAL_SYSTEM_DETAIL.id,
        expect.objectContaining({ q: 'Adenanthera' }),
      ),
    );
  });

  it('says so when a tab has no species, each in its own words', async () => {
    dataset.fetchTraitSpecies.mockResolvedValue(page([]));
    const { router } = await openPage();
    expect(await screen.findByText('No species have data for this trait yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Species missing data' }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual(expect.objectContaining({ mode: 'missing' })),
    );
    expect(
      await screen.findByText('Every visible species has data for this trait.'),
    ).toBeInTheDocument();
  });

  it('RFC-13 R4 shows a failed species page in the tab panel, under the header', async () => {
    dataset.fetchTraitSpecies.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    await openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    expect(definition('Species with data')).toHaveTextContent('12');
  });
});

describe('RFC-13 R3 TraitPage breadcrumb', () => {
  it('trails Data › Traits › category › trait, the category linking to its filtered list', async () => {
    await openPage();
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(trail).toHaveTextContent('Data');
    expect(within(trail).getByRole('link', { name: 'Traits' })).toHaveAttribute(
      'href',
      '/app/traits',
    );
    expect(within(trail).getByRole('link', { name: 'Reproductive system' })).toHaveAttribute(
      'href',
      '/app/traits?categoryKey=reproductive_system',
    );
    expect(within(trail).getByText('sexual system')).toHaveAttribute('aria-current', 'page');
    expect(within(trail).queryAllByRole('link', { current: 'page' })).toHaveLength(0);
  });
});
