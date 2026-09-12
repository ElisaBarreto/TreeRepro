import { PERMISSION_KEYS, PERMISSIONS } from '@treerepro/contracts';
import { Hono } from 'hono';
import type { AuthContext } from '../../auth/context.ts';
import type { AppEnv } from '../env.ts';
import { requirePermission } from '../middleware/require-permission.ts';

/** @rfc RFC-30 R5 */
export function adminRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>().get('/permissions', requirePermission(ctx, 'roles.read'), (c) =>
    c.json({ data: PERMISSION_KEYS.map((key) => ({ key, description: PERMISSIONS[key] })) }),
  );
}
