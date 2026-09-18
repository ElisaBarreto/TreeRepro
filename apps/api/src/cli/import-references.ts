// `pnpm import:references --file <csv> [--run-by <email>]` — fills
// short_citation, full_citation, doi and url on existing references,
// matched by citation_key, only where the stored value is null (RFC-68
// R13). Exit codes: 0 completed, 1 refused or failed, 2 usage.
import { parseArgs } from 'node:util';
import { findUserByEmail } from '../auth/users.ts';
import { loadConfig } from '../config.ts';
import { batchReport, ImportRefusedError, listImportRejects } from '../dataset/import.ts';
import { supplementaryReport } from '../dataset/imports/framework.ts';
import { importReferences } from '../dataset/imports/references.ts';
import { createDb } from '../db/client.ts';
import { configurePii } from '../security/pii.ts';

const USAGE = 'usage: import-references --file <csv> [--run-by <email>]\n';

let values: { file?: string; 'run-by'?: string };
try {
  ({ values } = parseArgs({
    options: {
      file: { type: 'string' },
      'run-by': { type: 'string' },
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
  const batch = await importReferences(db, { filePath: values.file, runBy });
  const report = await batchReport(db, batch.id);
  const rejects = (await listImportRejects(db, { batchId: batch.id, limit: 30 })).data;
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  process.stdout.write(`${supplementaryReport(batch, report, rejects, seconds)}\n`);
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
