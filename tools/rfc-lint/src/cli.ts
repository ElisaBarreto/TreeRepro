import { resolve } from 'node:path';
import { lintGates } from './gates.ts';
import { discoverRoots, lint } from './lint.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const rfcDir = resolve(repoRoot, 'docs/rfc');
const violations = [
  ...lint({ roots: discoverRoots(repoRoot), rfcDir, displayRoot: repoRoot }),
  ...lintGates({
    webSrc: resolve(repoRoot, 'apps/web/src'),
    apiSrc: resolve(repoRoot, 'apps/api/src'),
    rfcDir,
    displayRoot: repoRoot,
  }),
];

for (const v of violations) process.stderr.write(`${v.file}:${v.line}: ${v.message}\n`);
if (violations.length > 0) {
  process.stderr.write(`rfc-lint: ${violations.length} violation(s)\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('rfc-lint: ok\n');
}
