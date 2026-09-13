import type { PermissionKey } from '@treerepro/contracts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { TestApp } from '../../../../test/helpers/app.ts';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import {
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
  traitByKey,
} from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';
import { traitLevels } from '../../../db/schema/dictionary.ts';

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

/** A signed-in user holding exactly these permissions. */
async function scientist(
  t: TestApp,
  permissions: PermissionKey[] = ['records.create', 'dataset.read'],
) {
  const role = await createRole(t.db, { permissions });
  const { user } = await createUser(t.db, { roles: [role.id] });
  const { cookie } = await loginAs(t, user);
  return { user, cookie };
}

describe('RFC-65 R1, R2 POST /api/records', () => {
  const t = useTestApp();

  it('creates a categorical record with the level key as value_text and answers the detail', async () => {
    const { user, cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['red', 'blue'] });
    const ref = await createReference(t.db);
    const res = await call(t.app, 'POST', '/api/records', {
      cookie,
      body: {
        speciesId: sp1.id,
        traitId: trait.id,
        value: { levelId: trait.levels[0]?.id },
        primaryReferenceId: ref.id,
        rawValue: 'Reds',
        note: 'Table 2',
      },
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({
      speciesId: sp1.id,
      trait: { id: trait.id },
      valueText: 'red',
      level: { id: trait.levels[0]?.id, key: 'red' },
      numericValue: null,
      harmonisation: 'harmonised',
      review: 'unreviewed',
      origin: 'manual',
      createdBy: { id: user.id, name: 'Test User' },
      primaryReference: { id: ref.id },
      secondaryReference: null,
      rawValue: 'Reds',
      note: 'Table 2',
      importBatch: null,
      supersedes: null,
      supersededBy: [],
    });
  });

  it('creates a quantitative record with the canonical number as value_text', async () => {
    const { cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { valueType: 'quantitative', unit: 'mm' });
    const ref = await createReference(t.db);
    const res = await call(t.app, 'POST', '/api/records', {
      cookie,
      body: {
        speciesId: sp1.id,
        traitId: trait.id,
        value: { numeric: 1e3 },
        primaryReferenceId: ref.id,
      },
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({
      valueText: '1000',
      numericValue: 1000,
      level: null,
    });
  });

  it('validates the value against the trait: shape, foreign level, inactive level, inactive trait', async () => {
    const { cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const cat = await createTrait(t.db, { levels: ['a'] });
    const other = await createTrait(t.db, { levels: ['b'] });
    const quant = await createTrait(t.db, { valueType: 'quantitative' });
    const inactiveTrait = await createTrait(t.db, { active: false, levels: ['c'] });
    const ref = await createReference(t.db);
    await t.db
      .update(traitLevels)
      .set({ active: false })
      .where(eq(traitLevels.id, other.levels[0]?.id ?? ''));
    const post = (body: Record<string, unknown>) =>
      call(t.app, 'POST', '/api/records', {
        cookie,
        body: { speciesId: sp1.id, primaryReferenceId: ref.id, ...body },
      });
    const cases: [Record<string, unknown>, string][] = [
      [{ traitId: cat.id, value: { numeric: 1 } }, 'value'],
      [{ traitId: quant.id, value: { levelId: cat.levels[0]?.id } }, 'value'],
      [{ traitId: cat.id, value: { levelId: other.levels[0]?.id } }, 'value.levelId'],
      [{ traitId: other.id, value: { levelId: other.levels[0]?.id } }, 'value.levelId'],
      [{ traitId: inactiveTrait.id, value: { levelId: inactiveTrait.levels[0]?.id } }, 'traitId'],
    ];
    for (const [body, path] of cases) {
      const res = await post(body);
      expect(res.status, path).toBe(400);
      const err = (await res.json()).error;
      expect(err.code, path).toBe('VALIDATION_FAILED');
      expect(err.details[0].path, path).toBe(path);
    }
  });

  it('answers 404 for an unknown species, trait or reference', async () => {
    const { cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const ref = await createReference(t.db);
    const zero = '00000000-0000-7000-8000-000000000000';
    const base = {
      speciesId: sp1.id,
      traitId: trait.id,
      value: { levelId: trait.levels[0]?.id },
      primaryReferenceId: ref.id,
    };
    for (const [body, code] of [
      [{ ...base, speciesId: zero }, 'SPECIES_NOT_FOUND'],
      [{ ...base, traitId: zero }, 'TRAIT_NOT_FOUND'],
      [{ ...base, primaryReferenceId: zero }, 'REFERENCE_NOT_FOUND'],
      [{ ...base, secondaryReferenceId: zero }, 'REFERENCE_NOT_FOUND'],
    ] as const) {
      const res = await call(t.app, 'POST', '/api/records', { cookie, body });
      expect(res.status, code).toBe(404);
      expect((await res.json()).error.code, code).toBe(code);
    }
  });

  it('R2 an identical claim answers 409 RECORD_DUPLICATE naming the existing record', async () => {
    const { cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const ref = await createReference(t.db);
    const body = {
      speciesId: sp1.id,
      traitId: trait.id,
      value: { levelId: trait.levels[0]?.id },
      primaryReferenceId: ref.id,
      rawValue: 'A',
    };
    const first = await call(t.app, 'POST', '/api/records', { cookie, body });
    expect(first.status).toBe(201);
    const firstId = (await first.json()).data.id;
    const again = await call(t.app, 'POST', '/api/records', { cookie, body });
    expect(again.status).toBe(409);
    const err = (await again.json()).error;
    expect(err.code).toBe('RECORD_DUPLICATE');
    expect(err.details).toEqual([{ path: 'recordId', message: firstId }]);
    // a different raw value is a different claim
    const other = await call(t.app, 'POST', '/api/records', {
      cookie,
      body: { ...body, rawValue: 'a.' },
    });
    expect(other.status).toBe(201);
  });

  it('RFC-63 R8 the detail shows supersedes and supersededBy', async () => {
    const { user, cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const ref = await createReference(t.db);
    const batch = await createImportBatch(t.db);
    const pending = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'aa',
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    const mapped = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
      supersedesRecordId: pending.id,
    });
    const original = await call(t.app, 'GET', `/api/records/${pending.id}`, { cookie });
    expect((await original.json()).data).toMatchObject({
      supersedes: null,
      supersededBy: [{ id: mapped.id }],
    });
    const reading = await call(t.app, 'GET', `/api/records/${mapped.id}`, { cookie });
    expect((await reading.json()).data).toMatchObject({
      supersedes: { id: pending.id },
      supersededBy: [],
    });
  });
});
