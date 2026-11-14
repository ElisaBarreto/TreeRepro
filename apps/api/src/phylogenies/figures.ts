import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PhylogenyFigure, Platform } from '@treerepro/contracts';
import { and, inArray } from 'drizzle-orm';
import { traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { traits } from '../db/schema/dictionary.ts';

/** The coverage figure's key, never a trait's (RFC-79 R5). @rfc RFC-79 R1 */
export const COVERAGE = 'coverage';

/**
 * `apps/api/phylogenies/`, next to `src/` in development and to `dist/` in
 * the image; production mounts `/srv/phylogenies` instead.
 * @rfc RFC-79 R1
 */
export function defaultPhylogeniesDir(): string {
  return fileURLToPath(new URL('../../phylogenies', import.meta.url));
}

/** The PNG (`full`) or display copy of one figure. @rfc RFC-79 R1 */
export function figurePath(
  dir: string,
  platform: Platform,
  key: string,
  size: 'display' | 'full',
): string {
  return size === 'full'
    ? join(dir, platform, `trait_${key}.png`)
    : join(dir, platform, 'display', `trait_${key}.jpg`);
}

/** The keys of `trait_<key>.<ext>` files in `dir`; none when it is missing. */
async function keysIn(dir: string, ext: string): Promise<Set<string>> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const pattern = new RegExp(`^trait_([a-z0-9_]+)\\.${ext}$`);
  return new Set(names.flatMap((n) => pattern.exec(n)?.[1] ?? []));
}

/**
 * The figures of the viewer's platform: coverage first, then every trait the
 * viewer may see (inactive ones only with `dataset.read_inactive`; no plot
 * filter), by key, each only with its display copy present.
 * @rfc RFC-79 R1, R2, R4
 */
export async function listFigures(
  db: DbExecutor,
  visibility: Visibility,
  dir: string,
): Promise<PhylogenyFigure[]> {
  const base = join(dir, visibility.platform);
  const display = await keysIn(join(base, 'display'), 'jpg');
  const keys = [...(await keysIn(base, 'png'))].filter((k) => display.has(k));
  if (keys.length === 0) return [];
  const rows = await db
    .select({ id: traits.id, key: traits.key })
    .from(traits)
    .where(and(inArray(traits.key, keys), traitVisible(visibility)));
  const found = [
    ...(keys.includes(COVERAGE) ? [{ key: COVERAGE, traitId: null }] : []),
    ...rows
      .filter((r) => r.key !== COVERAGE)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((r) => ({ key: r.key, traitId: r.id })),
  ];
  return Promise.all(
    found.map(async (f) => ({
      ...f,
      version: String(
        Math.trunc((await stat(figurePath(dir, visibility.platform, f.key, 'full'))).mtimeMs),
      ),
    })),
  );
}
