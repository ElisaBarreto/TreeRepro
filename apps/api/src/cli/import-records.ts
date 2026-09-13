// `pnpm import:records --file <csv> [--run-by <email>] [--force]` — loads the
// compiled dataset (RFC-64). Exit codes: 0 completed, 1 refused or failed, 2 usage.
import { parseArgs } from 'node:util';
import { findUserByEmail } from '../auth/users.ts';
import { loadConfig } from '../config.ts';
import { batchReport, ImportRefusedError, importRecords } from '../dataset/import.ts';
import { createDb } from '../db/client.ts';
import { configurePii } from '../security/pii.ts';

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    'run-by': { type: 'string' },
    force: { type: 'boolean', default: false },
  },
  strict: true,
});
if (!values.file) {
  process.stderr.write('usage: import-records --file <csv> [--run-by <email>] [--force]\n');
  process.exit(2);
}

const config = loadConfig();
configurePii(config.pii.keyring.expose(), config.pii.hmacKey.expose());
const { db, close } = createDb(config.db.url.expose(), { max: 1 });

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
  const batch = await importRecords(db, { filePath: values.file, runBy, force: values.force });
  const report = await batchReport(db, batch.id);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const lines = [
    `File ${batch.fileName} (sha256 ${batch.fileSha256})`,
    `Batch ${batch.id} completed in ${seconds}s`,
    `Rows: ${batch.rowsTotal} total, ${batch.rowsInserted} inserted, ${batch.rowsDuplicate} duplicate, ${batch.rowsRejected} rejected, ${batch.rowsPending} pending harmonisation`,
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
