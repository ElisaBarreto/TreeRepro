import { describe, expect, it } from 'vitest';
import {
  IMPORT_COLUMNS,
  ImportRefusedError,
  isHarmonisableNumber,
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
