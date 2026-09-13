import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useTestDb } from '../../test/helpers/db.ts';
import { traitCategories, traitLevels, traits } from '../db/schema/dictionary.ts';
import { dictionaryPath, seedDictionary } from './seed.ts';

describe('RFC-62 R2 seedDictionary', () => {
  const t = useTestDb();

  it('loads the versioned dictionary: categories in first-appearance order, traits, levels in list order', async () => {
    // global-setup already seeded; a second run inserts nothing
    const report = await seedDictionary(t.db, dictionaryPath());
    expect(report).toEqual({ categories: 0, traits: 0, levels: 0 });

    const categories = await t.db
      .select()
      .from(traitCategories)
      .orderBy(asc(traitCategories.sortOrder));
    expect(categories.map((c) => c.key).slice(0, 4)).toEqual([
      'dispersal',
      'pollination',
      'reproduction',
      'fruit',
    ]);
    expect(categories.find((c) => c.key === 'fruit_color')?.label).toBe('Fruit Color');

    const [flowerColor] = await t.db.select().from(traits).where(eq(traits.key, 'flower_color'));
    expect(flowerColor).toMatchObject({
      categoryKey: 'flower_color',
      valueType: 'categorical',
      unit: null,
      active: true,
    });
    const [petalLength] = await t.db.select().from(traits).where(eq(traits.key, 'petal_length'));
    expect(petalLength).toMatchObject({
      categoryKey: 'flower',
      valueType: 'quantitative',
      unit: 'mm',
    });

    const levels = await t.db
      .select({ key: traitLevels.key, sortOrder: traitLevels.sortOrder })
      .from(traitLevels)
      .where(eq(traitLevels.traitId, flowerColor?.id as string))
      .orderBy(asc(traitLevels.sortOrder));
    expect(levels[0]).toEqual({ key: 'black', sortOrder: 1 });
    expect(levels.map((l) => l.key)).toContain('corolla_absent');
    const [quantitative] = await t.db.select().from(traits).where(eq(traits.key, 'seed_mass'));
    const none = await t.db
      .select()
      .from(traitLevels)
      .where(eq(traitLevels.traitId, quantitative?.id as string));
    expect(none).toEqual([]);
  });

  it('inserts only what is missing and never changes existing rows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dict-'));
    const file = join(dir, 'extra.csv');
    // The extra rows are appended after the real dictionary's full content
    // (not a two-row file of their own) so `zz_test_category`'s first
    // appearance (its `sort_order`, RFC-62 R2) lands after every real row —
    // a standalone extra file would give it row_no 2, sorting it second in
    // /api/traits ahead of nearly every real category for the rest of the
    // test run. The real file is CRLF-terminated; COPY's CSV reader commits
    // to whatever line ending the first line uses, so appending plain-LF
    // rows after it as-is makes it see an "unquoted newline" and (per the
    // postgres.js COPY-hang gotcha, since seedDictionary's pipeline has no
    // idle guard) the import hangs instead of erroring — normalise to LF
    // throughout before appending.
    const realDictionary = (await readFile(dictionaryPath(), 'utf8'))
      .replace(/\r\n/g, '\n')
      .replace(/\n$/, '');
    await writeFile(
      file,
      [
        realDictionary,
        'flower_color,flower_color,categorical,,CHANGED DESCRIPTION,black;blue;test_level_zz',
        'zz_test_trait,zz_test_category,quantitative,kg,A test trait,',
      ].join('\n'),
    );
    const report = await seedDictionary(t.db, file);
    expect(report).toEqual({ categories: 1, traits: 1, levels: 1 });
    const [flowerColor] = await t.db.select().from(traits).where(eq(traits.key, 'flower_color'));
    expect(flowerColor?.description).not.toBe('CHANGED DESCRIPTION');
    const again = await seedDictionary(t.db, file);
    expect(again).toEqual({ categories: 0, traits: 0, levels: 0 });
  });
});
