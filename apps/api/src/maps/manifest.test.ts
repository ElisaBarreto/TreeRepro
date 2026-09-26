import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasManifest, parseManifest, readManifest } from './manifest.ts';

// Only `readdir` is wrapped, so a test can make one call answer a directory
// listing from before a file landed — the retry this file tests for
// (RFC-76 R1) — while every other fs call (including `readManifest`'s own
// `readFile`) keeps its real behaviour.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readdir: vi.fn(actual.readdir) };
});

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

  it('retries once when a listed file is not yet in the directory listing, and succeeds if it has landed by then', async () => {
    // Simulates a request racing the publisher mid-way through the
    // documented publish order (README.md "Publishing"): the manifest
    // already names a.svg, but this read's own `readdir` snapshot is from
    // just before the file's own copy landed.
    dir = await mkdtemp(join(tmpdir(), 'maps-race-'));
    await writeFile(join(dir, 'manifest.csv'), `${HEADER}\nx,mean,,a.svg,2026-09-01\n`);
    vi.mocked(readdir).mockImplementationOnce(async () => []);
    await writeFile(join(dir, 'a.svg'), '');

    const rows = await readManifest(dir);

    expect(rows).toHaveLength(1);
    expect(vi.mocked(readdir)).toHaveBeenCalledTimes(2);
  });

  it('still throws, after the one retry, when the listed file never appears', async () => {
    dir = await mkdtemp(join(tmpdir(), 'maps-missing-file-'));
    await writeFile(join(dir, 'manifest.csv'), `${HEADER}\nx,mean,,zzz.svg,2026-09-01\n`);

    await expect(readManifest(dir)).rejects.toThrow(/line 2.*not found/);
  });

  it('does not retry a manifest problem other than a missing file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'maps-bad-kind-'));
    await writeFile(join(dir, 'manifest.csv'), `${HEADER}\nx,median,,a.svg,2026-09-01\n`);
    await writeFile(join(dir, 'a.svg'), '');
    vi.mocked(readdir).mockClear();

    await expect(readManifest(dir)).rejects.toThrow(/unknown map_kind/);

    expect(vi.mocked(readdir)).toHaveBeenCalledTimes(1);
  });
});

describe('hasManifest (RFC-76 R1)', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('is false for a directory that does not exist', async () => {
    dir = await mkdtemp(join(tmpdir(), 'maps-missing-'));
    expect(await hasManifest(join(dir, 'does-not-exist'))).toBe(false);
  });

  it('is false for a directory with no manifest.csv', async () => {
    dir = await mkdtemp(join(tmpdir(), 'maps-empty-'));
    expect(await hasManifest(dir)).toBe(false);
  });

  it('is true once manifest.csv is written, even header-only', async () => {
    dir = await mkdtemp(join(tmpdir(), 'maps-present-'));
    await writeFile(join(dir, 'manifest.csv'), `${HEADER}\n`);
    expect(await hasManifest(dir)).toBe(true);
  });
});
