// `pnpm build:snapshot` — computes the region tables now and replaces the
// snapshot (RFC-78 R12). Exit codes: 0 completed or skipped, 1 failed.
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { runSnapshot } from '../jobs/snapshot.ts';

const config = loadConfig();
// R12 reserves one connection for the lock; the computation needs another.
const { db, close } = createDb(config.db.url.expose(), { max: 3 });
let exitCode = 0;
const startedAt = Date.now();
try {
  const result = await runSnapshot({ db });
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  process.stdout.write(
    result.status === 'completed'
      ? `Snapshot completed in ${seconds}s: ${result.counts?.completeness} completeness, ${result.counts?.continuous} continuous, ${result.counts?.categorical} categorical rows\n`
      : `Snapshot ${result.status}: another run holds the lock\n`,
  );
} catch (err) {
  process.stderr.write(`Snapshot failed: ${(err as Error).message}\n`);
  exitCode = 1;
} finally {
  await close();
}
process.exit(exitCode);
