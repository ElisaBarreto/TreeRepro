import { randomBytes, randomInt } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAnnotation, createRecord, createReference } from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { UNRESTRICTED } from '../access/visibility.ts';
import { traits } from '../db/schema/dictionary.ts';
import { species } from '../db/schema/taxa.ts';
import { IMPORT_COLUMNS, importRecords } from './import.ts';
import {
  categoricalSummaries,
  continuousSummaries,
  speciesTraitStates,
} from './species-summary.ts';

type Column = (typeof IMPORT_COLUMNS)[number];
type Cells = Partial<Record<Column, string>>;

describe('RFC-77 species summaries', () => {
  const t = useTestDb();
  const tag = randomBytes(4).toString('hex');
  let next = randomInt(100_000_000, 900_000_000);
  const name = (base: string) => `${base}-${tag}`;

  /** Imports v1 rows (by name) and answers the species ids, by name. */
  async function load(rows: Cells[]) {
    const line = (cells: Cells) =>
      IMPORT_COLUMNS.map((c) => {
        const v = c === 'ID' ? `EB_${next++}` : (cells[c] ?? '');
        return v.includes(',') || v.includes(';') ? `"${v}"` : v;
      }).join(',');
    const dir = await mkdtemp(join(tmpdir(), 'summary-'));
    const file = join(dir, `summary-${randomBytes(4).toString('hex')}.csv`);
    await writeFile(file, `${IMPORT_COLUMNS.join(',')}\n${rows.map(line).join('\n')}\n`);
    const batch = await importRecords(t.db, { filePath: file });
    expect(batch).toMatchObject({ status: 'completed', rowsRejected: 0, rowsDuplicate: 0 });
  }
  async function ids(...names: string[]) {
    const rows = await t.db
      .select({ id: species.id, name: species.canonicalName })
      .from(species)
      .where(inArray(species.canonicalName, names));
    return names.map((n) => rows.find((r) => r.name === n)?.id as string);
  }
  const q = (sp: string, cells: Cells): Cells => ({
    species: sp,
    primary_reference: 'SUMREF',
    final_standard_trait: 'seed_mass',
    trait_value_type: 'quantitative_or_text',
    ...cells,
  });
  const c = (sp: string, cells: Cells): Cells => ({
    species: sp,
    primary_reference: 'SUMREF',
    final_standard_trait: 'flower_color',
    trait_value_type: 'categorical',
    ...cells,
  });

  it('R4, R5 the median of per-source medians, weighted mean and sd, a study summary once, unusable values counted', async () => {
    const sp = name('Summaria media');
    await load([
      // S1: 1, 2, 9 → source median 2; 9 is flagged
      q(sp, { source_folder: 'S1', harmonised_value: '1' }),
      // bounds_inverted is not an outlier flag of the summary (RFC-77 R5)
      q(sp, { source_folder: 'S1', harmonised_value: '2', outlier_flag: 'bounds_inverted' }),
      q(sp, { source_folder: 'S1', harmonised_value: '9', outlier_flag: 'trait_extreme' }),
      // S2: 10, and 1000 in a unit that needs checking (counted, never used)
      q(sp, { source_folder: 'S2', harmonised_value: '10' }),
      q(sp, {
        source_folder: 'S2',
        harmonised_value: '1000',
        unit_harmonisation_status: 'needs_unit_check',
        outlier_flag: 'unit_factor',
      }),
      // S3: its own mean 4 with n = 3 → central 4, weight 3
      q(sp, { source_folder: 'S3', mean: '4', sample_size: '3' }),
      // S4: a study's two measurements carrying its reported range: 5 and 7, bounds 3 and 20 once
      q(sp, {
        source_folder: 'S4',
        file_name: 'study.csv',
        harmonised_value: '5',
        min: '3',
        max: '20',
        summary_source: 'reported_by_study',
      }),
      q(sp, {
        source_folder: 'S4',
        file_name: 'study.csv',
        harmonised_value: '7',
        min: '3',
        max: '20',
        summary_source: 'reported_by_study',
      }),
      // S5: a derived mean alone contributes nothing and is not counted
      q(sp, { source_folder: 'S5', mean: '50', summary_source: 'derived_from_records' }),
    ]);
    const [id] = await ids(sp);
    const [row] = await continuousSummaries(t.db, UNRESTRICTED, [id as string]);
    const values = [1, 2, 9, 10, 4, 5, 7];
    const weights = [1, 1, 1, 1, 3, 1, 1];
    const w = weights.reduce((a, b) => a + b, 0);
    const mean = values.reduce((a, v, i) => a + v * (weights[i] as number), 0) / w;
    const sd = Math.sqrt(
      values.reduce((a, v, i) => a + (weights[i] as number) * (v - mean) ** 2, 0) / w,
    );
    expect(row).toMatchObject({
      speciesName: sp,
      traitKey: 'seed_mass',
      // source medians 2, 10, 4, 6 → 5
      speciesMedian: 5,
      summaryBasis: 'median_of_source_medians',
      meanBasis: 'central_values',
      speciesMin: 1,
      speciesMax: 20,
      nRecords: 8,
      nSources: 4,
      outlierFlags: 'unit_factor;trait_extreme',
      unit: 'mg',
    });
    expect(row?.speciesMean).toBeCloseTo(mean, 12);
    expect(row?.speciesSd).toBeCloseTo(sd, 12);
  });

  it('R5 a species with bounds only gets their midpoint, or the one bound it has', async () => {
    const range = name('Summaria ambitus');
    const single = name('Summaria unica');
    await load([
      q(range, { source_folder: 'S1', min: '2', max: '8' }),
      q(range, { source_folder: 'S2', min: '4' }),
      q(single, { source_folder: 'S1', max: '7' }),
    ]);
    const [a, b] = await ids(range, single);
    const rows = await continuousSummaries(t.db, UNRESTRICTED, [a as string, b as string]);
    expect(rows.find((r) => r.speciesName === range)).toMatchObject({
      // median of mins 3, median of maxs 8
      speciesMedian: 5.5,
      summaryBasis: 'range_midpoint',
      // mean of mins 3, mean of maxs 8
      speciesMean: 5.5,
      meanBasis: 'range_midpoint',
      speciesSd: null,
      speciesMin: 2,
      speciesMax: 8,
      nRecords: 2,
      nSources: 2,
      outlierFlags: '',
    });
    expect(rows.find((r) => r.speciesName === single)).toMatchObject({
      speciesMedian: 7,
      summaryBasis: 'single_bound',
      speciesMean: 7,
      meanBasis: 'single_bound',
    });
  });

  it('R6, R7 states counted per observation, weighted by records_behind_row; shares, main state, majority', async () => {
    const sp = name('Summaria colorata');
    await load([
      // one observation stating two states, standing for two records; each
      // observation cites its own reference, as in the owner's file (the claim
      // key of RFC-63 R3 merges identical claims of one reference)
      c(sp, { source_folder: 'S1', harmonised_value: 'black;brown', records_behind_row: '2' }),
      c(sp, { source_folder: 'S1', primary_reference: 'SUMREF-B', harmonised_value: 'black' }),
      c(sp, { source_folder: 'S2', harmonised_value: 'red' }),
    ]);
    const [id] = await ids(sp);
    const levels = await categoricalSummaries(t.db, UNRESTRICTED, [id as string]);
    const by = (level: string) => levels.find((l) => l.level === level);
    const totals = {
      nRecordsSpeciesTrait: 4,
      nSourcesSpeciesTrait: 2,
      nLevels: 3,
      mainState: 'black',
    };
    expect(by('black')).toMatchObject({
      ...totals,
      nRecords: 3,
      nSources: 1,
      shareOfRecords: 0.75,
      shareOfSources: 0.5,
      isMainState: true,
    });
    expect(by('brown')).toMatchObject({
      ...totals,
      nRecords: 2,
      nSources: 1,
      shareOfRecords: 0.5,
      isMainState: false,
    });
    expect(by('red')).toMatchObject({
      ...totals,
      nRecords: 1,
      nSources: 1,
      shareOfRecords: 0.25,
      shareOfSources: 0.5,
    });
    expect(speciesTraitStates(levels)).toEqual([
      expect.objectContaining({
        speciesName: sp,
        traitKey: 'flower_color',
        mainState: 'black',
        share: 0.75,
        majority: true,
        states: 'black;brown;red',
        allStates: 'black;brown;red',
        nRecords: 4,
        nStates: 3,
      }),
    ]);
  });

  it('R6, R7 a tie keeps every main state; a clear minority is left out of states only', async () => {
    const tie = name('Summaria aequa');
    const minor = name('Summaria minor');
    await load([
      c(tie, { source_folder: 'S1', harmonised_value: 'yellow' }),
      c(tie, { source_folder: 'S2', harmonised_value: 'white' }),
      ...Array.from({ length: 10 }, (_, i) =>
        c(minor, {
          source_folder: `M${i}`,
          primary_reference: `SUMREF-M${i}`,
          harmonised_value: 'white',
        }),
      ),
      c(minor, { source_folder: 'M10', harmonised_value: 'black' }),
    ]);
    const [a, b] = await ids(tie, minor);
    const states = speciesTraitStates(
      await categoricalSummaries(t.db, UNRESTRICTED, [a as string, b as string]),
    );
    expect(states.find((s) => s.speciesName === tie)).toMatchObject({
      mainState: 'white;yellow',
      share: 0.5,
      majority: true,
      states: 'white;yellow',
    });
    expect(states.find((s) => s.speciesName === minor)).toMatchObject({
      mainState: 'white',
      share: 0.9091,
      states: 'white',
      allStates: 'white;black',
      nStates: 2,
    });
  });

  it('R1, R3 a platform record votes as its reference; a withdrawn record never counts', async () => {
    const sp = name('Summaria communis');
    await load([q(sp, { source_folder: 'S1', harmonised_value: '10' })]);
    const [id] = await ids(sp);
    const [trait] = await t.db.select().from(traits).where(eq(traits.key, 'seed_mass'));
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const manual = (value: number) =>
      createRecord(t.db, {
        origin: 'manual',
        createdBy: user.id,
        speciesId: id as string,
        traitId: trait?.id as string,
        valueText: String(value),
        numericValue: value,
        primaryReferenceId: ref.id,
      });
    await manual(20);
    await manual(40);
    const withdrawn = await manual(1000);
    await createAnnotation(t.db, { recordId: withdrawn.id, actorId: user.id, kind: 'withdraw' });
    const [row] = await continuousSummaries(t.db, UNRESTRICTED, [id as string]);
    // sources S1 (10) and the reference (20, 40 → 30): median of 10 and 30
    expect(row).toMatchObject({ speciesMedian: 20, nRecords: 3, nSources: 2, speciesMax: 40 });
  });

  it('R8 with no species list, every species with records is summarised', async () => {
    const sp = name('Summaria omnis');
    await load([q(sp, { source_folder: 'S1', harmonised_value: '3' })]);
    const all = await continuousSummaries(t.db, UNRESTRICTED, null);
    expect(all.find((r) => r.speciesName === sp)).toMatchObject({ speciesMedian: 3 });
  });
});
