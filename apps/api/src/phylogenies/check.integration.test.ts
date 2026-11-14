import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useTestApp } from '../../test/helpers/app.ts';
import { createTrait } from '../../test/helpers/dataset.ts';
import { figure, figuresDir } from '../../test/helpers/phylogenies.ts';
import { traits } from '../db/schema/dictionary.ts';
import { checkFigures } from './check.ts';

describe('RFC-79 R5 checkFigures', () => {
  const t = useTestApp();

  it('ok for matching names with display copies, listing active traits without a figure', async () => {
    const a = await createTrait(t.db, { key: `chk_a_${Date.now()}` });
    const b = await createTrait(t.db, { key: `chk_b_${Date.now()}` });
    const dir = join(figuresDir([...figure('coverage'), ...figure(a.key)]), 'treerepro');
    const report = await checkFigures(t.db, dir);
    expect(report).toMatchObject({
      ok: true,
      unknown: [],
      missingDisplay: [],
      coverageClash: false,
    });
    expect(report.withoutFigure).toContain(b.key);
    expect(report.withoutFigure).not.toContain(a.key);
  });

  it('refuses an unknown name', async () => {
    const dir = join(figuresDir(figure('not_a_trait_zz')), 'treerepro');
    expect(await checkFigures(t.db, dir)).toMatchObject({ ok: false, unknown: ['not_a_trait_zz'] });
  });

  it('refuses a PNG without display copy', async () => {
    const a = await createTrait(t.db, { key: `chk_nod_${Date.now()}` });
    const dir = join(figuresDir([`treerepro/trait_${a.key}.png`]), 'treerepro');
    expect(await checkFigures(t.db, dir)).toMatchObject({ ok: false, missingDisplay: [a.key] });
  });

  it('refuses when a trait is keyed coverage', async () => {
    // Renamed back afterwards: the dictionary is shared by every test file.
    const clash = await createTrait(t.db, { key: `chk_clash_${Date.now()}` });
    await t.db.update(traits).set({ key: 'coverage' }).where(eq(traits.id, clash.id));
    try {
      const dir = join(figuresDir(figure('coverage')), 'treerepro');
      expect(await checkFigures(t.db, dir)).toMatchObject({ ok: false, coverageClash: true });
    } finally {
      await t.db.update(traits).set({ key: clash.key }).where(eq(traits.id, clash.id));
    }
  });

  it('refuses a missing directory', async () => {
    expect(await checkFigures(t.db, '/no/such/phylogenies/dir')).toMatchObject({
      ok: false,
      missingDir: true,
    });
  });
});
