import { parseArgs } from 'node:util';

/** @rfc RFC-64 R1, R12, R15 */
export const IMPORT_RECORDS_USAGE =
  'usage: import-records --file <csv> [--run-by <email>] [--force | --replace [--discard-platform] | --replace-imported --annotation-sheet <dir>]\n';

export interface ImportRecordsArgs {
  file: string;
  runBy?: string;
  force: boolean;
  replace: boolean;
  /** RFC-64 R12: set only together with `--replace`. */
  discardPlatform: boolean;
  /** RFC-64 R15: set only together with `--annotation-sheet`. */
  replaceImported?: { sheetDir: string };
}

/**
 * The command line of `import:records`, or `null` for a usage error (exit 2).
 * `--replace-imported` excludes `--replace` (two different wipes) and
 * `--force` (it already waives R3). `--annotation-sheet` goes with it and
 * only with it, and `--discard-platform` only with `--replace`.
 * @rfc RFC-64 R1, R12, R15
 */
export function parseImportRecordsArgs(args: string[]): ImportRecordsArgs | null {
  let values: {
    file?: string;
    'run-by'?: string;
    force: boolean;
    replace: boolean;
    'discard-platform': boolean;
    'replace-imported': boolean;
    'annotation-sheet'?: string;
  };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        file: { type: 'string' },
        'run-by': { type: 'string' },
        force: { type: 'boolean', default: false },
        replace: { type: 'boolean', default: false },
        'discard-platform': { type: 'boolean', default: false },
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
  if (values['discard-platform'] && !values.replace) return null;
  return {
    file: values.file,
    runBy: values['run-by'],
    force: values.force,
    replace: values.replace,
    discardPlatform: values['discard-platform'],
    replaceImported: sheetDir === undefined ? undefined : { sheetDir },
  };
}
