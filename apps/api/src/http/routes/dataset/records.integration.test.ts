import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import {
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  traitByKey,
} from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';

describe('RFC-63 R9, R10 record and summary routes', () => {
  const t = useTestApp();

  it('lists by species+trait or by reference, rejects other combinations, answers detail and summary', async () => {
    const role = await createRole(t.db, { permissions: ['dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    const { cookie } = await loginAs(t, user);
    const sp1 = await createSpecies(t.db);
    const trait = await traitByKey(t.db, 'flower_color');
    const ref = await createReference(t.db);
    const batch = await createImportBatch(t.db);
    const rec = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'x',
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });

    const byTrait = await call(
      t.app,
      'GET',
      `/api/records?speciesId=${sp1.id}&traitId=${trait.id}`,
      { cookie },
    );
    expect(byTrait.status).toBe(200);
    expect((await byTrait.json()).data.map((r: { id: string }) => r.id)).toEqual([rec.id]);
    const byRef = await call(t.app, 'GET', `/api/records?referenceId=${ref.id}`, { cookie });
    expect((await byRef.json()).data).toHaveLength(1);
    for (const bad of [
      `/api/records?speciesId=${sp1.id}`,
      `/api/records?referenceId=${ref.id}&traitId=${trait.id}`,
      '/api/records',
    ]) {
      const res = await call(t.app, 'GET', bad, { cookie });
      expect(res.status, bad).toBe(400);
      expect((await res.json()).error.details[0].path).toBe('speciesId');
    }
    const detail = await call(t.app, 'GET', `/api/records/${rec.id}`, { cookie });
    expect((await detail.json()).data).toMatchObject({
      id: rec.id,
      annotations: [],
      acceptedHistory: [],
      importBatch: { id: batch.id },
    });
    const missing = await call(t.app, 'GET', '/api/records/00000000-0000-7000-8000-000000000000', {
      cookie,
    });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('RECORD_NOT_FOUND');

    const summary = await call(t.app, 'GET', `/api/species/${sp1.id}/traits`, { cookie });
    expect(summary.status).toBe(200);
    const body = await summary.json();
    expect(body.data[0].category.key).toBe('flower_color');
    expect(body.data[0].traits[0]).toMatchObject({
      trait: { key: 'flower_color' },
      recordCount: 1,
      accepted: null,
    });
    const noSpecies = await call(
      t.app,
      'GET',
      '/api/species/00000000-0000-7000-8000-000000000000/traits',
      { cookie },
    );
    expect(noSpecies.status).toBe(404);
    expect((await noSpecies.json()).error.code).toBe('SPECIES_NOT_FOUND');
  });
});
