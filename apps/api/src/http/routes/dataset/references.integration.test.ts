import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { createReference } from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';

describe('RFC-61 R4 reference routes', () => {
  const t = useTestApp();

  it('lists with q and answers the detail or 404 REFERENCE_NOT_FOUND', async () => {
    const role = await createRole(t.db, { permissions: ['dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    const { cookie } = await loginAs(t, user);
    const ref = await createReference(t.db);
    const list = await call(
      t.app,
      'GET',
      `/api/references?q=${encodeURIComponent(ref.citationKey)}`,
      { cookie },
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({
      data: [expect.objectContaining({ id: ref.id })],
      meta: { nextCursor: null },
    });
    const detail = await call(t.app, 'GET', `/api/references/${ref.id}`, { cookie });
    expect((await detail.json()).data).toMatchObject({ id: ref.id, recordCount: 0 });
    const missing = await call(
      t.app,
      'GET',
      '/api/references/00000000-0000-7000-8000-000000000000',
      { cookie },
    );
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('REFERENCE_NOT_FOUND');
  });
});
