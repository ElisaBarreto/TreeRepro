// `pnpm import:records --file <csv> [--run-by <email>] [--force | --replace | --replace-imported --annotation-sheet <dir>]` — loads the
// compiled dataset (RFC-64). Exit codes: 0 completed, 1 refused or failed, 2 usage.
import { stat } from 'node:fs/promises';
import { findUserByEmail } from '../auth/users.ts';
import { loadConfig, loadMigratorConfig } from '../config.ts';
import { batchReport, ImportRefusedError, importRecords } from '../dataset/import.ts';
import { sheetPath } from '../dataset/replace-imported.ts';
import { isReplaceAllowed } from '../dataset/reset.ts';
import { createDb } from '../db/client.ts';
import { configurePii } from '../security/pii.ts';
import { IMPORT_RECORDS_USAGE, parseImportRecordsArgs } from './import-records-args.ts';

const values = parseImportRecordsArgs(process.argv.slice(2));
if (!values) {
  process.stderr.write(IMPORT_RECORDS_USAGE);
  process.exit(2);
}

const config = loadConfig();
// R12: the total replace is refused in production outright.
if (values.replace && !isReplaceAllowed(config.nodeEnv)) {
  process.stderr.write('--replace is not available in production\n');
  process.exit(1);
}
configurePii(config.pii.keyring.expose(), config.pii.hmacKey.expose());
// R12, R15: both replacing modes write past the RFC-63 R4 append-only
// triggers, which only the migrator role may switch off; `treerepro_app`
// never can. R15 runs in production too. There, the gate is this secret:
// only the runbook's one-off container mounts it (docs/gotchas/import.md).
let dbUrl = config.db.url;
if (values.replace || values.replaceImported) {
  try {
    dbUrl = loadMigratorConfig().db.url;
  } catch (err) {
    process.stderr.write(
      `${(err as Error).message}: --replace and --replace-imported run as treerepro_migrator; mount its secret as docs/gotchas/import.md shows\n`,
    );
    process.exit(1);
  }
}
// R13 reserves one connection to hold the advisory lock for the whole run,
// so the pool needs a second one for the import itself; with `max: 1` the
// reservation starves the work it is guarding and the run hangs.
const { db, close } = createDb(dbUrl.expose(), { max: 2 });

let exitCode = 0;
const startedAt = Date.now();
try {
  let runBy: string | null = null;
  if (values.runBy) {
    const user = await findUserByEmail(db, values.runBy);
    if (user) runBy = user.id;
    else process.stderr.write(`warning: no user with email ${values.runBy}; run_by stays null\n`);
  }
  const batch = await importRecords(db, {
    filePath: values.file,
    runBy,
    force: values.force,
    replace: values.replace,
    replaceImported: values.replaceImported,
  });
  const report = await batchReport(db, batch.id);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const lines = [
    `File ${batch.fileName} (sha256 ${batch.fileSha256})`,
    values.replace
      ? 'Mode: replace (everything earlier imports loaded was cleared)'
      : values.replaceImported
        ? 'Mode: replace-imported (the EB_ records were replaced; platform records and annotations kept, re-linked by code)'
        : 'Mode: append',
    `Batch ${batch.id} completed in ${seconds}s`,
    ...(values.replaceImported
      ? [`Annotation sheet: ${sheetPath(values.replaceImported.sheetDir, batch.id)}`]
      : []),
    `Rows: ${batch.rowsTotal} total, ${batch.rowsInserted} inserted, ${batch.rowsDuplicate} duplicate, ${batch.rowsRejected} rejected, ${batch.rowsPending} pending harmonisation`,
    // R14: rows whose ID is already stored, skipped without a record or a reject.
    `Rows already imported: ${batch.rowsAlreadyImported}`,
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
  // R15 (Ruling G): importRecords commits the batch even when the final
  // sheet's rename fails; the leftover `.tmp` is the only sign of that.
  if (values.replaceImported) {
    const tmpPath = `${sheetPath(values.replaceImported.sheetDir, batch.id)}.tmp`;
    const tmpLeft = await stat(tmpPath)
      .then(() => true)
      .catch(() => false);
    if (tmpLeft) {
      process.stderr.write(
        `batch ${batch.id} committed; final sheet left at ${tmpPath} — rename it by hand\n`,
      );
    }
  }
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
