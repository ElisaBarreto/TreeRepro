import { randomBytes } from 'node:crypto';
import {
  dataEnvelopeSchema,
  mapsResponseSchema,
  mapValuesSchema,
  type PermissionKey,
} from '@treerepro/contracts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { assignPlots, createPlot, createTrait } from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';
import { traitLevels, traits } from '../../../db/schema/dictionary.ts';
import { rampColour } from '../../../maps/colour.ts';

const tag = () => randomBytes(3).toString('hex').toUpperCase();

describe('RFC-76 R5, R6 trait maps from the region snapshot', () => {
  const t = useTestApp();

  async function viewer(permissions: PermissionKey[] = ['dataset.read']) {
    const role = await createRole(t.db, { permissions });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  /** A categorical and a quantitative trait with a snapshot of their own regions. */
  async function fixture() {
    const s = tag();
    const cat = await createTrait(t.db, {
      key: `map_cat_${s.toLowerCase()}`,
      levels: ['red', 'blue'],
    });
    const num = await createTrait(t.db, {
      key: `map_num_${s.toLowerCase()}`,
      valueType: 'quantitative',
      unit: 'mm',
    });
    const levels = await t.db.select().from(traitLevels).where(eq(traitLevels.traitId, cat.id));
    const red = levels.find((l) => l.key === 'red')?.id as string;
    const blue = levels.find((l) => l.key === 'blue')?.id as string;
    const [a, b] = [`A${s}`, `B${s}`];
    const $ = t.db.$client;
    await $`insert into region_completeness values
      (${cat.id}, ${a}, 2, 40, 8), (${cat.id}, ${b}, 1, 10, 0),
      (${num.id}, ${a}, 3, 40, 8), (${num.id}, ${b}, 2, 10, 4)`;
    await $`insert into region_categorical values
      (${cat.id}, ${red}, ${a}, 3, 4), (${cat.id}, ${blue}, ${a}, 1, 2)`;
    await $`insert into region_continuous values
      (${num.id}, ${a}, 3, 5, 1, 4, 1, 400, 20), (${num.id}, ${b}, 2, 7, 2, 7, 5, 9, 28)`;
    await $`insert into region_snapshot (id, computed_at) values (true, '2026-10-23T03:00:00Z')
      on conflict (id) do update set computed_at = excluded.computed_at`;
    return { cat, num, red, blue, a, b };
  }

  async function list(cookie: string) {
    const res = await call(t.app, 'GET', '/api/maps', { cookie });
    expect(res.status).toBe(200);
    return dataEnvelopeSchema(mapsResponseSchema).parse(await res.json()).data;
  }

  it('R5 lists each map with a region holding a value, by trait key, kind and state', async () => {
    const f = await fixture();
    const { cookie } = await viewer();
    const mine = (await list(cookie)).filter(
      (m) => m.traitId === f.cat.id || m.traitId === f.num.id,
    );
    expect(mine.map((m) => [m.traitId, m.kind, m.levelId, m.regions])).toEqual([
      [f.cat.id, 'completeness', null, 1],
      // blue rests on 2 species with the trait: below the minimum, so no map
      [f.cat.id, 'prevalence', f.red, 1],
      [f.num.id, 'completeness', null, 2],
      ...['mean', 'median', 'sd', 'cv', 'min', 'max'].map((kind) => [f.num.id, kind, null, 1]),
    ]);
    expect(mine[0]?.computedAt).toBe('2026-10-23T03:00:00.000Z');
  });

  it('R5 an inactive trait is listed only with dataset.read_inactive; a plot restriction filters nothing', async () => {
    const f = await fixture();
    await t.db.update(traits).set({ active: false }).where(eq(traits.id, f.num.id));
    const reader = await viewer();
    const manager = await viewer(['dataset.read', 'dataset.read_inactive']);
    expect((await list(reader.cookie)).some((m) => m.traitId === f.num.id)).toBe(false);
    expect((await list(manager.cookie)).some((m) => m.traitId === f.num.id)).toBe(true);
    const plot = await createPlot(t.db);
    await assignPlots(t.db, reader.user.id, [plot.id], true);
    expect((await list(reader.cookie)).some((m) => m.traitId === f.cat.id)).toBe(true);
  });

  it('R6 completeness: the trees percentage and its fill; a region with no tree species has no value', async () => {
    const f = await fixture();
    const { cookie } = await viewer();
    const res = await call(t.app, 'GET', `/api/maps/values?traitId=${f.cat.id}&kind=completeness`, {
      cookie,
    });
    expect(res.status).toBe(200);
    const { data } = dataEnvelopeSchema(mapValuesSchema).parse(await res.json());
    expect(data.regions).toEqual([
      { code: f.a, name: f.a, value: 25, nSpecies: 2, fill: rampColour('magma', 0.25) },
      { code: f.b, name: f.b, value: null, nSpecies: 1, fill: '#EBEBEB' },
    ]);
    expect(data.legend).toEqual({
      stops: ['#FCFDBF', '#FE9F6D', '#DE4968', '#8C2981', '#3B0F70', '#000004'],
      limits: [0, 100],
      log: false,
      percent: true,
      label: '% of species with data',
      unit: null,
    });
  });

  it('R6 continuous: below 3 species no value; the trait unit; prevalence is a percentage of the species with the trait', async () => {
    const f = await fixture();
    const { cookie } = await viewer();
    const get = async (query: string) => {
      const res = await call(t.app, 'GET', `/api/maps/values?${query}`, { cookie });
      expect(res.status).toBe(200);
      return dataEnvelopeSchema(mapValuesSchema).parse(await res.json()).data;
    };
    const max = await get(`traitId=${f.num.id}&kind=max`);
    expect(max.regions.map((r) => [r.code, r.value])).toEqual([
      [f.a, 400],
      [f.b, null],
    ]);
    expect(max.legend).toMatchObject({
      limits: [400, 400],
      log: false,
      unit: 'mm',
      label: 'highest species median',
    });
    expect(max.regions[0]?.fill).toBe(rampColour('cividis', 0.5));
    expect((await get(`traitId=${f.num.id}&kind=cv`)).legend.unit).toBeNull();
    const red = await get(`traitId=${f.cat.id}&kind=prevalence&levelId=${f.red}`);
    expect(red.regions).toEqual([
      { code: f.a, name: f.a, value: 75, nSpecies: 4, fill: rampColour('magma', 0.75) },
    ]);
  });

  it('R6 a map not listed is 404 MAP_NOT_FOUND; levelId goes with prevalence only', async () => {
    const f = await fixture();
    const { cookie } = await viewer();
    const status = async (query: string) =>
      (await call(t.app, 'GET', `/api/maps/values?${query}`, { cookie })).status;
    expect(await status(`traitId=${f.cat.id}&kind=prevalence&levelId=${f.blue}`)).toBe(404);
    // ids are compared case-insensitively, as UUIDs
    expect(await status(`traitId=${f.cat.id.toUpperCase()}&kind=completeness`)).toBe(200);
    expect(await status(`traitId=${f.cat.id}&kind=mean`)).toBe(404);
    expect(await status(`traitId=${f.cat.id}&kind=prevalence`)).toBe(400);
    expect(await status(`traitId=${f.num.id}&kind=mean&levelId=${f.red}`)).toBe(400);
  });
});
