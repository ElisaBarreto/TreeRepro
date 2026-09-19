import { PERMISSION_KEYS, PERMISSIONS } from '@treerepro/contracts';
import { Hono } from 'hono';
import type { AuthContext } from '../../../auth/context.ts';
import type { AppEnv } from '../../env.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { adminAuditRoutes } from './audit.ts';
import { adminHealthRoutes } from './health.ts';
import { adminRoleRoutes } from './roles.ts';
import { adminUserRoutes } from './users.ts';

/**
 * Everything under /api/admin is permission-guarded (RFC-32 R5).
 * @rfc RFC-30 R5
 * @rfc RFC-50 R2-R10
 * @rfc RFC-51 R1
 * @rfc RFC-52 R1
 */
export function adminRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get('/permissions', requirePermission(ctx, 'roles.read'), (c) =>
      c.json({ data: PERMISSION_KEYS.map((key) => ({ key, description: PERMISSIONS[key] })) }),
    )
    .route('/users', adminUserRoutes(ctx))
    .route('/roles', adminRoleRoutes(ctx))
    .route('/audit', adminAuditRoutes(ctx))
    .route('/health', adminHealthRoutes(ctx));
}
