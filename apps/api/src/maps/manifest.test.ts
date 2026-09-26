import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseCsvLine } from '../dataset/import.ts';
import { dictionaryPath } from '../dataset/seed.ts';
import { defaultMapsDir, KIND_FITS, parseManifest, readManifest } from './manifest.ts';

const HEADER = 'trait_key,map_kind,level_key,file,data_version';
const files = new Set(['a.svg', 'b.webp', 'c.svg']);
const parse = (...rows: string[]) => parseManifest([HEADER, ...rows].join('\n'), files);

describe('parseManifest (RFC-76 R1)', () => {
  it('parses rows, empty level as null, in file order', () => {
    expect(
      parse('seed_mass,mean,,b.webp,2026-09-01', 'flower_color,prevalence,red,a.svg,2026-08-31'),
    ).toEqual([
      {
        line: 2,
        traitKey: 'seed_mass',
        kind: 'mean',
        levelKey: null,
        file: 'b.webp',
        dataVersion: '2026-09-01',
      },
      {
        line: 3,
        traitKey: 'flower_color',
        kind: 'prevalence',
        levelKey: 'red',
        file: 'a.svg',
        dataVersion: '2026-08-31',
      },
    ]);
  });

  it('accepts a header-only manifest and a trailing newline / CRLF', () => {
    expect(parseManifest(`${HEADER}\n`, files)).toEqual([]);
    expect(parseManifest(`${HEADER}\r\nx,completeness,,a.svg,2026-09-01\r\n`, files)).toHaveLength(
      1,
    );
  });

  it.each([
    ['a wrong header', 'trait,map_kind,level_key,file,data_version', /line 1/],
    ['an unknown kind', `${HEADER}\nx,median,,a.svg,2026-09-01`, /line 2.*map_kind/],
    ['prevalence without level', `${HEADER}\nx,prevalence,,a.svg,2026-09-01`, /line 2.*level_key/],
    ['a level on another kind', `${HEADER}\nx,mean,red,a.svg,2026-09-01`, /line 2.*level_key/],
    ['a path in file', `${HEADER}\nx,mean,,../a.svg,2026-09-01`, /line 2.*file/],
    ['an unsupported extension', `${HEADER}\nx,mean,,a.png,2026-09-01`, /line 2.*file/],
    ['an uppercase file name', `${HEADER}\nx,mean,,A.svg,2026-09-01`, /line 2.*file/],
    ['a missing file', `${HEADER}\nx,mean,,zzz.svg,2026-09-01`, /line 2.*not found/],
    ['an impossible date', `${HEADER}\nx,mean,,a.svg,2026-02-30`, /line 2.*data_version/],
    [
      'a repeated file',
      `${HEADER}\nx,mean,,a.svg,2026-09-01\ny,mean,,a.svg,2026-09-01`,
      /line 3.*file/,
    ],
    [
      'a repeated map',
      `${HEADER}\nx,mean,,a.svg,2026-09-01\nx,mean,,c.svg,2026-09-01`,
      /line 3.*duplicate/,
    ],
    ['a wrong column count', `${HEADER}\nx,mean,a.svg,2026-09-01`, /line 2/],
    ['an empty trait key', `${HEADER}\n,mean,,a.svg,2026-09-01`, /line 2.*trait_key/],
  ])('rejects %s', (_label, text, message) => {
    expect(() => parseManifest(text, files)).toThrow(message);
  });
});

describe('the committed manifest agrees with the dictionary (RFC-76 R2)', () => {
  it('names dictionary traits, fitting kinds and existing levels', async () => {
    const rows = await readManifest(defaultMapsDir());
    const [, ...lines] = (await readFile(dictionaryPath(), 'utf8')).trim().split(/\r?\n/);
    // header: final_standard_trait,broad_category,trait_value_type,standard_unit,description,harmonised_levels[,active]
    const dict = new Map(
      lines.map((l) => {
        const f = parseCsvLine(l);
        return [
          f[0],
          { valueType: f[2], levels: new Set((f[5] ?? '').split(';').filter(Boolean)) },
        ];
      }),
    );
    for (const row of rows) {
      const trait = dict.get(row.traitKey);
      expect(trait, `line ${row.line}: unknown trait ${row.traitKey}`).toBeDefined();
      const fits = KIND_FITS[row.kind];
      if (fits !== 'any')
        expect(trait?.valueType, `line ${row.line}: ${row.kind} on ${trait?.valueType}`).toBe(fits);
      if (row.levelKey)
        expect(
          trait?.levels.has(row.levelKey),
          `line ${row.line}: unknown level ${row.levelKey}`,
        ).toBe(true);
    }
  });

  it('lists every image in the directory (no orphan files)', async () => {
    const listed = new Set((await readManifest(defaultMapsDir())).map((r) => r.file));
    const images = (await readdir(defaultMapsDir())).filter((f) => /\.(svg|webp)$/i.test(f));
    expect(images.filter((f) => !listed.has(f))).toEqual([]);
  });
});
