import { parseCsvLine } from './import.ts';

/**
 * Why the raw exports differ from the importers at all: they are produced by
 * the compilations the project draws on, whose column names and shapes are not
 * ours to choose. This module is the one place that mapping is written down.
 * @rfc RFC-68 R14
 */
export interface Anomaly {
  kind:
    | 'date_serial_plot_code'
    | 'malformed_plot_code'
    | 'blank_field'
    | 'conflicting_doi'
    | 'ambiguous_local_name';
  detail: string;
}

/** A prepared file: the header the importer expects, its rows, and what looked wrong. @rfc RFC-68 R14 */
export interface Prepared {
  header: string[];
  rows: string[][];
  anomalies: Anomaly[];
}

/** RFC-60 R2: trimmed, internal whitespace collapsed. Names only. @rfc RFC-68 R14 */
function norm(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Trim, and nothing else. RFC-64 R5 matches a reference by its *trimmed*
 * `citation_key`, so any inner character is part of the key — including a
 * non-breaking space, which several citations carry and which `\s` would
 * otherwise collapse into a plain space, leaving a key that no longer matches
 * the same string in `sample_data.csv`.
 * @rfc RFC-68 R14
 */
function trimOnly(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * Reads a whole CSV into records keyed by header name. The repository has no
 * CSV parser by design — Postgres parses the bulk files through COPY — but
 * these three exports are small and have to be reshaped before any database
 * sees them. None of them puts a newline inside a quoted field, so splitting
 * on newlines and reusing `parseCsvLine` is sound; a line whose quotes do not
 * close is refused rather than silently mis-parsed into the wrong columns.
 * @rfc RFC-68 R14
 */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .replace(/^﻿/, '')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0);
  const [head, ...rest] = lines;
  if (!head) return [];
  const columns = parseCsvLine(head).map((c) => c.trim());
  return rest.map((line, i) => {
    if ((line.match(/"/g)?.length ?? 0) % 2 !== 0) {
      throw new Error(`Unterminated quoted field on line ${i + 2}`);
    }
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    columns.forEach((name, j) => {
      row[name] = cells[j] ?? '';
    });
    return row;
  });
}

/** Excel's serial epoch is 1899-12-30. @rfc RFC-68 R14 */
export function decodeExcelSerial(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + serial * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Every plot code in the exports has this shape; anything else is suspect. @rfc RFC-68 R14 */
const PLOT_CODE = /^[A-Z]{3}-[0-9]+$/;

/**
 * Classifies a plot code. A digits-only code is reported with the date it
 * decodes to and the code that implies, because that is what a spreadsheet
 * does to `DEC-01`: it stores 1 December as a serial. Today's damaged values
 * are deliberately not listed here — a corrected export must pass straight
 * through.
 * @rfc RFC-68 R14
 */
function checkPlotCode(code: string): Anomaly | null {
  if (PLOT_CODE.test(code)) return null;
  if (/^[0-9]+$/.test(code)) {
    const date = decodeExcelSerial(Number(code));
    const [y, m] = date.split('-');
    const month = [
      '',
      'JAN',
      'FEB',
      'MAR',
      'APR',
      'MAY',
      'JUN',
      'JUL',
      'AUG',
      'SEP',
      'OCT',
      'NOV',
      'DEC',
    ][Number(m)];
    return {
      kind: 'date_serial_plot_code',
      detail: `${code} decodes as the Excel date ${date}; the original code was probably ${month}-${(Number(y) % 100).toString().padStart(2, '0')}`,
    };
  }
  return { kind: 'malformed_plot_code', detail: `${code} is not of the form AAA-NN` };
}

/** @rfc RFC-68 R14 */
export function preparePlotSpecies(rows: Record<string, string>[]): Prepared {
  const anomalies: Anomaly[] = [];
  const pairs = new Set<string>();
  rows.forEach((r, i) => {
    const plot = norm(r['plot.id']);
    const species = norm(r.wcvp_species);
    if (!plot || !species) {
      anomalies.push({
        kind: 'blank_field',
        detail: `row ${i + 2}: ${!plot ? 'plot.id' : 'wcvp_species'} is blank`,
      });
      return;
    }
    // The same check `preparePlots` applies: a pair naming a plot that will not
    // be in plots.import.csv could only reject as unknown_plot.
    const bad = checkPlotCode(plot);
    if (bad) {
      if (!anomalies.some((a) => a.detail === bad.detail)) anomalies.push(bad);
      return;
    }
    pairs.add(`${plot}\u0000${species}`);
  });
  return {
    header: ['plot_id', 'wcvp_species'],
    rows: [...pairs].sort().map((p) => p.split('\u0000') as [string, string]),
    anomalies,
  };
}

/**
 * The local names contributors know their species by. Only names that differ
 * from the accepted one are emitted: RFC-68 R12 counts a name equal to the
 * canonical as a duplicate anyway.
 * @rfc RFC-68 R14
 */
export function prepareSynonyms(rows: Record<string, string>[]): Prepared {
  const anomalies: Anomaly[] = [];
  const pairs = new Set<string>();
  const resolvesTo = new Map<string, Set<string>>();
  for (const r of rows) {
    const local = norm(r['species.cor']);
    const accepted = norm(r.wcvp_species);
    if (!local || !accepted) continue;
    let seen = resolvesTo.get(local);
    if (!seen) {
      seen = new Set();
      resolvesTo.set(local, seen);
    }
    seen.add(accepted);
    if (local !== accepted) pairs.add(`${accepted}\u0000${local}`);
  }
  for (const [local, accepted] of resolvesTo) {
    if (accepted.size > 1) {
      anomalies.push({
        kind: 'ambiguous_local_name',
        detail: `${local} resolves to ${[...accepted].sort().join(', ')}`,
      });
    }
  }
  return {
    header: ['wcvp_canonical_name', 'synonym_or_common_name', 'name_type', 'source'],
    rows: [...pairs].sort().map((p) => {
      const [accepted, local] = p.split('\u0000') as [string, string];
      return [accepted, local, 'synonym', 'original.species.name'];
    }),
    anomalies,
  };
}

/**
 * Every plot either export mentions. `plots.name` is NOT NULL and no export
 * carries a plot name, so the code stands in for it; RFC-68 R9 never updates
 * an existing plot, so real names arrive through the UI, not a re-import.
 * @rfc RFC-68 R14
 */
export function preparePlots(
  speciesRows: Record<string, string>[],
  piRows: Record<string, string>[],
): Prepared {
  const anomalies: Anomaly[] = [];
  const codes = new Set<string>();
  const consider = (raw: string) => {
    const code = norm(raw);
    if (!code) return;
    const bad = checkPlotCode(code);
    if (bad) {
      if (!anomalies.some((a) => a.detail === bad.detail)) anomalies.push(bad);
      return;
    }
    codes.add(code);
  };
  for (const r of speciesRows) consider(r['plot.id'] ?? '');
  for (const r of piRows) for (const c of (r.PlotCode ?? '').split('|')) consider(c);
  return {
    header: ['plot_id', 'name', 'description', 'latitude', 'longitude', 'country', 'biome'],
    rows: [...codes].sort().map((c) => [c, c, '', '', '', '', '']),
    anomalies,
  };
}

/**
 * `url` is left empty on purpose: the web app builds the `https://doi.org/`
 * link from the stored DOI (RFC-61 R4), so filling it here would duplicate a
 * value that is derived elsewhere.
 * @rfc RFC-68 R14
 */
export function prepareReferences(rows: Record<string, string>[]): Prepared {
  const anomalies: Anomaly[] = [];
  const byKey = new Map<string, { doi: string; citation: string }>();
  rows.forEach((r, i) => {
    const key = trimOnly(r.secondary_reference);
    const doi = trimOnly(r.DOI);
    const citation = trimOnly(r['Full citation']);
    if (!key) {
      anomalies.push({ kind: 'blank_field', detail: `row ${i + 2}: secondary_reference is blank` });
      return;
    }
    const existing = byKey.get(key);
    if (existing) {
      if (existing.doi !== doi) {
        anomalies.push({
          kind: 'conflicting_doi',
          detail: `${key} appears with two DOIs: ${existing.doi} and ${doi}`,
        });
      }
      return;
    }
    byKey.set(key, { doi, citation });
  });
  return {
    header: ['reference_key', 'short_citation', 'full_citation', 'doi', 'url'],
    rows: [...byKey.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => [key, key, v.citation, v.doi, '']),
    anomalies,
  };
}
