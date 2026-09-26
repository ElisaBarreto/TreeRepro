import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Dictionary, MapEntry, MeResponse } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { mapFileUrl } from '../../api/maps.ts';
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
// `useMaps` is mocked directly, not `fetchMaps`: it is defined in the same
// module as `fetchMaps` and calls it through its own closure, a same-module
// reference `vi.mock`'s replacement of the exported binding never reaches —
// only the cross-module import `MapsPage.tsx` holds of `useMaps` itself is.
const maps = vi.hoisted(() => ({ useMaps: vi.fn() }));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));
vi.mock('../../api/maps.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/maps.ts')>()),
  ...maps,
}));

const READER: MeResponse = { ...ME, permissions: ['dataset.read'] };

function quantitative(n: number, key: string) {
  return {
    id: `018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f0${n}`,
    key,
    valueType: 'quantitative' as const,
    unit: 'mg',
    description: `${key}.`,
    active: true,
    speciesCount: 3,
    levels: [],
  };
}

const SEED_MASS = quantitative(1, 'seed_mass');
const SEED_WIDTH = quantitative(2, 'seed_width'); // no maps
const SEED_LENGTH = quantitative(3, 'seed_length');
const FRUIT_TYPE = quantitative(4, 'fruit_type'); // no maps: its category is left out
const LEAF_AREA = quantitative(5, 'leaf_area'); // a mean map only, no completeness
const WHITE = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f21',
  key: 'white',
  sortOrder: 1,
  active: true,
};
const RED = { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f22', key: 'red', sortOrder: 2, active: true };
const BLUE = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f23',
  key: 'blue',
  sortOrder: 3,
  active: true,
};
const FLOWER_COLOUR = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f06',
  key: 'flower_colour',
  valueType: 'categorical' as const,
  unit: null,
  description: 'The colour of the flower.',
  active: true,
  speciesCount: 5,
  // Dictionary level order is sortOrder, not array order.
  levels: [BLUE, RED, WHITE],
};

const DICTIONARY: Dictionary = [
  { key: 'seed', label: 'Seed', traits: [SEED_MASS, SEED_WIDTH, SEED_LENGTH] },
  { key: 'fruit', label: 'Fruit', traits: [FRUIT_TYPE] },
  { key: 'flower', label: 'Flower', traits: [FLOWER_COLOUR] },
  { key: 'leaf', label: 'Leaf', traits: [LEAF_AREA] },
];

const VERSION = '2026-09-01';

function entry(
  trait: { id: string; key: string },
  kind: MapEntry['kind'],
  level?: { id: string; key: string },
): MapEntry {
  return {
    traitId: trait.id,
    kind,
    levelId: level?.id ?? null,
    file: `${trait.key}_${kind}${level ? `_${level.key}` : ''}.svg`,
    dataVersion: VERSION,
  };
}

// Manifest order is scrambled on purpose: page order comes from the dictionary.
const MAP_ENTRIES: MapEntry[] = [
  entry(SEED_MASS, 'sd'),
  entry(SEED_MASS, 'mean'),
  entry(SEED_MASS, 'completeness'),
  entry(SEED_MASS, 'max'),
  entry(SEED_LENGTH, 'completeness'),
  entry(FLOWER_COLOUR, 'prevalence', BLUE),
  entry(FLOWER_COLOUR, 'completeness'),
  entry(FLOWER_COLOUR, 'prevalence', WHITE),
  entry(LEAF_AREA, 'mean'),
];

function queryResult(data: MapEntry[]) {
  return { data, isPending: false, isSuccess: true, isError: false, error: null };
}

beforeEach(() => {
  auth.fetchMe.mockReset();
  dataset.fetchDictionary.mockReset();
  maps.useMaps.mockReset();
  auth.fetchMe.mockResolvedValue(READER);
  dataset.fetchDictionary.mockResolvedValue(DICTIONARY);
  maps.useMaps.mockReturnValue(queryResult(MAP_ENTRIES));
});

async function openPage(path = '/app/maps') {
  const utils = renderAt(path);
  expect(await screen.findByRole('heading', { name: 'Maps', level: 1 })).toBeInTheDocument();
  return utils;
}

async function tabs() {
  return within(await screen.findByRole('tablist', { name: 'Trait categories' })).getAllByRole(
    'tab',
  );
}

function traitButtons(category: string) {
  return within(screen.getByRole('group', { name: `Traits in ${category}` })).getAllByRole(
    'button',
  );
}

function headingTexts(level: number) {
  return screen.getAllByRole('heading', { level }).map((h) => h.textContent);
}

