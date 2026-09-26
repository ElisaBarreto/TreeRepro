import { dashboardSchema, type PermissionKey } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../test/helpers/app.ts';
import {
  addPlotSpecies,
  createPlot,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../../test/helpers/dataset.ts';
import { createRole } from '../../../test/helpers/roles.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { forgetCached } from '../../redis/cache.ts';

describe('RFC-72 R1, R2 GET /api/me/dashboard', () => {
  const t = useTestApp();

  const reader = async (permissions: PermissionKey[]) => {
    const role = await createRole(t.db, { permissions });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  };

  it('answers the dashboard contract to a viewer with dataset.read', async () => {
    const { user, cookie } = await reader(['dataset.read']);
    const plot = await createPlot(t.db);
    const species = await createSpecies(t.db);
    await addPlotSpecies(t.db, plot.id, [species.id]);
    try {
      const res = await call(t.app, 'GET', '/api/me/dashboard', { cookie });
      expect(res.status).toBe(200);
      const body = await res.json();
      const parsed = dashboardSchema.safeParse(body.data);
      expect(parsed.error?.issues.map((i) => i.path.join('.'))).toBeUndefined();
      expect(parsed.success).toBe(true);
      // No plot is assigned to this viewer, so the scope-dependent sections
      // are null and curation is absent without `records.review`.
      expect(body.data.scope).toBeNull();
      expect(body.data.contributor.missingCells).toBeNull();
      expect(body.data.contributor.awaitingValidation).toBeNull();
      expect(body.data.curation).toBeNull();
    } finally {
      await forgetCached(t.redis, `dashboard:${user.id}`);
    }
  });

  it('refuses a viewer without dataset.read', async () => {
    const { cookie } = await reader(['records.create']);
    const res = await call(t.app, 'GET', '/api/me/dashboard', { cookie });
    expect(res.status).toBe(403);
  });

  it('forgets the viewer entry when they create a record or annotate one', async () => {
    const { user, cookie } = await reader(['dataset.read', 'records.create', 'records.annotate']);
    const species = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['alpha', 'beta'] });
    const reference = await createReference(t.db);
    const key = `dashboard:${user.id}`;
    try {
      expect((await call(t.app, 'GET', '/api/me/dashboard', { cookie })).status).toBe(200);
      expect(await t.redis.get(key)).not.toBeNull();

      const created = await call(t.app, 'POST', '/api/records', {
        cookie,
        body: {
          speciesId: species.id,
          traitId: trait.id,
          value: { levelIds: [trait.levels[0]?.id] },
          sources: { references: [{ id: reference.id }] },
        },
      });
      expect(created.status).toBe(201);
      expect(await t.redis.get(key)).toBeNull();

      expect((await call(t.app, 'GET', '/api/me/dashboard', { cookie })).status).toBe(200);
      expect(await t.redis.get(key)).not.toBeNull();

      const other = await createSpecies(t.db);
      const { user: author } = await createUser(t.db);
      const record = await createRecord(t.db, {
        speciesId: other.id,
        traitId: trait.id,
        valueText: 'beta',
        levelId: trait.levels[1]?.id,
        primaryReferenceId: reference.id,
        origin: 'manual',
        createdBy: author.id,
      });
      const annotated = await call(t.app, 'POST', `/api/records/${record.id}/annotations`, {
        cookie,
        body: { kind: 'confirm' },
      });
      expect(annotated.status).toBe(201);
      expect(await t.redis.get(key)).toBeNull();
    } finally {
      await forgetCached(t.redis, key);
    }
  });

  /**
   * RFC-72 R1 names "creating a record" as an invalidator, and mapping a
   * pending group creates records: the INSERT … SELECT writes `trait_records`
   * with `created_by = <actor>` and `origin = 'manual'`, which lands in the
   * actor's own `awaitingValidation` and moves `missingCells` and the
   * contribution summary.
   */
  it('forgets the viewer entry when they map a pending group', async () => {
    const { user, cookie } = await reader(['dataset.read', 'records.review']);
    const species = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['alpha', 'beta'] });
    const reference = await createReference(t.db);
    await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'ten to twelve',
      harmonisation: 'unknown_level',
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: user.id,
    });
    const key = `dashboard:${user.id}`;
    try {
      expect((await call(t.app, 'GET', '/api/me/dashboard', { cookie })).status).toBe(200);
      expect(await t.redis.get(key)).not.toBeNull();

      const mapped = await call(t.app, 'POST', '/api/records/pending/map', {
        cookie,
        body: {
          traitId: trait.id,
          valueText: 'ten to twelve',
          value: { levelIds: [trait.levels[0]?.id] },
        },
      });
      expect(mapped.status).toBe(200);
      expect(await mapped.json()).toEqual({ data: { created: 1, skipped: 0 } });
      expect(await t.redis.get(key)).toBeNull();
    } finally {
      await forgetCached(t.redis, key);
    }
  });
});
