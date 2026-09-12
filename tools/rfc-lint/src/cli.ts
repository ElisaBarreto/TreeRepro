import { resolve } from 'node:path';
import { discoverRoots, lint } from './lint.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const violations = lint({
  roots: discoverRoots(repoRoot),
  rfcDir: resolve(repoRoot, 'docs/rfc'),
  displayRoot: repoRoot,
});

for (const v of violations) process.stderr.write(`${v.file}:${v.line}: ${v.message}\n`);
if (violations.length > 0) {
  process.stderr.write(`rfc-lint: ${violations.length} violation(s)\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('rfc-lint: ok\n');
}
