import type { Dictionary, Trait } from '@treerepro/contracts';
import { asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { traitCategories, traitLevels, traits } from '../db/schema/dictionary.ts';

/** @rfc RFC-62 R5 */
export async function getDictionary(db: DbExecutor): Promise<Dictionary> {
  const [categories, traitRows, levelRows] = await Promise.all([
    db
      .select()
      .from(traitCategories)
      .orderBy(asc(traitCategories.sortOrder), asc(traitCategories.key)),
    db.select().from(traits).orderBy(asc(traits.key)),
    db
      .select({
        id: traitLevels.id,
        traitId: traitLevels.traitId,
        key: traitLevels.key,
        sortOrder: traitLevels.sortOrder,
        active: traitLevels.active,
      })
      .from(traitLevels)
      .innerJoin(traits, eq(traits.id, traitLevels.traitId))
      .orderBy(asc(traitLevels.sortOrder), asc(traitLevels.key)),
  ]);
  const levelsByTrait = new Map<string, Trait['levels']>();
  for (const l of levelRows) {
    levelsByTrait.set(l.traitId, [
      ...(levelsByTrait.get(l.traitId) ?? []),
      { id: l.id, key: l.key, sortOrder: l.sortOrder, active: l.active },
    ]);
  }
  const traitsByCategory = new Map<string, Trait[]>();
  for (const t of traitRows) {
    const entry: Trait = {
      id: t.id,
      key: t.key,
      valueType: t.valueType,
      unit: t.unit,
      description: t.description,
      active: t.active,
      levels: levelsByTrait.get(t.id) ?? [],
    };
    traitsByCategory.set(t.categoryKey, [...(traitsByCategory.get(t.categoryKey) ?? []), entry]);
  }
  return categories.map((c) => ({
    key: c.key,
    label: c.label,
    traits: traitsByCategory.get(c.key) ?? [],
  }));
}

/** One trait with its levels, in dictionary order. @rfc RFC-62 R5, R6 */
export async function getTrait(db: DbExecutor, id: string): Promise<Trait | null> {
  const [t] = await db.select().from(traits).where(eq(traits.id, id)).limit(1);
  if (!t) return null;
  const levels = await db
    .select({
      id: traitLevels.id,
      key: traitLevels.key,
      sortOrder: traitLevels.sortOrder,
      active: traitLevels.active,
    })
    .from(traitLevels)
    .where(eq(traitLevels.traitId, id))
    .orderBy(asc(traitLevels.sortOrder), asc(traitLevels.key));
  return {
    id: t.id,
    key: t.key,
    valueType: t.valueType,
    unit: t.unit,
    description: t.description,
    active: t.active,
    levels,
  };
}
