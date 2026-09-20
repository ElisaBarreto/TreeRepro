import { Hono } from 'hono';
import { visibilityOf } from '../../../access/visibility.ts';
import { recordAudit } from '../../../audit/audit.ts';
import type { AuthContext } from '../../../auth/context.ts';
import { acceptedCsv } from '../../../dataset/export.ts';
import type { AppEnv } from '../../env.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';

/**
 * File download: the RFC-11 R2 exception. The viewer's visibility is resolved
 * here and handed down, like every other dataset read (RFC-33 R1, R3).
 * @rfc RFC-66 R1, R2, R4, R6, R7
 * @rfc RFC-33 R1, R3
 */
export function exportRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>().get(
    '/accepted.csv',
    requirePermission(ctx, 'dataset.export'),
    async (c) => {
      // Resolved before the audit entry: a viewer that cannot be resolved is
      // an export that never started (RFC-66 R6).
      const visibility = await visibilityOf(ctx, c);
      await recordAudit(ctx.db, {
        actorUserId: currentUser(c).id,
        action: 'dataset.exported',
        metadata: { format: 'csv', scope: 'accepted' },
      });
      const day = new Date(ctx.now()).toISOString().slice(0, 10);
      c.header('Content-Type', 'text/csv; charset=utf-8');
      c.header('Content-Disposition', `attachment; filename="treerepro-accepted-${day}.csv"`);
      c.header('Cache-Control', 'no-store');
      return c.body(acceptedCsv(ctx.db, visibility));
    },
  );
}
