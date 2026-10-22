// `pnpm import:wcvp --names <wcvp_names.csv> --distribution <wcvp_distribution.csv>` —
// replaces the WCVP region tables (RFC-78 R2). Exit codes: 0 completed, 1 refused or failed, 2 usage.
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { describeError, ImportRefusedError } from '../dataset/import.ts';
import { importWcvp } from '../dataset/wcvp.ts';
import { createDb } from '../db/client.ts';

const USAGE =
  'usage: import-wcvp --names <wcvp_names.csv> --distribution <wcvp_distribution.csv>\n';

let values: { names?: string; distribution?: string };
try {
  ({ values } = parseArgs({
    options: { names: { type: 'string' }, distribution: { type: 'string' } },
    strict: true,
  }));
} catch {
  process.stderr.write(USAGE);
  process.exit(2);
}
if (!values.names || !values.distribution) {
  process.stderr.write(USAGE);
  process.exit(2);
}

const config = loadConfig();
const { db, close } = createDb(config.db.url.expose(), { max: 1 });

let exitCode = 0;
const startedAt = Date.now();
try {
  const c = await importWcvp(db, {
    namesPath: values.names,
    distributionPath: values.distribution,
  });
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  process.stdout.write(
    `WCVP loaded in ${seconds}s: ${c.acceptedSpecies} accepted species (${c.treeSpecies} trees), ${c.regions} regions, ${c.distributionRows} distribution rows\n`,
  );
} catch (err) {
  process.stderr.write(
    err instanceof ImportRefusedError
      ? `${err.message}\n`
      : `Import failed: ${describeError(err)}\n`,
  );
  exitCode = 1;
} finally {
  await close();
}
process.exit(exitCode);
