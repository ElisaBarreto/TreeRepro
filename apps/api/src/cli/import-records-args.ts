import { parseArgs } from 'node:util';

/** @rfc RFC-64 R1, R12, R15 */
export const IMPORT_RECORDS_USAGE =
  'usage: import-records --file <parquet|csv> [--run-by <email>] [--trees-only] [--force | --replace [--discard-platform] [--sync-dictionary] | --replace-imported --annotation-sheet <dir>]\n';

export interface ImportRecordsArgs {
  file: string;
  /** RFC-64 R4: keep only the rows whose `is_tree_species` is true. */
  treesOnly: boolean;
  runBy?: string;
  force: boolean;
  replace: boolean;
  /** RFC-64 R12: set only together with `--replace`. */
  discardPlatform: boolean;
  /** RFC-62 R9: set only together with `--replace`. */
  syncDictionary: boolean;
  /** RFC-64 R15: set only together with `--annotation-sheet`. */
  replaceImported?: { sheetDir: string };
}

/**
 * The command line of `import:records`, or `null` for a usage error (exit 2).
 * `--replace-imported` excludes `--replace` (two different wipes) and
 * `--force` (it already waives R3). `--annotation-sheet` goes with it and
 * only with it, and `--discard-platform` and `--sync-dictionary` only with `--replace`.
 * @rfc RFC-64 R1, R4, R12, R15
 * @rfc RFC-62 R9
 */
export function parseImportRecordsArgs(args: string[]): ImportRecordsArgs | null {
  let values: {
    file?: string;
    'run-by'?: string;
    'trees-only': boolean;
    force: boolean;
    replace: boolean;
    'discard-platform': boolean;
    'sync-dictionary': boolean;
    'replace-imported': boolean;
    'annotation-sheet'?: string;
  };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        file: { type: 'string' },
        'run-by': { type: 'string' },
        'trees-only': { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        replace: { type: 'boolean', default: false },
        'discard-platform': { type: 'boolean', default: false },
        'sync-dictionary': { type: 'boolean', default: false },
        'replace-imported': { type: 'boolean', default: false },
        'annotation-sheet': { type: 'string' },
      },
      strict: true,
    }));
  } catch {
    return null;
  }
  const sheetDir = values['annotation-sheet'];
  if (!values.file) return null;
  if (values['replace-imported'] !== (sheetDir !== undefined)) return null;
  if (values['replace-imported'] && (values.replace || values.force)) return null;
  if ((values['discard-platform'] || values['sync-dictionary']) && !values.replace) return null;
  return {
    file: values.file,
    treesOnly: values['trees-only'],
    runBy: values['run-by'],
    force: values.force,
    replace: values.replace,
    discardPlatform: values['discard-platform'],
    syncDictionary: values['sync-dictionary'],
    replaceImported: sheetDir === undefined ? undefined : { sheetDir },
  };
}
