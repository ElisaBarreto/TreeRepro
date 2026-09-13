import { describe, expect, it } from 'vitest';
import { useTestDb } from '../../test/helpers/db.ts';
import { getDictionary } from './dictionary.ts';

describe('RFC-62 R5 getDictionary', () => {
  const t = useTestDb();

  it('groups traits by category in dictionary order with their levels', async () => {
    const dictionary = await getDictionary(t.db);
    expect(dictionary[0]?.key).toBe('dispersal');
    const flower = dictionary.find((c) => c.key === 'flower_color');
    const trait = flower?.traits.find((tr) => tr.key === 'flower_color');
    expect(trait).toMatchObject({ valueType: 'categorical', unit: null, active: true });
    // The seed script numbers levels with SQL `with ordinality`, which is 1-based.
    expect(trait?.levels[0]).toMatchObject({ key: 'black', sortOrder: 1, active: true });
    expect(trait?.levels.map((l) => l.key)).toContain('yellow');
    const keys = flower?.traits.map((tr) => tr.key) ?? [];
    expect(keys).toEqual([...keys].sort());
  });
});
