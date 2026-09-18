import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { lastAudit } from '../../../../test/helpers/audit.ts';
import {
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';
import { forgetCached } from '../../../redis/cache.ts';

const zero = '00000000-0000-7000-8000-000000000000';

describe('RFC-62 R5, R6 dictionary reads and writes', () => {
  const t = useTestApp();

  async function lexicographer() {
    const role = await createRole(t.db, { permissions: ['traits.manage', 'dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  it('R5 the dictionary carries level sortOrder and is not HTTP-cached', async () => {
    const { cookie } = await lexicographer();
    const own = await createTrait(t.db, { levels: ['one', 'two'] });
    const res = await call(t.app, 'GET', '/api/traits', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control') ?? '').not.toMatch(/max-age/);
    const dictionary = (await res.json()).data as {
      traits: { id: string; levels: { key: string; sortOrder: number }[] }[];
    }[];
    const trait = dictionary.flatMap((c) => c.traits).find((x) => x.id === own.id);
    expect(trait?.levels).toEqual([
      { id: own.levels[0]?.id, key: 'one', sortOrder: 0, active: true },
      { id: own.levels[1]?.id, key: 'two', sortOrder: 1, active: true },
    ]);
  });

  it('R6 creates a trait, edits description, category and active; key, valueType and unit are not editable', async () => {
    const { cookie } = await lexicographer();
    const key = `test_created_${Math.random().toString(16).slice(2)}`;
    const created = await call(t.app, 'POST', '/api/traits', {
      cookie,
      body: {
        key,
        categoryKey: 'flower_color',
        valueType: 'quantitative',
        unit: 'mm',
        description: 'Test',
      },
    });
    expect(created.status).toBe(201);
    const trait = (await created.json()).data;
    expect(trait).toEqual({
      id: expect.any(String),
      key,
      valueType: 'quantitative',
      unit: 'mm',
      description: 'Test',
      active: true,
      levels: [],
      speciesCount: 0,
    });
    expect((await lastAudit(t.db, 'traits.created', { targetId: trait.id }))?.targetType).toBe(
      'traits',
    );
    const dup = await call(t.app, 'POST', '/api/traits', {
      cookie,
      body: { key, categoryKey: 'flower_color', valueType: 'categorical' },
    });
    expect((await dup.json()).error.code).toBe('TRAIT_KEY_TAKEN');
    const badCategory = await call(t.app, 'POST', '/api/traits', {
      cookie,
      body: { key: `${key}_b`, categoryKey: 'nope', valueType: 'categorical' },
    });
    expect(badCategory.status).toBe(400);
    expect((await badCategory.json()).error.details[0].path).toBe('categoryKey');
    const edited = await call(t.app, 'PATCH', `/api/traits/${trait.id}`, {
      cookie,
      body: { description: 'Edited', active: false },
    });
    expect((await edited.json()).data).toMatchObject({
      description: 'Edited',
      active: false,
      unit: 'mm',
    });
    expect((await lastAudit(t.db, 'traits.updated', { targetId: trait.id }))?.metadata).toEqual({
      fields: ['description', 'active'],
    });
    const immutable = await call(t.app, 'PATCH', `/api/traits/${trait.id}`, {
      cookie,
      body: { unit: 'cm' },
    });
    expect(immutable.status).toBe(400);
    const missing = await call(t.app, 'PATCH', `/api/traits/${zero}`, {
      cookie,
      body: { active: true },
    });
    expect((await missing.json()).error.code).toBe('TRAIT_NOT_FOUND');
  });

  it('R6 adds, renames, reorders and retires levels; renaming keeps the records; 409 and 404', async () => {
    const { user, cookie } = await lexicographer();
    const own = await createTrait(t.db, { levels: ['grey'] });
    const sp1 = await createSpecies(t.db);
    const ref = await createReference(t.db);
    const rec = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: own.id,
      valueText: 'grey',
      levelId: own.levels[0]?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    const added = await call(t.app, 'POST', `/api/traits/${own.id}/levels`, {
      cookie,
      body: { key: 'black' },
    });
    expect(added.status).toBe(201);
    const afterAdd = (await added.json()).data;
    expect(afterAdd.levels).toEqual([
      { id: own.levels[0]?.id, key: 'grey', sortOrder: 0, active: true },
      { id: expect.any(String), key: 'black', sortOrder: 1, active: true },
    ]);
    const black = afterAdd.levels[1].id;
    expect((await lastAudit(t.db, 'traits.updated', { targetId: own.id }))?.metadata).toEqual({
      levelId: black,
      fields: ['levels'],
    });
    const dup = await call(t.app, 'POST', `/api/traits/${own.id}/levels`, {
      cookie,
      body: { key: 'GREY' },
    });
    expect((await dup.json()).error.code).toBe('LEVEL_KEY_TAKEN');
    const renamed = await call(
      t.app,
      'PATCH',
      `/api/traits/${own.id}/levels/${own.levels[0]?.id}`,
      { cookie, body: { key: 'gray', sortOrder: 5 } },
    );
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).data.levels.map((l: { key: string }) => l.key)).toEqual([
      'black',
      'gray',
    ]);
    expect((await lastAudit(t.db, 'traits.updated', { targetId: own.id }))?.metadata).toEqual({
      levelId: own.levels[0]?.id,
      fields: ['key', 'sortOrder'],
    });
    const record = await call(t.app, 'GET', `/api/records/${rec.id}`, { cookie });
    expect((await record.json()).data).toMatchObject({
      level: { id: own.levels[0]?.id, key: 'gray' },
      valueText: 'grey',
    });
    const retired = await call(t.app, 'PATCH', `/api/traits/${own.id}/levels/${black}`, {
      cookie,
      body: { active: false },
    });
    expect(
      (await retired.json()).data.levels.find((l: { id: string }) => l.id === black).active,
    ).toBe(false);
    const other = await createTrait(t.db, { levels: ['x'] });
    const foreign = await call(
      t.app,
      'PATCH',
      `/api/traits/${own.id}/levels/${other.levels[0]?.id}`,
      { cookie, body: { key: 'y' } },
    );
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).error.code).toBe('LEVEL_NOT_FOUND');
  });
});

