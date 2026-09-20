import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { createPlot, createSpecies } from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';
import { userPlots } from '../../../db/schema/plots.ts';

const tag = () => randomBytes(4).toString('hex');
const zero = '00000000-0000-7000-8000-000000000000';

describe('RFC-67 R3-R5 plot routes', () => {
  const t = useTestApp();

  async function contributor() {
    const role = await createRole(t.db, { permissions: ['dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  async function plotManager() {
    const role = await createRole(t.db, { permissions: ['plots.manage', 'dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  it('enforces permission matrix: contributor has read access, cannot mutate; manager has write access', async () => {
    const reader = await contributor();
    const manager = await plotManager();

    // Contributor can list plots
    const listRes = await call(t.app, 'GET', '/api/plots', { cookie: reader.cookie });
    expect(listRes.status).toBe(200);
    expect(Array.isArray((await listRes.json()).data)).toBe(true);

    // Contributor cannot create a plot
    const createForbidden = await call(t.app, 'POST', '/api/plots', {
      cookie: reader.cookie,
      body: { code: `P-${tag()}`, name: 'Forbidden Plot' },
    });
    expect(createForbidden.status).toBe(403);
    expect((await createForbidden.json()).error.code).toBe('PERMISSION_DENIED');

    // Manager can create a plot
    const code = `P-${tag()}`;
    const createRes = await call(t.app, 'POST', '/api/plots', {
      cookie: manager.cookie,
      body: { code, name: 'Managed Plot', description: 'Plot notes' },
    });
    expect(createRes.status).toBe(201);
    const plot = (await createRes.json()).data;
    expect(plot).toMatchObject({
      code,
      name: 'Managed Plot',
      description: 'Plot notes',
      speciesCount: 0,
      userCount: 0,
    });

    // Contributor reading plot detail gets userCount: null
    const readerDetailRes = await call(t.app, 'GET', `/api/plots/${plot.id}`, {
      cookie: reader.cookie,
    });
    expect(readerDetailRes.status).toBe(200);
    expect((await readerDetailRes.json()).data.userCount).toBeNull();

    // Manager reading plot detail gets userCount: number
    const managerDetailRes = await call(t.app, 'GET', `/api/plots/${plot.id}`, {
      cookie: manager.cookie,
    });
    expect(managerDetailRes.status).toBe(200);
    expect((await managerDetailRes.json()).data.userCount).toBe(0);

    // Contributor cannot patch plot
    const patchForbidden = await call(t.app, 'PATCH', `/api/plots/${plot.id}`, {
      cookie: reader.cookie,
      body: { name: 'New Name' },
    });
    expect(patchForbidden.status).toBe(403);

    // Manager can patch plot
    const patchRes = await call(t.app, 'PATCH', `/api/plots/${plot.id}`, {
      cookie: manager.cookie,
      body: { name: 'Updated Name' },
    });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).data.name).toBe('Updated Name');

    // Contributor cannot read plot users
    const usersForbidden = await call(t.app, 'GET', `/api/plots/${plot.id}/users`, {
      cookie: reader.cookie,
    });
    expect(usersForbidden.status).toBe(403);

    // Manager can read plot users; the item names the user without the
    // address, which stays behind users.read (RFC-02 R14, RFC-67 R4)
    await t.db.insert(userPlots).values({ plotId: plot.id, userId: reader.user.id });
    const usersRes = await call(t.app, 'GET', `/api/plots/${plot.id}/users`, {
      cookie: manager.cookie,
    });
    expect(usersRes.status).toBe(200);
    expect((await usersRes.json()).data).toEqual([
      { id: reader.user.id, name: reader.user.name, status: 'active', restricted: false },
    ]);

    // Add species to plot
    const sp = await createSpecies(t.db);
    const addSpForbidden = await call(t.app, 'POST', `/api/plots/${plot.id}/species`, {
      cookie: reader.cookie,
      body: { speciesId: sp.id },
    });
    expect(addSpForbidden.status).toBe(403);

    const addSpRes = await call(t.app, 'POST', `/api/plots/${plot.id}/species`, {
      cookie: manager.cookie,
      body: { speciesId: sp.id },
    });
    expect(addSpRes.status).toBe(201);
    expect((await addSpRes.json()).data.speciesCount).toBe(1);

    // Both can list plot species
    const plotSpeciesReader = await call(t.app, 'GET', `/api/plots/${plot.id}/species`, {
      cookie: reader.cookie,
    });
    expect(plotSpeciesReader.status).toBe(200);
    expect((await plotSpeciesReader.json()).data).toHaveLength(1);

    // Contributor cannot remove species
    const delSpForbidden = await call(t.app, 'DELETE', `/api/plots/${plot.id}/species/${sp.id}`, {
      cookie: reader.cookie,
    });
    expect(delSpForbidden.status).toBe(403);

    // Manager can remove species
    const delSpRes = await call(t.app, 'DELETE', `/api/plots/${plot.id}/species/${sp.id}`, {
      cookie: manager.cookie,
    });
    expect(delSpRes.status).toBe(200);
    expect((await delSpRes.json()).data.speciesCount).toBe(0);
  });

  it('handles error codes: 404 PLOT_NOT_FOUND, 409 PLOT_CODE_TAKEN, 409 PLOT_SPECIES_EXISTS, 400 VALIDATION_FAILED', async () => {
    const manager = await plotManager();
    const plot = await createPlot(t.db);
    const sp = await createSpecies(t.db);

    // 404 PLOT_NOT_FOUND
    const notFound = await call(t.app, 'GET', `/api/plots/${zero}`, { cookie: manager.cookie });
    expect(notFound.status).toBe(404);
    expect((await notFound.json()).error.code).toBe('PLOT_NOT_FOUND');

    // 409 PLOT_CODE_TAKEN on POST
    const dup = await call(t.app, 'POST', '/api/plots', {
      cookie: manager.cookie,
      body: { code: plot.code.toLowerCase(), name: 'Dup Code' },
    });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe('PLOT_CODE_TAKEN');

    // 409 PLOT_SPECIES_EXISTS
    await call(t.app, 'POST', `/api/plots/${plot.id}/species`, {
      cookie: manager.cookie,
      body: { speciesId: sp.id },
    });
    const dupSpecies = await call(t.app, 'POST', `/api/plots/${plot.id}/species`, {
      cookie: manager.cookie,
      body: { speciesId: sp.id },
    });
    expect(dupSpecies.status).toBe(409);
    expect((await dupSpecies.json()).error.code).toBe('PLOT_SPECIES_EXISTS');

    // 400 VALIDATION_FAILED on empty PATCH body
    const emptyPatch = await call(t.app, 'PATCH', `/api/plots/${plot.id}`, {
      cookie: manager.cookie,
      body: {},
    });
    expect(emptyPatch.status).toBe(400);
    expect((await emptyPatch.json()).error.code).toBe('VALIDATION_FAILED');
  });
});
