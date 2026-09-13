import { describe, expect, it } from 'vitest';
import {
  IMPORT_COLUMNS,
  ImportRefusedError,
  NUMBER_PATTERN,
  parseCsvLine,
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
});

describe('RFC-64 R6 number pattern', () => {
  it('matches integers, decimals, signs and exponents; not text, commas or blanks', () => {
    for (const ok of ['0', '12', '12.5', '-.5', '+3.', '1e2', '2.5E-3'])
      expect(NUMBER_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ['', ' 1', '1,5', 'Aug', '<10mm', '1/2', 'NaN', '1e', '.'])
      expect(NUMBER_PATTERN.test(bad), bad).toBe(false);
  });
});
