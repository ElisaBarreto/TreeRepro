import { screen, within } from '@testing-library/react';
import type { Dictionary, MapEntry, MeResponse } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const SEED_MASS = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f01',
  key: 'seed_mass',
  valueType: 'quantitative' as const,
  unit: 'mg',
  description: 'Mass of one dry seed.',
  active: true,
  speciesCount: 3,
  levels: [],
};
const FLOWER_COLOUR = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f02',
  key: 'flower_colour',
  valueType: 'categorical' as const,
  unit: null,
  description: 'The colour of the flower.',
  active: true,
  speciesCount: 5,
  levels: [{ id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f21', key: 'red', sortOrder: 0, active: true }],
};
const LEAF_SHAPE = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f03',
  key: 'leaf_shape',
  valueType: 'categorical' as const,
  unit: null,
  description: 'The shape of the leaf.',
  active: true,
  speciesCount: 2,
  levels: [],
};
const FRUIT_TYPE = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f04',
  key: 'fruit_type',
  valueType: 'categorical' as const,
  unit: null,
  description: 'The type of fruit.',
  active: true,
  speciesCount: 1,
  levels: [],
};

const DICTIONARY: Dictionary = [
  { key: 'seed', label: 'Seed', traits: [SEED_MASS] },
  { key: 'flower', label: 'Flower', traits: [FLOWER_COLOUR, LEAF_SHAPE] },
  { key: 'fruit', label: 'Fruit', traits: [FRUIT_TYPE] },
];

const MAP_ENTRIES: MapEntry[] = [
  {
    traitId: SEED_MASS.id,
    kind: 'mean',
    levelId: null,
    file: 'seed_mass_mean.svg',
    dataVersion: '2026-09-01',
  },
  {
    traitId: FLOWER_COLOUR.id,
    kind: 'completeness',
    levelId: null,
    file: 'flower_colour_completeness.svg',
    dataVersion: '2026-09-01',
  },
  {
    traitId: FLOWER_COLOUR.id,
    kind: 'prevalence',
    levelId: FLOWER_COLOUR.levels[0]?.id ?? null,
    file: 'flower_colour_prevalence_red.svg',
    dataVersion: '2026-09-01',
  },
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

async function openPage() {
  const utils = renderAt('/app/maps');
  expect(await screen.findByRole('heading', { name: 'Maps' })).toBeInTheDocument();
  return utils;
}

describe('RFC-76 R6 MapsPage', () => {
  it('lists only the categories with maps, in dictionary order, as jump-bar anchors', async () => {
    await openPage();
    const nav = await screen.findByRole('navigation', { name: 'Trait categories' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Seed', 'Flower']);
    expect(links[0]).toHaveAttribute('href', '#seed');
    expect(links[1]).toHaveAttribute('href', '#flower');
    expect(screen.queryByText('Fruit')).not.toBeInTheDocument();
  });

  it('shows one card per trait with maps, linking to its trait, and drops the trait without maps', async () => {
    await openPage();
    const seedSection = document.getElementById('seed') as HTMLElement;
    expect(seedSection).toBeInTheDocument();
    expect(within(seedSection).getByRole('heading', { name: 'Seed' })).toBeInTheDocument();
    const seedLink = within(seedSection).getByRole('link', { name: /seed mass/ });
    expect(seedLink).toHaveAttribute('href', `/app/maps/${SEED_MASS.id}`);
    expect(seedLink).toHaveTextContent('Quantitative');
    const seedImg = within(seedLink).getByRole('img');
    expect(seedImg).toHaveAttribute('src', mapFileUrl('seed_mass_mean.svg'));

    const flowerSection = document.getElementById('flower') as HTMLElement;
    expect(flowerSection).toBeInTheDocument();
    const flowerLink = within(flowerSection).getByRole('link', { name: /flower colour/ });
    expect(flowerLink).toHaveAttribute('href', `/app/maps/${FLOWER_COLOUR.id}`);
    expect(flowerLink).toHaveTextContent('Categorical');
    const flowerImg = within(flowerLink).getByRole('img');
    expect(flowerImg).toHaveAttribute('src', mapFileUrl('flower_colour_completeness.svg'));

    // leaf_shape has no maps in the manifest, so it never gets a card.
    expect(screen.queryByText('leaf shape')).not.toBeInTheDocument();
    // fruit_type's category has no trait with maps, so the whole section is gone.
    expect(document.getElementById('fruit')).not.toBeInTheDocument();
  });

  it('says so when there are no maps at all', async () => {
    maps.useMaps.mockReturnValue(queryResult([]));
    await openPage();
    expect(await screen.findByText('No maps yet.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Trait categories' })).not.toBeInTheDocument();
  });
});
