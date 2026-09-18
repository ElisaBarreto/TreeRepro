import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { lastAudit } from '../../../../test/helpers/audit.ts';
import {
  createGenus,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';

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

  it('applies categoryKey, valueType and q server-side, and reports the cached speciesCount', async () => {
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

    // `dictionary:species-counts:r` is a fixed key (RFC-62 R5) shared by
    // every parallel test that reads the dictionary, and `cachedJson` stores
    // the whole per-viewer-class map as one blob: seeding a bare single-trait
    // entry would silently zero out every other trait's count for the rest
    // of the key's 10-minute TTL, corrupting any concurrent reader.
    // `reader()` has `dataset.read` but not `dataset.read_inactive`, so it
    // is a restricted viewer and reads `r`, not `u`. An unfiltered request
    // first ensures the key holds a real, complete map (fresh, or already
    // warm from an earlier test — either way every trait but `own` keeps its
    // true count); only then is `own`'s entry overridden with the sentinel
    // and the *whole* map written back. The key is deleted in `finally` so a
    // failing assertion cannot leave the seed behind — the window is bounded
    // to this test, not the TTL.
    const cacheKey = 'dictionary:species-counts:r';
    await call(t.app, 'GET', '/api/traits', { cookie });
    const cached = await t.redis.get(cacheKey);
    const entry = cached
      ? (JSON.parse(cached) as { value: [string, number][]; computedAt: string })
      : { value: [] as [string, number][], computedAt: new Date().toISOString() };
    const map = new Map(entry.value);
    const sentinel = 424242;
    map.set(own.id, sentinel);
    await t.redis.set(
      cacheKey,
      JSON.stringify({ value: [...map], computedAt: entry.computedAt }),
      'EX',
      600,
    );
    try {
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
      expect(traitsFound[0]?.speciesCount).toBe(sentinel);
      expect(traitsFound.some((tr) => tr.id === other.id)).toBe(false);
    } finally {
      await t.redis.del(cacheKey);
    }

    const badQuery = await call(t.app, 'GET', '/api/traits?valueType=nope', { cookie });
    expect(badQuery.status).toBe(400);
    expect((await badQuery.json()).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('RFC-62 R7, R8 GET /api/traits/:id and /api/traits/:id/species', () => {
  const t = useTestApp();

  async function reader() {
    const role = await createRole(t.db, { permissions: ['dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  it('R7 answers the trait detail, and 404 for an unknown or invisible trait', async () => {
    const { user, cookie } = await reader();
    const reference = await createReference(t.db);
    const own = await createTrait(t.db, { categoryKey: 'flower_color', levels: ['alpha'] });
    const subject = await createSpecies(t.db);
    await createRecord(t.db, {
      speciesId: subject.id,
      traitId: own.id,
      valueText: 'alpha',
      levelId: own.levels[0]?.id,
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: user.id,
    });

    try {
      const res = await call(t.app, 'GET', `/api/traits/${own.id}`, { cookie });
      expect(res.status).toBe(200);
      expect((await res.json()).data).toMatchObject({
        id: own.id,
        category: { key: 'flower_color' },
        speciesWithData: 1,
        acceptedCount: 0,
        distribution: {
          levels: [
            { level: { id: own.levels[0]?.id, key: 'alpha' }, speciesCount: 1, recordCount: 1 },
          ],
        },
      });

      const unknown = await call(t.app, 'GET', `/api/traits/${zero}`, { cookie });
      expect(unknown.status).toBe(404);
      expect((await unknown.json()).error.code).toBe('TRAIT_NOT_FOUND');

      // `reader` has `dataset.read` but not `dataset.read_inactive`.
      const retired = await createTrait(t.db, { active: false });
      const invisible = await call(t.app, 'GET', `/api/traits/${retired.id}`, { cookie });
      expect(invisible.status).toBe(404);
    } finally {
      await t.redis.del(`trait:${own.id}:distribution:u`, `trait:${own.id}:distribution:r`);
    }
  });

  it('R8 lists the species of a trait, defaulting to mode=with, and 404 for an unknown trait', async () => {
    const { user, cookie } = await reader();
    const reference = await createReference(t.db);
    const own = await createTrait(t.db, { levels: ['alpha'] });
    const genus = await createGenus(t.db);
    const withData = await createSpecies(t.db, { genusId: genus.id });
    const without = await createSpecies(t.db, { genusId: genus.id });
    await createRecord(t.db, {
      speciesId: withData.id,
      traitId: own.id,
      valueText: 'alpha',
      levelId: own.levels[0]?.id,
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: user.id,
    });

    const implied = await call(t.app, 'GET', `/api/traits/${own.id}/species`, { cookie });
    expect(implied.status).toBe(200);
    const body = await implied.json();
    expect(body.meta).toEqual({ nextCursor: null });
    expect(body.data).toEqual([
      expect.objectContaining({
        id: withData.id,
        recordCount: 1,
        summary: { levels: [{ key: 'alpha', count: 1 }] },
      }),
    ]);

    const explicit = await call(t.app, 'GET', `/api/traits/${own.id}/species?mode=with`, {
      cookie,
    });
    expect((await explicit.json()).data).toEqual(body.data);

    const missing = await call(
      t.app,
      'GET',
      `/api/traits/${own.id}/species?mode=missing&genusId=${genus.id}`,
      { cookie },
    );
    expect((await missing.json()).data).toEqual([
      expect.objectContaining({ id: without.id, recordCount: null, accepted: null, summary: null }),
    ]);

    const unknown = await call(t.app, 'GET', `/api/traits/${zero}/species`, { cookie });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe('TRAIT_NOT_FOUND');

    const badMode = await call(t.app, 'GET', `/api/traits/${own.id}/species?mode=nope`, { cookie });
    expect(badMode.status).toBe(400);
  });
});