describe('RFC-76 R6 MapsPage', () => {
  it('shows the categories with maps as tabs, in dictionary order, the first selected', async () => {
    await openPage();
    const list = await tabs();
    expect(list.map((tab) => tab.textContent)).toEqual(['Seed', 'Flower', 'Leaf']);
    expect(list.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(list.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('heading', { level: 2, name: 'Seed' })).toBeInTheDocument();
  });

  it('shows the traits with maps of the category as buttons, the first pressed', async () => {
    await openPage();
    await tabs();
    const buttons = traitButtons('Seed');
    expect(buttons.map((b) => b.textContent)).toEqual(['seed mass', 'seed length']);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(screen.getByRole('heading', { level: 3, name: 'seed mass' })).toBeInTheDocument();
    expect(screen.getByText('Quantitative')).toBeInTheDocument();
  });

  it('links Trait details to the trait page', async () => {
    await openPage();
    expect(await screen.findByRole('link', { name: 'Trait details' })).toHaveAttribute(
      'href',
      `/app/traits/${SEED_MASS.id}`,
    );
  });

  it('a trait given alone selects its category and the trait', async () => {
    await openPage('/app/maps?trait=flower_colour');
    const list = await tabs();
    expect(list[1]).toHaveAttribute('aria-selected', 'true');
    expect(traitButtons('Flower')[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { level: 3, name: 'flower colour' })).toBeInTheDocument();
  });

  it('a trait from another category than the one given wins: its own category and itself', async () => {
    await openPage('/app/maps?category=seed&trait=flower_colour');
    const list = await tabs();
    expect(list[1]).toHaveAttribute('aria-selected', 'true');
    expect(traitButtons('Flower')[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { level: 3, name: 'flower colour' })).toBeInTheDocument();
  });

  it('an unknown category and trait fall back to the defaults', async () => {
    await openPage('/app/maps?category=nope&trait=nope');
    const list = await tabs();
    expect(list[0]).toHaveAttribute('aria-selected', 'true');
    expect(traitButtons('Seed')[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('a mapless trait key falls back to the first trait of the category', async () => {
    await openPage('/app/maps?category=seed&trait=seed_width');
    await tabs();
    expect(traitButtons('Seed')[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('a tab click selects its category and clears the trait; a trait click keeps the category', async () => {
    const user = userEvent.setup();
    const { router } = await openPage('/app/maps?trait=seed_length');
    await user.click((await tabs())[1] as HTMLElement);
    await waitFor(() => expect(router.state.location.search).toEqual({ category: 'flower' }));
    expect(screen.getByRole('heading', { level: 3, name: 'flower colour' })).toBeInTheDocument();

    await user.click((await tabs())[0] as HTMLElement);
    await user.click(traitButtons('Seed')[1] as HTMLElement);
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ category: 'seed', trait: 'seed_length' }),
    );
  });

  it('says so when there are no maps at all', async () => {
    maps.useMaps.mockReturnValue(queryResult([]));
    await openPage();
    expect(await screen.findByText('No maps yet.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('reads Data › Maps in the breadcrumb, Maps once and current', async () => {
    await openPage();
    await tabs();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toHaveTextContent('Data');
    // getByText throws on a second "Maps": the trail must not read Data › Maps › Maps.
    expect(within(nav).getByText('Maps')).toHaveAttribute('aria-current', 'page');
  });

  it('RFC-13 R4 a permission failure on the maps query shows the permission sentence', async () => {
    maps.useMaps.mockReturnValue({
      data: undefined,
      isPending: false,
      isSuccess: false,
      isError: true,
      error: new ApiError(403, 'PERMISSION_DENIED', 'x'),
    });
    await openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
  });
});

describe('RFC-76 R7 MapsPage maps of the selected trait', () => {
  it('shows Data completeness, then Summary statistics Mean/Min/Max/SD, missing kinds left out', async () => {
    await openPage();
    await tabs();
    expect(headingTexts(4)).toEqual(['Data completeness', 'Summary statistics']);
    expect(
      screen.getByText(
        'Share of tree species with data for this trait in each TDWG level-3 region.',
      ),
    ).toBeInTheDocument();
    expect(headingTexts(5)).toEqual(['Mean', 'Max', 'SD']);
    expect(screen.getByText('Mean of the species means in the region.')).toBeInTheDocument();
    expect(screen.getByText('Highest species mean in the region.')).toBeInTheDocument();
    expect(
      screen.getByText('Standard deviation of the species means in the region.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Lowest species mean in the region.')).not.toBeInTheDocument();
    // completeness + mean + max + sd.
    expect(screen.getAllByText(`TDWG level 3 regions · ${VERSION}`)).toHaveLength(4);
    expect(
      within(screen.getByRole('tabpanel'))
        .getAllByRole('img')
        .map((img) => img.getAttribute('src')),
    ).toEqual(
      ['completeness', 'mean', 'max', 'sd'].map((kind) => mapFileUrl(`seed_mass_${kind}.svg`)),
    );
    expect(screen.getByRole('img', { name: 'Mean map of seed mass' })).toBeInTheDocument();
  });

  it('shows Prevalence by level in dictionary level order, a level without a map left out', async () => {
    await openPage('/app/maps?category=flower');
    await tabs();
    expect(headingTexts(4)).toEqual(['Data completeness', 'Prevalence by level']);
    expect(
      screen.getByText(
        "Share of the region's tree species with data for this trait that hold each level; a species with several levels counts under each.",
      ),
    ).toBeInTheDocument();
    expect(headingTexts(5)).toEqual(['white', 'blue']);
    expect(
      screen.getByRole('img', { name: 'Prevalence map of flower colour: blue' }),
    ).toHaveAttribute('src', mapFileUrl('flower_colour_prevalence_blue.svg'));
  });

  it('leaves the completeness section out when the trait has no completeness map', async () => {
    await openPage('/app/maps?trait=leaf_area');
    await tabs();
    expect(headingTexts(4)).toEqual(['Summary statistics']);
  });
});

describe('RFC-76 R7 MapsPage keyboard', () => {
  it('Left/Right, Home/End move between the category tabs, selecting and focusing, wrapping', async () => {
    const user = userEvent.setup();
    const { router } = await openPage();
    const [seed] = await tabs();
    await user.click(seed as HTMLElement);

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(currentTabs()[1]).toHaveFocus());
    expect(router.state.location.search).toEqual({ category: 'flower' });
    expect((await tabs())[1]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{End}');
    await waitFor(() => expect(currentTabs()[2]).toHaveFocus());
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(currentTabs()[0]).toHaveFocus());
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(currentTabs()[2]).toHaveFocus());
    await user.keyboard('{Home}');
    await waitFor(() => expect(currentTabs()[0]).toHaveFocus());
    await waitFor(() => expect(router.state.location.search).toEqual({ category: 'seed' }));
  });

  it('arrow keys move between the trait buttons, selecting and focusing, wrapping', async () => {
    const user = userEvent.setup();
    const { router } = await openPage();
    await tabs();
    await user.click(traitButtons('Seed')[0] as HTMLElement);
    // Every trait button stays tabbable (no roving tabIndex); only Tab order
    // is native, arrow keys still move selection and focus among them.
    expect(traitButtons('Seed').map((b) => b.tabIndex)).toEqual([0, 0]);

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(traitButtons('Seed')[1]).toHaveFocus());
    expect(traitButtons('Seed')[1]).toHaveAttribute('aria-pressed', 'true');
    expect(router.state.location.search).toEqual({ category: 'seed', trait: 'seed_length' });

    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(traitButtons('Seed')[0]).toHaveFocus());
    await user.keyboard('{ArrowUp}');
    await waitFor(() => expect(traitButtons('Seed')[1]).toHaveFocus());
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(traitButtons('Seed')[0]).toHaveFocus());
    expect(screen.getByRole('heading', { level: 3, name: 'seed mass' })).toBeInTheDocument();
  });

  it('the full-size viewer opens on a map and Left/Right step through the trait maps in page order, wrapping', async () => {
    const user = userEvent.setup();
    await openPage();
    await tabs();
    await user.click(
      screen.getByRole('button', { name: 'Data completeness map of seed mass, open full size' }),
    );
    const dialog = screen.getByRole('dialog');
    const shown = () => within(dialog).getByRole('img');
    expect(within(dialog).getByRole('heading', { name: 'Data completeness' })).toBeInTheDocument();
    expect(shown()).toHaveAttribute('src', mapFileUrl('seed_mass_completeness.svg'));
    expect(within(dialog).getByText('Data completeness map of seed mass')).toBeInTheDocument();

    await user.keyboard('{ArrowRight}');
    expect(within(dialog).getByRole('heading', { name: 'Mean' })).toBeInTheDocument();
    expect(shown()).toHaveAttribute('src', mapFileUrl('seed_mass_mean.svg'));
    expect(shown()).toHaveAttribute('alt', 'Mean map of seed mass');

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(within(dialog).getByRole('heading', { name: 'SD' })).toBeInTheDocument();
    expect(shown()).toHaveAttribute('src', mapFileUrl('seed_mass_sd.svg'));

    await user.keyboard('{ArrowRight}');
    expect(shown()).toHaveAttribute('src', mapFileUrl('seed_mass_completeness.svg'));

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the viewer opens on the map clicked, not the first one', async () => {
    const user = userEvent.setup();
    await openPage('/app/maps?category=flower');
    await tabs();
    await user.click(
      screen.getByRole('button', {
        name: 'Prevalence map of flower colour: blue, open full size',
      }),
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'blue' })).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(within(dialog).getByRole('heading', { name: 'Data completeness' })).toBeInTheDocument();
  });
});

// A synchronous re-query of the tabs for use inside `waitFor` callbacks.
function currentTabs() {
  return within(screen.getByRole('tablist', { name: 'Trait categories' })).getAllByRole('tab');
}
