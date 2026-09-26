import { exportDatasetQuerySchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import { visibilityOf } from '../../../access/visibility.ts';
import { recordAudit } from '../../../audit/audit.ts';
import type { AuthContext } from '../../../auth/context.ts';
import { datasetZip } from '../../../dataset/export.ts';
import type { AppEnv } from '../../env.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';
import { validate } from '../../validate.ts';

/**
 * File download: the RFC-11 R2 exception. The viewer's visibility is resolved
 * here and handed down, like every other dataset read (RFC-33 R1, R3). Its
 * record clause (`recordVisible`, `visibility.review` included) decides
 * whether pending records are in the file, so no separate permission read is
 * needed here (spec R-14).
 * @rfc RFC-66 R1, R2, R4, R6, R7, R9
 * @rfc RFC-33 R1, R3
 */
export function exportRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>().get(
    '/dataset.zip',
    requirePermission(ctx, 'dataset.export'),
    validate('query', exportDatasetQuerySchema),
    async (c) => {
      const scope = c.req.valid('query').scope ?? 'all';
      // Resolved before the audit entry: a viewer that cannot be resolved is
      // an export that never started (RFC-66 R6).
      const visibility = await visibilityOf(ctx, c);
      await recordAudit(ctx.db, {
        actorUserId: currentUser(c).id,
        action: 'dataset.exported',
        metadata: { format: 'zip', scope },
      });
      const now = new Date(ctx.now());
      const day = now.toISOString().slice(0, 10);
      const name = scope === 'platform' ? 'platform' : 'dataset';
      c.header('Content-Type', 'application/zip');
      c.header('Content-Disposition', `attachment; filename="treerepro-${name}-${day}.zip"`);
      c.header('Cache-Control', 'no-store');
      return c.body(datasetZip(ctx.db, visibility, { scope, now }));
    },
  );
}
