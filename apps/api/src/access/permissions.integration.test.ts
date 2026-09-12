import { PERMISSION_KEYS } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { useTestApp } from '../../test/helpers/app.ts';
import { adminRoleId, createRole, grantRoles } from '../../test/helpers/roles.ts';
import { createUser } from '../../test/helpers/users.ts';
import {
  createPermissionCache,
  effectivePermissions,
  PERMISSION_CACHE_TTL_MS,
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
    expect(await effectivePermissions(t.db, nobody.user.id)).toEqual([]);
    expect(await effectivePermissions(t.db, both.user.id)).toEqual([
      'audit.read',
      'roles.read',
      'users.read',
    ]);
    expect(await effectivePermissions(t.db, admin.user.id)).toEqual([...PERMISSION_KEYS].sort());
  });
});

describe('RFC-32 R2, R3 permission cache', () => {
  const t = useTestApp();

  it('stores sorted keys as JSON for 5 minutes and returns null on a miss or garbage', async () => {
    const cache = createPermissionCache(t.redis);
    const userId = `u-${Math.random().toString(16).slice(2)}`;
    expect(await cache.get(userId)).toBeNull();
    await cache.set(userId, ['users.read', 'audit.read']);
    expect(await t.redis.get(`perms:${userId}`)).toBe('["users.read","audit.read"]');
    expect(await t.redis.pttl(`perms:${userId}`)).toBeGreaterThan(PERMISSION_CACHE_TTL_MS - 5000);
    expect(await cache.get(userId)).toEqual(['users.read', 'audit.read']);
    await t.redis.set(`perms:${userId}`, 'not json');
    expect(await cache.get(userId)).toBeNull();
    await cache.invalidate([userId, 'missing']);
    expect(await t.redis.exists(`perms:${userId}`)).toBe(0);
  });

  it('resolvePermissions serves the cache until invalidated', async () => {
    const role = await createRole(t.db, { permissions: ['users.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    const ctx = {
      db: t.db,
      permissionCache: t.permissionCache,
      logger: t.deps.logger,
      now: () => t.clock.now,
    };
    expect([...(await resolvePermissions(ctx, user.id))]).toEqual(['users.read']);
    const more = await createRole(t.db, { permissions: ['audit.read'] });
    await grantRoles(t.db, user.id, [more.id]);
    expect([...(await resolvePermissions(ctx, user.id))]).toEqual(['users.read']);
    await t.permissionCache.invalidate([user.id]);
    expect([...(await resolvePermissions(ctx, user.id))]).toEqual(['audit.read', 'users.read']);
  });
});
