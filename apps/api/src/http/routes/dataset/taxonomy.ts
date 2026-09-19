import { taxonomyMatchQuerySchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import type { AuthContext } from '../../../auth/context.ts';
import { RATE_LIMITS } from '../../../auth/rate-limit.ts';
import { matchTaxon } from '../../../dataset/proposals.ts';
import type { AppEnv } from '../../env.ts';
import { rateLimit } from '../../middleware/rate-limit.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';
import { validate } from '../../validate.ts';

/**
 * The direct taxonomy lookup. It is the only route outside the proposal flow
 * that reaches GBIF, so it carries RFC-24 R3's own bucket keyed by the user —
 * the global per-session limit alone would let one reviewer spend the
 * platform's whole GBIF budget.
 * @rfc RFC-81 R4
 * @rfc RFC-24 R3
 */
export function taxonomyRoutes(ctx: AuthContext) {
  const matchLimit = rateLimit(ctx.limiter, [
    {
      scope: 'taxonomy/match',
      rule: RATE_LIMITS.taxonomyMatchUser,
      key: (c) => currentUser(c).id,
    },
  ]);

  return new Hono<AppEnv>().get(
    '/match',
    requirePermission(ctx, 'taxa.manage'),
    matchLimit,
    validate('query', taxonomyMatchQuerySchema),
    async (c) => c.json({ data: await matchTaxon(ctx, c.req.valid('query').name) }),
  );
}
