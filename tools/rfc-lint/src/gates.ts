import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectSourceFiles, type Violation } from './lint.ts';

/**
 * Permission keys the SPA tests that the API never checks (RFC-32 R8):
 * `admin.access` opens the admin area and grants nothing by itself (RFC-30
 * R4).
 */
export const GATE_EXEMPT_KEYS: readonly string[] = ['admin.access'];

export interface Gate {
  /** 1-based line where the gate starts. */
  line: number;
  key: string;
}

export interface GateLintOptions {
  /** `apps/web/src` */
  webSrc: string;
  /** `apps/api/src` */
  apiSrc: string;
  /** `docs/rfc` — the catalog is the table of RFC-30. */
  rfcDir: string;
  /** When set, reported file paths are relative to this directory. */
  displayRoot?: string;
}

// The first argument may hold one level of parentheses (`useMe()`), never a
// closing one of its own, so a dynamic key (`hasPermission(me, e.permission)`)
// stops the match instead of reaching into the next call. The trailing comma
// is the one Biome puts after the key when the call spans several lines.
const HAS_PERMISSION_RE = /hasPermission\((?:[^()]|\([^()]*\))*?,\s*'([^']*)'\s*,?\s*\)/g;
const NAV_PERMISSION_RE = /\bpermission:\s*'([^']*)'/g;
const INCLUDES_RE = /permissions\.includes\(\s*'([^']*)'\s*\)/g;
// A route guard, or a check on a resolved permission set inside a handler or
// a service (RFC-32 R7): `permissions.has(…)`, `currentPermissions(c).has(…)`.
const REQUIRE_PERMISSION_RE = /requirePermission\(\s*ctx\s*,\s*'([^']*)'/g;
const HAS_RE = /[pP]ermissions(?:\(\w*\))?\.has\(\s*'([^']*)'\s*\)/g;
const CATALOG_ROW_RE = /^\|\s*`([^`]+)`\s*\|/gm;

/**
 * Blanks `//` and `/* *\/` comments so a gate quoted in prose is not read as
 * one, keeping every newline (line numbers stay true) and every string
 * literal (a `//` inside a URL is not a comment). Regular-expression literals
 * are not tracked: a `//` inside one is taken for a comment to the end of
 * that line, which no gate shares.
 */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i] as string;
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (; i < stop; i++) out += source[i] === '\n' ? '\n' : ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      out += ch;
      i++;
      while (i < n && source[i] !== ch) {
        if (source[i] === '\\') {
          out += source[i];
          i++;
        }
        if (i < n) {
          out += source[i];
          i++;
        }
      }
      if (i < n) {
        out += ch;
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/** Every permission key the web app tests, in source order. */
export function findGates(source: string): Gate[] {
  const code = stripComments(source);
  const gates: Gate[] = [];
  for (const re of [HAS_PERMISSION_RE, NAV_PERMISSION_RE, INCLUDES_RE]) {
    for (const match of code.matchAll(re)) {
      gates.push({ line: lineOf(code, match.index), key: match[1] ?? '' });
    }
  }
  return gates.sort((a, b) => a.line - b.line);
}

/**
 * Every key the source enforces: named by a `requirePermission(ctx, '<key>')`
 * guard or tested with `.has('<key>')` on a resolved permission set.
 */
export function findEnforcedPermissions(source: string): Set<string> {
  const code = stripComments(source);
  const keys = new Set<string>();
  for (const re of [REQUIRE_PERMISSION_RE, HAS_RE]) {
    for (const match of code.matchAll(re)) keys.add(match[1] ?? '');
  }
  return keys;
}

/** The keys of the RFC-30 catalog table, in table order. */
export function loadPermissionCatalog(rfcDir: string): Set<string> {
  const source = readFileSync(join(rfcDir, '30-access/30-permission-catalog.md'), 'utf8');
  const keys = new Set<string>();
  for (const match of source.matchAll(CATALOG_ROW_RE)) keys.add(match[1] ?? '');
  if (keys.size === 0) throw new Error('RFC-30 has no permission catalog table');
  return keys;
}

/**
 * RFC-32 R8: every SPA gate is a catalog key the API enforces, except the
 * keys of `GATE_EXEMPT_KEYS`, which the SPA must still test.
 */
export function lintGates(options: GateLintOptions): Violation[] {
  const catalog = loadPermissionCatalog(options.rfcDir);
  const enforced = new Set<string>();
  for (const path of collectSourceFiles(options.apiSrc)) {
    for (const key of findEnforcedPermissions(readFileSync(path, 'utf8'))) enforced.add(key);
  }
  const display = (path: string) =>
    options.displayRoot ? relative(options.displayRoot, path) : path;
  const violations: Violation[] = [];
  const tested = new Set<string>();
  for (const path of collectSourceFiles(options.webSrc)) {
    for (const gate of findGates(readFileSync(path, 'utf8'))) {
      tested.add(gate.key);
      if (!catalog.has(gate.key)) {
        violations.push({
          file: display(path),
          line: gate.line,
          message: `SPA gate "${gate.key}" is not a permission of the RFC-30 catalog`,
        });
        continue;
      }
      if (GATE_EXEMPT_KEYS.includes(gate.key) || enforced.has(gate.key)) continue;
      violations.push({
        file: display(path),
        line: gate.line,
        message: `SPA gate "${gate.key}" names a permission the API never checks (no requirePermission or .has of it under apps/api/src)`,
      });
    }
  }
  for (const key of GATE_EXEMPT_KEYS) {
    if (tested.has(key)) continue;
    violations.push({
      file: display(options.webSrc),
      line: 0,
      message: `RFC-32 R8 exempts "${key}" from the cross-check, but the SPA no longer tests it (drop it from GATE_EXEMPT_KEYS and from the rule)`,
    });
  }
  return violations;
}
