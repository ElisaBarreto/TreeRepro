import { auditQuerySchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import { isAuditAction } from '../../../audit/actions.ts';
import { queryAudit } from '../../../audit/query.ts';
import type { AuthContext } from '../../../auth/context.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { validate } from '../../validate.ts';

/** @rfc RFC-51 R1, R4 */
export function adminAuditRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>().get(
    '/',
    requirePermission(ctx, 'audit.read'),
    validate('query', auditQuerySchema),
    async (c) => {
      const q = c.req.valid('query');
      if (q.action !== undefined && !isAuditAction(q.action)) {
        throw new AppError('VALIDATION_FAILED', 'Request validation failed', [
          { path: 'action', message: 'Unknown action' },
        ]);
      }
      const { data, nextCursor } = await queryAudit(ctx.db, {
        actor: q.actor,
        action: q.action,
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
        cursor: q.cursor,
        limit: q.limit,
      });
      return c.json({ data, meta: { nextCursor } });
    },
  );
}
