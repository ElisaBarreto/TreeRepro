import { describe, expect, it } from 'vitest';
import { ANNOTATION_COLUMNS, csvRow, RECORD_COLUMNS } from './export.ts';

describe('RFC-66 R4 csvRow', () => {
  it('joins with commas, ends with CRLF, quotes fields holding quotes, commas or line breaks', () => {
    expect(csvRow(['a', 'b', null, 3])).toBe('a,b,,3\r\n');
    expect(csvRow(['Smith, J.', 'say "hi"', 'two\nlines', 'cr\rhere'])).toBe(
      '"Smith, J.","say ""hi""","two\nlines","cr\rhere"\r\n',
    );
    expect(csvRow([''])).toBe('\r\n');
  });
});

describe('RFC-66 R2 column lists', () => {
  it('records.csv names the 24 columns of spec R-17 in order', () => {
    expect([...RECORD_COLUMNS]).toEqual([
      'record_code',
      'family',
      'genus',
      'species',
      'name_source',
      'category',
      'trait',
      'unit',
      'level',
      'value_single',
      'value_min',
      'value_max',
      'value_mean',
      'value_sd',
      'value_n',
      'raw_value',
      'references',
      'origin',
      'intent',
      'responds_to',
      'contested',
      'n_validations',
      'n_contests',
      'created_at',
    ]);
  });

  it('annotations.csv names six columns and no e-mail', () => {
    expect([...ANNOTATION_COLUMNS]).toEqual([
      'record_code',
      'kind',
      'user_name',
      'date',
      'reference',
      'contest_record_code',
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
