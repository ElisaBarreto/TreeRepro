import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseManifest, readManifest } from './manifest.ts';

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

describe('readManifest (RFC-76 R1)', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('answers no maps for a directory that does not exist', async () => {
    dir = await mkdtemp(join(tmpdir(), 'maps-missing-'));
    const missing = join(dir, 'does-not-exist');
    expect(await readManifest(missing)).toEqual([]);
  });

  it('answers no maps for a directory with no manifest.csv', async () => {
    dir = await mkdtemp(join(tmpdir(), 'maps-empty-'));
    expect(await readManifest(dir)).toEqual([]);
  });
});
