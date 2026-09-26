import { screen, within } from '@testing-library/react';
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
// only the cross-module import `TraitMapsPage.tsx` holds of `useMaps` itself
// is (see `MapsPage.test.tsx`).
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

const WHITE_LEVEL = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f21',
  key: 'white',
  sortOrder: 1,
  active: true,
};
const RED_LEVEL = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f22',
  key: 'red',
  sortOrder: 2,
  active: true,
};
const BLUE_LEVEL = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f23',
  key: 'blue',
  sortOrder: 3,
  active: true,
};
const FLOWER_COLOUR = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f02',
  key: 'flower_colour',
  valueType: 'categorical' as const,
  unit: null,
  description: 'The colour of the flower.',
  active: true,
  speciesCount: 5,
  levels: [WHITE_LEVEL, RED_LEVEL, BLUE_LEVEL],
};
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
const TRAIT_A = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f31',
  key: 'trait_a',
  valueType: 'quantitative' as const,
  unit: null,
  description: 'Trait A.',
  active: true,
  speciesCount: 1,
  levels: [],
};
const TRAIT_B = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f32',
  key: 'trait_b',
  valueType: 'quantitative' as const,
  unit: null,
  description: 'Trait B.',
  active: true,
  speciesCount: 1,
  levels: [],
};
const TRAIT_C = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f33',
  key: 'trait_c',
  valueType: 'quantitative' as const,
  unit: null,
  description: 'Trait C.',
  active: true,
  speciesCount: 1,
  levels: [],
};
const TRAIT_D = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f34',
  key: 'trait_d',
  valueType: 'quantitative' as const,
  unit: null,
  description: 'Trait D, no maps.',
  active: true,
  speciesCount: 1,
  levels: [],
};

const DICTIONARY: Dictionary = [
  { key: 'flower', label: 'Flower', traits: [FLOWER_COLOUR] },
  { key: 'seed', label: 'Seed', traits: [SEED_MASS] },
  { key: 'fruit', label: 'Fruit', traits: [TRAIT_A, TRAIT_B, TRAIT_C, TRAIT_D] },
];

const VERSION = '2026-09-01';

