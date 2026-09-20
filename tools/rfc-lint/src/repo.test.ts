import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lintGates } from './gates.ts';
import { discoverRoots, lint } from './lint.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const rfcDir = resolve(repoRoot, 'docs/rfc');

describe('RFC-00 R4 repository linkage', () => {
  it('every exported symbol in apps/*/src and packages/*/src links to an existing RFC rule', () => {
    const violations = lint({ roots: discoverRoots(repoRoot), rfcDir, displayRoot: repoRoot });
    expect(violations.map((v) => `${v.file}:${v.line}: ${v.message}`)).toEqual([]);
  });
});

describe('RFC-32 R8 SPA gates mirror the API', () => {
  it('every permission the web app tests is a catalog key the API enforces', () => {
    const violations = lintGates({
      webSrc: resolve(repoRoot, 'apps/web/src'),
      apiSrc: resolve(repoRoot, 'apps/api/src'),
      rfcDir,
      displayRoot: repoRoot,
    });
    expect(violations.map((v) => `${v.file}:${v.line}: ${v.message}`)).toEqual([]);
  });
});
