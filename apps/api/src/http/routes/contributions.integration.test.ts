import {
  contributionAnnotationSchema,
  contributionRecordSchema,
  contributionSummarySchema,
} from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../test/helpers/app.ts';
import {
  createAnnotation,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../../test/helpers/dataset.ts';
import { createRole } from '../../../test/helpers/roles.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser } from '../../../test/helpers/users.ts';

describe('RFC-71 R1, R2, R3, R4 GET /api/me/contributions', () => {
  const t = useTestApp();

  const reader = async () => {
    const role = await createRole(t.db, { permissions: ['dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  };

  it('answers the viewer own records with the contribution shape and a cursor', async () => {
    const { user, cookie } = await reader();
    const { user: other } = await createUser(t.db);
    const species = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['alpha', 'beta'] });
    const reference = await createReference(t.db);
    const mine = async (valueText: string, createdBy: string) =>
      createRecord(t.db, {
        speciesId: species.id,
        traitId: trait.id,
        valueText,
        primaryReferenceId: reference.id,
        origin: 'manual',
        createdBy,
      });
    const first = await mine('alpha', user.id);
    const second = await mine('beta', user.id);
    const foreign = await mine('gamma', other.id);

    const res = await call(t.app, 'GET', '/api/me/contributions?kind=records&limit=1', { cookie });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((r: { id: string }) => r.id)).toEqual([second.id]);
    expect(contributionRecordSchema.safeParse(body.data[0]).success).toBe(true);
    expect(body.meta).toEqual({ nextCursor: expect.any(String) });

    const next = await call(
      t.app,
      'GET',
      `/api/me/contributions?kind=records&limit=10&cursor=${body.meta.nextCursor}`,
      { cookie },
    );
    const rest = await next.json();
    expect(rest.data.map((r: { id: string }) => r.id)).toEqual([first.id]);
    expect(rest.data.map((r: { id: string }) => r.id)).not.toContain(foreign.id);

    const filtered = await call(
      t.app,
      'GET',
      `/api/me/contributions?kind=records&speciesId=${species.id}&traitId=${trait.id}&intent=none&from=2024-01-01`,
      { cookie },
    );
    expect(filtered.status).toBe(200);
    expect((await filtered.json()).data).toHaveLength(2);
  });

  it('answers the viewer own annotations and refuses a query without a kind', async () => {
    const { user, cookie } = await reader();
    const { user: other } = await createUser(t.db);
    const species = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['alpha'] });
    const reference = await createReference(t.db);
    const record = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'alpha',
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: other.id,
    });
    const annotation = await createAnnotation(t.db, {
      recordId: record.id,
      actorId: user.id,
      kind: 'confirm',
    });

    const res = await call(t.app, 'GET', '/api/me/contributions?kind=annotations', { cookie });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((r: { id: string }) => r.id)).toEqual([annotation.id]);
    expect(contributionAnnotationSchema.safeParse(body.data[0]).success).toBe(true);

    for (const q of ['', '?kind=other', '?kind=records&page=2', '?kind=records&cursor=nope']) {
      const bad = await call(t.app, 'GET', `/api/me/contributions${q}`, { cookie });
      expect(bad.status, q).toBe(400);
      expect((await bad.json()).error.code, q).toBe('VALIDATION_FAILED');
    }
  });

  it('summarises the viewer own standing', async () => {
    const { user, cookie } = await reader();
    const species = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['alpha'] });
    const reference = await createReference(t.db);
    await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'alpha',
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: user.id,
    });

    const res = await call(t.app, 'GET', '/api/me/contributions/summary', { cookie });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(contributionSummarySchema.safeParse(body.data).success).toBe(true);
    expect(body.data.records).toBe(1);
  });

  it('is 403 for a session without dataset.read', async () => {
    const role = await createRole(t.db, { permissions: ['users.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    const cookie = (await loginAs(t, user)).cookie;
    for (const path of ['/api/me/contributions?kind=records', '/api/me/contributions/summary']) {
      const res = await call(t.app, 'GET', path, { cookie });
      expect(res.status, path).toBe(403);
      expect((await res.json()).error.code, path).toBe('PERMISSION_DENIED');
    }
  });
});
