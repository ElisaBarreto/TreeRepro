import { describe, expect, it } from 'vitest';
import {
  headerMatches,
  IMPORT_COLUMNS,
  ImportRefusedError,
  isHarmonisableNumber,
  NUMBER_PATTERN,
  parseCsvLine,
  toImportBatch,
  validateHeader,
} from './import.ts';

describe('RFC-64 R2 header validation', () => {
  it('parseCsvLine handles quotes, embedded commas and doubled quotes', () => {
    expect(parseCsvLine('a,b,,d')).toEqual(['a', 'b', '', 'd']);
    expect(parseCsvLine('"Kühn, I., W. Durka",TRY,"say ""hi"""')).toEqual([
      'Kühn, I., W. Durka',
      'TRY',
      'say "hi"',
    ]);
  });

  it('accepts the exact header, with a BOM or CRLF, and refuses anything else', () => {
    const header = IMPORT_COLUMNS.join(',');
    expect(() => validateHeader(header)).not.toThrow();
    expect(() => validateHeader(`\uFEFF${header}\r`)).not.toThrow();
    expect(() => validateHeader(header.replace('wcvp_species', 'species'))).toThrow(
      ImportRefusedError,
    );
    expect(() => validateHeader(`${header},extra`)).toThrow(ImportRefusedError);
    expect(() => validateHeader(IMPORT_COLUMNS.slice().reverse().join(','))).toThrow(
      ImportRefusedError,
    );
    try {
      validateHeader('x');
    } catch (err) {
      expect((err as ImportRefusedError).reason).toBe('header_mismatch');
    }
  });

  it('spec R-2 the header is the unnamed row-number column, the 15 known columns, then ID', () => {
    expect(IMPORT_COLUMNS).toHaveLength(17);
    expect(IMPORT_COLUMNS[0]).toBe('');
    expect(IMPORT_COLUMNS[1]).toBe('primary_reference');
    expect(IMPORT_COLUMNS[15]).toBe('harmonised_value');
    expect(IMPORT_COLUMNS[16]).toBe('ID');
  });

  it("accepts the owner's quoted header and refuses one without ID or without the unnamed column", () => {
    const quoted = IMPORT_COLUMNS.map((c) => `"${c}"`).join(',');
    expect(() => validateHeader(quoted)).not.toThrow();
    expect(headerMatches(quoted)).toBe(true);
    expect(headerMatches(IMPORT_COLUMNS.slice(0, 16).join(','))).toBe(false);
    expect(headerMatches(IMPORT_COLUMNS.slice(1).join(','))).toBe(false);
    expect(() => validateHeader(IMPORT_COLUMNS.slice(1).join(','))).toThrow(ImportRefusedError);
  });
});

describe('RFC-64 R6 number rule', () => {
  it('pattern: integers, decimals, signs, exponents of 1–3 digits; not text, commas, blanks or longer exponents', () => {
    for (const ok of ['0', '12', '12.5', '-.5', '+3.', '1e2', '2.5E-3', '1e307', '1e999'])
      expect(NUMBER_PATTERN.test(ok), ok).toBe(true);
    for (const bad of [
      '',
      ' 1',
      '1,5',
      'Aug',
      '<10mm',
      '1/2',
      'NaN',
      '1e',
      '.',
      '1e2000',
      '1e200000',
    ])
      expect(NUMBER_PATTERN.test(bad), bad).toBe(false);
  });

  it('isHarmonisableNumber adds the 64-character cap and the magnitude bound', () => {
    for (const ok of ['0', '-0', '1e99', '1e307', '.5', '+3', '9'.repeat(64)])
      expect(isHarmonisableNumber(ok), ok).toBe(true);
    for (const bad of ['1e308', '1e400', '1e999', '-1e308', '1'.repeat(65), '1e200000', 'Aug'])
      expect(isHarmonisableNumber(bad), bad).toBe(false);
  });
});

describe('RFC-64 R11, R14 batch item', () => {
  it('carries rowsAlreadyImported', () => {
    const item = toImportBatch(
      {
        id: '0190c3a0-0000-7000-8000-000000000001',
        fileName: 'f.csv',
        fileSha256: 'a'.repeat(64),
        kind: 'records',
        runBy: null,
        startedAt: new Date('2026-09-25T10:00:00Z'),
        finishedAt: null,
        status: 'completed',
        mode: 'append',
        error: null,
        rowsTotal: 5,
        rowsInserted: 1,
        rowsDuplicate: 0,
        rowsRejected: 1,
        rowsPending: 0,
        rowsAlreadyImported: 3,
        unknownLevels: [],
      },
      null,
    );
    expect(item.rowsAlreadyImported).toBe(3);
  });
});
