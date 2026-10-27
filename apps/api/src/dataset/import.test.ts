import { describe, expect, it } from 'vitest';
import {
  IMPORT_COLUMNS,
  ImportRefusedError,
  isHarmonisableNumber,
  NUMBER_PATTERN,
  parseCsvLine,
  toImportBatch,
  validateColumns,
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

  const V1 = [
    'ID',
    'source_folder',
    'file_name',
    'sheet',
    'observation_key',
    'final_standard_trait',
    'species',
    'is_tree_species',
    'tree_basis',
    'tree_flag',
    'unit',
    'observation_key_source',
    'study_id',
    'study_key',
    'broad_category',
    'trait_value_type',
    'original_trait_name',
    'original_column_or_variable',
    'original_value_clean',
    'harmonised_value',
    'statistic',
    'unit_harmonisation_status',
    'mean',
    'median',
    'min',
    'max',
    'sd',
    'se',
    'sample_size',
    'summary_source',
    'outlier_flag',
    'wcvp_species',
    'wcvp_genus',
    'wcvp_family',
    'wcvp_taxonomic_status',
    'gbif_species',
    'gbif_genus',
    'gbif_family',
    'gbif_order',
    'gbif_usage_key',
    'taxon_family',
    'taxon_genus',
    'taxon_order',
    'primary_source_species_name',
    'secondary_source_species_name',
    'taxon_name_for_matching',
    'primary_reference',
    'secondary_reference',
    'records_behind_row',
    'dispersal_phase',
    'evidence_id',
    'counts_as_evidence',
    'also_reported_by',
  ];
  const refusal = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(ImportRefusedError);
      expect((err as ImportRefusedError).reason).toBe('header_mismatch');
      return (err as ImportRefusedError).message;
    }
    throw new Error('expected a header_mismatch refusal');
  };

  it("R2 accepts the owner's 53-column release v1 header, in its own order, with or without --trees-only", () => {
    expect(V1).toHaveLength(53);
    expect(() => validateColumns(V1)).not.toThrow();
    expect(() => validateColumns(V1, true)).not.toThrow();
    expect(() => validateHeader(V1.join(','))).not.toThrow();
  });

  it('R2 reads names, not positions: any order, quotes, a BOM or CRLF, extra columns', () => {
    const header = [...IMPORT_COLUMNS]
      .reverse()
      .map((c) => `"${c}"`)
      .join(',');
    expect(() => validateHeader(`\uFEFF${header},extra_one\r`)).not.toThrow();
  });

  it('R2 names every missing column', () => {
    const message = refusal(() =>
      validateColumns(IMPORT_COLUMNS.filter((c) => c !== 'species' && c !== 'outlier_flag')),
    );
    expect(message).toContain('species');
    expect(message).toContain('outlier_flag');
  });

  it('R2 refuses a repeated column, naming it', () => {
    expect(refusal(() => validateColumns([...IMPORT_COLUMNS, 'unit']))).toContain('unit');
  });

  it('R2 requires is_tree_species only with --trees-only', () => {
    expect(() => validateColumns([...IMPORT_COLUMNS])).not.toThrow();
    expect(refusal(() => validateColumns([...IMPORT_COLUMNS], true))).toContain('is_tree_species');
  });

  it('R2 refuses the 36-column layout of 2026-10-19, which has no species and no primary_source_species_name', () => {
    const old =
      'ID,primary_reference,secondary_reference,wcvp_species,wcvp_genus,wcvp_family,gbif_species,gbif_genus,gbif_family,gbif_usage_key,original_species_name,secondary_source_species_name,original_trait_name,final_standard_trait,broad_category,original_value_clean,trait_value_type,harmonised_value,statistic,mean,median,min,max,sd,se,sample_size,summary_source,unit,unit_harmonisation_status,source_folder,file_name,wcvp_taxonomic_status,gbif_order,taxon_order,records_behind_row,outlier_flag';
    const message = refusal(() => validateHeader(old));
    expect(message).toContain('primary_source_species_name');
    expect(message).toMatch(/\bspecies\b/);
  });

  it('R2 refuses the 49-column file of 2026-10-22, which has no evidence columns (issue #345)', () => {
    const evidence = ['dispersal_phase', 'evidence_id', 'counts_as_evidence', 'also_reported_by'];
    const message = refusal(() => validateColumns(V1.filter((c) => !evidence.includes(c))));
    for (const c of evidence) expect(message).toContain(c);
  });

  it('R2 the used columns are the v1 names: the 36 of the old layout, renamed, plus species and the four evidence columns', () => {
    expect(IMPORT_COLUMNS).toHaveLength(41);
    expect(IMPORT_COLUMNS).toContain('species');
    expect(IMPORT_COLUMNS).toContain('primary_source_species_name');
    expect(IMPORT_COLUMNS).not.toContain('original_species_name');
    for (const c of IMPORT_COLUMNS) expect(V1).toContain(c);
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
        rowsFiltered: 4,
        unknownLevels: [],
      },
      null,
    );
    expect(item.rowsAlreadyImported).toBe(3);
    // RFC-64 R11 (issue #288): the rows --trees-only left out.
    expect(item.rowsFiltered).toBe(4);
  });
});
