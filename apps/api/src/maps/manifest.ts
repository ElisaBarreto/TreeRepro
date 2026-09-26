import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_KINDS, type MapKind, type TraitValueType } from '@treerepro/contracts';
import { parseCsvLine } from '../dataset/import.ts';

const HEADER = 'trait_key,map_kind,level_key,file,data_version';
const FILE_PATTERN = /^[a-z0-9][a-z0-9._-]*\.(svg|webp)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KIND_SET: ReadonlySet<string> = new Set(MAP_KINDS);

/** A validated row of `apps/api/maps/manifest.csv` (RFC-76 R1). @rfc RFC-76 R1 */
export interface ManifestRow {
  line: number;
  traitKey: string;
  kind: MapKind;
  levelKey: string | null;
  file: string;
  dataVersion: string;
}

/**
 * Which trait value type a map kind fits: `'any'` for completeness, `'categorical'` for
 * prevalence, `'quantitative'` for the four numeric summaries (RFC-76 R2).
 * @rfc RFC-76 R2
 */
export const KIND_FITS: Record<MapKind, TraitValueType | 'any'> = {
  completeness: 'any',
  prevalence: 'categorical',
  mean: 'quantitative',
  min: 'quantitative',
  max: 'quantitative',
  sd: 'quantitative',
};

function fail(line: number, reason: string): never {
  throw new Error(`maps manifest line ${line}: ${reason}`);
}

function toIsoDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10);
}

/**
 * Parses and validates manifest text against the files actually present in the maps
 * directory (RFC-76 R1). Pure: throws `Error('maps manifest line <n>: <reason>')` on any
 * rule breach, naming the line. Blank lines are skipped.
 * @rfc RFC-76 R1
 */
export function parseManifest(text: string, filesPresent: ReadonlySet<string>): ManifestRow[] {
  const physicalLines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  if (physicalLines.length > 0 && physicalLines[physicalLines.length - 1] === '') {
    physicalLines.pop();
  }
  const [header, ...rest] = physicalLines;
  if (header !== HEADER) fail(1, `expected header "${HEADER}", got "${header ?? ''}"`);

  const rows: ManifestRow[] = [];
  const seenFiles = new Set<string>();
  const seenMaps = new Set<string>();

  rest.forEach((raw, i) => {
    const lineNo = i + 2;
    if (raw.trim() === '') return;

    const fields = parseCsvLine(raw);
    if (fields.length !== 5) fail(lineNo, `expected 5 columns, got ${fields.length}`);
    const [traitKey, kindRaw, levelRaw, file, dataVersion] = fields as [
      string,
      string,
      string,
      string,
      string,
    ];

    if (!traitKey) fail(lineNo, 'trait_key is empty');
    if (!KIND_SET.has(kindRaw)) fail(lineNo, `unknown map_kind "${kindRaw}"`);
    const kind = kindRaw as MapKind;

    const levelKey = levelRaw === '' ? null : levelRaw;
    if (kind === 'prevalence' && levelKey === null) {
      fail(lineNo, 'level_key is required for prevalence');
    }
    if (kind !== 'prevalence' && levelKey !== null) {
      fail(lineNo, `level_key must be empty for ${kind}`);
    }

    if (!FILE_PATTERN.test(file)) fail(lineNo, `file "${file}" is not a valid file name`);
    if (!filesPresent.has(file)) fail(lineNo, `file "${file}" not found`);

    if (!DATE_PATTERN.test(dataVersion) || toIsoDate(dataVersion) !== dataVersion) {
      fail(lineNo, `data_version "${dataVersion}" is not a real calendar date`);
    }

    if (seenFiles.has(file)) fail(lineNo, `file "${file}" is already used by another row`);
    seenFiles.add(file);

    const mapKey = `${traitKey}\u0000${kind}\u0000${levelKey ?? ''}`;
    if (seenMaps.has(mapKey)) {
      fail(lineNo, `duplicate map for ${traitKey}/${kind}${levelKey ? `/${levelKey}` : ''}`);
    }
    seenMaps.add(mapKey);

    rows.push({ line: lineNo, traitKey, kind, levelKey, file, dataVersion });
  });

  return rows;
}

/**
 * Reads `<dir>/manifest.csv` and the directory listing, then validates the manifest
 * against it (RFC-76 R1). A missing directory or a missing `manifest.csv` means no
 * maps, never an error; any other read error still throws.
 * @rfc RFC-76 R1
 */
export async function readManifest(dir: string): Promise<ManifestRow[]> {
  let text: string;
  let entries: string[];
  try {
    [text, entries] = await Promise.all([
      readFile(join(dir, 'manifest.csv'), 'utf8'),
      readdir(dir),
    ]);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return parseManifest(text, new Set(entries));
}

/**
 * Whether `<dir>/manifest.csv` exists. A missing manifest means no maps (R1),
 * not an error; this lets a caller such as `check-maps` still say so, since
 * `readManifest` folds that case into an empty row list indistinguishable
 * from a header-only manifest.
 * @rfc RFC-76 R1
 */
export async function hasManifest(dir: string): Promise<boolean> {
  try {
    await access(join(dir, 'manifest.csv'));
    return true;
  } catch {
    return false;
  }
}

/**
 * `apps/api/maps/`, next to `src/` in development and to `dist/` in the image, same
 * idiom as `dictionaryPath()` in `apps/api/src/dataset/seed.ts` (RFC-76 R1).
 * @rfc RFC-76 R1
 */
export function defaultMapsDir(): string {
  return fileURLToPath(new URL('../../maps', import.meta.url));
}
