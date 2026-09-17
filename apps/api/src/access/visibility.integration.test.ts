import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createSpecies, createTrait } from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { traits } from '../db/schema/dictionary.ts';
import { species } from '../db/schema/taxa.ts';
import { speciesVisible, traitVisible, visibilityFor } from './visibility.ts';

describe('RFC-33 R1 visibilityFor', () => {
  it('reads dataset.read_inactive; plotIds is null until plan 08b', () => {
    expect(visibilityFor(new Set(['dataset.read']))).toEqual({ inactive: false, plotIds: null });
    expect(visibilityFor(new Set(['dataset.read', 'dataset.read_inactive']))).toEqual({
      inactive: true,
      plotIds: null,
    });
  });
});

describe('RFC-33 R2 predicates', () => {
  const t = useTestDb();

  it('hide an inactive species and trait from a restricted viewer only', async () => {
    const hidden = await createSpecies(t.db);
    await t.db.update(species).set({ active: false }).where(sql`${species.id} = ${hidden.id}`);
    const shown = await createSpecies(t.db);
    const rows = async (v: typeof RESTRICTED) =>
      (
        await t.db
          .select({ id: species.id })
          .from(species)
          .where(sql`${species.id} in (${hidden.id}, ${shown.id}) and ${speciesVisible(v)}`)
      ).map((r) => r.id);
    expect(await rows(RESTRICTED)).toEqual([shown.id]);
    expect((await rows(UNRESTRICTED)).sort()).toEqual([hidden.id, shown.id].sort());

    const off = await createTrait(t.db, { active: false });
    const [restricted] = await t.db
      .select({ id: traits.id })
      .from(traits)
      .where(sql`${traits.id} = ${off.id} and ${traitVisible(RESTRICTED)}`);
    expect(restricted).toBeUndefined();
    const [unrestricted] = await t.db
      .select({ id: traits.id })
      .from(traits)
      .where(sql`${traits.id} = ${off.id} and ${traitVisible(UNRESTRICTED)}`);
    expect(unrestricted?.id).toBe(off.id);
  });
});
