import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { createFamily, createGenus, createSpecies } from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';
import { encodeCompositeCursor } from '../../cursor.ts';

const tag = () => randomBytes(4).toString('hex');

describe('RFC-60 R6-R8 species, families and genera routes', () => {
  const t = useTestApp();

  async function reader() {
    const role = await createRole(t.db, { permissions: ['dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return (await loginAs(t, user)).cookie;
  }

  it('dataset.read lists, filters and paginates species with the RFC-11 envelope', async () => {
    const cookie = await reader();
    const k = tag();
    const family = await createFamily(t.db, { name: `Routeaceae-${k}` });
    const genus = await createGenus(t.db, { name: `Routus-${k}`, familyId: family.id });
    const a = await createSpecies(t.db, {
      canonicalName: `Routus a-${k}`,
      genusId: genus.id,
      names: [{ name: `Alt a-${k}` }],
    });
    const b = await createSpecies(t.db, { canonicalName: `Routus b-${k}`, genusId: genus.id });
    const res = await call(t.app, 'GET', `/api/species?q=routus&genusId=${genus.id}&limit=1`, {
      cookie,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((s: { id: string }) => s.id)).toEqual([a.id]);
    expect(body.meta.nextCursor).toEqual(expect.any(String));
    const next = await call(
      t.app,
      'GET',
      `/api/species?q=routus&genusId=${genus.id}&limit=1&cursor=${encodeURIComponent(body.meta.nextCursor)}`,
      { cookie },
    );
    expect((await next.json()).data.map((s: { id: string }) => s.id)).toEqual([b.id]);
    const alt = await call(t.app, 'GET', `/api/species?q=${encodeURIComponent(`alt a-${k}`)}`, {
      cookie,
    });
    expect((await alt.json()).data[0]).toMatchObject({ id: a.id, matchedName: `Alt a-${k}` });
    const short = await call(t.app, 'GET', '/api/species?q=a', { cookie });
    expect(short.status).toBe(400);
    expect((await short.json()).error.details[0].path).toBe('q');
    const badCursor = await call(t.app, 'GET', '/api/species?cursor=zzz', { cookie });
    expect(badCursor.status).toBe(400);
    // A well-formed composite cursor (right shape, right arity) whose id
    // part is not a uuid must still answer 400, not reach the `::uuid` cast
    // and surface as a 500.
    const tamperedCursor = await call(
      t.app,
      'GET',
      `/api/species?cursor=${encodeURIComponent(encodeCompositeCursor(['a', 'b']))}`,
      { cookie },
    );
    expect(tamperedCursor.status).toBe(400);
    expect((await tamperedCursor.json()).error.code).toBe('VALIDATION_FAILED');
  });

  it('R7 detail answers the species or 404 SPECIES_NOT_FOUND', async () => {
    const cookie = await reader();
    const sp1 = await createSpecies(t.db, { nameSource: 'gbif' });
    const res = await call(t.app, 'GET', `/api/species/${sp1.id}`, { cookie });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      id: sp1.id,
      unresolvedTaxon: true,
      recordCount: 0,
      names: [],
    });
    const missing = await call(t.app, 'GET', '/api/species/00000000-0000-7000-8000-000000000000', {
      cookie,
    });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('SPECIES_NOT_FOUND');
    const malformed = await call(t.app, 'GET', '/api/species/not-a-uuid', { cookie });
    expect(malformed.status).toBe(400);
  });

  it('R8 families and genera', async () => {
    const cookie = await reader();
    const k = tag();
    const family = await createFamily(t.db, { name: `Famroute-${k}` });
    await createGenus(t.db, { name: `Genroute-${k}`, familyId: family.id });
    const families = await call(t.app, 'GET', '/api/families?limit=200', { cookie });
    expect(families.status).toBe(200);
    expect((await families.json()).data).toEqual(
      expect.arrayContaining([{ id: family.id, name: `Famroute-${k}` }]),
    );
    const genera = await call(t.app, 'GET', `/api/genera?familyId=${family.id}&q=genroute`, {
      cookie,
    });
    expect((await genera.json()).data).toEqual([
      {
        id: expect.any(String),
        name: `Genroute-${k}`,
        family: { id: family.id, name: `Famroute-${k}` },
      },
    ]);
  });
});
