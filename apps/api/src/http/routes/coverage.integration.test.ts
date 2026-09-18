import { coverageSchema, coverageTraitRowSchema, type PermissionKey } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../test/helpers/app.ts';
import {
  createFamily,
  createGenus,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
  createTraitCategory,
} from '../../../test/helpers/dataset.ts';
import { createRole } from '../../../test/helpers/roles.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { forgetCached } from '../../redis/cache.ts';

describe('RFC-69 R5, R6 GET /api/coverage', () => {
  const t = useTestApp();

  const reader = async (permissions: PermissionKey[]) => {
    const role = await createRole(t.db, { permissions });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  };

  /** One family with one species, one category with one trait, one record. */
  const fixture = async (actorId: string) => {
    const family = await createFamily(t.db);
    const genus = await createGenus(t.db, { familyId: family.id });
    const species = await createSpecies(t.db, { genusId: genus.id });
    const category = await createTraitCategory(t.db);
    const trait = await createTrait(t.db, { categoryKey: category.key, levels: ['a'] });
    const reference = await createReference(t.db);
    await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: actorId,
    });
    return { family, species, category, trait };
  };

  it('answers the coverage contract over the filters it is given', async () => {
    const { user, cookie } = await reader(['coverage.read']);
    const f = await fixture(user.id);
    // The viewer has no `dataset.read_inactive`, so their class is `r`; the
    // family is this test's own, so the entry is this test's own too.
    const key = `coverage:r:${f.family.id}:-:-`;
    try {
      const res = await call(t.app, 'GET', `/api/coverage?familyId=${f.family.id}`, { cookie });
      expect(res.status).toBe(200);
      const body = await res.json();
      const parsed = coverageSchema.safeParse(body.data);
      expect(parsed.error?.issues.map((i) => i.path.join('.'))).toBeUndefined();
      expect(parsed.success).toBe(true);
      expect(body.data.species).toBe(1);
      expect(body.data.withData).toBe(1);
      expect(body.data.accepted).toBe(0);
      const row = body.data.byTrait.find(
        (r: { trait: { id: string } }) => r.trait.id === f.trait.id,
      );
      expect(row).toMatchObject({ cells: 1, withData: 1, species: 1, percentWithData: 100 });
      expect(await t.redis.get(key)).not.toBeNull();
    } finally {
      await forgetCached(t.redis, key);
    }
  });

  it('refuses a viewer without coverage.read', async () => {
    const { cookie } = await reader(['dataset.read']);
    expect((await call(t.app, 'GET', '/api/coverage', { cookie })).status).toBe(403);
    expect((await call(t.app, 'GET', '/api/coverage/top', { cookie })).status).toBe(403);
  });

  it('answers 404 FAMILY_NOT_FOUND for a family that does not exist', async () => {
    const { cookie } = await reader(['coverage.read']);
    const res = await call(
      t.app,
      'GET',
      '/api/coverage?familyId=00000000-0000-4000-8000-000000000000',
      { cookie },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('FAMILY_NOT_FOUND');
  });

  it('rejects a filter that is not a filter', async () => {
    const { cookie } = await reader(['coverage.read']);
    const res = await call(t.app, 'GET', '/api/coverage?genusId=abc', { cookie });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED');
  });

  it('answers 400 VALIDATION_FAILED for a category key that is not a category', async () => {
    const { cookie } = await reader(['coverage.read']);
    const res = await call(t.app, 'GET', '/api/coverage?categoryKey=no_such_category_xyz', {
      cookie,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual([
      { path: 'categoryKey', message: 'Unknown trait category' },
    ]);
  });
});

describe('RFC-69 R7 GET /api/coverage/top', () => {
  const t = useTestApp();

  const reader = async (permissions: PermissionKey[]) => {
    const role = await createRole(t.db, { permissions });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  };

  it("answers byTrait items, ranked and cut to the limit, off R6's no-filter entry", async () => {
    const { cookie } = await reader(['coverage.read']);
    // The ranking itself is pinned in `dataset/coverage.integration.test.ts`
    // against its own fixture. What is asserted here is that the route cuts
    // the list to `limit` and hands back contract-shaped items — and the three
    // traits the limit is read against are this test's own, so the assertion
    // does not rest on how many traits the shared dictionary happens to hold.
    const category = await createTraitCategory(t.db);
    for (let i = 0; i < 3; i++) await createTrait(t.db, { categoryKey: category.key });
    // The viewer has no `dataset.read_inactive`, so the entry this route now
    // shares with `GET /api/coverage` (RFC-69 R6, R7) is the `r` one. It is
    // the run's one no-filter key, so only its presence is asserted, never its
    // contents, and it is dropped afterwards rather than left to a sibling.
    const key = 'coverage:r:-:-:-';
    try {
      const res = await call(t.app, 'GET', '/api/coverage/top?mode=missing&limit=3', { cookie });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(3);
      for (const item of body.data) {
        const parsed = coverageTraitRowSchema.safeParse(item);
        expect(parsed.error?.issues.map((i) => i.path.join('.'))).toBeUndefined();
        expect(parsed.success).toBe(true);
        expect(item.species).toBe(item.withData);
      }
      const withData = body.data.map((r: { withData: number }) => r.withData);
      expect(withData).toEqual([...withData].sort((a: number, b: number) => a - b));
      expect(await t.redis.get(key)).not.toBeNull();

      const least = await call(t.app, 'GET', '/api/coverage/top?mode=least_accepted&limit=2', {
        cookie,
      });
      expect(least.status).toBe(200);
      expect((await least.json()).data).toHaveLength(2);
    } finally {
      await forgetCached(t.redis, key);
    }
  });

  it('rejects an unknown mode and a limit outside the contract', async () => {
    const { cookie } = await reader(['coverage.read']);
    for (const query of ['?mode=worst', '?limit=0', '?limit=51', '?familyId=abc']) {
      const res = await call(t.app, 'GET', `/api/coverage/top${query}`, { cookie });
      expect(res.status, query).toBe(400);
      expect((await res.json()).error.code, query).toBe('VALIDATION_FAILED');
    }
  });
});
