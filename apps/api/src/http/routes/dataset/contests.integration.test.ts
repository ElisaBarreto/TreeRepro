import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import {
  createContest,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../../../test/helpers/dataset.ts';
import { systemRoleId } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';

describe('RFC-65 R16 contest routes', () => {
  const t = useTestApp();

  it('resolve needs records.review, withdraw records.annotate and authorship or records.withdraw; both answer 200 { data: null }', async () => {
    const role = async (name: 'contributor' | 'manager') =>
      createUser(t.db, { roles: [await systemRoleId(t.db, name)] });
    const { user: author } = await role('contributor');
    const { user: stranger } = await role('contributor');
    const { user: manager } = await role('manager');
    const a = (await loginAs(t, author)).cookie;
    const s = (await loginAs(t, stranger)).cookie;
    const m = (await loginAs(t, manager)).cookie;
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['blue'] });
    const sp = await createSpecies(t.db);
    const blue = trait.levels[0]?.id as string;
    await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'blue',
      levelId: blue,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: manager.id,
    });
    const contest = await createContest(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      createdBy: author.id,
      levelIds: [blue],
    });
    const url = (action: string, id = contest.id) => `/api/contests/${id}/${action}`;

    expect((await call(t.app, 'POST', url('resolve'), { cookie: a, body: {} })).status).toBe(403);
    for (let i = 0; i < 2; i++) {
      const r = await call(t.app, 'POST', url('resolve'), { cookie: m, body: {} });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ data: null });
    }
    const denied = await call(t.app, 'POST', url('withdraw'), { cookie: s, body: {} });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('PERMISSION_DENIED');
    const w = await call(t.app, 'POST', url('withdraw'), { cookie: a, body: {} });
    expect(w.status).toBe(200);
    expect(await w.json()).toEqual({ data: null });
    const gone = await call(t.app, 'POST', url('resolve'), { cookie: m, body: {} });
    expect(gone.status).toBe(404);
    expect((await gone.json()).error.code).toBe('RECORD_NOT_FOUND');
    const unknown = await call(
      t.app,
      'POST',
      url('withdraw', '00000000-0000-4000-8000-000000000000'),
      {
        cookie: m,
        body: {},
      },
    );
    expect(unknown.status).toBe(404);
  });
});
