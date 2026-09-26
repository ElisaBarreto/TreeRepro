import type { PermissionKey } from '@treerepro/contracts';
import type { Context, MiddlewareHandler } from 'hono';
import type { AccessContext } from '../../access/context.ts';
import { resolvePermissions } from '../../access/permissions.ts';
import type { AppEnv } from '../env.ts';
import { AppError } from '../errors.ts';
import { markGuard } from '../guards.ts';

export interface RequirePermissionOptions {
  /** Row-level hook (RFC-32 R7): runs after the permission check; `false` answers 403. */
  resource?: (c: Context<AppEnv>) => Promise<boolean> | boolean;
}

/**
 * Permissions that create or change identities, roles or sessions: an API key
 * never exercises them, so a leaked key cannot outlive its own revocation.
 * @rfc RFC-82 R6
 */
export const KEY_REFUSED_PERMISSIONS: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  'users.invite',
  'users.update',
  'users.suspend',
  'users.delete',
  'roles.manage',
  'sessions.revoke',
]);

const DENIED = () => new AppError('PERMISSION_DENIED', 'You do not have permission to do this');

/**
 * @rfc RFC-32 R4, R7
 * @rfc RFC-82 R6
 */
export function requirePermission(
  ctx: AccessContext,
  key: PermissionKey,
  options: RequirePermissionOptions = {},
): MiddlewareHandler<AppEnv> {
  return markGuard(
    async (c, next) => {
      const user = c.get('user');
      if (!user) throw new AppError('AUTH_UNAUTHENTICATED', 'Authentication required');
      const permissions = await resolvePermissions(ctx, user.id);
      if (!permissions.has(key)) throw DENIED();
      if (c.get('apiKey') && KEY_REFUSED_PERMISSIONS.has(key)) throw DENIED();
      if (options.resource && !(await options.resource(c))) throw DENIED();
      c.set('permissions', permissions);
      await next();
    },
    'permission',
    key,
  );
}

/** For handlers behind `requirePermission`. @rfc RFC-32 R4 */
export function currentPermissions(c: Context<AppEnv>): ReadonlySet<PermissionKey> {
  return c.get('permissions') ?? new Set<PermissionKey>();
}
