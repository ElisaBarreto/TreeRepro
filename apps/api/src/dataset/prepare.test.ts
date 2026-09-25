import { describe, expect, it } from 'vitest';
import {
  decodeExcelSerial,
  parseCsv,
  preparePlotSpecies,
  preparePlots,
  prepareReferences,
  prepareSynonyms,
  prepareUserPlots,
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

  it('keeps a newline inside a quoted field in that field (RFC 4180)', () => {
    // A full citation is exactly the kind of value that carries one.
    const rows = parseCsv('a,b\n1,"line one\nline two"\n');
    expect(rows).toEqual([{ a: '1', b: 'line one\nline two' }]);
  });

  it('refuses a file whose quotes never close rather than mis-parsing', () => {
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
    const bad = out.anomalies.filter((a) => a.kind === 'malformed_plot_code');
    expect(bad).toHaveLength(1);
    expect(bad[0]?.detail).toMatch(/^row 2:/);
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

  it('flags a local name resolving to more than one WCVP name and emits neither pair', () => {
    const csv = speciesPerPlot([
      ['ABU-01', 'Ambigua nomen', '', '', 'Species one', '', '', '', ''],
      ['ABU-02', 'Ambigua nomen', '', '', 'Species two', '', '', '', ''],
      ['ABU-03', 'Clara nomen', '', '', 'Species three', '', '', '', ''],
    ]);
    const out = prepareSynonyms(parseCsv(csv));
    const amb = out.anomalies.filter((x) => x.kind === 'ambiguous_local_name');
    expect(amb.some((x) => x.detail.includes('Ambigua nomen'))).toBe(true);
    // Writing either pair would assert a mapping the data does not support,
    // and R14 requires each dropped pair to be listed, not just the name.
    expect(amb.filter((x) => x.detail.startsWith('dropped'))).toHaveLength(2);
    expect(out.rows.map((r) => r[1])).toEqual(['Clara nomen']);
  });

  it('reports a blank required field instead of skipping the row in silence', () => {
    const csv = speciesPerPlot([
      ['ABU-01', '', '', '', 'Species one', '', '', '', ''],
      ['ABU-02', 'Local name', '', '', '', '', '', '', ''],
    ]);
    const out = prepareSynonyms(parseCsv(csv));
    expect(out.anomalies.filter((x) => x.kind === 'blank_field')).toHaveLength(2);
    expect(out.rows).toEqual([]);
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

  it('returns null rather than throwing on a value outside the date range', () => {
    // 1e11 days past 1899 is far outside what Date can represent, and unlike
    // a larger literal it is still an exact Number.
    expect(decodeExcelSerial(100_000_000_000)).toBeNull();
  });
});

describe('RFC-68 R14 preparePlots, out-of-range codes', () => {
  it('classifies an undecodable digit-only code as malformed, without crashing the run', () => {
    const pis = parseCsv('FirstName,LastName,WorkEmail,PlotCode\nA,B,a@b.c,100000000000\n');
    const out = preparePlots([], pis);
    expect(out.anomalies.some((a) => a.kind === 'malformed_plot_code')).toBe(true);
    expect(out.rows).toEqual([]);
  });
});

describe('RFC-68 R14 prepareUserPlots', () => {
  const pis = (rows: string[][]) =>
    parseCsv(
      [
        'FirstName,LastName,WorkEmail,PlotCode',
        ...rows.map((r) => r.map((c) => `"${c}"`).join(',')),
      ].join('\n'),
    );

  it('gives one user_email,plot_id row per PI and plot, trimmed, empty parts dropped, pairs distinct', () => {
    const out = prepareUserPlots(
      pis([
        ['Ana', 'B', ' ana@x.org ', 'ABU-02| ABU-01 ||ABU-02'],
        ['Ana', 'B', 'ana@x.org', 'ABU-01'],
        ['Caio', 'D', 'caio@y.org', 'BDF-01'],
      ]),
    );
    expect(out.header).toEqual(['user_email', 'plot_id']);
    expect(out.rows).toEqual([
      ['ana@x.org', 'ABU-01'],
      ['ana@x.org', 'ABU-02'],
      ['caio@y.org', 'BDF-01'],
    ]);
    expect(out.anomalies).toEqual([]);
  });

  it('reports a blank e-mail or a blank plot list instead of skipping the row in silence', () => {
    const out = prepareUserPlots(
      pis([
        ['Ana', 'B', '', 'ABU-01'],
        ['Caio', 'D', 'caio@y.org', ' | '],
      ]),
    );
    expect(out.rows).toEqual([]);
    const blanks = out.anomalies.filter((a) => a.kind === 'blank_field');
    expect(blanks.map((a) => a.detail)).toEqual([
      'row 2: WorkEmail is blank',
      'row 3: PlotCode is blank',
    ]);
  });

  it('drops a pair whose plot code is anomalous, as preparePlots does, and keeps the rest of the row', () => {
    const out = prepareUserPlots(pis([['Ana', 'B', 'ana@x.org', '37226|ABU-01|Dec.01']]));
    expect(out.rows).toEqual([['ana@x.org', 'ABU-01']]);
    expect(out.anomalies.map((a) => a.kind).sort()).toEqual([
      'date_serial_plot_code',
      'malformed_plot_code',
    ]);
    expect(out.anomalies.every((a) => a.detail.startsWith('row 2:'))).toBe(true);
  });
});
