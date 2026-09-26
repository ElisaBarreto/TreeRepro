import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createTrait } from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { traitLevels } from '../db/schema/dictionary.ts';
import { checkMaps } from './check.ts';

const HEADER = 'trait_key,map_kind,level_key,file,data_version';
const tag = () => randomBytes(4).toString('hex');

/** A maps directory of its own: `manifest.csv` plus an empty file per name (bytes never read). */
async function mapsDir(rows: string[], files: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'check-maps-'));
  await writeFile(join(dir, 'manifest.csv'), `${[HEADER, ...rows].join('\n')}\n`);
  for (const name of files) await writeFile(join(dir, name), '');
  return dir;
}

describe('checkMaps (RFC-76 R2)', () => {
  const t = useTestDb();
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('reports no problems and counts every row when the manifest agrees with the dictionary', async () => {
    const s = tag();
    const cat = await createTrait(t.db, { key: `chk_cat_${s}`, levels: ['Red', 'blue'] });
    const num = await createTrait(t.db, { key: `chk_num_${s}`, valueType: 'quantitative' });
    dir = await mapsDir(
      [
        `${cat.key},completeness,,a-${s}.svg,2026-09-01`,
        `${cat.key},prevalence,red,b-${s}.svg,2026-09-01`,
        `${num.key},mean,,c-${s}.svg,2026-09-01`,
      ],
      [`a-${s}.svg`, `b-${s}.svg`, `c-${s}.svg`],
    );
    expect(await checkMaps(t.db, dir)).toEqual({ shown: 3, problems: [] });
  });

  it('reports an unknown trait, naming the line', async () => {
    const s = tag();
    dir = await mapsDir([`nope_${s},completeness,,a-${s}.svg,2026-09-01`], [`a-${s}.svg`]);
    expect(await checkMaps(t.db, dir)).toEqual({
      shown: 0,
      problems: [`manifest line 2: unknown trait nope_${s}`],
    });
  });

  it('reports a kind that does not fit the trait value type', async () => {
    const s = tag();
    const cat = await createTrait(t.db, { key: `chk_misfit_${s}`, levels: ['x'] });
    dir = await mapsDir([`${cat.key},mean,,a-${s}.svg,2026-09-01`], [`a-${s}.svg`]);
    expect(await checkMaps(t.db, dir)).toEqual({
      shown: 0,
      problems: [`manifest line 2: mean does not fit categorical trait ${cat.key}`],
    });
  });

  it('reports a prevalence level unknown to the trait, including a level renamed after the manifest was written', async () => {
    const s = tag();
    const trait = await createTrait(t.db, { key: `chk_lvl_${s}`, levels: ['old_key'] });
    await t.db
      .update(traitLevels)
      .set({ key: 'new_key' })
      .where(eq(traitLevels.id, trait.levels[0]?.id as string));
    dir = await mapsDir([`${trait.key},prevalence,old_key,a-${s}.svg,2026-09-01`], [`a-${s}.svg`]);
    expect(await checkMaps(t.db, dir)).toEqual({
      shown: 0,
      problems: [`manifest line 2: unknown level old_key for trait ${trait.key}`],
    });
  });

  it('accepts a level match case-insensitively', async () => {
    const s = tag();
    const trait = await createTrait(t.db, { key: `chk_ci_${s}`, levels: ['Red'] });
    dir = await mapsDir([`${trait.key},prevalence,red,a-${s}.svg,2026-09-01`], [`a-${s}.svg`]);
    expect(await checkMaps(t.db, dir)).toEqual({ shown: 1, problems: [] });
  });

  it('reports a malformed manifest as the parser message, shown 0', async () => {
    dir = await mkdtemp(join(tmpdir(), 'check-maps-'));
    await writeFile(join(dir, 'manifest.csv'), 'wrong,header\n');
    const result = await checkMaps(t.db, dir);
    expect(result.shown).toBe(0);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/line 1/);
  });

  it('answers no problems and nothing shown for a directory that does not exist', async () => {
    dir = await mkdtemp(join(tmpdir(), 'check-maps-'));
    const missing = join(dir, 'does-not-exist');
    expect(await checkMaps(t.db, missing)).toEqual({ shown: 0, problems: [] });
  });
});
