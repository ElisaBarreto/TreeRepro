import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { lastAudit } from '../../../../test/helpers/audit.ts';
import {
  addPlotSpecies,
  assignPlots,
  createAnnotation,
  createFamily,
  createGenus,
  createImportBatch,
  createPlot,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../../../test/helpers/dataset.ts';
import { adminRoleId, createRole, systemRoleId } from '../../../../test/helpers/roles.ts';
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
    const genus = await createGenus(t.db, { name: `Genroute-${k}`, familyId: family.id });
    // RFC-33 R3: a family or genus with no visible species is omitted for a
    // restricted viewer, so this fixture needs at least one active species.
    await createSpecies(t.db, { canonicalName: `Sproute-${k}`, genusId: genus.id });
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

  it('R6 five concurrent identical PUT accepted requests insert the decision only once', async () => {
    const { user, cookie } = await curator();
    const { sp1, trait, recA } = await fixture(user.id);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        put(cookie, sp1.id, trait.id, { decision: 'accepted', recordId: recA.id }),
      ),
    );
    for (const res of results) expect(res.status).toBe(200);
    const got = await call(t.app, 'GET', `/api/species/${sp1.id}/traits/${trait.id}/accepted`, {
      cookie,
    });
    const history = (await got.json()).data.history as { decision: string }[];
    expect(history.filter((h) => h.decision === 'accepted')).toHaveLength(1);
  });
});

describe('RFC-33 R4, RFC-60 R6 species routes by viewer', () => {
  const t = useTestApp();

  it('404 for a contributor, 200 with active=false for a manager; status filter; PATCH active', async () => {
    const contributorRole = await systemRoleId(t.db, 'contributor');
    const managerRole = await systemRoleId(t.db, 'manager');
    const { user: reader } = await createUser(t.db, { roles: [contributorRole] });
    const { user: manager } = await createUser(t.db, { roles: [managerRole] });
    const admin = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const sp = await createSpecies(t.db);
    const [r, m, a] = await Promise.all([
      loginAs(t, reader),
      loginAs(t, manager),
      loginAs(t, admin.user),
    ]);

    const off = await call(t.app, 'PATCH', `/api/species/${sp.id}`, {
      cookie: a.cookie,
      body: { active: false },
    });
    expect(off.status).toBe(200);
    expect((await off.json()).data.active).toBe(false);
    const firstAudit = await lastAudit(t.db, 'taxa.updated', { targetId: sp.id });
    expect(firstAudit?.metadata).toEqual({ kind: 'species', fields: ['active'] });

    // RFC-60 R9: a PATCH that changes nothing records nothing — the audit
    // trail's newest `taxa.updated` entry for this species stays the same row.
    const again = await call(t.app, 'PATCH', `/api/species/${sp.id}`, {
      cookie: a.cookie,
      body: { active: false },
    });
    expect(again.status).toBe(200);
    const secondAudit = await lastAudit(t.db, 'taxa.updated', { targetId: sp.id });
    expect(secondAudit?.id).toBe(firstAudit?.id);

    expect((await call(t.app, 'GET', `/api/species/${sp.id}`, { cookie: r.cookie })).status).toBe(
      404,
    );
    const seen = await call(t.app, 'GET', `/api/species/${sp.id}`, { cookie: m.cookie });
    expect(seen.status).toBe(200);
    expect((await seen.json()).data.active).toBe(false);

    const list = await call(
      t.app,
      'GET',
      `/api/species?q=${encodeURIComponent(sp.canonicalName)}&status=inactive`,
      { cookie: m.cookie },
    );
    expect((await list.json()).data.map((s: { id: string }) => s.id)).toEqual([sp.id]);
    const forced = await call(
      t.app,
      'GET',
      `/api/species?q=${encodeURIComponent(sp.canonicalName)}&status=all`,
      { cookie: r.cookie },
    );
    expect((await forced.json()).data).toEqual([]);
  });
});

