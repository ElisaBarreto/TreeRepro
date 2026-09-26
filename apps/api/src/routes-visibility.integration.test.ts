import type { PermissionKey } from '@treerepro/contracts';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../test/helpers/app.ts';
import {
  createContest,
  createPlot,
  createRecord,
  createTrait,
  createVisibilityFixture,
} from '../test/helpers/dataset.ts';
import { adminRoleId } from '../test/helpers/roles.ts';
import { loginAs } from '../test/helpers/session.ts';
import { createUser } from '../test/helpers/users.ts';
import type { Visibility } from './access/visibility.ts';
import { traitLevels } from './db/schema/dictionary.ts';
import type { AppEnv } from './http/env.ts';
import { guardPermission } from './http/guards.ts';
import {
  VISIBILITY_EXEMPT_ROUTES,
  VISIBILITY_GUARDED_PERMISSIONS,
} from './http/visibility-routes.ts';

interface RouteEntry {
  method: string;
  path: string;
  handler: unknown;
}

/** `"<METHOD> <path>"` → the permission its guard names, for every permission-guarded route. */
function guardedRoutes(routes: RouteEntry[]): Map<string, PermissionKey> {
  const map = new Map<string, PermissionKey>();
  for (const r of routes) {
    const key = guardPermission(r.handler);
    if (key) map.set(`${r.method} ${r.path}`, key);
  }
  return map;
}

describe('RFC-33 R10 every route behind a dataset-reading permission resolves the viewer visibility', () => {
  const t = useTestApp();

  it('the handler resolves visibilityOf, or the route is on the exempt list', async () => {
    const admin = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const { cookie } = await loginAs(t, admin.user);
    const fx = await createVisibilityFixture(t.db, admin.user.id);
    const plot = await createPlot(t.db);
    // The trait the default maps fixture names, so both map routes answer 200.
    await createTrait(t.db, { key: 'map_fixture' });
    const level = fx.activeTrait.levels[0]?.id as string;
    // A level and a contest of their own, so the withdraw and resolve calls
    // change nothing the sweep reads on another route.
    const [sweptLevel] = await t.db
      .insert(traitLevels)
      .values({ traitId: fx.activeTrait.id, key: `swept-${Date.now()}`, sortOrder: 99 })
      .returning({ id: traitLevels.id });
    await createRecord(t.db, {
      speciesId: fx.shownSpecies.id,
      traitId: fx.activeTrait.id,
      valueText: 'swept',
      levelId: sweptLevel?.id,
      primaryReferenceId: fx.reference.id,
      origin: 'manual',
      createdBy: admin.user.id,
    });
    const contest = await createContest(t.db, {
      speciesId: fx.shownSpecies.id,
      traitId: fx.activeTrait.id,
      createdBy: admin.user.id,
    });

    // The outer app sees the same request context as the handlers it wraps,
    // so it can read what `visibilityOf` recorded once the handler is done.
    let resolved: Visibility | undefined;
    const observed = new Hono<AppEnv>();
    observed.use('*', async (c, next) => {
      await next();
      resolved = c.get('visibility');
    });
    observed.route('/', t.app);

    // `:id` means a different row per prefix; longest prefix wins.
    const ids: [string, string][] = [
      ['/api/admin/users', admin.user.id],
      ['/api/species', fx.shownSpecies.id],
      ['/api/traits', fx.activeTrait.id],
      ['/api/references', fx.reference.id],
      ['/api/records', fx.visible.id],
      ['/api/plots', plot.id],
      ['/api/contests', contest.id],
    ];
    const concrete = (path: string): string => {
      const [, id] = ids.find(([prefix]) => path.startsWith(`${prefix}/`)) ?? [];
      return path
        .replace(':traitId', fx.activeTrait.id)
        .replace(':levelId', sweptLevel?.id ?? '')
        .replace(':name', 'map_fixture-completeness.svg')
        .replace(':id', id ?? '0'.repeat(32));
    };
    // Query strings and bodies the route's schema requires.
    const inputs: Record<string, { query?: string; body?: unknown }> = {
      'GET /api/records': { query: `speciesId=${fx.shownSpecies.id}&traitId=${fx.activeTrait.id}` },
      'GET /api/records/pending': { query: `traitId=${fx.activeTrait.id}` },
      'POST /api/records/pending/map': {
        body: {
          traitId: fx.activeTrait.id,
          valueText: 'nothing pending',
          value: { levelIds: [level] },
        },
      },
      'GET /api/me/contributions': { query: 'kind=records' },
      'GET /api/admin/users/:id/contributions': { query: 'kind=records' },
    };

    const covered: string[] = [];
    const wrong: string[] = [];
    for (const [key, permission] of guardedRoutes(t.app.routes as RouteEntry[])) {
      if (!VISIBILITY_GUARDED_PERMISSIONS.includes(permission)) continue;
      covered.push(key);
      const [method, path] = key.split(' ') as [string, string];
      const input = inputs[key] ?? {};
      resolved = undefined;
      const res = await call(
        observed,
        method,
        concrete(path) + (input.query ? `?${input.query}` : ''),
        {
          body: method === 'GET' ? undefined : (input.body ?? {}),
          cookie,
        },
      );
      if (res.status < 200 || res.status >= 300) {
        wrong.push(`${key}: answered ${res.status} ${JSON.stringify(await res.json())}`);
        continue;
      }
      const exempt = VISIBILITY_EXEMPT_ROUTES.includes(key);
      if (!exempt && resolved === undefined) wrong.push(`${key}: never resolved visibilityOf`);
      if (exempt && resolved !== undefined)
        wrong.push(`${key}: exempt but resolves visibilityOf (drop it from the list)`);
    }
    expect(wrong).toEqual([]);
    for (const route of VISIBILITY_EXEMPT_ROUTES) expect(covered).toContain(route);
  });
});
