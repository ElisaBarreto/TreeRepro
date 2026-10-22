import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareRows, readCsvRows, valuesMatch } from './verify-summaries.ts';

describe('RFC-77 R9 verify:summaries', () => {
  it('valuesMatch: empty and NA are null, booleans, numbers within 1e-9, text exact', () => {
    expect(valuesMatch('', null)).toBe(true);
    expect(valuesMatch('NA', null)).toBe(true);
    expect(valuesMatch('', '')).toBe(true);
    expect(valuesMatch('', 0)).toBe(false);
    expect(valuesMatch('TRUE', true)).toBe(true);
    expect(valuesMatch('FALSE', true)).toBe(false);
    expect(valuesMatch('1289.42', 1289.4200000000001)).toBe(true);
    expect(valuesMatch('1289.42', 1289.43)).toBe(false);
    expect(valuesMatch('3', 3)).toBe(true);
    expect(valuesMatch('median_of_source_medians', 'median_of_source_medians')).toBe(true);
    expect(valuesMatch('black;brown', 'black')).toBe(false);
  });

  it('compareRows reports missing, extra and differing rows', () => {
    const expected = [
      { species: 'A a', trait: 't', v: '1' },
      { species: 'B b', trait: 't', v: '2' },
      { species: 'C c', trait: 't', v: '3' },
    ];
    const computed = [
      { name: 'A a', key: 't', value: 1 },
      { name: 'B b', key: 't', value: 2.5 },
      { name: 'D d', key: 't', value: 4 },
    ];
    const result = compareRows(
      expected,
      computed,
      { expected: ['species', 'trait'], computed: ['name', 'key'] },
      { v: 'value' },
    );
    expect(result.compared).toBe(3);
    expect(result.problems).toEqual([
      'B b / t: v expected 2 got 2.5',
      'missing: C c / t',
      'extra: D d / t',
    ]);
  });

  it('readCsvRows streams rows by header name, quotes and a BOM included', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'verify-'));
    const file = join(dir, 'x.csv');
    await writeFile(file, '﻿species,main_state,share\r\n"Ab c","black;brown",0.5\r\nDe f,red,1\r\n');
    const rows = [];
    for await (const row of readCsvRows(file)) rows.push(row);
    expect(rows).toEqual([
      { species: 'Ab c', main_state: 'black;brown', share: '0.5' },
      { species: 'De f', main_state: 'red', share: '1' },
    ]);
  });
});
