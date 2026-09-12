import { isPermissionKey, PERMISSION_KEYS, type PermissionKey } from '@treerepro/contracts';
import { eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { rolePermissions } from '../db/schema/role-permissions.ts';
import { ADMIN_ROLE_NAME, roles } from '../db/schema/roles.ts';
import { userRoles } from '../db/schema/user-roles.ts';
import type { Redis } from '../redis/client.ts';
import type { AccessContext } from './context.ts';

/** @rfc RFC-32 R2 */
export const PERMISSION_CACHE_TTL_MS = 5 * 60 * 1000;

/** @rfc RFC-32 R2, R3 */
export interface PermissionCache {
  get(userId: string): Promise<readonly PermissionKey[] | null>;
  set(userId: string, keys: readonly PermissionKey[]): Promise<void>;
  invalidate(userIds: readonly string[]): Promise<void>;
}

const cacheKey = (userId: string) => `perms:${userId}`;

/** @rfc RFC-32 R2, R3 */
export function createPermissionCache(redis: Redis): PermissionCache {
  return {
    async get(userId) {
      const raw = await redis.get(cacheKey(userId));
      if (!raw) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        return parsed.filter(
          (k): k is PermissionKey => typeof k === 'string' && isPermissionKey(k),
        );
      } catch {
        return null;
      }
    },
    async set(userId, keys) {
      await redis.set(cacheKey(userId), JSON.stringify([...keys]), 'PX', PERMISSION_CACHE_TTL_MS);
    },
    async invalidate(userIds) {
      if (userIds.length === 0) return;
      await redis.del(...userIds.map(cacheKey));
    },
  };
}

/** Sorted; the whole catalog for the admin system role. @rfc RFC-32 R1 */
export async function effectivePermissions(
  db: DbExecutor,
  userId: string,
): Promise<PermissionKey[]> {
  const held = await db
    .select({ id: roles.id, name: roles.name, isSystem: roles.isSystem })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
  if (held.some((r) => r.isSystem && r.name === ADMIN_ROLE_NAME))
    return [...PERMISSION_KEYS].sort();
  if (held.length === 0) return [];
  const rows = await db
    .selectDistinct({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(
      inArray(
        rolePermissions.roleId,
        held.map((r) => r.id),
      ),
    );
  return rows
    .map((r) => r.key)
    .filter(isPermissionKey)
    .sort();
}

/** Cache first, database on a miss. @rfc RFC-32 R1, R2 */
export async function resolvePermissions(
  ctx: AccessContext,
  userId: string,
): Promise<ReadonlySet<PermissionKey>> {
  const cached = await ctx.permissionCache.get(userId);
  if (cached) return new Set(cached);
  const keys = await effectivePermissions(ctx.db, userId);
  await ctx.permissionCache.set(userId, keys);
  return new Set(keys);
}
