import { describe, expect, it } from 'vitest';
import {
  decodeExcelSerial,
  parseCsv,
  preparePlotSpecies,
  preparePlots,
  prepareReferences,
  prepareSynonyms,
} from './prepare.ts';

const speciesPerPlot = (rows: string[][]) =>
  [
    'plot.id,species.cor,genus.cor,family.cor,wcvp_species,wcvp_genus,wcvp_family,gbif_species,gbif_usage_key',
    ...rows.map((r) => r.join(',')),
  ].join('\n');

describe('RFC-68 R14 parseCsv', () => {
  it('reads quoted fields containing commas', () => {
    const rows = parseCsv('a,b\n1,"x, y"\n');
    expect(rows).toEqual([{ a: '1', b: 'x, y' }]);
  });

  it('refuses an unterminated quoted field rather than mis-parsing', () => {
    expect(() => parseCsv('a,b\n1,"x\n')).toThrow(/unterminated/i);
  });

  it('strips a BOM and a trailing carriage return', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([{ a: '1', b: '2' }]);
  });
});

describe('RFC-68 R14 preparePlotSpecies', () => {
  it('maps plot.id to plot_id, drops blanks and de-duplicates pairs', () => {
    const csv = speciesPerPlot([
      ['ABU-01', 'Ceiba insignis', '', '', 'Ceiba insignis', '', '', '', ''],
      ['ABU-01', 'Chorisia integrifolia', '', '', 'Ceiba insignis', '', '', '', ''],
      ['', 'X', '', '', 'Y', '', '', '', ''],
      ['ABU-02', 'Z', '', '', '', '', '', '', ''],
    ]);
    const out = preparePlotSpecies(parseCsv(csv));
    expect(out.header).toEqual(['plot_id', 'wcvp_species']);
    expect(out.rows).toEqual([['ABU-01', 'Ceiba insignis']]);
    expect(out.anomalies.filter((a) => a.kind === 'blank_field')).toHaveLength(2);
  });

  it('drops a pair whose plot code is anomalous, as preparePlots does', () => {
    // plots.import.csv never contains a damaged code, so a pair referencing
    // one could only reject as unknown_plot.
    const csv = speciesPerPlot([
      ['Dec.01', 'X', '', '', 'Xus xus', '', '', '', ''],
      ['ABU-01', 'Y', '', '', 'Yus yus', '', '', '', ''],
    ]);
    const out = preparePlotSpecies(parseCsv(csv));
    expect(out.rows).toEqual([['ABU-01', 'Yus yus']]);
    expect(out.anomalies.some((a) => a.kind === 'malformed_plot_code')).toBe(true);
  });
});

describe('RFC-68 R14 prepareSynonyms', () => {
  it('keeps only names that differ, tagged with the agreed source', () => {
    const csv = speciesPerPlot([
      ['ABU-01', 'Chorisia integrifolia', '', '', 'Ceiba insignis', '', '', '', ''],
      ['ABU-02', 'Ceiba insignis', '', '', 'Ceiba insignis', '', '', '', ''],
    ]);
    const out = prepareSynonyms(parseCsv(csv));
    expect(out.header).toEqual([
      'wcvp_canonical_name',
      'synonym_or_common_name',
      'name_type',
      'source',
    ]);
    expect(out.rows).toEqual([
      ['Ceiba insignis', 'Chorisia integrifolia', 'synonym', 'original.species.name'],
    ]);
  });

  it('flags a local name resolving to more than one WCVP name', () => {
    const csv = speciesPerPlot([
      ['ABU-01', 'Ambigua nomen', '', '', 'Species one', '', '', '', ''],
      ['ABU-02', 'Ambigua nomen', '', '', 'Species two', '', '', '', ''],
    ]);
    const out = prepareSynonyms(parseCsv(csv));
    const a = out.anomalies.find((x) => x.kind === 'ambiguous_local_name');
    expect(a?.detail).toContain('Ambigua nomen');
  });
});

describe('RFC-68 R14 preparePlots', () => {
  const pis = (codes: string) =>
    parseCsv(`FirstName,LastName,WorkEmail,PlotCode\nA,B,a@b.c,${codes}\n`);

  it('unions both files, splits PlotCode on the pipe and names each plot by its code', () => {
    const sp = parseCsv(speciesPerPlot([['BDF-01', 'X', '', '', 'X', '', '', '', '']]));
    const out = preparePlots(sp, pis('ABU-01|ABU-02'));
    expect(out.header).toEqual([
      'plot_id',
      'name',
      'description',
      'latitude',
      'longitude',
      'country',
      'biome',
    ]);
    expect(out.rows).toEqual([
      ['ABU-01', 'ABU-01', '', '', '', '', ''],
      ['ABU-02', 'ABU-02', '', '', '', '', ''],
      ['BDF-01', 'BDF-01', '', '', '', '', ''],
    ]);
  });

  it('reports a digits-only code with the date it decodes to', () => {
    const out = preparePlots([], pis('37226'));
    const a = out.anomalies.find((x) => x.kind === 'date_serial_plot_code');
    expect(a?.detail).toContain('37226');
    expect(a?.detail).toContain('2001-12-01');
    expect(out.rows.map((r) => r[0])).not.toContain('37226');
  });

  it('reports a code outside the UPPERCASE3-NN shape', () => {
    const out = preparePlots([], pis('Dec.01'));
    const a = out.anomalies.find((x) => x.kind === 'malformed_plot_code');
    expect(a?.detail).toContain('Dec.01');
  });
});

describe('RFC-68 R14 prepareReferences', () => {
  it('trims but never collapses a reference key: RFC-64 R5 matches on the trimmed key', () => {
    // A non-breaking space inside a key is part of it. `\s` in JavaScript
    // matches U+00A0, so collapsing would rewrite the key and it would no
    // longer match the same string in sample_data.csv.
    const nbsp = '\u00a0';
    const out = prepareReferences(
      parseCsv(
        `DOI,Full citation,secondary_reference\n"10.1/x","A citation","B.${nbsp}Lanuza et al., 2023"\n`,
      ),
    );
    expect(out.rows[0]?.[0]).toBe(`B.${nbsp}Lanuza et al., 2023`);
  });

  const refs = (rows: string[][]) =>
    parseCsv(
      [
        'DOI,Full citation,secondary_reference',
        ...rows.map((r) => r.map((c) => `"${c}"`).join(',')),
      ].join('\n'),
    );

  it('maps the key to both reference_key and short_citation and leaves url empty', () => {
    const out = prepareReferences(
      refs([['https://doi.org/10.1/x', 'Ann A. (2020). Title.', 'Ann, 2020']]),
    );
    expect(out.header).toEqual(['reference_key', 'short_citation', 'full_citation', 'doi', 'url']);
    expect(out.rows).toEqual([
      ['Ann, 2020', 'Ann, 2020', 'Ann A. (2020). Title.', 'https://doi.org/10.1/x', ''],
    ]);
  });

  it('flags one key carrying two different DOIs', () => {
    const out = prepareReferences(
      refs([
        ['https://doi.org/10.1/a', 'First paper', 'Wang, 2025'],
        ['https://doi.org/10.1/b', 'Second paper', 'Wang, 2025'],
      ]),
    );
    const a = out.anomalies.find((x) => x.kind === 'conflicting_doi');
    expect(a?.detail).toContain('Wang, 2025');
  });
});

describe('RFC-68 R14 decodeExcelSerial', () => {
  it('decodes with the 1899-12-30 epoch', () => {
    expect(decodeExcelSerial(37226)).toBe('2001-12-01');
    expect(decodeExcelSerial(37135)).toBe('2001-09-01');
  });
});
