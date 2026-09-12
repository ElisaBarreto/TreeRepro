import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, discoverRoots, lint, lintSource } from './lint.ts';
import { loadRfcIndex } from './rfc-index.ts';

function makeTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rfc-lint-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

const RFCS = {
  'docs/rfc/10-platform/10-architecture.md': '- **R1** a\n- **R2** b\n',
};

describe('RFC-00 R4 lintSource', () => {
  const index = loadRfcIndex(join(makeTree(RFCS), 'docs/rfc'));

  it('accepts a tagged export', () => {
    const src = '/** @rfc RFC-10 R1-R2 */\nexport const ok = 1;\n';
    expect(lintSource({ path: 'a.ts', source: src }, index)).toEqual([]);
  });

  it('flags an export without JSDoc', () => {
    const out = lintSource({ path: 'a.ts', source: 'export const bad = 1;\n' }, index);
    expect(out).toEqual([{ file: 'a.ts', line: 1, message: 'export "bad" has no JSDoc @rfc tag' }]);
  });

  it('flags a JSDoc without @rfc', () => {
    const out = lintSource(
      { path: 'a.ts', source: '/** hello */\nexport const bad = 1;\n' },
      index,
    );
    expect(out[0]?.message).toBe('export "bad" JSDoc has no @rfc tag');
  });

  it('flags an unknown RFC', () => {
    const out = lintSource(
      { path: 'a.ts', source: '/** @rfc RFC-99 */\nexport const bad = 1;\n' },
      index,
    );
    expect(out[0]?.message).toBe('export "bad" references unknown RFC-99');
  });

  it('flags an unknown rule', () => {
    const out = lintSource(
      { path: 'a.ts', source: '/** @rfc RFC-10 R7 */\nexport const bad = 1;\n' },
      index,
    );
    expect(out[0]?.message).toBe('export "bad" references RFC-10 R7 which does not exist');
  });

  it('flags a malformed tag with trailing text', () => {
    const src = '/** @rfc RFC-10 R1, RFC-10 R2 */\nexport const bad = 1;\n';
    const out = lintSource({ path: 'a.ts', source: src }, index);
    expect(out[0]?.message).toBe('export "bad" has a malformed @rfc tag (one @rfc line per RFC)');
  });
});

describe('RFC-00 R4 collectSourceFiles and discoverRoots', () => {
  it('collects .ts/.tsx and skips tests, generated, declarations, node_modules and dist', () => {
    const root = makeTree({
      'src/a.ts': '',
      'src/b.tsx': '',
      'src/a.test.ts': '',
      'src/c.integration.test.ts': '',
      'src/routeTree.gen.ts': '',
      'src/types.d.ts': '',
      'src/node_modules/x.ts': '',
      'src/dist/y.ts': '',
      'src/nested/d.ts': '',
    });
    const files = collectSourceFiles(join(root, 'src')).map((f) => f.slice(root.length + 1));
    expect(files).toEqual(['src/a.ts', 'src/b.tsx', 'src/nested/d.ts']);
  });

  it('discovers apps/*/src and packages/*/src', () => {
    const root = makeTree({
      'apps/api/src/x.ts': '',
      'apps/web/src/x.ts': '',
      'packages/contracts/src/x.ts': '',
      'packages/config/tsconfig.base.json': '{}',
      'tools/rfc-lint/src/x.ts': '',
    });
    const roots = discoverRoots(root).map((r) => r.slice(root.length + 1));
    expect(roots).toEqual(['apps/api/src', 'apps/web/src', 'packages/contracts/src']);
  });
});

describe('RFC-00 R4 lint', () => {
  it('reports violations with paths relative to displayRoot', () => {
    const root = makeTree({
      ...RFCS,
      'apps/api/src/good.ts': '/** @rfc RFC-10 R1 */\nexport const good = 1;\n',
      'apps/api/src/bad.ts': 'export const bad = 1;\n',
    });
    const out = lint({
      roots: discoverRoots(root),
      rfcDir: join(root, 'docs/rfc'),
      displayRoot: root,
    });
    expect(out).toEqual([
      { file: 'apps/api/src/bad.ts', line: 1, message: 'export "bad" has no JSDoc @rfc tag' },
    ]);
  });
});
