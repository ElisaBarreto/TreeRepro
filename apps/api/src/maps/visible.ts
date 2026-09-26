import type { MapEntry } from '@treerepro/contracts';
import { and, inArray } from 'drizzle-orm';
import { levelVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { KIND_FITS, readManifest } from './manifest.ts';

/**
 * The manifest rows a viewer may see, with dictionary ids: the trait must exist and be
 * visible, the kind must fit its value type, and a prevalence row's level must exist on
 * the trait and be visible. No plot filter. Manifest order.
 * @rfc RFC-76 R4
 */
export async function visibleMaps(
  db: DbExecutor,
  visibility: Visibility,
  dir: string,
): Promise<MapEntry[]> {
  const rows = await readManifest(dir);
  if (rows.length === 0) return [];
  const found = await db
    .select({ id: traits.id, key: traits.key, valueType: traits.valueType })
    .from(traits)
    .where(
      and(inArray(traits.key, [...new Set(rows.map((r) => r.traitKey))]), traitVisible(visibility)),
    );
  if (found.length === 0) return [];
  const byKey = new Map(found.map((t) => [t.key, t]));
  const levels = await db
    .select({ id: traitLevels.id, traitId: traitLevels.traitId, key: traitLevels.key })
    .from(traitLevels)
    .where(
      and(
        inArray(
          traitLevels.traitId,
          found.map((t) => t.id),
        ),
        levelVisible(visibility),
      ),
    );
  // Level keys are unique per trait on lower(key).
  const levelKey = (traitId: string, key: string) => `${traitId}\u0000${key.toLowerCase()}`;
  const levelIds = new Map(levels.map((l) => [levelKey(l.traitId, l.key), l.id]));
  const out: MapEntry[] = [];
  for (const row of rows) {
    const trait = byKey.get(row.traitKey);
    if (!trait) continue;
    const fits = KIND_FITS[row.kind];
    if (fits !== 'any' && fits !== trait.valueType) continue;
    const levelId = row.levelKey === null ? null : levelIds.get(levelKey(trait.id, row.levelKey));
    if (levelId === undefined) continue;
    out.push({
      traitId: trait.id,
      kind: row.kind,
      levelId,
      file: row.file,
      dataVersion: row.dataVersion,
    });
  }
  return out;
}
