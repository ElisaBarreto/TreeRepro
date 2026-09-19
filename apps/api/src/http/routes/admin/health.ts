import { Hono } from 'hono';
import { platformHealth } from '../../../admin/health.ts';
import type { AuthContext } from '../../../auth/context.ts';
import type { AppEnv } from '../../env.ts';
import { requirePermission } from '../../middleware/require-permission.ts';

/**
 * One global snapshot of the platform, the same for every caller. It writes
 * nothing, and RFC-52 R2 asks for no audit entry: a read of counts is not an
 * event worth recording, and the payload holds no PII to account for.
 * @rfc RFC-52 R1, R2
 */
export function adminHealthRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>().get('/', requirePermission(ctx, 'health.read'), async (c) =>
    c.json({ data: await platformHealth(ctx) }),
  );
}
