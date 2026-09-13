import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { createImportBatch } from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';
import { importRejects } from '../../../db/schema/imports.ts';

describe('RFC-62 R5 GET /api/traits', () => {
  const t = useTestApp();

  it('returns the dictionary with a private cache header', async () => {
    const role = await createRole(t.db, { permissions: ['dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    const { cookie } = await loginAs(t, user);
    const res = await call(t.app, 'GET', '/api/traits', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');
    const body = await res.json();
    expect(body.data[0].key).toBe('dispersal');
    expect(
      body.data.some((c: { traits: { key: string }[] }) =>
        c.traits.some((tr) => tr.key === 'flower_color'),
      ),
    ).toBe(true);
  });
});

describe('RFC-64 R11 import routes', () => {
  const t = useTestApp();

  it('imports.read lists batches, reads one with its rejects, 404 otherwise; dataset.read alone is denied', async () => {
    const readerRole = await createRole(t.db, { permissions: ['dataset.read'] });
    const importsRole = await createRole(t.db, { permissions: ['imports.read'] });
    const reader = (await loginAs(t, (await createUser(t.db, { roles: [readerRole.id] })).user))
      .cookie;
    const auditor = (await loginAs(t, (await createUser(t.db, { roles: [importsRole.id] })).user))
      .cookie;
    const batch = await createImportBatch(t.db, { fileName: 'routes.csv' });
    await t.db.insert(importRejects).values([
      {
        batchId: batch.id,
        rowNo: 3,
        reason: 'unknown_trait',
        rawRow: { final_standard_trait: 'x' },
      },
      { batchId: batch.id, rowNo: 1, reason: 'no_reference', rawRow: { primary_reference: '' } },
    ]);
    expect((await call(t.app, 'GET', '/api/imports', { cookie: reader })).status).toBe(403);
    const list = await call(t.app, 'GET', '/api/imports?limit=200', { cookie: auditor });
    expect(list.status).toBe(200);
    expect((await list.json()).data.some((b: { id: string }) => b.id === batch.id)).toBe(true);
    const one = await call(t.app, 'GET', `/api/imports/${batch.id}`, { cookie: auditor });
    expect((await one.json()).data).toMatchObject({
      id: batch.id,
      fileName: 'routes.csv',
      status: 'completed',
      runBy: null,
    });
    const rejects = await call(t.app, 'GET', `/api/imports/${batch.id}/rejects`, {
      cookie: auditor,
    });
    expect((await rejects.json()).data.map((r: { rowNo: number }) => r.rowNo)).toEqual([1, 3]);
    const missing = await call(t.app, 'GET', '/api/imports/00000000-0000-7000-8000-000000000000', {
      cookie: auditor,
    });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('IMPORT_NOT_FOUND');
    const missingRejects = await call(
      t.app,
      'GET',
      '/api/imports/00000000-0000-7000-8000-000000000000/rejects',
      { cookie: auditor },
    );
    expect(missingRejects.status).toBe(404);
  });
});
