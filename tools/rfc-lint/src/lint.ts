import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadRfcIndex, type RfcEntry } from './rfc-index.ts';
import { findExports, parseRfcTags } from './scan.ts';

export interface Violation {
  file: string;
  line: number;
  message: string;
}

export interface SourceFile {
  path: string;
  source: string;
}

export interface LintOptions {
  roots: string[];
  rfcDir: string;
  /** When set, reported file paths are relative to this directory. */
  displayRoot?: string;
}

const SOURCE_RE = /\.tsx?$/;
const IGNORED_RE = /(\.test\.tsx?|\.gen\.tsx?|\.d\.ts)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist']);

export function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (SOURCE_RE.test(entry.name) && !IGNORED_RE.test(entry.name)) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

export function discoverRoots(repoRoot: string): string[] {
  const roots: string[] = [];
  for (const group of ['apps', 'packages']) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      const src = join(groupDir, entry.name, 'src');
      if (entry.isDirectory() && existsSync(src)) roots.push(src);
    }
  }
  return roots.sort();
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function lintSource(file: SourceFile, index: Map<number, RfcEntry>): Violation[] {
  const violations: Violation[] = [];
  const add = (line: number, message: string): void => {
    violations.push({ file: file.path, line, message });
  };
  for (const site of findExports(file.source)) {
    if (site.doc === null) {
      add(site.line, `export "${site.name}" has no JSDoc @rfc tag`);
      continue;
    }
    const refs = parseRfcTags(site.doc);
    if (refs.length === 0) {
      add(site.line, `export "${site.name}" JSDoc has no @rfc tag`);
      continue;
    }
    const tagCount = (site.doc.match(/@rfc\b/g) ?? []).length;
    if (tagCount !== refs.length || refs.some((r) => r.trailing !== '')) {
      add(site.line, `export "${site.name}" has a malformed @rfc tag (one @rfc line per RFC)`);
      continue;
    }
    for (const ref of refs) {
      const entry = index.get(ref.rfc);
      if (!entry) {
        add(site.line, `export "${site.name}" references unknown RFC-${pad(ref.rfc)}`);
        continue;
      }
      for (const rule of ref.rules) {
        if (!entry.rules.has(rule)) {
          add(
            site.line,
            `export "${site.name}" references RFC-${pad(ref.rfc)} R${rule} which does not exist`,
          );
        }
      }
    }
  }
  return violations;
}

export function lint(options: LintOptions): Violation[] {
  const index = loadRfcIndex(options.rfcDir);
  const violations: Violation[] = [];
  for (const root of options.roots) {
    for (const path of collectSourceFiles(root)) {
      const display = options.displayRoot ? relative(options.displayRoot, path) : path;
      violations.push(...lintSource({ path: display, source: readFileSync(path, 'utf8') }, index));
    }
  }
  return violations;
}
