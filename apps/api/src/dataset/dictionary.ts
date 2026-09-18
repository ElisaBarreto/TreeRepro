import type { Dictionary, ListTraitsQuery, Trait, TraitValueType } from '@treerepro/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  globalSpeciesVisible,
  levelVisible,
  traitVisible,
  type Visibility,
} from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { traitCategories, traitLevels, traits } from '../db/schema/dictionary.ts';
import { AppError } from '../http/errors.ts';
import { cachedJson } from '../redis/cache.ts';
import type { Redis } from '../redis/client.ts';

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
 * One category with its visible traits and their levels, without the cached
 * species count.
 * @rfc RFC-62 R5
 */
export type DictionaryCategory = {
  key: string;
  label: string;
  traits: Omit<Trait, 'speciesCount'>[];
};

/**
 * Categories with their visible traits and levels, in dictionary order: the
 * read `getDictionary` (R5) and `speciesTraitSummary` (RFC-70 R7) share.
 * Kept apart from `getDictionary` so `speciesTraitSummary` — which only
 * walks categories and traits, never their counts — never needs Redis.
 * @rfc RFC-62 R5
 * @rfc RFC-33 R2, R3
 */
export async function dictionaryCategories(
  db: DbExecutor,
  visibility: Visibility,
): Promise<DictionaryCategory[]> {
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
  const traitsByCategory = new Map<string, Omit<Trait, 'speciesCount'>[]>();
  for (const t of traitRows) {
    const entry: Omit<Trait, 'speciesCount'> = {
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

/**
 * The visible species count per trait, keyed by trait id: a scan of
 * `species_trait_coverage` joined to visible species, cached 10 minutes per
 * viewer class under `dictionary:species-counts:<u|r>` (RFC-62 R5) — the
 * table is millions of rows, so this is not recomputed per request.
 *
 * Exported for the workspace dashboard (RFC-72 R1), whose `topMissingTraits`
 * subtracts these same counts from the visible species count: one producer
 * writes this key, because two that diverge on the visibility predicate or the
 * stored shape would corrupt the dictionary page with nothing to point at.
 * @rfc RFC-62 R5
 * @rfc RFC-72 R1
 */
export async function speciesCountsByTrait(
  ctx: { db: DbExecutor; redis: Redis },
  visibility: Visibility,
): Promise<Map<string, number>> {
  const key = `dictionary:species-counts:${visibility.inactive ? 'u' : 'r'}`;
  const { value } = await cachedJson(ctx.redis, key, 600, async () => {
    const rows = (await ctx.db.execute(sql`
      select c.trait_id as trait_id, count(*)::int as species_count
      from species_trait_coverage c
      join species s on s.id = c.species_id
      where ${globalSpeciesVisible(visibility, sql`s.active`, sql`s.id`)}
      group by c.trait_id
    `)) as unknown as { trait_id: string; species_count: number }[];
    return rows.map((r) => [r.trait_id, r.species_count] as [string, number]);
  });
  return new Map(value);
}

/**
 * `GET /api/traits`: the dictionary, filtered server-side by `categoryKey`,
 * `valueType` and `q` (a case-insensitive substring of the trait's `key` or
 * `description`), each trait carrying its cached `speciesCount`.
 *
 * With no filter given (the page's own selects, which load the dictionary
 * whole), every visible category is returned exactly as `dictionaryCategories`
 * answers it — including one with no visible traits. Filtering answers deep
 * links (RFC-62 R5): once any filter is applied, a category a filter emptied
 * out is pruned, since rendering it as an empty heading is a worse answer to
 * a deep link than the unfiltered dictionary.
 * @rfc RFC-62 R5
 * @rfc RFC-33 R2, R3
 */
export async function getDictionary(
  ctx: { db: DbExecutor; redis: Redis },
  visibility: Visibility,
  filters: ListTraitsQuery = {},
): Promise<Dictionary> {
  const [categories, counts] = await Promise.all([
    dictionaryCategories(ctx.db, visibility),
    speciesCountsByTrait(ctx, visibility),
  ]);
  const q = filters.q?.toLowerCase();
  const filtered =
    filters.categoryKey !== undefined || filters.valueType !== undefined || q !== undefined;
  return categories
    .map((c) => ({
      key: c.key,
      label: c.label,
      traits: c.traits
        .filter((t) => {
          if (filters.categoryKey && filters.categoryKey !== c.key) return false;
          if (filters.valueType && filters.valueType !== t.valueType) return false;
          if (q && !t.key.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) {
            return false;
          }
          return true;
        })
        .map((t) => ({ ...t, speciesCount: counts.get(t.id) ?? 0 })),
    }))
    .filter((c) => !filtered || c.traits.length > 0);
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
  // A direct, bounded count for this one trait (indexed by
  // species_trait_coverage_trait_idx) rather than the dictionary-wide cache:
  // trait writes are rare, so a fresh number costs nothing here, and this
  // feeds POST/PATCH /api/traits, where a cached, possibly-stale 0 would
  // ship as wrong data. Plot-blind like `getDictionary`'s cached map: the
  // same contract field cannot mean one thing on GET /api/traits and another
  // on the write responses.
  const [countRow] = (await db.execute(sql`
    select count(*)::int as species_count
    from species_trait_coverage c
    join species s on s.id = c.species_id
    where c.trait_id = ${id} and ${globalSpeciesVisible(visibility, sql`s.active`, sql`s.id`)}
  `)) as unknown as { species_count: number }[];
  return {
    id: t.id,
    key: t.key,
    valueType: t.valueType,
    unit: t.unit,
    description: t.description,
    active: t.active,
    levels,
    speciesCount: countRow?.species_count ?? 0,
  };
}
