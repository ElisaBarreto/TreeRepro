import {
  dataEnvelopeSchema,
  type PermissionKey,
  phylogeniesResponseSchema,
} from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { call, TEST_PLANT_ORIGIN, useTestApp } from '../../../../test/helpers/app.ts';
import { assignPlots, createPlot, createTrait } from '../../../../test/helpers/dataset.ts';
import { figure, figuresDir } from '../../../../test/helpers/phylogenies.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';

describe('RFC-79 R2, R3, R4 phylogeny routes', () => {
  const t = useTestApp();

  async function viewer(permissions: PermissionKey[] = ['dataset.read']) {
    const role = await createRole(t.db, { permissions });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  async function fixture() {
    const on = await createTrait(t.db, { key: `phy_on_${Date.now()}` });
    const off = await createTrait(t.db, { key: `phy_off_${Date.now()}`, active: false });
    const dir = figuresDir([...figure('coverage'), ...figure(on.key), ...figure(off.key)]);
    const { app } = t.build({ phylogeniesDir: dir });
    return { app, on, off };
  }

  it('GET /api/phylogenies needs dataset.read', async () => {
    const { app } = await fixture();
    expect((await call(app, 'GET', '/api/phylogenies')).status).toBe(401);
    const { cookie } = await viewer(['users.read']);
    expect((await call(app, 'GET', '/api/phylogenies', { cookie })).status).toBe(403);
  });

  it('lists coverage and the visible traits; a plot-restricted viewer sees every figure', async () => {
    const { app, on } = await fixture();
    const { user, cookie } = await viewer();
    const plot = await createPlot(t.db);
    await assignPlots(t.db, user.id, [plot.id], true);
    const res = await call(app, 'GET', '/api/phylogenies', { cookie });
    expect(res.status).toBe(200);
    const body = dataEnvelopeSchema(phylogeniesResponseSchema).parse(await res.json());
    expect(body.data.map((f) => f.key)).toEqual(['coverage', on.key]);
  });

  it('PlantRepro reads its own directory, empty here', async () => {
    const { app } = await fixture();
    const role = await createRole(t.db, { permissions: ['dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id], platform: 'plantrepro' });
    const cookie = (await loginAs(t, user, { platform: 'plantrepro' })).cookie;
    const res = await call(app, 'GET', 'http://plantrepro.localhost/api/phylogenies', {
      cookie,
      origin: TEST_PLANT_ORIGIN,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });

  it('size=display answers image/jpeg with an immutable private cache; size=full image/png', async () => {
    const { app, on } = await fixture();
    const { cookie } = await viewer();
    const display = await call(app, 'GET', `/api/phylogenies/files/${on.key}?size=display&v=1`, {
      cookie,
    });
    expect(display.status).toBe(200);
    expect(display.headers.get('content-type')).toBe('image/jpeg');
    expect(display.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(await display.text()).toBe(`treerepro/display/trait_${on.key}.jpg`);
    const full = await call(app, 'GET', '/api/phylogenies/files/coverage?size=full', { cookie });
    expect(full.headers.get('content-type')).toBe('image/png');
    expect(await full.text()).toBe('treerepro/trait_coverage.png');
  });

  it('an unknown key, or an inactive trait without dataset.read_inactive, is 404 PHYLOGENY_NOT_FOUND', async () => {
    const { app, off } = await fixture();
    const { cookie } = await viewer();
    for (const key of ['no_such_trait', off.key]) {
      const res = await call(app, 'GET', `/api/phylogenies/files/${key}?size=full`, { cookie });
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        'PHYLOGENY_NOT_FOUND',
      );
    }
    const reader = await viewer(['dataset.read', 'dataset.read_inactive']);
    const res = await call(app, 'GET', `/api/phylogenies/files/${off.key}?size=full`, {
      cookie: reader.cookie,
    });
    expect(res.status).toBe(200);
  });

  it('never serves a path: traversal attempts are 400 or 404', async () => {
    const { app } = await fixture();
    const { cookie } = await viewer();
    for (const key of ['..%2F..%2Fetc%2Fpasswd', '..', 'a%2Fb', 'Coverage']) {
      const res = await call(app, 'GET', `/api/phylogenies/files/${key}?size=full`, { cookie });
      expect([400, 404]).toContain(res.status);
    }
  });

  it('size other than display or full is 400', async () => {
    const { app } = await fixture();
    const { cookie } = await viewer();
    const res = await call(app, 'GET', '/api/phylogenies/files/coverage?size=huge', { cookie });
    expect(res.status).toBe(400);
  });
});
