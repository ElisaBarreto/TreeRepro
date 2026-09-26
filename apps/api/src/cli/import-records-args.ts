import { parseArgs } from 'node:util';

/** @rfc RFC-64 R1, R15 */
export const IMPORT_RECORDS_USAGE =
  'usage: import-records --file <csv> [--run-by <email>] [--force | --replace | --replace-imported --annotation-sheet <dir>]\n';

export interface ImportRecordsArgs {
  file: string;
  runBy?: string;
  force: boolean;
  replace: boolean;
  /** RFC-64 R15: set only together with `--annotation-sheet`. */
  replaceImported?: { sheetDir: string };
}

/**
 * The command line of `import:records`, or `null` for a usage error (exit 2).
 * `--replace-imported` excludes `--replace` (two different wipes) and
 * `--force` (it already waives R3). `--annotation-sheet` goes with it and
 * only with it.
 * @rfc RFC-64 R1, R15
 */
export function parseImportRecordsArgs(args: string[]): ImportRecordsArgs | null {
  let values: {
    file?: string;
    'run-by'?: string;
    force: boolean;
    replace: boolean;
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
  return {
    file: values.file,
    runBy: values['run-by'],
    force: values.force,
    replace: values.replace,
    replaceImported: sheetDir === undefined ? undefined : { sheetDir },
  };
}
