// `pnpm import:records --file <csv> [--run-by <email>] [--force] [--replace]` — loads the
// compiled dataset (RFC-64). Exit codes: 0 completed, 1 refused or failed, 2 usage.
import { parseArgs } from 'node:util';
import { findUserByEmail } from '../auth/users.ts';
import { loadConfig, loadMigratorConfig } from '../config.ts';
import { batchReport, ImportRefusedError, importRecords } from '../dataset/import.ts';
import { isReplaceAllowed } from '../dataset/reset.ts';
import { createDb } from '../db/client.ts';
import { configurePii } from '../security/pii.ts';

const USAGE = 'usage: import-records --file <csv> [--run-by <email>] [--force] [--replace]\n';

let values: { file?: string; 'run-by'?: string; force: boolean; replace: boolean };
try {
  ({ values } = parseArgs({
    options: {
      file: { type: 'string' },
      'run-by': { type: 'string' },
      force: { type: 'boolean', default: false },
      replace: { type: 'boolean', default: false },
    },
    strict: true,
  }));
} catch {
  process.stderr.write(USAGE);
  process.exit(2);
}
if (!values.file) {
  process.stderr.write(USAGE);
  process.exit(2);
}

const config = loadConfig();
// R12: the reset empties tables the schema protects as append-only (RFC-63 R4),
// which `treerepro_app` cannot do and must not be able to do. A replacing run
// therefore uses the migrator role for the whole import, so the wipe and the
// load stay in one transaction. Production is refused outright, and its
// container carries no migrator secret either, so the flag cannot work there.
if (values.replace && !isReplaceAllowed(config.nodeEnv)) {
  process.stderr.write('--replace is not available in production\n');
  process.exit(1);
}
configurePii(config.pii.keyring.expose(), config.pii.hmacKey.expose());
const dbUrl = values.replace ? loadMigratorConfig().db.url : config.db.url;
// R13 reserves one connection to hold the advisory lock for the whole run,
// so the pool needs a second one for the import itself; with `max: 1` the
// reservation starves the work it is guarding and the run hangs.
const { db, close } = createDb(dbUrl.expose(), { max: 2 });

let exitCode = 0;
const startedAt = Date.now();
try {
  let runBy: string | null = null;
  if (values['run-by']) {
    const user = await findUserByEmail(db, values['run-by']);
    if (user) runBy = user.id;
    else
      process.stderr.write(`warning: no user with email ${values['run-by']}; run_by stays null\n`);
  }
  const batch = await importRecords(db, {
    filePath: values.file,
    runBy,
    force: values.force,
    replace: values.replace,
  });
  const report = await batchReport(db, batch.id);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const lines = [
    `File ${batch.fileName} (sha256 ${batch.fileSha256})`,
    values.replace
      ? 'Mode: replace (everything earlier imports loaded was cleared)'
      : 'Mode: append',
    `Batch ${batch.id} completed in ${seconds}s`,
    `Rows: ${batch.rowsTotal} total, ${batch.rowsInserted} inserted, ${batch.rowsDuplicate} duplicate, ${batch.rowsRejected} rejected, ${batch.rowsPending} pending harmonisation`,
    // R14: rows whose ID is already stored, skipped without a record or a reject.
    `Rows skipped, already imported: ${batch.rowsAlreadyImported}`,
    `Harmonisation: ${Object.entries(report.harmonisation)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
    `Rejections: ${Object.entries(report.rejectReasons)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
    'Unknown levels (top 30):',
    ...batch.unknownLevels.map((u) => `  ${u.trait}: ${u.value} (${u.count})`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
} catch (err) {
  if (err instanceof ImportRefusedError) {
    process.stderr.write(`${err.message}\n`);
  } else {
    process.stderr.write(`Import failed: ${(err as Error).message}\n`);
  }
  exitCode = 1;
} finally {
  await close();
}
process.exit(exitCode);
