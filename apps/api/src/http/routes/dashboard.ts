import { Hono } from 'hono';
import { userScopeOf, visibilityOf } from '../../access/visibility.ts';
import type { AuthContext } from '../../auth/context.ts';
import { getDashboard } from '../../workspace/dashboard.ts';
import type { AppEnv } from '../env.ts';
import { currentPermissions, requirePermission } from '../middleware/require-permission.ts';
import { currentUser } from '../middleware/session.ts';

/**
 * Mounted on `/me` beside `meRoutes` and `contributionRoutes`: the workspace
 * landing page needs `dataset.read`, which is what keeps it out of the
 * self-service router (RFC-32 R5).
 * @rfc RFC-72 R1, R2
 * @rfc RFC-33 R2, R3
 */
export function dashboardRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>().get('/dashboard', requirePermission(ctx, 'dataset.read'), async (c) => {
    const user = currentUser(c);
    // Sequential on purpose: `visibilityOf` resolves the scope itself and
    // leaves it on the request, so the second call is a hit rather than a
    // second query racing the first to fill the same slot.
    const visibility = await visibilityOf(ctx, c);
    const scope = await userScopeOf(ctx.db, c);
    const data = await getDashboard(ctx, visibility, {
      id: user.id,
      permissions: currentPermissions(c),
      scope,
    });
    return c.json({ data });
  });
}
