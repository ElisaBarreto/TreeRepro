import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DbExecutor } from '../db/client.ts';
import { traits } from '../db/schema/dictionary.ts';
import { COVERAGE } from './figures.ts';

/** @rfc RFC-79 R5 */
export interface FiguresReport {
  ok: boolean;
  missingDir: boolean;
  unknown: string[];
  missingDisplay: string[];
  withoutFigure: string[];
  coverageClash: boolean;
}

const keysOf = (names: string[], ext: string) =>
  names.flatMap((n) => new RegExp(`^trait_([a-z0-9_]+)\\.${ext}$`).exec(n)?.[1] ?? []);

/**
 * Checks one platform's figures directory against the trait dictionary before
 * it is published: unknown names, PNGs without a display copy and a trait
 * keyed `coverage` fail it; active traits without a figure are only reported.
 * @rfc RFC-79 R5
 */
export async function checkFigures(db: DbExecutor, dir: string): Promise<FiguresReport> {
  const names = await readdir(dir).catch(() => null);
  const display = new Set(
    keysOf((await readdir(join(dir, 'display')).catch(() => [])) ?? [], 'jpg'),
  );
  const pngs = keysOf(names ?? [], 'png');
  const rows = await db.select({ key: traits.key, active: traits.active }).from(traits);
  const known = new Set(rows.map((r) => r.key));
  const report = {
    missingDir: names === null,
    unknown: pngs.filter((k) => k !== COVERAGE && !known.has(k)).sort(),
    missingDisplay: pngs.filter((k) => !display.has(k)).sort(),
    withoutFigure: rows
      .filter((r) => r.active && !pngs.includes(r.key))
      .map((r) => r.key)
      .sort(),
    coverageClash: known.has(COVERAGE),
  };
  const ok =
    !report.missingDir &&
    report.unknown.length === 0 &&
    report.missingDisplay.length === 0 &&
    !report.coverageClash;
  return { ok, ...report };
}
