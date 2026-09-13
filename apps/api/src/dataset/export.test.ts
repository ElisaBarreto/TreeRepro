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

  it('R2 the header names the fourteen columns in order', () => {
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
      'primary_reference',
      'secondary_reference',
      'decided_at',
      'record_id',
    ]);
  });
});
