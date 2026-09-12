export interface ExportSite {
  /** 1-based line of the export statement. */
  line: number;
  name: string;
  /** JSDoc block ending on the line directly above the export, or null. */
  doc: string | null;
}

export interface RfcRef {
  rfc: number;
  rules: number[];
  /** Anything left on the tag line after the rule list; must be empty. */
  trailing: string;
}

const EXPORT_RE = /^export\s/;
const EXEMPT_RE = /^export\s+(type|interface|declare|\{|\*)/;
const NAMED_RE =
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
const DEFAULT_RE = /^export\s+default\b/;

/**
 * Name given to an export line that is neither exempt nor understood
 * (`export abstract class`, `export enum`, `export const { a } = …`). It is
 * still reported, so an unknown shape fails loud instead of slipping past.
 */
export const UNPARSED_EXPORT = '<unparsed export>';

export function findExports(source: string): ExportSite[] {
  const lines = source.split('\n');
  const sites: ExportSite[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!EXPORT_RE.test(line) || EXEMPT_RE.test(line)) continue;
    const named = NAMED_RE.exec(line);
    const name = named?.[1] ?? (DEFAULT_RE.test(line) ? 'default' : UNPARSED_EXPORT);
    sites.push({ line: i + 1, name, doc: docAbove(lines, i) });
  }
  return sites;
}

function docAbove(lines: string[], exportIndex: number): string | null {
  let i = exportIndex - 1;
  if (i < 0 || !(lines[i] ?? '').trim().endsWith('*/')) return null;
  const collected: string[] = [];
  for (; i >= 0; i--) {
    const line = lines[i] ?? '';
    collected.unshift(line);
    const trimmed = line.trim();
    if (trimmed.startsWith('/**')) return collected.join('\n');
    if (trimmed.startsWith('/*')) return null;
  }
  return null;
}

const TAG_RE = /@rfc\s+RFC-(\d{2})\b((?:\s*,?\s*R\d+(?:\s*-\s*R?\d+)?)*)([^\n]*)/g;
const RULE_RE = /R(\d+)(?:\s*-\s*R?(\d+))?/g;

export function parseRfcTags(doc: string): RfcRef[] {
  const refs: RfcRef[] = [];
  for (const match of doc.matchAll(TAG_RE)) {
    const rules: number[] = [];
    for (const rule of (match[2] ?? '').matchAll(RULE_RE)) {
      const from = Number(rule[1]);
      const to = rule[2] === undefined ? from : Number(rule[2]);
      for (let k = from; k <= to; k++) rules.push(k);
    }
    const trailing = (match[3] ?? '').replace(/\*\/\s*$/, '').trimEnd();
    refs.push({ rfc: Number(match[1]), rules, trailing });
  }
  return refs;
}
