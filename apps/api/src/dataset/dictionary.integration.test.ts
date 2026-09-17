import type { Dictionary } from '@treerepro/contracts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTrait } from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { traitLevels } from '../db/schema/dictionary.ts';
import { getDictionary, getTrait } from './dictionary.ts';

describe('RFC-62 R5 getDictionary', () => {
  const t = useTestDb();

  it('groups traits by category in dictionary order with their levels', async () => {
    const dictionary = await getDictionary(t.db, UNRESTRICTED);
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

describe('RFC-33 R3, RFC-62 R5 dictionary by viewer', () => {
  const t = useTestDb();
  it('omits an inactive trait and inactive levels for a restricted viewer', async () => {
    const trait = await createTrait(t.db, { levels: ['on', 'off'] });
    const offLevel = trait.levels[1] as { id: string };
    await t.db.update(traitLevels).set({ active: false }).where(eq(traitLevels.id, offLevel.id));
    const inactive = await createTrait(t.db, { active: false });
    const flat = (d: Dictionary) => d.flatMap((c) => c.traits);
    const restricted = flat(await getDictionary(t.db, RESTRICTED));
    expect(restricted.find((x) => x.id === inactive.id)).toBeUndefined();
    expect(restricted.find((x) => x.id === trait.id)?.levels.map((l) => l.key)).toEqual(['on']);
    const unrestricted = flat(await getDictionary(t.db, UNRESTRICTED));
    expect(unrestricted.find((x) => x.id === inactive.id)?.active).toBe(false);
    expect(unrestricted.find((x) => x.id === trait.id)?.levels).toHaveLength(2);
    expect(await getTrait(t.db, RESTRICTED, inactive.id)).toBeNull();
  });
});
