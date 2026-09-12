import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface RfcEntry {
  id: number;
  path: string;
  rules: Set<number>;
}

const FILE_RE = /^(\d{2})-[a-z0-9-]+\.md$/;
const RULE_RE = /\*\*R(\d+)\*\*/g;

export function loadRfcIndex(rfcDir: string): Map<number, RfcEntry> {
  const index = new Map<number, RfcEntry>();
  for (const rel of readdirSync(rfcDir, { recursive: true, encoding: 'utf8' })) {
    const match = FILE_RE.exec(basename(rel));
    if (!match) continue;
    const id = Number(match[1]);
    const path = join(rfcDir, rel);
    const existing = index.get(id);
    if (existing) {
      throw new Error(`duplicate RFC number ${match[1]}: ${existing.path} and ${path}`);
    }
    const rules = new Set<number>();
    for (const rule of readFileSync(path, 'utf8').matchAll(RULE_RE)) rules.add(Number(rule[1]));
    index.set(id, { id, path, rules });
  }
  return index;
}
