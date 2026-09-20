/**
 * A lexical pass over TypeScript / TSX source, enough for the gate lint to
 * read code and nothing else: comments vanish, a string or template literal
 * is one opaque token (so code quoted inside one is never read as code), a
 * regular-expression literal is one opaque token (so a quote inside one
 * cannot open a string). It is not a parser: JSX text is tokenised as code,
 * which is harmless except for an apostrophe in prose, which opens a string
 * that ends at the end of that line.
 */
export type Token =
  | { kind: 'ident'; value: string; line: number }
  | { kind: 'number'; value: string; line: number }
  | { kind: 'punct'; value: string; line: number }
  | { kind: 'string'; value: string; line: number }
  | { kind: 'template'; line: number }
  | { kind: 'regex'; line: number };

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;
const DIGIT = /[0-9]/;
const NUMBER_PART = /[\w.]/;

// After one of these a `/` starts a regular expression; after anything else
// that ends an operand (an identifier, a number, a closing bracket) it divides.
const REGEX_AFTER_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

function regexMayStart(previous: Token | undefined): boolean {
  if (!previous) return true;
  switch (previous.kind) {
    case 'ident':
      return REGEX_AFTER_KEYWORDS.has(previous.value);
    case 'punct':
      return previous.value !== ')' && previous.value !== ']';
    default:
      return false;
  }
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  const at = (k: number): string => source[k] ?? '';

  /** Skips a template literal starting at the opening backtick; returns the index after the closing one. */
  const skipTemplate = (start: number): number => {
    let k = start + 1;
    while (k < n) {
      const ch = at(k);
      if (ch === '\\') {
        k += 2;
        continue;
      }
      if (ch === '\n') line++;
      if (ch === '`') return k + 1;
      if (ch === '$' && at(k + 1) === '{') {
        k = skipTemplateExpression(k + 2);
        continue;
      }
      k++;
    }
    return n;
  };
  /** Skips a `${ … }` expression body starting after the brace; returns the index after the closing one. */
  const skipTemplateExpression = (start: number): number => {
    let depth = 1;
    let k = start;
    while (k < n && depth > 0) {
      const ch = at(k);
      if (ch === '\n') line++;
      if (ch === '`') {
        k = skipTemplate(k);
        continue;
      }
      if (ch === "'" || ch === '"') {
        k = skipString(k);
        continue;
      }
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      k++;
    }
    return k;
  };
  /** Skips a quoted string starting at its quote; returns the index after the closing quote (or at the newline that cut it short). */
  const skipString = (start: number): number => {
    const quote = at(start);
    let k = start + 1;
    while (k < n) {
      const ch = at(k);
      if (ch === '\\') {
        k += 2;
        continue;
      }
      if (ch === '\n') return k;
      if (ch === quote) return k + 1;
      k++;
    }
    return n;
  };

  while (i < n) {
    const ch = at(i);
    const next = at(i + 1);
    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < n && at(i) !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (; i < stop; i++) if (at(i) === '\n') line++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = skipString(i);
      const closed = at(end - 1) === ch && end - 1 > i;
      tokens.push({ kind: 'string', value: source.slice(i + 1, closed ? end - 1 : end), line });
      i = end;
      continue;
    }
    if (ch === '`') {
      tokens.push({ kind: 'template', line });
      i = skipTemplate(i);
      continue;
    }
    if (ch === '/' && regexMayStart(tokens[tokens.length - 1])) {
      let k = i + 1;
      let inClass = false;
      while (k < n && at(k) !== '\n') {
        const c = at(k);
        if (c === '\\') {
          k += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        k++;
      }
      k++;
      while (k < n && IDENT_PART.test(at(k))) k++;
      tokens.push({ kind: 'regex', line });
      i = k;
      continue;
    }
    if (IDENT_START.test(ch)) {
      let k = i + 1;
      while (k < n && IDENT_PART.test(at(k))) k++;
      tokens.push({ kind: 'ident', value: source.slice(i, k), line });
      i = k;
      continue;
    }
    if (DIGIT.test(ch)) {
      let k = i + 1;
      while (k < n && NUMBER_PART.test(at(k))) k++;
      tokens.push({ kind: 'number', value: source.slice(i, k), line });
      i = k;
      continue;
    }
    tokens.push({ kind: 'punct', value: ch, line });
    i++;
  }
  return tokens;
}
