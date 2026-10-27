// `pnpm verify:summaries --expected <dir> [--trees-only]` — compares the
// platform's species summaries with the owner's species_*_long.csv (RFC-77 R9).
// Reads only. Exit codes: 0 equal, 1 differences or error, 2 usage.
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { UNRESTRICTED } from '../access/visibility.ts';
import { loadConfig } from '../config.ts';
import { categoricalSummaries, continuousSummaries } from '../dataset/species-summary.ts';
import {
  type CsvRow,
  compareRows,
  ownerOutlierFlags,
  readCsvRows,
} from '../dataset/verify-summaries.ts';
import { createDb } from '../db/client.ts';

let values: { expected?: string; 'trees-only': boolean };
try {
  ({ values } = parseArgs({
    options: { expected: { type: 'string' }, 'trees-only': { type: 'boolean', default: false } },
    strict: true,
  }));
} catch {
  values = { 'trees-only': false };
}
if (!values.expected) {
  process.stderr.write('usage: verify-summaries --expected <dir> [--trees-only]\n');
  process.exit(2);
}
const dir = values.expected;
const treesOnly = values['trees-only'];

async function expectedRows(file: string): Promise<CsvRow[]> {
  const rows: CsvRow[] = [];
  for await (const row of readCsvRows(join(dir, file))) {
    if (!treesOnly || row.is_tree_species?.toUpperCase() === 'TRUE') rows.push(row);
  }
  return rows;
}

const SHOWN = 50;
const config = loadConfig();
const { db, close } = createDb(config.db.url.expose(), { max: 2 });
let exitCode = 0;
try {
  const continuous = compareRows(
    await expectedRows('species_continuous_traits_long.csv'),
    (await continuousSummaries(db, UNRESTRICTED, null)).map((row) => ({
      ...row,
      outlierFlags: ownerOutlierFlags(row.outlierFlags),
    })),
    { expected: ['species', 'final_standard_trait'], computed: ['speciesName', 'traitKey'] },
    {
      species_median: 'speciesMedian',
      summary_basis: 'summaryBasis',
      species_mean: 'speciesMean',
      mean_basis: 'meanBasis',
      species_sd: 'speciesSd',
      species_min: 'speciesMin',
      species_max: 'speciesMax',
      n_records: 'nRecords',
      n_sources: 'nSources',
      outlier_flags: 'outlierFlags',
    },
  );
  const categorical = compareRows(
    await expectedRows('species_categorical_traits_long.csv'),
    await categoricalSummaries(db, UNRESTRICTED, null),
    {
      expected: ['species', 'final_standard_trait', 'level'],
      computed: ['speciesName', 'traitKey', 'level'],
    },
    {
      n_references: 'nReferences',
      n_sources: 'nSources',
      n_references_species_trait: 'nReferencesSpeciesTrait',
      n_sources_species_trait: 'nSourcesSpeciesTrait',
      share_of_references: 'shareOfReferences',
      share_of_sources: 'shareOfSources',
      n_levels_for_species_trait: 'nLevels',
      is_main_state: 'isMainState',
      main_state: 'mainState',
    },
  );
  for (const [name, result] of [
    ['continuous', continuous],
    ['categorical', categorical],
  ] as const) {
    process.stdout.write(
      `${name}: ${result.compared} rows compared, ${result.problems.length} problems\n`,
    );
    for (const p of result.problems.slice(0, SHOWN)) process.stdout.write(`  ${p}\n`);
    if (result.problems.length > SHOWN) {
      process.stdout.write(`  … and ${result.problems.length - SHOWN} more\n`);
    }
    if (result.problems.length > 0) exitCode = 1;
  }
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  exitCode = 1;
} finally {
  await close();
}
process.exit(exitCode);
