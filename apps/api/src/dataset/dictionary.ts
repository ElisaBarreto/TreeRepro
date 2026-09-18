import type { Dictionary, Trait, TraitValueType } from '@treerepro/contracts';
import { and, asc, eq } from 'drizzle-orm';
import { levelVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { traitCategories, traitLevels, traits } from '../db/schema/dictionary.ts';
import { AppError } from '../http/errors.ts';

/**
 * The fields of a trait every caller needs before it may use it: enough to
 * validate a value (RFC-65 R1) and to check a category filter (RFC-60 R6).
 * @rfc RFC-65 R1
 */
export interface TraitBrief {
  id: string;
  key: string;
  categoryKey: string;
  valueType: TraitValueType;
  unit: string | null;
  active: boolean;
}

/**
 * One visible trait, or 404. It lives here rather than in `curation.ts` so
 * `taxa.ts` can use it: `catalog.ts` imports `getSpecies` from `taxa.ts`, so
 * `taxa.ts` importing `curation.ts` would close an import cycle; this module
 * imports neither. `curation.ts` re-exports it for its existing callers.
 * @rfc RFC-65 R1
 * @rfc RFC-33 R2, R4
 */
export async function requireTrait(
  db: DbExecutor,
  visibility: Visibility,
  traitId: string,
): Promise<TraitBrief> {
  const [row] = await db
    .select({
      id: traits.id,
      key: traits.key,
      categoryKey: traits.categoryKey,
      valueType: traits.valueType,
      unit: traits.unit,
      active: traits.active,
    })
    .from(traits)
    .where(and(eq(traits.id, traitId), traitVisible(visibility)))
    .limit(1);
  if (!row) throw new AppError('TRAIT_NOT_FOUND', 'Trait not found');
  return row;
}

/**
 * @rfc RFC-62 R5
 * @rfc RFC-33 R2, R3
 */
export async function getDictionary(db: DbExecutor, visibility: Visibility): Promise<Dictionary> {
  const [categories, traitRows, levelRows] = await Promise.all([
    db
      .select()
      .from(traitCategories)
      .orderBy(asc(traitCategories.sortOrder), asc(traitCategories.key)),
    db.select().from(traits).where(traitVisible(visibility)).orderBy(asc(traits.key)),
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
      .where(and(traitVisible(visibility), levelVisible(visibility)))
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
      // Placeholder until Task 5 / RFC-62 R5 fills in the cached species count.
      speciesCount: 0,
    };
    traitsByCategory.set(t.categoryKey, [...(traitsByCategory.get(t.categoryKey) ?? []), entry]);
  }
  return categories.map((c) => ({
    key: c.key,
    label: c.label,
    traits: traitsByCategory.get(c.key) ?? [],
  }));
}

/**
 * One trait with its levels, in dictionary order.
 * @rfc RFC-62 R5, R6
 * @rfc RFC-33 R2, R4
 */
export async function getTrait(
  db: DbExecutor,
  visibility: Visibility,
  id: string,
): Promise<Trait | null> {
  const [t] = await db
    .select()
    .from(traits)
    .where(and(eq(traits.id, id), traitVisible(visibility)))
    .limit(1);
  if (!t) return null;
  const levels = await db
    .select({
      id: traitLevels.id,
      key: traitLevels.key,
      sortOrder: traitLevels.sortOrder,
      active: traitLevels.active,
    })
    .from(traitLevels)
    .where(and(eq(traitLevels.traitId, id), levelVisible(visibility)))
    .orderBy(asc(traitLevels.sortOrder), asc(traitLevels.key));
  return {
    id: t.id,
    key: t.key,
    valueType: t.valueType,
    unit: t.unit,
    description: t.description,
    active: t.active,
    levels,
    // Placeholder until Task 5 / RFC-62 R5 fills in the cached species count.
    speciesCount: 0,
  };
}
