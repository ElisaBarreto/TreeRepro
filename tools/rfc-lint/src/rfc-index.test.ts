import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRfcIndex } from './rfc-index.ts';

function makeRfcDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rfc-index-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

describe('RFC-00 R1, R3 loadRfcIndex', () => {
  it('indexes RFC numbers and rule ids from nested category folders', () => {
    const dir = makeRfcDir({
      'README.md': '# index',
      '00-process/00-rfc-process.md': '- **R1** a\n- **R2** b\n',
      '10-platform/10-architecture.md': '- **R1** only\n',
    });
    const index = loadRfcIndex(dir);
    expect([...index.keys()].sort()).toEqual([0, 10]);
    expect([...(index.get(0)?.rules ?? [])]).toEqual([1, 2]);
    expect([...(index.get(10)?.rules ?? [])]).toEqual([1]);
  });

  it('throws on duplicate RFC numbers', () => {
    const dir = makeRfcDir({
      '00-process/00-a.md': '- **R1** a\n',
      '10-platform/00-b.md': '- **R1** b\n',
    });
    expect(() => loadRfcIndex(dir)).toThrow(/duplicate RFC number 00/);
  });
});
