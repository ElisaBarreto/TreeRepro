import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { useTestApp } from '../../test/helpers/app.ts';
import { createTrait } from '../../test/helpers/dataset.ts';
import { figure, figuresDir } from '../../test/helpers/phylogenies.ts';
import type { Visibility } from '../access/visibility.ts';
import { figurePath, listFigures } from './figures.ts';

const VIEWER: Visibility = { inactive: false, plotIds: null, platform: 'treerepro' };

describe('RFC-79 R1, R2, R4 listFigures', () => {
  const t = useTestApp();

  it('lists coverage first, then visible traits by key, each with its mtime as version', async () => {
    const b = await createTrait(t.db, { key: `phy_b_${Date.now()}` });
    const a = await createTrait(t.db, { key: `phy_a_${Date.now()}` });
    const dir = figuresDir([...figure(b.key), ...figure('coverage'), ...figure(a.key)]);
    expect(await listFigures(t.db, VIEWER, dir)).toEqual([
      { key: 'coverage', traitId: null, version: '1700000000000' },
      { key: a.key, traitId: a.id, version: '1700000000000' },
      { key: b.key, traitId: b.id, version: '1700000000000' },
    ]);
  });

  it('omits a PNG without its display copy', async () => {
    const a = await createTrait(t.db, { key: `phy_nodisplay_${Date.now()}` });
    const dir = figuresDir([`treerepro/trait_${a.key}.png`]);
    expect(await listFigures(t.db, VIEWER, dir)).toEqual([]);
  });

  it('omits a file whose key is not a trait, other than coverage', async () => {
    const dir = figuresDir(figure('no_such_trait_xyz'));
    expect(await listFigures(t.db, VIEWER, dir)).toEqual([]);
  });

  it('omits an inactive trait figure unless the viewer holds dataset.read_inactive', async () => {
    const off = await createTrait(t.db, { key: `phy_off_${Date.now()}`, active: false });
    const dir = figuresDir(figure(off.key));
    expect(await listFigures(t.db, VIEWER, dir)).toEqual([]);
    expect(await listFigures(t.db, { ...VIEWER, inactive: true }, dir)).toEqual([
      { key: off.key, traitId: off.id, version: '1700000000000' },
    ]);
  });

  it('ignores the plot restriction', async () => {
    const a = await createTrait(t.db, { key: `phy_plot_${Date.now()}` });
    const dir = figuresDir(figure(a.key));
    expect(await listFigures(t.db, { ...VIEWER, plotIds: [] }, dir)).toHaveLength(1);
  });

  it('reads only the request platform directory: plantrepro with only treerepro/ is []', async () => {
    const dir = figuresDir(figure('coverage'));
    expect(await listFigures(t.db, { ...VIEWER, platform: 'plantrepro' }, dir)).toEqual([]);
  });

  it('a missing directory is []', async () => {
    expect(await listFigures(t.db, VIEWER, join(tmpdir(), 'phylo-missing-dir'))).toEqual([]);
  });

  it('figurePath names the PNG or the display copy inside the platform directory', () => {
    expect(figurePath('/d', 'plantrepro', 'seed_mass', 'full')).toBe(
      '/d/plantrepro/trait_seed_mass.png',
    );
    expect(figurePath('/d', 'treerepro', 'coverage', 'display')).toBe(
      '/d/treerepro/display/trait_coverage.jpg',
    );
  });
});