describe('RFC-33 R6, RFC-67 R8 species scope and plot filter matrix', () => {
  const t = useTestApp();

  it('enforces scope defaults, restrictions, and plot list on detail', async () => {
    const k = tag();
    const plotA = await createPlot(t.db, { code: `SPA-${k}`, name: 'Plot Alpha' });
    const plotB = await createPlot(t.db, { code: `SPB-${k}`, name: 'Plot Beta' });

    const spInsideA = await createSpecies(t.db, { canonicalName: `Scopeus insideA-${k}` });
    const spInsideB = await createSpecies(t.db, { canonicalName: `Scopeus insideB-${k}` });
    const spOutside = await createSpecies(t.db, { canonicalName: `Scopeus outside-${k}` });

    await addPlotSpecies(t.db, plotA.id, [spInsideA.id]);
    await addPlotSpecies(t.db, plotB.id, [spInsideB.id]);

    const readRole = await createRole(t.db, { permissions: ['dataset.read'] });
    const managerRole = await createRole(t.db, {
      permissions: ['dataset.read', 'dataset.read_inactive', 'plots.manage'],
    });

    // (a) Contributor with plotA, unbound:
    const { user: unboundUser } = await createUser(t.db, { roles: [readRole.id] });
    await assignPlots(t.db, unboundUser.id, [plotA.id], false);
    const unboundCookie = (await loginAs(t, unboundUser)).cookie;

    // Default scope is 'plots' (only sees insideA)
    const unboundDefault = await call(t.app, 'GET', `/api/species?q=scopeus`, {
      cookie: unboundCookie,
    });
    expect(unboundDefault.status).toBe(200);
    expect((await unboundDefault.json()).data.map((s: { id: string }) => s.id)).toEqual([
      spInsideA.id,
    ]);

    // scope=all lists all species
    const unboundAll = await call(t.app, 'GET', `/api/species?q=scopeus&scope=all`, {
      cookie: unboundCookie,
    });
    expect(unboundAll.status).toBe(200);
    const unboundAllIds = (await unboundAll.json()).data.map((s: { id: string }) => s.id);
    expect(unboundAllIds).toContain(spInsideA.id);
    expect(unboundAllIds).toContain(spInsideB.id);
    expect(unboundAllIds).toContain(spOutside.id);

    // plotId=plotB lists insideB
    const unboundPlotB = await call(t.app, 'GET', `/api/species?plotId=${plotB.id}`, {
      cookie: unboundCookie,
    });
    expect(unboundPlotB.status).toBe(200);
    expect((await unboundPlotB.json()).data.map((s: { id: string }) => s.id)).toEqual([
      spInsideB.id,
    ]);

    // (b) Bound contributor (restricted to plotA):
    const { user: boundUser } = await createUser(t.db, { roles: [readRole.id] });
    await assignPlots(t.db, boundUser.id, [plotA.id], true);
    const boundCookie = (await loginAs(t, boundUser)).cookie;

    // Default sees insideA
    const boundDefault = await call(t.app, 'GET', `/api/species?q=scopeus`, {
      cookie: boundCookie,
    });
    expect(boundDefault.status).toBe(200);
    expect((await boundDefault.json()).data.map((s: { id: string }) => s.id)).toEqual([
      spInsideA.id,
    ]);

    // scope=all returns 403 PERMISSION_DENIED
    const boundScopeAll = await call(t.app, 'GET', `/api/species?scope=all`, {
      cookie: boundCookie,
    });
    expect(boundScopeAll.status).toBe(403);
    expect((await boundScopeAll.json()).error.code).toBe('PERMISSION_DENIED');

    // plotId=plotB (outside assigned plots) returns 403 PERMISSION_DENIED
    const boundOtherPlot = await call(t.app, 'GET', `/api/species?plotId=${plotB.id}`, {
      cookie: boundCookie,
    });
    expect(boundOtherPlot.status).toBe(403);
    expect((await boundOtherPlot.json()).error.code).toBe('PERMISSION_DENIED');

    // Detail of outside species returns 404 SPECIES_NOT_FOUND
    const boundOutsideDetail = await call(t.app, 'GET', `/api/species/${spOutside.id}`, {
      cookie: boundCookie,
    });
    expect(boundOutsideDetail.status).toBe(404);
    expect((await boundOutsideDetail.json()).error.code).toBe('SPECIES_NOT_FOUND');

    // (c) Manager without plots:
    const { user: managerUser } = await createUser(t.db, { roles: [managerRole.id] });
    const managerCookie = (await loginAs(t, managerUser)).cookie;

    // Default is 'all'
    const managerDefault = await call(t.app, 'GET', `/api/species?q=scopeus`, {
      cookie: managerCookie,
    });
    expect(managerDefault.status).toBe(200);
    const managerAllIds = (await managerDefault.json()).data.map((s: { id: string }) => s.id);
    expect(managerAllIds).toContain(spInsideA.id);
    expect(managerAllIds).toContain(spInsideB.id);
    expect(managerAllIds).toContain(spOutside.id);

    // plotId=<any> works
    const managerPlotA = await call(t.app, 'GET', `/api/species?plotId=${plotA.id}`, {
      cookie: managerCookie,
    });
    expect(managerPlotA.status).toBe(200);
    expect((await managerPlotA.json()).data.map((s: { id: string }) => s.id)).toEqual([
      spInsideA.id,
    ]);

    // (d) Restricted viewer who also holds dataset.read_inactive:
    const { user: restrictedManager } = await createUser(t.db, { roles: [managerRole.id] });
    await assignPlots(t.db, restrictedManager.id, [plotA.id], true);
    const restrictedManagerCookie = (await loginAs(t, restrictedManager)).cookie;

    // Plain request with no params answers 200 with defaultScope 'plots' (not 403)
    const restrictedManagerDefault = await call(t.app, 'GET', `/api/species?q=scopeus`, {
      cookie: restrictedManagerCookie,
    });
    expect(restrictedManagerDefault.status).toBe(200);
    expect((await restrictedManagerDefault.json()).data.map((s: { id: string }) => s.id)).toEqual([
      spInsideA.id,
    ]);

    // (d) plots on detail:
    // Add spInsideA to plotB as well
    await addPlotSpecies(t.db, plotB.id, [spInsideA.id]);

    // Unbound contributor assigned to plotA sees only plotA on spInsideA detail
    const contributorDetail = await call(t.app, 'GET', `/api/species/${spInsideA.id}`, {
      cookie: unboundCookie,
    });
    expect(contributorDetail.status).toBe(200);
    const contributorPlots = (await contributorDetail.json()).data.plots;
    expect(contributorPlots.map((p: { id: string }) => p.id)).toEqual([plotA.id]);

    // Manager with plots.manage sees every plot (plotA and plotB)
    const managerDetail = await call(t.app, 'GET', `/api/species/${spInsideA.id}`, {
      cookie: managerCookie,
    });
    expect(managerDetail.status).toBe(200);
    const managerPlots = (await managerDetail.json()).data.plots;
    expect(managerPlots.map((p: { id: string }) => p.id).sort()).toEqual(
      [plotA.id, plotB.id].sort(),
    );
  });
});
