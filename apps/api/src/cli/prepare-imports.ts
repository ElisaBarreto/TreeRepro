// `pnpm prepare:imports --source <dir> --out <dir> [--skip-anomalies]` — turns the
// raw exports into the importers' headers (RFC-68 R14). Reads and writes files
// only; no database. Exit codes: 0 written, 1 anomalies, 2 usage.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { IMPORT_COLUMNS, readFirstLine } from '../dataset/import.ts';
import {
  type Anomaly,
  type Prepared,
  parseCsv,
  preparePlotSpecies,
  preparePlots,
  prepareReferences,
  prepareSynonyms,
} from '../dataset/prepare.ts';

const USAGE = 'usage: prepare-imports --source <dir> --out <dir> [--skip-anomalies]\n';

let values: { source?: string; out?: string; 'skip-anomalies': boolean };
try {
  ({ values } = parseArgs({
    options: {
      source: { type: 'string' },
      out: { type: 'string' },
      'skip-anomalies': { type: 'boolean', default: false },
    },
    strict: true,
  }));
} catch {
  process.stderr.write(USAGE);
  process.exit(2);
}
if (!values.source || !values.out) {
  process.stderr.write(USAGE);
  process.exit(2);
}
const source = values.source;
const out = values.out;

const SPECIES_PER_PLOT = 'Species_per_plot_filtered.csv';
const PIS_PER_PLOT = 'PIs_per_plot_filtered.csv';
const REFS = 'refs_with_citations_filtered.csv';
const RECORDS = 'sample_data.csv';

async function read(name: string): Promise<Record<string, string>[]> {
  return parseCsv(await readFile(join(source, name), 'utf8'));
}

function toCsv(p: Prepared): string {
  const quote = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  return [p.header, ...p.rows]
    .map((row) => row.map(quote).join(','))
    .join('\n')
    .concat('\n');
}

/**
 * `full` prints every detail. RFC-68 R14 promises that `--skip-anomalies`
 * lists every dropped row, so the operator can account for each one; the
 * preview is only for the refusal case, where nothing has been dropped yet
 * and the point is to show what is wrong.
 * @rfc RFC-68 R14
 */
function report(name: string, anomalies: Anomaly[], full: boolean): void {
  if (anomalies.length === 0) return;
  const byKind = new Map<string, Anomaly[]>();
  for (const a of anomalies) byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a]);
  for (const [kind, list] of byKind) {
    process.stderr.write(`  ${name}: ${list.length} ${kind}\n`);
    const shown = full ? list : list.slice(0, 10);
    for (const a of shown) process.stderr.write(`      ${a.detail}\n`);
    if (!full && list.length > shown.length) {
      process.stderr.write(
        `      … and ${list.length - shown.length} more; --skip-anomalies lists them all\n`,
      );
    }
  }
}

let exitCode = 0;
try {
  // RFC-64 R2 owns this header; the records file is reported, never rewritten.
  const header = (await readFirstLine(join(source, RECORDS))).replace(/^﻿/, '').replace(/\r$/, '');
  const matches = header === IMPORT_COLUMNS.join(',');
  process.stdout.write(
    `${RECORDS}: header ${matches ? 'matches RFC-64 R2 — import it as it is' : 'DOES NOT match RFC-64 R2'}\n`,
  );
  if (!matches) exitCode = 1;
} catch {
  process.stdout.write(`${RECORDS}: not found in ${source} — skipped\n`);
}

const speciesRows = await read(SPECIES_PER_PLOT);
const piRows = await read(PIS_PER_PLOT);
const refRows = await read(REFS);

const outputs: [string, Prepared][] = [
  ['plot-species.import.csv', preparePlotSpecies(speciesRows)],
  ['synonyms.import.csv', prepareSynonyms(speciesRows)],
  ['plots.import.csv', preparePlots(speciesRows, piRows)],
  ['references.import.csv', prepareReferences(refRows)],
];

for (const [name, prepared] of outputs) {
  if (prepared.anomalies.length > 0) {
    process.stderr.write(`anomalies in ${name}:\n`);
    report(name, prepared.anomalies, values['skip-anomalies']);
    if (!values['skip-anomalies']) {
      process.stderr.write(
        `  not written; re-run with --skip-anomalies to write it without those rows\n`,
      );
      exitCode = 1;
      continue;
    }
    process.stderr.write(`  --skip-anomalies: writing without the rows above\n`);
  }
  await writeFile(join(out, name), toCsv(prepared), 'utf8');
  process.stdout.write(`${name}: ${prepared.rows.length} rows\n`);
}

process.exit(exitCode);
