import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../test/helpers/app.ts';
import { createSpecies } from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createRole } from '../../test/helpers/roles.ts';
import { loginAs } from '../../test/helpers/session.ts';
import { createUser } from '../../test/helpers/users.ts';
import { importWcvp } from './wcvp.ts';

const NAMES_HEADER =
  'plant_name_id|ipni_id|taxon_rank|taxon_status|family|genus|species|lifeform_description|taxon_name|taxon_authors';
const DIST_HEADER =
  'plant_locality_id|plant_name_id|continent_code_l1|continent|region_code_l2|region|area_code_l3|area|introduced|extinct|location_doubtful';

/** Level 1 and level 2 of each test code, as WCVP gives them. */
const LEVELS: Record<string, string> = {
  BZN: '8|SOUTHERN AMERICA|84|Brazil',
  NEP: '4|ASIA-TROPICAL|40|Indian Subcontinent',
  COS: '8|SOUTHERN AMERICA|80|Central America',
  VEN: '8|SOUTHERN AMERICA|82|Northern South America',
  AGE: '8|SOUTHERN AMERICA|85|Southern South America',
};

async function file(name: string, lines: string[], eol = '\n'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wcvp-'));
  const path = join(dir, name);
  await writeFile(path, `${lines.join(eol)}${eol}`);
  return path;
}

/** A names row in NAMES_HEADER order. */
function n(id: string, rank: string, status: string, life: string, name: string): string {
  return `${id}|ipni-${id}|${rank}|${status}|Fam|Gen|sp|${life}|${name}|Auth.`;
}

/** A distribution row in DIST_HEADER order. */
function d(id: string, code: string, area: string, intro = '0', ext = '0', doubt = '0'): string {
  const levels = LEVELS[code.toUpperCase()] ?? '|||';
  return `${randomUUID()}|${id}|${levels}|${code}|${area}|${intro}|${ext}|${doubt}`;
}

