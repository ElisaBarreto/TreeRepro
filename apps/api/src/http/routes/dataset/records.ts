import {
  createRecordBodySchema,
  idParamSchema,
  listRecordsQuerySchema,
} from '@treerepro/contracts';
import { Hono } from 'hono';
import type { AuthContext } from '../../../auth/context.ts';
import { createRecord } from '../../../dataset/curation.ts';
import { getRecord, listRecords } from '../../../dataset/records.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';
import { validate } from '../../validate.ts';

/**
 * @rfc RFC-63 R8, R9
 * @rfc RFC-65 R1, R2
 */
export function recordRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .post(
      '/',
      requirePermission(ctx, 'records.create'),
      validate('json', createRecordBodySchema),
      async (c) => {
        const record = await createRecord(ctx.db, {
          ...c.req.valid('json'),
          actorId: currentUser(c).id,
        });
        return c.json({ data: record }, 201);
      },
    )
    .get(
      '/',
      requirePermission(ctx, 'dataset.read'),
      validate('query', listRecordsQuerySchema),
      async (c) => {
        const q = c.req.valid('query');
        const { data, nextCursor } = await listRecords(ctx.db, {
          speciesId: q.speciesId,
          traitId: q.traitId,
          referenceId: q.referenceId,
          cursor: q.cursor,
          limit: q.limit,
        });
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .get(
      '/:id',
      requirePermission(ctx, 'dataset.read'),
      validate('param', idParamSchema),
      async (c) => {
        const found = await getRecord(ctx.db, c.req.valid('param').id);
        if (!found) throw new AppError('RECORD_NOT_FOUND', 'Record not found');
        return c.json({ data: found });
      },
    );
}
