// `pnpm check:maps [--dir <dir>]` — checks a maps directory against the
// manifest rules and the trait dictionary in the database before publishing
// (RFC-76 R2). Writes nothing. Exit codes: 0 no problems, 1 problems found or
// no manifest.csv, 2 usage.
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { checkMaps, checkMapsExitCode } from '../maps/check.ts';
import { hasManifest } from '../maps/manifest.ts';

const USAGE = 'usage: check-maps [--dir <dir>]\n';

let values: { dir?: string };
try {
  ({ values } = parseArgs({
    options: { dir: { type: 'string' } },
    strict: true,
  }));
} catch {
  process.stderr.write(USAGE);
  process.exit(2);
}

const config = loadConfig();
const dir = values.dir ?? config.mapsDir;
const manifestPresent = await hasManifest(dir);
if (!manifestPresent) process.stderr.write(`no manifest.csv in ${dir}\n`);
const { db, close } = createDb(config.db.url.expose(), { max: 1 });

let exitCode = 0;
try {
  const result = await checkMaps(db, dir);
  for (const problem of result.problems) process.stdout.write(`${problem}\n`);
  process.stdout.write(`${result.shown} maps would be shown from ${dir}\n`);
  process.stdout.write(`${result.problems.length} problems\n`);
  exitCode = checkMapsExitCode(manifestPresent, result);
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  exitCode = 1;
} finally {
  await close();
}
process.exit(exitCode);
