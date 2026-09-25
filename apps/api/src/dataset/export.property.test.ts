import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { csvRow } from './export.ts';

// Property-based counterpart of export.test.ts: csvRow must stay readable by an
// RFC 4180 reader for any field value, and the formula guard must fire for
// every dangerous prefix while leaving plain numbers alone.

const FORMULA_START = /^[=+\-@\t\r\n]/;

/** One field the way the export builds them: text, number, or a missing value. */
const fieldArb = fc.oneof(
  fc.string({ unit: 'grapheme' }),
  fc.string(),
  fc
    .tuple(fc.constantFrom('=', '+', '-', '@', '\t', '\r', '\n'), fc.string())
    .map(([p, s]) => p + s),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.integer(),
  fc.constant(null),
  fc.constant(undefined),
);

/** Text a spreadsheet parses as a number: the guard must never touch these. */
const plainNumberArb = fc.oneof(
  fc.stringMatching(/^[+-]?\d{1,12}$/),
  fc.stringMatching(/^[+-]?\d{1,6}\.\d{0,6}$/),
  fc.stringMatching(/^[+-]?\.\d{1,6}$/),
  fc.stringMatching(/^[+-]?\d{1,6}(\.\d{1,6})?[eE][+-]?\d{1,3}$/),
);

/** Minimal RFC 4180 reader for a single CRLF-terminated line. */
function parseCsvLine(line: string): string[] {
  if (!line.endsWith('\r\n')) throw new Error('line does not end with CRLF');
  const body = line.slice(0, -2);
  const fields: string[] = [];
  let i = 0;
  for (;;) {
    if (body[i] === '"') {
      let field = '';
      i += 1;
      for (;;) {
        const ch = body[i];
        if (ch === undefined) throw new Error('unterminated quoted field');
        if (ch === '"') {
          if (body[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        field += ch;
        i += 1;
      }
      fields.push(field);
    } else {
      let end = body.indexOf(',', i);
      if (end === -1) end = body.length;
      const field = body.slice(i, end);
      if (/["\r\n]/.test(field)) throw new Error('unquoted field holds a quote or line break');
      fields.push(field);
      i = end;
    }
    if (i === body.length) return fields;
    if (body[i] !== ',') throw new Error(`expected a comma at offset ${i}`);
    i += 1;
  }
}

function expectedText(field: string | number | null | undefined): string {
  return field === null || field === undefined ? '' : String(field);
}

describe('RFC-66 R4 csvRow properties', () => {
  it('reads back with an RFC 4180 parser, one field per input, in order', () => {
    fc.assert(
      fc.property(fc.array(fieldArb, { minLength: 1, maxLength: 14 }), (fields) => {
        const parsed = parseCsvLine(csvRow(fields));
        expect(parsed).toHaveLength(fields.length);
        parsed.forEach((text, index) => {
          const original = expectedText(fields[index]);
          expect([original, `'${original}`]).toContain(text);
        });
      }),
    );
  });

  it('never lets a non-numeric field start with a formula character', () => {
    fc.assert(
      fc.property(fc.array(fieldArb, { minLength: 1, maxLength: 14 }), (fields) => {
        for (const text of parseCsvLine(csvRow(fields))) {
          if (FORMULA_START.test(text)) expect(Number.isNaN(Number(text))).toBe(false);
        }
      }),
    );
  });

  it('leaves plain numbers, as text or as number, untouched', () => {
    fc.assert(
      fc.property(plainNumberArb, (text) => {
        expect(parseCsvLine(csvRow([text]))).toEqual([text]);
      }),
    );
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (n) => {
        expect(parseCsvLine(csvRow([n]))).toEqual([String(n)]);
      }),
    );
  });

  it('guards every field that starts with a formula character and is not a number', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('=', '+', '-', '@', '\t', '\r', '\n'),
        fc.stringMatching(/^[A-Za-z(][A-Za-z0-9()]*$/),
        (prefix, rest) => {
          expect(parseCsvLine(csvRow([`${prefix}${rest}`]))).toEqual([`'${prefix}${rest}`]);
        },
      ),
    );
  });
});
