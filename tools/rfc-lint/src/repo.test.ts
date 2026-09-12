import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverRoots, lint } from './lint.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');

describe('RFC-00 R4 repository linkage', () => {
  it('every exported symbol in apps/*/src and packages/*/src links to an existing RFC rule', () => {
    const violations = lint({
      roots: discoverRoots(repoRoot),
      rfcDir: resolve(repoRoot, 'docs/rfc'),
      displayRoot: repoRoot,
    });
    expect(violations.map((v) => `${v.file}:${v.line}: ${v.message}`)).toEqual([]);
  });
});