describe('RFC-78 import:wcvp', () => {
  const t = useTestDb();
  const tag = randomUUID().slice(0, 8);
  const names = {
    tree: `Arbor ${tag}`,
    shrubOrTree: `Frutex ${tag}`,
    treelet: `Arbuscula ${tag}`,
  };

  async function load(): Promise<{ names: string; distribution: string }> {
    return {
      names: await file(
        'wcvp_names.csv',
        [
          NAMES_HEADER,
          n('1', 'Species', 'Accepted', 'tree', names.tree),
          n(
            '2',
            'Species',
            'Accepted',
            'shrub or tree',
            `  ${names.shrubOrTree.replace(' ', '   ')} `,
          ),
          n('3', 'Species', 'Accepted', 'treelet', names.treelet),
          n('4', 'Species', 'Accepted', 'Arborescent herb', `Herba ${tag}`),
          n('5', 'Species', 'Accepted', 'phanerophyte', `Phanero ${tag}`),
          n('6', 'Species', 'Accepted', '', `Nulla "quoted" ${tag}`),
          n('7', 'Species', 'Synonym', 'tree', `Synonymus ${tag}`),
          n('8', 'Subspecies', 'Accepted', 'tree', `${names.tree} subsp. minor`),
          n('9', 'Species', 'Accepted', 'tree', names.tree), // homonym, later in file order
        ],
        '\r\n',
      ),
      distribution: await file('wcvp_distribution.csv', [
        DIST_HEADER,
        d('1', 'BZN', 'Brazil North'),
        d('1', 'BZN', 'Brazil North'), // duplicate occurrence
        d('1', 'nep', ''), // lower-case code, no name
        d('2', 'NEP', 'Nepal', '1'), // introduced
        d('2', 'NEP', 'Nepal'), // also native there: native wins
        d('1', 'NEP', 'Nepal'),
        d('2', 'BZN', 'Brazil North'),
        d('2', 'COS', 'Costa Rica', '1'), // introduced
        d('3', 'COS', 'Costa Rica', '0', '1'), // extinct
        d('4', 'COS', 'Costa Rica', '0', '0', '1'), // doubtful
        d('7', 'VEN', 'Venezuela'), // synonym
        d('5', '', ''), // no code
        d('6', 'XXX', ''), // a region with no name
      ]),
    };
  }

  it('keeps accepted species, regions with their levels and every extant occurrence; flags trees by whole word', async () => {
    const files = await load();
    const counts = await importWcvp(t.db, {
      namesPath: files.names,
      distributionPath: files.distribution,
    });
    expect(counts).toEqual({
      acceptedSpecies: 7,
      treeSpecies: 5,
      regions: 5,
      distributionRows: 6,
    });
    const species = await t.db.execute(
      sql`select plant_name_id, taxon_name, is_tree, file_order from wcvp_species order by file_order`,
    );
    expect(species.map((r) => [r.plant_name_id, r.taxon_name, r.is_tree])).toEqual([
      ['1', names.tree, true],
      ['2', names.shrubOrTree, true],
      ['3', names.treelet, false],
      ['4', `Herba ${tag}`, true],
      ['5', `Phanero ${tag}`, true],
      ['6', `Nulla "quoted" ${tag}`, false],
      ['9', names.tree, true],
    ]);
    const regions = await t.db.execute(
      sql`select area_code_l3, name, region_code_l2, region, continent_code_l1, continent
          from wcvp_regions order by area_code_l3`,
    );
    expect(
      regions.map((r) => [
        r.area_code_l3,
        r.name,
        r.region_code_l2,
        r.region,
        r.continent_code_l1,
        r.continent,
      ]),
    ).toEqual([
      ['BZN', 'Brazil North', '84', 'Brazil', '8', 'SOUTHERN AMERICA'],
      ['COS', 'Costa Rica', '80', 'Central America', '8', 'SOUTHERN AMERICA'],
      ['NEP', 'Nepal', '40', 'Indian Subcontinent', '4', 'ASIA-TROPICAL'],
      ['VEN', 'Venezuela', '82', 'Northern South America', '8', 'SOUTHERN AMERICA'],
      ['XXX', 'XXX', null, null, null, null],
    ]);
    const dist = await t.db.execute(
      sql`select plant_name_id, area_code_l3, introduced from wcvp_distribution order by 1, 2`,
    );
    expect(dist.map((r) => [r.plant_name_id, r.area_code_l3, r.introduced])).toEqual([
      ['1', 'BZN', false],
      ['1', 'NEP', false],
      ['2', 'BZN', false],
      ['2', 'COS', true],
      ['2', 'NEP', false],
      ['6', 'XXX', false],
    ]);
  });

  it('a re-run replaces the previous load', async () => {
    const files = await load();
    await importWcvp(t.db, { namesPath: files.names, distributionPath: files.distribution });
    const counts = await importWcvp(t.db, {
      namesPath: await file('n.csv', [
        NAMES_HEADER,
        n('42', 'Species', 'Accepted', 'tree', 'Solus'),
      ]),
      distributionPath: await file('d.csv', [DIST_HEADER, d('42', 'AGE', 'Argentina Northeast')]),
    });
    expect(counts).toEqual({ acceptedSpecies: 1, treeSpecies: 1, regions: 1, distributionRows: 1 });
    const [row] = await t.db.execute(sql`select count(*)::int as c from wcvp_species`);
    expect(row?.c).toBe(1);
  });

  it('refuses a file missing a needed column before any write, naming it', async () => {
    const files = await load();
    await importWcvp(t.db, { namesPath: files.names, distributionPath: files.distribution });
    const badDist = await file('d.csv', [
      'plant_name_id|area_code_l3|introduced|extinct',
      '1|BZN|0|0',
    ]);
    await expect(
      importWcvp(t.db, { namesPath: files.names, distributionPath: badDist }),
    ).rejects.toThrow(/d\.csv.*area, location_doubtful/);
    const badNames = await file('n.csv', [
      'plant_name_id|taxon_rank|taxon_status',
      '1|Species|Accepted',
    ]);
    await expect(
      importWcvp(t.db, { namesPath: badNames, distributionPath: files.distribution }),
    ).rejects.toThrow(/n\.csv.*taxon_name, lifeform_description/);
    const [row] = await t.db.execute(sql`select count(*)::int as c from wcvp_species`);
    expect(row?.c).toBe(7);
  });

  it('a failed run leaves the previous load', async () => {
    const files = await load();
    await importWcvp(t.db, { namesPath: files.names, distributionPath: files.distribution });
    const duplicateId = await file('n.csv', [
      NAMES_HEADER,
      n('1', 'Species', 'Accepted', 'tree', 'Unus'),
      n('1', 'Species', 'Accepted', 'tree', 'Duo'),
    ]);
    await expect(
      importWcvp(t.db, { namesPath: duplicateId, distributionPath: files.distribution }),
    ).rejects.toThrow();
    const [row] = await t.db.execute(sql`select count(*)::int as c from wcvp_species`);
    expect(row?.c).toBe(7);
  });

  it('matches platform species by collapsed canonical name, the first homonym in file order', async () => {
    const files = await load();
    await importWcvp(t.db, { namesPath: files.names, distributionPath: files.distribution });
    const tree = await createSpecies(t.db, { canonicalName: names.tree });
    const shrub = await createSpecies(t.db, {
      canonicalName: ` ${names.shrubOrTree.replace(' ', '  ')}`,
    });
    const unmatched = await createSpecies(t.db, { canonicalName: `Ignota ${tag}` });
    const synonym = await createSpecies(t.db, { canonicalName: `Synonymus ${tag}` });
    const ids = [tree.id, shrub.id, unmatched.id, synonym.id];
    const rows = await t.db.execute(
      sql`select species_id, plant_name_id from wcvp_species_match
          where species_id in (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.species_id, r.plant_name_id]))).toEqual({
      [tree.id]: '1',
      [shrub.id]: '2',
    });
  });
});

// The geographic filters read the WCVP tables, which `import:wcvp` truncates:
// they live in this file, the only one that loads them, so no parallel file
// can replace the load under them.
describe('RFC-60 R6, R12, R13 geographic species filters over the WCVP load', () => {
  const t = useTestApp();
  const tag = randomUUID().slice(0, 8);
  const native = `Geoa ${tag}`;
  const spread = `Geob ${tag}`;
  let ids: { native: string; spread: string; unmatched: string };
  let cookie: string;

  beforeAll(async () => {
    await importWcvp(t.db, {
      namesPath: await file('n.csv', [
        NAMES_HEADER,
        n('g1', 'Species', 'Accepted', 'tree', native),
        n('g2', 'Species', 'Accepted', 'tree', spread),
      ]),
      distributionPath: await file('d.csv', [
        DIST_HEADER,
        d('g1', 'BZN', 'Brazil North'),
        d('g2', 'NEP', 'Nepal'),
        d('g2', 'COS', 'Costa Rica', '1'), // introduced
        d('g2', 'XXX', ''), // a region with no levels
      ]),
    });
    ids = {
      native: (await createSpecies(t.db, { canonicalName: native })).id,
      spread: (await createSpecies(t.db, { canonicalName: spread })).id,
      unmatched: (await createSpecies(t.db, { canonicalName: `Geoc ${tag}` })).id,
    };
    const role = await createRole(t.db, { permissions: ['dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    cookie = (await loginAs(t, user)).cookie;
  });

  async function found(query: string): Promise<string[]> {
    const res = await call(t.app, 'GET', `/api/species?q=${tag}&${query}`, { cookie });
    expect(res.status).toBe(200);
    return ((await res.json()).data as { id: string }[]).map((s) => s.id);
  }

  it('R6 filters by continent, region and botanical country, natives only by default', async () => {
    expect(await found('continent=8')).toEqual([ids.native]);
    expect(await found('continent=4')).toEqual([ids.spread]);
    expect(await found('region=84')).toEqual([ids.native]);
    expect(await found('area=bzn')).toEqual([ids.native]);
    expect(await found('area=COS')).toEqual([]);
    expect(await found('continent=4&area=BZN')).toEqual([]);
    expect(await found('area=ZZZ')).toEqual([]);
    expect(await found('')).toEqual([ids.native, ids.spread, ids.unmatched]);
  });

  it('R6 introduced=true counts introduced occurrences too', async () => {
    expect(await found('area=COS&introduced=true')).toEqual([ids.spread]);
    expect(await found('continent=8&introduced=true')).toEqual([ids.native, ids.spread]);
    expect(await found('introduced=true')).toEqual([ids.native, ids.spread, ids.unmatched]);
  });

  it('R6 refuses a malformed code with its path', async () => {
    for (const [query, path] of [
      ['area=BZ1', 'area'],
      ['region=north', 'region'],
      ['continent=123', 'continent'],
    ]) {
      const res = await call(t.app, 'GET', `/api/species?${query}`, { cookie });
      expect(res.status).toBe(400);
      expect((await res.json()).error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path })]),
      );
    }
  });

  it('R12 counts with the same filters', async () => {
    const res = await call(
      t.app,
      'GET',
      `/api/species/count?q=${tag}&continent=8&introduced=true`,
      {
        cookie,
      },
    );
    expect((await res.json()).data).toEqual({ count: 2 });
  });

  it('R13 lists every level-3 region with its region and continent', async () => {
    const res = await call(t.app, 'GET', '/api/species/regions', { cookie });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([
      {
        code: 'NEP',
        name: 'Nepal',
        regionCode: '40',
        region: 'Indian Subcontinent',
        continentCode: '4',
        continent: 'ASIA-TROPICAL',
      },
      {
        code: 'COS',
        name: 'Costa Rica',
        regionCode: '80',
        region: 'Central America',
        continentCode: '8',
        continent: 'SOUTHERN AMERICA',
      },
      {
        code: 'BZN',
        name: 'Brazil North',
        regionCode: '84',
        region: 'Brazil',
        continentCode: '8',
        continent: 'SOUTHERN AMERICA',
      },
      {
        code: 'XXX',
        name: 'XXX',
        regionCode: null,
        region: null,
        continentCode: null,
        continent: null,
      },
    ]);
  });
});
