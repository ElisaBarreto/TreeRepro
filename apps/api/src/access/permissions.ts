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

/** The generation counter outlives the entry so a slow fill still sees the bump. @rfc RFC-32 R3 */
export const PERMISSION_GENERATION_TTL_MS = 10 * 60 * 1000;

/** @rfc RFC-32 R2, R3 */
export interface PermissionCache {
  get(userId: string): Promise<readonly PermissionKey[] | null>;
  /** The user's current invalidation counter as a string; '0' when absent. */
  generation(userId: string): Promise<string>;
  /** Writes only while the counter still equals `generation`, so a fill that raced an invalidation is discarded. */
  set(userId: string, keys: readonly PermissionKey[], generation: string): Promise<void>;
  /** Deletes the entry and bumps the counter. */
  invalidate(userIds: readonly string[]): Promise<void>;
}

const cacheKey = (userId: string) => `perms:${userId}`;
const generationKey = (userId: string) => `perms:gen:${userId}`;

// KEYS[1] = generation counter, KEYS[2] = entry; ARGV = expected generation, value, ttl(ms).
// Writes the entry only while the counter still equals the expected generation.
const SET_IF_GENERATION_SCRIPT = `
local gen = redis.call('GET', KEYS[1]) or '0'
if gen ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
return 1
`;

/** @rfc RFC-32 R2, R3 */
export function createPermissionCache(redis: Redis): PermissionCache {
  return {
    async get(userId) {
      const raw = await redis.get(cacheKey(userId));
      if (!raw) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || !('keys' in parsed)) return null;
        const keys: unknown = parsed.keys;
        if (!Array.isArray(keys)) return null;
        return keys.filter((k): k is PermissionKey => typeof k === 'string' && isPermissionKey(k));
      } catch {
        return null;
      }
    },
    async generation(userId) {
      return (await redis.get(generationKey(userId))) ?? '0';
    },
    async set(userId, keys, generation) {
      await redis.eval(
        SET_IF_GENERATION_SCRIPT,
        2,
        generationKey(userId),
        cacheKey(userId),
        generation,
        JSON.stringify({ gen: generation, keys: [...keys] }),
        String(PERMISSION_CACHE_TTL_MS),
      );
    },
    async invalidate(userIds) {
      if (userIds.length === 0) return;
      const multi = redis.multi().del(...userIds.map(cacheKey));
      for (const id of userIds)
        multi.incr(generationKey(id)).pexpire(generationKey(id), PERMISSION_GENERATION_TTL_MS);
      await multi.exec();
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
  const gen = await ctx.permissionCache.generation(userId);
  const keys = await effectivePermissions(ctx.db, userId);
  await ctx.permissionCache.set(userId, keys, gen);
  return new Set(keys);
}