const MAP_ENTRIES: MapEntry[] = [
  // Manifest order for flower_colour: blue, completeness, white — no red.
  {
    traitId: FLOWER_COLOUR.id,
    kind: 'prevalence',
    levelId: BLUE_LEVEL.id,
    file: 'flower_colour_prevalence_blue.svg',
    dataVersion: VERSION,
  },
  {
    traitId: FLOWER_COLOUR.id,
    kind: 'completeness',
    levelId: null,
    file: 'flower_colour_completeness.svg',
    dataVersion: VERSION,
  },
  {
    traitId: FLOWER_COLOUR.id,
    kind: 'prevalence',
    levelId: WHITE_LEVEL.id,
    file: 'flower_colour_prevalence_white.svg',
    dataVersion: VERSION,
  },
  // Only mean and sd for seed_mass.
  {
    traitId: SEED_MASS.id,
    kind: 'mean',
    levelId: null,
    file: 'seed_mass_mean.svg',
    dataVersion: VERSION,
  },
  {
    traitId: SEED_MASS.id,
    kind: 'sd',
    levelId: null,
    file: 'seed_mass_sd.svg',
    dataVersion: VERSION,
  },
  // A, B, C each have one map; D has none.
  {
    traitId: TRAIT_A.id,
    kind: 'completeness',
    levelId: null,
    file: 'trait_a_completeness.svg',
    dataVersion: VERSION,
  },
  {
    traitId: TRAIT_B.id,
    kind: 'completeness',
    levelId: null,
    file: 'trait_b_completeness.svg',
    dataVersion: VERSION,
  },
  {
    traitId: TRAIT_C.id,
    kind: 'completeness',
    levelId: null,
    file: 'trait_c_completeness.svg',
    dataVersion: VERSION,
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

async function openPage(traitId: string) {
  const utils = renderAt(`/app/maps/${traitId}`);
  await screen.findByRole('navigation', { name: 'Breadcrumb' });
  return utils;
}

describe('RFC-76 R7 TraitMapsPage', () => {
  it('puts completeness first and the prevalence grid in dictionary level order, dropping the level with no entry', async () => {
    await openPage(FLOWER_COLOUR.id);
    expect(await screen.findByRole('heading', { name: 'flower colour' })).toBeInTheDocument();

    const completenessSection = screen
      .getByRole('heading', { name: 'Data completeness' })
      .closest('section') as HTMLElement;
    const completenessImg = within(completenessSection).getByRole('img');
    expect(completenessImg).toHaveAttribute('src', mapFileUrl('flower_colour_completeness.svg'));
    expect(completenessImg).toHaveAttribute('alt', 'Data completeness map of flower colour');

    const prevalenceSection = screen
      .getByRole('heading', { name: 'Prevalence by level' })
      .closest('section') as HTMLElement;
    expect(screen.queryByText('red')).not.toBeInTheDocument();
    const levelHeadings = within(prevalenceSection).getAllByRole('heading', { level: 3 });
    expect(levelHeadings.map((h) => h.textContent)).toEqual(['white', 'blue']);

    const images = within(prevalenceSection).getAllByRole('img');
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute('src', mapFileUrl('flower_colour_prevalence_white.svg'));
    expect(images[0]).toHaveAttribute('alt', 'Prevalence map of flower colour: white');
    expect(images[1]).toHaveAttribute('src', mapFileUrl('flower_colour_prevalence_blue.svg'));
    expect(images[1]).toHaveAttribute('alt', 'Prevalence map of flower colour: blue');

    // The document order runs completeness, then the prevalence grid.
    expect(
      completenessSection.compareDocumentPosition(prevalenceSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows a Mean/SD grid for a quantitative trait, leaving out the missing Min and Max', async () => {
    await openPage(SEED_MASS.id);
    expect(await screen.findByRole('heading', { name: 'seed mass' })).toBeInTheDocument();
    const summarySection = screen
      .getByRole('heading', { name: 'Summary statistics' })
      .closest('section') as HTMLElement;
    const headings = within(summarySection).getAllByRole('heading', { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(['Mean', 'SD']);
    expect(within(summarySection).queryByRole('heading', { name: 'Min' })).not.toBeInTheDocument();
    expect(within(summarySection).queryByRole('heading', { name: 'Max' })).not.toBeInTheDocument();
  });

  it('every map caption reads the TDWG level and the manifest data version', async () => {
    await openPage(FLOWER_COLOUR.id);
    await screen.findByRole('heading', { name: 'flower colour' });
    const captions = screen.getAllByText('TDWG level 3 regions · 2026-09-01');
    // completeness + white + blue.
    expect(captions).toHaveLength(3);
  });

  it('registers the breadcrumb Data › Maps › <category> › <trait>, the category crumb linking to /app/maps', async () => {
    await openPage(FLOWER_COLOUR.id);
    await screen.findByRole('heading', { name: 'flower colour' });
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const mapsLink = within(nav).getByRole('link', { name: 'Maps' });
    expect(mapsLink).toHaveAttribute('href', '/app/maps');
    const categoryLink = within(nav).getByRole('link', { name: 'Flower' });
    expect(categoryLink).toHaveAttribute('href', '/app/maps');
    expect(within(nav).getByText('flower colour')).toHaveAttribute('aria-current', 'page');
  });

  it('links Previous/Next through the traits with maps in the same category, in dictionary order', async () => {
    await openPage(TRAIT_B.id);
    await screen.findByRole('heading', { name: 'trait b' });
    const previous = screen.getByRole('link', { name: 'Previous: trait a' });
    expect(previous).toHaveAttribute('href', `/app/maps/${TRAIT_A.id}`);
    const next = screen.getByRole('link', { name: 'Next: trait c' });
    expect(next).toHaveAttribute('href', `/app/maps/${TRAIT_C.id}`);
  });

  it('has no Next link on the last trait with maps — the trait after it has none', async () => {
    await openPage(TRAIT_C.id);
    await screen.findByRole('heading', { name: 'trait c' });
    expect(screen.getByRole('link', { name: 'Previous: trait b' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Next:/ })).not.toBeInTheDocument();
  });

  it('links Trait details to the trait detail page', async () => {
    await openPage(FLOWER_COLOUR.id);
    await screen.findByRole('heading', { name: 'flower colour' });
    expect(screen.getByRole('link', { name: 'Trait details' })).toHaveAttribute(
      'href',
      `/app/traits/${FLOWER_COLOUR.id}`,
    );
  });

  it('reads "No maps for this trait." for a trait with no maps', async () => {
    await openPage(TRAIT_D.id);
    expect(await screen.findByText('No maps for this trait.')).toBeInTheDocument();
  });

  it('reads "No maps for this trait." for a trait id not in the dictionary', async () => {
    await openPage('018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8fff');
    expect(await screen.findByText('No maps for this trait.')).toBeInTheDocument();
  });

  it('RFC-13 R4 a permission failure on the maps query shows the permission sentence', async () => {
    maps.useMaps.mockReturnValue({
      data: undefined,
      isPending: false,
      isSuccess: false,
      isError: true,
      error: new ApiError(403, 'PERMISSION_DENIED', 'x'),
    });
    renderAt(`/app/maps/${FLOWER_COLOUR.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
  });
});
