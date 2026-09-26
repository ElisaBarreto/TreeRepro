import { inArray } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { KIND_FITS, readManifest } from './manifest.ts';

/** The outcome of `checkMaps` (RFC-76 R2). @rfc RFC-76 R2 */
export interface CheckMapsResult {
  /** Rows without a problem: the maps that would be shown. */
  shown: number;
  /** One line per problem, naming the manifest line. */
  problems: string[];
}

/**
 * Checks a maps directory against R1 (the manifest itself) and R2 (the trait
 * dictionary in the database): every `trait_key` is a dictionary trait, a
 * `prevalence` row's `level_key` is one of that trait's levels
 * (case-insensitive), and every kind fits the trait's value type. Inactive
 * traits and levels are not problems — they are simply hidden from viewers
 * without `dataset.read_inactive` (RFC-76 R4). Writes nothing.
 * @rfc RFC-76 R2
 */
export async function checkMaps(db: DbExecutor, dir: string): Promise<CheckMapsResult> {
  let rows: Awaited<ReturnType<typeof readManifest>>;
  try {
    rows = await readManifest(dir);
  } catch (err) {
    return { shown: 0, problems: [(err as Error).message] };
  }
  if (rows.length === 0) return { shown: 0, problems: [] };

  const traitKeys = [...new Set(rows.map((r) => r.traitKey))];
  const found = await db
    .select({ id: traits.id, key: traits.key, valueType: traits.valueType })
    .from(traits)
    .where(inArray(traits.key, traitKeys));
  const byKey = new Map(found.map((t) => [t.key, t]));

  const levels =
    found.length === 0
      ? []
      : await db
          .select({ traitId: traitLevels.traitId, key: traitLevels.key })
          .from(traitLevels)
          .where(
            inArray(
              traitLevels.traitId,
              found.map((t) => t.id),
            ),
          );
  const levelsByTrait = new Map<string, Set<string>>();
  for (const l of levels) {
    const set = levelsByTrait.get(l.traitId) ?? new Set<string>();
    set.add(l.key.toLowerCase());
    levelsByTrait.set(l.traitId, set);
  }

  const problems: string[] = [];
  let shown = 0;
  for (const row of rows) {
    const trait = byKey.get(row.traitKey);
    if (!trait) {
      problems.push(`manifest line ${row.line}: unknown trait ${row.traitKey}`);
      continue;
    }
    const fits = KIND_FITS[row.kind];
    if (fits !== 'any' && fits !== trait.valueType) {
      problems.push(
        `manifest line ${row.line}: ${row.kind} does not fit ${trait.valueType} trait ${row.traitKey}`,
      );
      continue;
    }
    if (row.levelKey !== null) {
      const levelKeys = levelsByTrait.get(trait.id);
      if (!levelKeys?.has(row.levelKey.toLowerCase())) {
        problems.push(
          `manifest line ${row.line}: unknown level ${row.levelKey} for trait ${row.traitKey}`,
        );
        continue;
      }
    }
    shown++;
  }
  return { shown, problems };
}

/**
 * The exit code `check:maps` reports: 1 when the directory has no manifest
 * at all, even if `checkMaps` itself found nothing wrong with it — a
 * publishing gate must not wave an empty or mistargeted staging copy
 * through, since the next step (`rsync --delete` into the live directory)
 * would then delete every map — or when `checkMaps` found any problem; 0
 * otherwise. `hasManifest` is the caller's own check (`../maps/manifest.ts`);
 * the API route itself still reads a missing manifest as no maps (R1), so
 * this distinction belongs to `check:maps` alone.
 * @rfc RFC-76 R2
 */
export function checkMapsExitCode(hasManifest: boolean, result: CheckMapsResult): number {
  return !hasManifest || result.problems.length > 0 ? 1 : 0;
}
