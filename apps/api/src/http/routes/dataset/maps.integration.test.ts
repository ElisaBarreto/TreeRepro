import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataEnvelopeSchema, mapsResponseSchema, type PermissionKey } from '@treerepro/contracts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { assignPlots, createPlot, createTrait } from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';
import { traitLevels } from '../../../db/schema/dictionary.ts';

const HEADER = 'trait_key,map_kind,level_key,file,data_version';
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1"><rect width="2" height="1"/></svg>';

/** A maps directory of its own: `manifest.csv` plus every named file. */
async function mapsDir(rows: string[], files: Record<string, string | Buffer>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'maps-'));
  await writeFile(join(dir, 'manifest.csv'), `${[HEADER, ...rows].join('\n')}\n`);
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(dir, name), bytes);
  return dir;
}

const tag = () => randomBytes(4).toString('hex');

describe('RFC-76 R4, R5 trait maps', () => {
  const t = useTestApp();

  async function viewer(permissions: PermissionKey[] = ['dataset.read']) {
    const role = await createRole(t.db, { permissions });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  async function list(app: ReturnType<typeof t.build>['app'], cookie: string) {
    const res = await call(app, 'GET', '/api/maps', { cookie });
    expect(res.status).toBe(200);
    return dataEnvelopeSchema(mapsResponseSchema).parse(await res.json()).data;
  }

  it('R4 lists, in manifest order, the rows whose trait, kind and level fit the dictionary', async () => {
    const s = tag();
    const cat = await createTrait(t.db, { key: `map_cat_${s}`, levels: ['Red', 'blue'] });
    const num = await createTrait(t.db, { key: `map_num_${s}`, valueType: 'quantitative' });
    const f = (n: string) => `${n}-${s}.svg`;
    const dir = await mapsDir(
      [
        `nope_${s},completeness,,${f('unknown')},2026-09-01`,
        `${cat.key},completeness,,${f('cat-c')},2026-09-01`,
        `${cat.key},mean,,${f('cat-mean')},2026-09-01`,
        `${cat.key},prevalence,red,${f('cat-red')},2026-09-02`,
        `${cat.key},prevalence,green,${f('cat-green')},2026-09-01`,
        `${num.key},prevalence,red,${f('num-red')},2026-09-01`,
        `${num.key},mean,,${f('num-mean')},2026-09-03`,
      ],
      Object.fromEntries(
        ['unknown', 'cat-c', 'cat-mean', 'cat-red', 'cat-green', 'num-red', 'num-mean'].map((n) => [
          f(n),
          SVG,
        ]),
      ),
    );
    const { app } = t.build({ mapsDir: dir });
    const { cookie } = await viewer();
    expect(await list(app, cookie)).toEqual([
      {
        traitId: cat.id,
        kind: 'completeness',
        levelId: null,
        file: f('cat-c'),
        dataVersion: '2026-09-01',
      },
      {
        traitId: cat.id,
        kind: 'prevalence',
        levelId: cat.levels[0]?.id,
        file: f('cat-red'),
        dataVersion: '2026-09-02',
      },
      {
        traitId: num.id,
        kind: 'mean',
        levelId: null,
        file: f('num-mean'),
        dataVersion: '2026-09-03',
      },
    ]);
  });

  it('R4, R5 an inactive trait or level is seen only with dataset.read_inactive', async () => {
    const s = tag();
    const hidden = await createTrait(t.db, { key: `map_off_${s}`, active: false });
    const shown = await createTrait(t.db, { key: `map_on_${s}`, levels: ['gone'] });
    await t.db
      .update(traitLevels)
      .set({ active: false })
      .where(eq(traitLevels.id, shown.levels[0]?.id as string));
    const off = `off-${s}.svg`;
    const gone = `gone-${s}.svg`;
    const dir = await mapsDir(
      [
        `${hidden.key},completeness,,${off},2026-09-01`,
        `${shown.key},prevalence,gone,${gone},2026-09-01`,
      ],
      { [off]: SVG, [gone]: SVG },
    );
    const { app } = t.build({ mapsDir: dir });

    const reader = await viewer();
    expect(await list(app, reader.cookie)).toEqual([]);
    for (const name of [off, gone]) {
      const res = await call(app, 'GET', `/api/maps/files/${name}`, { cookie: reader.cookie });
      expect(res.status, name).toBe(404);
      expect((await res.json()).error.code).toBe('MAP_NOT_FOUND');
    }

    const manager = await viewer(['dataset.read', 'dataset.read_inactive']);
    expect((await list(app, manager.cookie)).map((m) => m.file)).toEqual([off, gone]);
    for (const name of [off, gone]) {
      const res = await call(app, 'GET', `/api/maps/files/${name}`, { cookie: manager.cookie });
      expect(res.status, name).toBe(200);
    }
  });

  it('R4 the plot restriction does not filter maps', async () => {
    const s = tag();
    const trait = await createTrait(t.db, { key: `map_plot_${s}` });
    const file = `plot-${s}.svg`;
    const dir = await mapsDir([`${trait.key},completeness,,${file},2026-09-01`], { [file]: SVG });
    const { app } = t.build({ mapsDir: dir });
    const free = await viewer();
    const bound = await viewer();
    await assignPlots(t.db, bound.user.id, [(await createPlot(t.db)).id], true);
    const expected = await list(app, free.cookie);
    expect(expected).toHaveLength(1);
    expect(await list(app, bound.cookie)).toEqual(expected);
  });

  it('R5 serves the bytes with type, no-cache and an ETag that follows the file', async () => {
    const s = tag();
    const trait = await createTrait(t.db, { key: `map_file_${s}` });
    const svg = `a-${s}.svg`;
    const webp = `b-${s}.webp`;
    const webpBytes = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ');
    const dir = await mapsDir(
      [
        `${trait.key},completeness,,${svg},2026-09-01`,
        `${trait.key},prevalence,alpha,${webp},2026-09-01`,
      ],
      { [svg]: SVG, [webp]: webpBytes },
    );
    const { app } = t.build({ mapsDir: dir });
    const { cookie } = await viewer();

    const first = await call(app, 'GET', `/api/maps/files/${svg}`, { cookie });
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('image/svg+xml');
    expect(first.headers.get('cache-control')).toBe('private, no-cache');
    expect(await first.text()).toBe(SVG);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const again = await call(app, 'GET', `/api/maps/files/${svg}`, {
      cookie,
      headers: { 'if-none-match': etag as string },
    });
    expect(again.status).toBe(304);

    const replaced = SVG.replace('height="1"/>', 'height="1" fill="red"/>');
    await writeFile(join(dir, svg), replaced);
    const fresh = await call(app, 'GET', `/api/maps/files/${svg}`, {
      cookie,
      headers: { 'if-none-match': etag as string },
    });
    expect(fresh.status).toBe(200);
    expect(await fresh.text()).toBe(replaced);
    expect(fresh.headers.get('etag')).not.toBe(etag);

    const image = await call(app, 'GET', `/api/maps/files/${webp}`, { cookie });
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/webp');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(webpBytes);
  });

  it('R5 a name the manifest does not list is 404 MAP_NOT_FOUND, never a path', async () => {
    const s = tag();
    const trait = await createTrait(t.db, { key: `map_path_${s}` });
    const file = `listed-${s}.svg`;
    const dir = await mapsDir([`${trait.key},completeness,,${file},2026-09-01`], {
      [file]: SVG,
      'unlisted.svg': SVG,
    });
    const { app } = t.build({ mapsDir: dir });
    const { cookie } = await viewer();
    for (const name of [
      'unlisted.svg',
      'manifest.csv',
      '..%2Fmanifest.csv',
      '%2e%2e%2fsecret.svg',
    ]) {
      const res = await call(app, 'GET', `/api/maps/files/${name}`, { cookie });
      expect(res.status, name).toBe(404);
      expect((await res.json()).error.code, name).toBe('MAP_NOT_FOUND');
    }
  });

  it('R4, R5 need a session and dataset.read', async () => {
    const { app } = t.build({ mapsDir: await mapsDir([], {}) });
    const { cookie } = await viewer([]);
    for (const path of ['/api/maps', '/api/maps/files/x.svg']) {
      const anonymous = await call(app, 'GET', path);
      expect(anonymous.status, path).toBe(401);
      const denied = await call(app, 'GET', path, { cookie });
      expect(denied.status, path).toBe(403);
      expect((await denied.json()).error.code, path).toBe('PERMISSION_DENIED');
    }
  });
});
