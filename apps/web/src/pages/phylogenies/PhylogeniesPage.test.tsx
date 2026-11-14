import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Dictionary, MeResponse, PhylogenyFigure } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ME } from '../../test/fixtures.ts';
import { renderAt } from '../../test/router.tsx';

const auth = vi.hoisted(() => ({ fetchMe: vi.fn() }));
vi.mock('../../api/auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/auth.ts')>()),
  fetchMe: auth.fetchMe,
}));
const dataset = vi.hoisted(() => ({ fetchDictionary: vi.fn() }));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));
// `usePhylogenies` is mocked directly: it calls `fetchPhylogenies` through its
// own module, which `vi.mock` never reaches (see MapsPage.test.tsx).
const phylo = vi.hoisted(() => ({ usePhylogenies: vi.fn() }));
vi.mock('../../api/phylogenies.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/phylogenies.ts')>()),
  ...phylo,
}));
const platform = vi.hoisted(() => ({ value: 'treerepro' as 'treerepro' | 'plantrepro' }));
vi.mock('../../lib/platform.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/platform.ts')>();
  return {
    ...actual,
    currentPlatform: () => platform.value,
    platformCopy: (p?: 'treerepro' | 'plantrepro') => actual.platformCopy(p ?? platform.value),
  };
});

const READER: MeResponse = { ...ME, permissions: ['dataset.read'] };

const trait = (n: number, key: string) => ({
  id: `018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f0${n}`,
  key,
  valueType: 'quantitative' as const,
  unit: 'mg',
  description: `${key}.`,
  active: true,
  speciesCount: 3,
  levels: [],
});
const SEED_MASS = trait(1, 'seed_mass');
const SEED_WIDTH = trait(2, 'seed_width');
const FRUIT_TYPE = trait(3, 'fruit_type');
const LEAF_AREA = trait(4, 'leaf_area'); // no figure: its category is left out

const DICTIONARY: Dictionary = [
  { key: 'seed', label: 'Seed', traits: [SEED_MASS, SEED_WIDTH] },
  { key: 'leaf', label: 'Leaf', traits: [LEAF_AREA] },
  { key: 'fruit', label: 'Fruit', traits: [FRUIT_TYPE] },
];

const fig = (t: { id: string; key: string } | null): PhylogenyFigure => ({
  key: t?.key ?? 'coverage',
  traitId: t?.id ?? null,
  version: '1',
});
const FIGURES = [fig(null), fig(FRUIT_TYPE), fig(SEED_MASS), fig(SEED_WIDTH)];

beforeEach(() => {
  platform.value = 'treerepro';
  auth.fetchMe.mockReset().mockResolvedValue(READER);
  dataset.fetchDictionary.mockReset().mockResolvedValue(DICTIONARY);
  phylo.usePhylogenies
    .mockReset()
    .mockReturnValue({ isPending: false, isSuccess: true, data: FIGURES });
});

const figureImg = () => screen.getByRole('img', { name: /phylogeny/i });

describe('RFC-79 R6 PhylogeniesPage', () => {
  it('defaults to All traits and shows the coverage figure', async () => {
    renderAt('/app/phylogenies');
    const tab = await screen.findByRole('tab', { name: 'All traits' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(figureImg()).toHaveAttribute('src', '/api/phylogenies/files/coverage?size=display&v=1');
  });

  it('category tabs follow All traits, in dictionary order, only categories with figures', async () => {
    renderAt('/app/phylogenies');
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['All traits', 'Seed', 'Fruit']);
  });

  it('?trait= selects its category and shows that figure, headed by the trait name', async () => {
    renderAt('/app/phylogenies?trait=seed_width');
    expect(await screen.findByRole('tab', { name: 'Seed' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('button', { name: 'seed width' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('heading', { name: 'seed width' })).toBeInTheDocument();
    expect(figureImg()).toHaveAttribute(
      'src',
      '/api/phylogenies/files/seed_width?size=display&v=1',
    );
  });

  it('?category= alone selects its first trait with a figure', async () => {
    renderAt('/app/phylogenies?category=seed');
    expect(await screen.findByRole('button', { name: 'seed mass' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('an unknown trait key falls back to All traits', async () => {
    renderAt('/app/phylogenies?trait=leaf_area');
    expect(await screen.findByRole('tab', { name: 'All traits' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('arrow keys move between the tabs', async () => {
    renderAt('/app/phylogenies');
    const all = await screen.findByRole('tab', { name: 'All traits' });
    all.focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Seed' })).toHaveAttribute('aria-selected', 'true'),
    );
  });

  it('clicking the figure opens the viewer on it', async () => {
    renderAt('/app/phylogenies?trait=fruit_type');
    await userEvent.click(await screen.findByRole('button', { name: /open .*full size/i }));
    expect(screen.getByRole('dialog', { name: 'fruit type' })).toBeInTheDocument();
  });

  it('with no figures, says they are not available on TreeRepro yet', async () => {
    phylo.usePhylogenies.mockReturnValue({ isPending: false, isSuccess: true, data: [] });
    renderAt('/app/phylogenies');
    expect(
      await screen.findByText('Phylogenies are not available on TreeRepro yet.'),
    ).toBeInTheDocument();
  });

  it('on PlantRepro with no figures, names PlantRepro', async () => {
    platform.value = 'plantrepro';
    phylo.usePhylogenies.mockReturnValue({ isPending: false, isSuccess: true, data: [] });
    renderAt('/app/phylogenies');
    expect(
      await screen.findByText('Phylogenies are not available on PlantRepro yet.'),
    ).toBeInTheDocument();
  });

  it('the sidebar lists Phylogenies right after Maps', async () => {
    renderAt('/app/phylogenies');
    const data = await screen.findByRole('navigation', { name: 'Data' });
    const labels = within(data)
      .getAllByRole('link')
      .map((l) => l.textContent?.trim());
    expect(labels.indexOf('Phylogenies')).toBe(labels.indexOf('Maps') + 1);
  });
});
