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

  it('R2 the header is the 30 columns of the compiled dataset, ID first', () => {
    expect(IMPORT_COLUMNS.join(',')).toBe(
      'ID,primary_reference,secondary_reference,wcvp_species,wcvp_genus,wcvp_family,gbif_species,gbif_genus,gbif_family,gbif_usage_key,original_species_name,secondary_source_species_name,original_trait_name,final_standard_trait,broad_category,original_value_clean,trait_value_type,harmonised_value,statistic,sample_size,source_folder,file_name,wcvp_taxonomic_status,gbif_order,taxon_order,unit_harmonisation_status,min,max,sd,se',
    );
  });

  it('R2 refuses the 28-column layout of 2026-09-27 (no gbif_genus, gbif_family, gbif_order; statistic_record_codes last)', () => {
    const old = [
      ...IMPORT_COLUMNS.filter((c) => !['gbif_genus', 'gbif_family', 'gbif_order'].includes(c)),
      'statistic_record_codes',
    ];
    expect(old).toHaveLength(28);
    expect(headerMatches(old.join(','))).toBe(false);
    expect(() => validateHeader(old.join(','))).toThrow(ImportRefusedError);
  });

  it("R2 accepts the owner's quoted header and refuses the old 17-column one and one without ID", () => {
    const quoted = IMPORT_COLUMNS.map((c) => `"${c}"`).join(',');
    expect(() => validateHeader(quoted)).not.toThrow();
    expect(headerMatches(quoted)).toBe(true);
    expect(headerMatches(IMPORT_COLUMNS.join(','))).toBe(true);
    const old = [
      '',
      ...IMPORT_COLUMNS.slice(1, IMPORT_COLUMNS.indexOf('harmonised_value') + 1),
      'ID',
    ];
    expect(old).toHaveLength(17);
    expect(headerMatches(old.join(','))).toBe(false);
    expect(headerMatches(['', ...IMPORT_COLUMNS].join(','))).toBe(false);
    const noId = IMPORT_COLUMNS.filter((c) => c !== 'ID');
    expect(noId).toHaveLength(29);
    expect(headerMatches(noId.join(','))).toBe(false);
    expect(() => validateHeader(noId.join(','))).toThrow(ImportRefusedError);
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
