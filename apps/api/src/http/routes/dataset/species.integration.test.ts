import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { lastAudit } from '../../../../test/helpers/audit.ts';
import {
  createAnnotation,
  createFamily,
  createGenus,
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../../../test/helpers/dataset.ts';
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

describe('RFC-60 R9, R10 species writes', () => {
  const t = useTestApp();

  async function taxonomist() {
    const role = await createRole(t.db, { permissions: ['taxa.manage', 'dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  it('creates a species, edits its name, source and genus, adds alternative names; 409s and 404s', async () => {
    const { user, cookie } = await taxonomist();
    const family = await createFamily(t.db);
    const genus = await createGenus(t.db, { familyId: family.id });
    const name = `Testus creatus-${Math.random().toString(16).slice(2)}`;
    const created = await call(t.app, 'POST', '/api/species', {
      cookie,
      body: { canonicalName: name, nameSource: 'original' },
    });
    expect(created.status).toBe(201);
    const sp = (await created.json()).data;
    expect(sp).toMatchObject({
      canonicalName: name,
      nameSource: 'original',
      genus: null,
      family: null,
      unresolvedTaxon: true,
      names: [],
      recordCount: 0,
    });
    expect((await lastAudit(t.db, 'taxa.created', { targetId: sp.id }))?.metadata).toEqual({
      kind: 'species',
    });
    const dup = await call(t.app, 'POST', '/api/species', {
      cookie,
      body: { canonicalName: name, nameSource: 'wcvp' },
    });
    expect((await dup.json()).error.code).toBe('SPECIES_NAME_TAKEN');
    const resolved = await call(t.app, 'PATCH', `/api/species/${sp.id}`, {
      cookie,
      body: { nameSource: 'wcvp', genusId: genus.id },
    });
    expect(resolved.status).toBe(200);
    expect((await resolved.json()).data).toMatchObject({
      nameSource: 'wcvp',
      genus: { id: genus.id },
      family: { id: family.id },
      unresolvedTaxon: false,
    });
    expect((await lastAudit(t.db, 'taxa.updated', { targetId: sp.id }))?.metadata).toEqual({
      kind: 'species',
      fields: ['nameSource', 'genusId'],
    });
    const unknownGenus = await call(t.app, 'PATCH', `/api/species/${sp.id}`, {
      cookie,
      body: { genusId: '00000000-0000-7000-8000-000000000000' },
    });
    expect((await unknownGenus.json()).error.code).toBe('GENUS_NOT_FOUND');
    const alt = await call(t.app, 'POST', `/api/species/${sp.id}/names`, {
      cookie,
      body: { name: `${name} alt`, gbifUsageKey: '123' },
    });
    expect(alt.status).toBe(201);
    expect((await alt.json()).data.names).toEqual([
      { name: `${name} alt`, source: 'gbif', gbifUsageKey: '123' },
    ]);
    expect((await lastAudit(t.db, 'taxa.created', { actorUserId: user.id }))?.metadata).toEqual({
      kind: 'species_name',
      speciesId: sp.id,
    });
    const altAgain = await call(t.app, 'POST', `/api/species/${sp.id}/names`, {
      cookie,
      body: { name: `${name} alt` },
    });
    expect((await altAgain.json()).error.code).toBe('SPECIES_NAME_TAKEN');
    const canonical = await call(t.app, 'POST', `/api/species/${sp.id}/names`, {
      cookie,
      body: { name },
    });
    expect((await canonical.json()).error.code).toBe('SPECIES_NAME_TAKEN');
    const missing = await call(
      t.app,
      'POST',
      '/api/species/00000000-0000-7000-8000-000000000000/names',
      { cookie, body: { name: 'x' } },
    );
    expect((await missing.json()).error.code).toBe('SPECIES_NOT_FOUND');
  });
});

describe('RFC-65 R6 accepted value per species and trait', () => {
  const t = useTestApp();

  async function curator() {
    const role = await createRole(t.db, { permissions: ['accepted.manage', 'dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }
  async function fixture(authorId: string) {
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const ref = await createReference(t.db);
    const mk = (levelIndex: number, valueText: string) =>
      createRecord(t.db, {
        speciesId: sp1.id,
        traitId: trait.id,
        valueText,
        levelId: trait.levels[levelIndex]?.id,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: authorId,
      });
    return { sp1, trait, ref, recA: await mk(0, 'a'), recB: await mk(1, 'b') };
  }
  const put = (cookie: string, speciesId: string, traitId: string, body: Record<string, unknown>) =>
    call(t.app, 'PUT', `/api/species/${speciesId}/traits/${traitId}/accepted`, { cookie, body });

  it('accepts, replaces, clears; repeats insert nothing; the summary and the GET agree', async () => {
    const { user, cookie } = await curator();
    const { sp1, trait, recA, recB } = await fixture(user.id);
    const first = await put(cookie, sp1.id, trait.id, {
      decision: 'accepted',
      recordId: recA.id,
      note: 'Best sampled',
    });
    expect(first.status).toBe(200);
    expect((await first.json()).data).toMatchObject({
      current: {
        recordId: recA.id,
        valueText: 'a',
        actor: { id: user.id, name: 'Test User' },
        note: 'Best sampled',
      },
      history: [{ decision: 'accepted', recordId: recA.id, valueText: 'a' }],
    });
    const summary = await call(t.app, 'GET', `/api/species/${sp1.id}/traits`, { cookie });
    expect((await summary.json()).data[0].traits[0].accepted).toMatchObject({
      recordId: recA.id,
      valueText: 'a',
    });
    const same = await put(cookie, sp1.id, trait.id, { decision: 'accepted', recordId: recA.id });
    expect((await same.json()).data.history).toHaveLength(1);
    const replaced = await put(cookie, sp1.id, trait.id, {
      decision: 'accepted',
      recordId: recB.id,
    });
    expect((await replaced.json()).data).toMatchObject({
      current: { recordId: recB.id },
      history: [{ recordId: recB.id }, { recordId: recA.id }],
    });
    const cleared = await put(cookie, sp1.id, trait.id, {
      decision: 'cleared',
      note: 'Sources disagree',
    });
    expect((await cleared.json()).data).toMatchObject({
      current: null,
      history: [
        { decision: 'cleared', recordId: null, valueText: null, note: 'Sources disagree' },
        {},
        {},
      ],
    });
    const clearedAgain = await put(cookie, sp1.id, trait.id, {
      decision: 'cleared',
      note: 'still',
    });
    const clearedAgainBody = await clearedAgain.json();
    expect(clearedAgainBody.data.history).toHaveLength(3);
    const got = await call(t.app, 'GET', `/api/species/${sp1.id}/traits/${trait.id}/accepted`, {
      cookie,
    });
    expect(got.status).toBe(200);
    expect((await got.json()).data).toEqual(clearedAgainBody.data);
  });

  it('refuses a record of another species or trait, a pending record and a withdrawn one; 404s', async () => {
    const { user, cookie } = await curator();
    const { sp1, trait, ref, recA } = await fixture(user.id);
    const otherSpecies = await createSpecies(t.db);
    const batch = await createImportBatch(t.db);
    const pending = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'zz',
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    await createAnnotation(t.db, {
      recordId: recA.id,
      actorId: user.id,
      kind: 'withdraw',
      note: 'gone',
    });
    const zero = '00000000-0000-7000-8000-000000000000';
    const wrong = await put(cookie, otherSpecies.id, trait.id, {
      decision: 'accepted',
      recordId: recA.id,
    });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.details[0].path).toBe('recordId');
    const notHarmonised = await put(cookie, sp1.id, trait.id, {
      decision: 'accepted',
      recordId: pending.id,
    });
    expect((await notHarmonised.json()).error.code).toBe('RECORD_NOT_HARMONISED');
    const withdrawn = await put(cookie, sp1.id, trait.id, {
      decision: 'accepted',
      recordId: recA.id,
    });
    expect((await withdrawn.json()).error.code).toBe('RECORD_WITHDRAWN');
    for (const [s, tr, r, code] of [
      [zero, trait.id, recA.id, 'SPECIES_NOT_FOUND'],
      [sp1.id, zero, recA.id, 'TRAIT_NOT_FOUND'],
      [sp1.id, trait.id, zero, 'RECORD_NOT_FOUND'],
    ] as const) {
      const res = await put(cookie, s, tr, { decision: 'accepted', recordId: r });
      expect(res.status, code).toBe(404);
      expect((await res.json()).error.code, code).toBe(code);
    }
    const getMissing = await call(t.app, 'GET', `/api/species/${sp1.id}/traits/${zero}/accepted`, {
      cookie,
    });
    expect(getMissing.status).toBe(404);
  });
});