describe('RFC-62 R5 GET /api/traits filters and speciesCount', () => {
  const t = useTestApp();

  async function reader() {
    const role = await createRole(t.db, { permissions: ['dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { cookie: (await loginAs(t, user)).cookie };
  }

  it('applies categoryKey, valueType and q server-side, and reports speciesCount', async () => {
    const { cookie } = await reader();
    const suffix = Math.random().toString(16).slice(2);
    const own = await createTrait(t.db, {
      key: `route_filter_${suffix}`,
      categoryKey: 'flower_color',
      valueType: 'categorical',
      levels: ['x'],
    });
    const other = await createTrait(t.db, {
      key: `route_other_${suffix}`,
      categoryKey: 'plant_form',
      valueType: 'quantitative',
    });
    const ref = await createReference(t.db);
    const sp = await createSpecies(t.db);
    const { user: recorder } = await createUser(t.db);
    await createRecord(t.db, {
      speciesId: sp.id,
      traitId: own.id,
      valueText: 'x',
      levelId: own.levels[0]?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: recorder.id,
    });

    // The species-count map is cached under a fixed key shared by every
    // parallel test that reads the dictionary (RFC-62 R5); forget it first
    // so this call scans fresh and sees the record just inserted above.
    await forgetCached(t.redis, 'dictionary:species-counts:u', 'dictionary:species-counts:r');
    const res = await call(t.app, 'GET', `/api/traits?categoryKey=flower_color&q=${own.key}`, {
      cookie,
    });
    expect(res.status).toBe(200);
    const dictionary = (await res.json()).data as {
      key: string;
      traits: { id: string; key: string; speciesCount: number }[];
    }[];
    const traitsFound = dictionary.flatMap((c) => c.traits);
    expect(traitsFound.map((tr) => tr.key)).toEqual([own.key]);
    expect(traitsFound[0]?.speciesCount).toBe(1);
    expect(traitsFound.some((tr) => tr.id === other.id)).toBe(false);

    const badQuery = await call(t.app, 'GET', '/api/traits?valueType=nope', { cookie });
    expect(badQuery.status).toBe(400);
    expect((await badQuery.json()).error.code).toBe('VALIDATION_FAILED');
  });
});
