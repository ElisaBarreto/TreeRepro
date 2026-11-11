import { PERMISSION_KEYS } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { useTestApp } from '../../test/helpers/app.ts';
import { adminRoleId, createRole, grantRoles } from '../../test/helpers/roles.ts';
import { createUser } from '../../test/helpers/users.ts';
import {
  createPermissionCache,
  effectivePermissions,
  PERMISSION_CACHE_TTL_MS,
  PERMISSION_GENERATION_TTL_MS,
  resolvePermissions,
} from './permissions.ts';

describe('RFC-32 R1 effectivePermissions', () => {
  const t = useTestApp();

  it('is empty without roles, the union over roles, and the whole catalog for admin', async () => {
    const editors = await createRole(t.db, { permissions: ['users.read', 'roles.read'] });
    const auditors = await createRole(t.db, { permissions: ['audit.read', 'users.read'] });
    const nobody = await createUser(t.db);
    const both = await createUser(t.db, { roles: [editors.id, auditors.id] });
    const admin = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    expect(await effectivePermissions(t.db, nobody.user.id, 'treerepro')).toEqual([]);
    expect(await effectivePermissions(t.db, both.user.id, 'treerepro')).toEqual([
      'audit.read',
      'roles.read',
      'users.read',
    ]);
    expect(await effectivePermissions(t.db, admin.user.id, 'treerepro')).toEqual(
      [...PERMISSION_KEYS].sort(),
    );
  });

  it('counts only the roles held on the platform; admin holds both (RFC-31 R16)', async () => {
    const readers = await createRole(t.db, { permissions: ['dataset.read'] });
    const auditors = await createRole(t.db, { permissions: ['audit.read'] });
    const { user } = await createUser(t.db, { roles: [readers.id] });
    await grantRoles(t.db, user.id, [auditors.id], 'plantrepro');
    expect(await effectivePermissions(t.db, user.id, 'treerepro')).toEqual(['dataset.read']);
    expect(await effectivePermissions(t.db, user.id, 'plantrepro')).toEqual(['audit.read']);
    const admin = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    expect(await effectivePermissions(t.db, admin.user.id, 'plantrepro')).toEqual(
      [...PERMISSION_KEYS].sort(),
    );
  });
});

describe('RFC-32 R2, R3 permission cache', () => {
  const t = useTestApp();

  it('stores sorted keys as JSON per platform for 5 minutes and returns null on a miss or garbage', async () => {
    const cache = createPermissionCache(t.redis);
    const userId = `u-${Math.random().toString(16).slice(2)}`;
    const key = `perms:treerepro:${userId}`;
    expect(await cache.get(userId, 'treerepro')).toBeNull();
    await cache.set(userId, 'treerepro', ['users.read', 'audit.read'], '0');
    expect(JSON.parse((await t.redis.get(key)) ?? 'null')).toEqual({
      gen: '0',
      keys: ['users.read', 'audit.read'],
    });
    expect(await t.redis.pttl(key)).toBeGreaterThan(PERMISSION_CACHE_TTL_MS - 5000);
    expect(await cache.get(userId, 'treerepro')).toEqual(['users.read', 'audit.read']);
    expect(await cache.get(userId, 'plantrepro')).toBeNull();
    await t.redis.set(key, 'not json');
    expect(await cache.get(userId, 'treerepro')).toBeNull();
    await t.redis.set(key, '["users.read"]');
    expect(await cache.get(userId, 'treerepro')).toBeNull();
    await cache.set(userId, 'plantrepro', ['audit.read'], '0');
    await cache.invalidate([userId, 'missing']);
    expect(await t.redis.exists(key, `perms:plantrepro:${userId}`)).toBe(0);
  });

  it('set with a stale generation writes nothing; invalidation bumps both platforms', async () => {
    const cache = createPermissionCache(t.redis);
    const userId = `u-${Math.random().toString(16).slice(2)}`;
    expect(await cache.generation(userId, 'treerepro')).toBe('0');
    await cache.invalidate([userId]);
    expect(await cache.generation(userId, 'treerepro')).toBe('1');
    expect(await cache.generation(userId, 'plantrepro')).toBe('1');
    expect(await t.redis.pttl(`perms:gen:plantrepro:${userId}`)).toBeGreaterThan(
      PERMISSION_GENERATION_TTL_MS - 5000,
    );
    await cache.set(userId, 'treerepro', ['users.read'], '0');
    expect(await cache.get(userId, 'treerepro')).toBeNull();
    await cache.set(
      userId,
      'treerepro',
      ['users.read'],
      await cache.generation(userId, 'treerepro'),
    );
    expect(await cache.get(userId, 'treerepro')).toEqual(['users.read']);
  });

  it('resolvePermissions serves the cache per platform until invalidated', async () => {
    const role = await createRole(t.db, { permissions: ['users.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    const ctx = {
      db: t.db,
      permissionCache: t.permissionCache,
      logger: t.deps.logger,
      now: () => t.clock.now,
    };
    expect([...(await resolvePermissions(ctx, user.id, 'treerepro'))]).toEqual(['users.read']);
    expect([...(await resolvePermissions(ctx, user.id, 'plantrepro'))]).toEqual([]);
    const more = await createRole(t.db, { permissions: ['audit.read'] });
    await grantRoles(t.db, user.id, [more.id]);
    await grantRoles(t.db, user.id, [more.id], 'plantrepro');
    expect([...(await resolvePermissions(ctx, user.id, 'treerepro'))]).toEqual(['users.read']);
    expect([...(await resolvePermissions(ctx, user.id, 'plantrepro'))]).toEqual([]);
    await t.permissionCache.invalidate([user.id]);
    expect([...(await resolvePermissions(ctx, user.id, 'treerepro'))]).toEqual([
      'audit.read',
      'users.read',
    ]);
    expect([...(await resolvePermissions(ctx, user.id, 'plantrepro'))]).toEqual(['audit.read']);
  });
});
