// `pnpm check:phylogenies --dir <platform dir>` — checks one platform's
// phylogeny figures against the trait dictionary in the database before they
// are published (RFC-79 R5). Writes nothing. Exit codes: 0 ok, 1 problems, 2 usage.
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { checkFigures } from '../phylogenies/check.ts';

const USAGE = 'usage: check-phylogenies --dir <platform dir>\n';

let dir: string | undefined;
try {
  ({
    values: { dir },
  } = parseArgs({ options: { dir: { type: 'string' } }, strict: true }));
} catch {
  dir = undefined;
}
if (!dir) {
  process.stderr.write(USAGE);
  process.exit(2);
}

const config = loadConfig();
const { db, close } = createDb(config.db.url.expose(), { max: 1 });

let exitCode = 0;
try {
  const r = await checkFigures(db, dir);
  const line = (label: string, items: string[]) =>
    process.stdout.write(`${label} (${items.length}): ${items.join(', ') || '—'}\n`);
  if (r.missingDir) process.stdout.write(`No such directory: ${dir}\n`);
  if (r.coverageClash) process.stdout.write('A trait is keyed "coverage": rename it first\n');
  line('Unknown names', r.unknown);
  line('PNGs without a display copy', r.missingDisplay);
  line('Active traits without a figure (report only)', r.withoutFigure);
  process.stdout.write(r.ok ? 'OK\n' : 'FAILED\n');
  if (!r.ok) exitCode = 1;
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  exitCode = 1;
} finally {
  await close();
}
process.exit(exitCode);
