import { coverageQuerySchema, coverageTopQuerySchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import { visibilityOf } from '../../access/visibility.ts';
import type { AuthContext } from '../../auth/context.ts';
import { coverageMetrics, coverageTop } from '../../dataset/coverage.ts';
import type { AppEnv } from '../env.ts';
import { requirePermission } from '../middleware/require-permission.ts';
import { validate } from '../validate.ts';

/**
 * The coverage metrics of RFC-69 R5-R7, both guarded by `coverage.read`: the
 * filtered grid and the top gaps. `/top` is declared first so the router
 * matches it as a path of its own rather than as a filter of `/`.
 * @rfc RFC-69 R5, R6, R7
 * @rfc RFC-33 R2, R6
 */
export function coverageRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get(
      '/top',
      requirePermission(ctx, 'coverage.read'),
      validate('query', coverageTopQuerySchema),
      async (c) => {
        const visibility = await visibilityOf(ctx, c);
        return c.json({ data: await coverageTop(ctx, visibility, c.req.valid('query')) });
      },
    )
    .get(
      '/',
      requirePermission(ctx, 'coverage.read'),
      validate('query', coverageQuerySchema),
      async (c) => {
        const visibility = await visibilityOf(ctx, c);
        return c.json({ data: await coverageMetrics(ctx, visibility, c.req.valid('query')) });
      },
    );
}
