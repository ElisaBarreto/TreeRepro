import { describe, expect, it } from 'vitest';
import { csvRow, EXPORT_COLUMNS } from './export.ts';

describe('RFC-66 R4 csvRow', () => {
  it('joins with commas, ends with CRLF, quotes fields holding quotes, commas or line breaks', () => {
    expect(csvRow(['a', 'b', null, 3])).toBe('a,b,,3\r\n');
    expect(csvRow(['Smith, J.', 'say "hi"', 'two\nlines', 'cr\rhere'])).toBe(
      '"Smith, J.","say ""hi""","two\nlines","cr\rhere"\r\n',
    );
    expect(csvRow([''])).toBe('\r\n');
  });

  it('R8 the header names the seventeen columns in order', () => {
    expect([...EXPORT_COLUMNS]).toEqual([
      'family',
      'genus',
      'species',
      'name_source',
      'category',
      'trait',
      'value',
      'unit',
      'level',
      'numeric_value',
      'raw_value',
      'primary_reference',
      'secondary_reference',
      'origin',
      'intent',
      'created_at',
      'record_id',
    ]);
  });
});

describe('RFC-66 R4 csvField CSV formula injection guard', () => {
  it.each([
    ['=SUM(A1)', "'=SUM(A1)"],
    ['+1+1', "'+1+1"],
    ['-1+1', "'-1+1"],
    ['@cmd', "'@cmd"],
    ['\tx', "'\tx"],
  ])('prefixes %j with a quote before RFC 4180 quoting', (input, expected) => {
    expect(csvRow([input])).toBe(`${expected}\r\n`);
  });

  it('quotes the prefixed field too when RFC 4180 also requires it', () => {
    expect(csvRow(['\rx'])).toBe(`"'\rx"\r\n`);
  });

  it('prefixes a field starting with a line feed too', () => {
    expect(csvRow(['\nx'])).toBe(`"'\nx"\r\n`);
  });

  it('leaves a plain number unprefixed', () => {
    expect(csvRow([-12.5, '+3', '1e5'])).toBe('-12.5,+3,1e5\r\n');
  });
});
