import { Hono } from 'hono';
import type { AuthContext } from '../../../auth/context.ts';
import type { AppEnv } from '../../env.ts';
import { recordRoutes } from './records.ts';
import { referenceRoutes } from './references.ts';
import { speciesRoutes } from './species.ts';
import { familyRoutes, genusRoutes } from './taxa.ts';

/**
 * The scientific dataset: every route is permission-guarded (RFC-32 R5).
 * Later tasks add imports here.
 * @rfc RFC-60 R6-R8
 * @rfc RFC-61 R4
 * @rfc RFC-63 R9, R10
 */
export function datasetRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .route('/species', speciesRoutes(ctx))
    .route('/families', familyRoutes(ctx))
    .route('/genera', genusRoutes(ctx))
    .route('/references', referenceRoutes(ctx))
    .route('/records', recordRoutes(ctx));
}
