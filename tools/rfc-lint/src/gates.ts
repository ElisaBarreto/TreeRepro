import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectSourceFiles, type Violation } from './lint.ts';
import { type Token, tokenize } from './tokens.ts';

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

const CATALOG_ROW_RE = /^\|\s*`([^`]+)`\s*\|/gm;

type StringToken = Token & { kind: 'string' };

const isIdent = (t: Token | undefined, value?: string): boolean =>
  t?.kind === 'ident' && (value === undefined || t.value === value);
const isPunct = (t: Token | undefined, value: string): boolean =>
  t?.kind === 'punct' && t.value === value;
const isString = (t: Token | undefined): t is StringToken => t?.kind === 'string';

/**
 * The key of a call opening at `open` (the index of its `(`) when the call
 * has the shape `f(<one argument>, '<key>')`, the argument holding at most
 * nested parentheses (`useMe()`) and a trailing comma allowed; undefined for
 * any other shape, a dynamic key included.
 */
function lastStringArgument(tokens: Token[], open: number): StringToken | undefined {
  let depth = 0;
  for (let k = open + 1; k < tokens.length; k++) {
    const t = tokens[k];
    if (isPunct(t, '(')) depth++;
    else if (isPunct(t, ')')) {
      if (depth === 0) return undefined;
      depth--;
    } else if (isPunct(t, ',') && depth === 0) {
      const key = tokens[k + 1];
      const after = tokens[k + 2];
      const close = isPunct(after, ',') ? tokens[k + 3] : after;
      return isString(key) && isPunct(close, ')') ? key : undefined;
    }
  }
  return undefined;
}

/** The key of `.has('<key>')` when it starts at `k` (the index of the `.`). */
function hasArgument(tokens: Token[], k: number): string | undefined {
  const key = tokens[k + 3];
  return isPunct(tokens[k], '.') &&
    isIdent(tokens[k + 1], 'has') &&
    isPunct(tokens[k + 2], '(') &&
    isString(key) &&
    isPunct(tokens[k + 4], ')')
    ? key.value
    : undefined;
}

/**
 * Every permission key the web app tests, in source order: the key argument
 * of `hasPermission(…, '<key>')`, a navigation entry's `permission: '<key>'`
 * and `permissions.includes('<key>')`. Read from tokens, so a gate quoted in
 * a comment or a string is no gate.
 */
export function findGates(source: string): Gate[] {
  const tokens = tokenize(source);
  const gates: Gate[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t?.kind !== 'ident') continue;
    if (t.value === 'hasPermission' && isPunct(tokens[i + 1], '(')) {
      const key = lastStringArgument(tokens, i + 1);
      if (key) gates.push({ line: t.line, key: key.value });
    } else if (t.value === 'permission' && isPunct(tokens[i + 1], ':')) {
      const key = tokens[i + 2];
      if (isString(key)) gates.push({ line: t.line, key: key.value });
    } else if (t.value === 'permissions' && isPunct(tokens[i + 1], '.')) {
      const key = tokens[i + 4];
      if (
        isIdent(tokens[i + 2], 'includes') &&
        isPunct(tokens[i + 3], '(') &&
        isString(key) &&
        isPunct(tokens[i + 5], ')')
      )
        gates.push({ line: t.line, key: key.value });
    }
  }
  return gates;
}

/**
 * Every key the source enforces: named by a `requirePermission(ctx, '<key>')`
 * guard, or tested on a resolved permission set inside a handler or a service
 * (RFC-32 R7) — exactly `permissions.has('<key>')` on the bare identifier, or
 * `currentPermissions(c).has('<key>')`. Another receiver (`rolePermissions`,
 * `viewer.permissions`) is not the viewer's resolved set and does not count;
 * nor does anything inside a comment or a string.
 */
export function findEnforcedPermissions(source: string): Set<string> {
  const tokens = tokenize(source);
  const keys = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t?.kind !== 'ident') continue;
    if (t.value === 'requirePermission') {
      const key = tokens[i + 4];
      if (
        isPunct(tokens[i + 1], '(') &&
        isIdent(tokens[i + 2], 'ctx') &&
        isPunct(tokens[i + 3], ',') &&
        isString(key)
      )
        keys.add(key.value);
    } else if (t.value === 'permissions' && !isPunct(tokens[i - 1], '.')) {
      const key = hasArgument(tokens, i + 1);
      if (key !== undefined) keys.add(key);
    } else if (
      t.value === 'currentPermissions' &&
      isPunct(tokens[i + 1], '(') &&
      isIdent(tokens[i + 2]) &&
      isPunct(tokens[i + 3], ')')
    ) {
      const key = hasArgument(tokens, i + 4);
      if (key !== undefined) keys.add(key);
    }
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
        message: `SPA gate "${gate.key}" names a permission the API never checks (no requirePermission or permissions.has of it under apps/api/src)`,
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
