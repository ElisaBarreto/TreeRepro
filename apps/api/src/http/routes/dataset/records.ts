import {
  annotateRecordBodySchema,
  createRecordBodySchema,
  idParamSchema,
  listDisputedQuerySchema,
  listRecordsQuerySchema,
  mapPendingBodySchema,
  pendingGroupsQuerySchema,
} from '@treerepro/contracts';
import { Hono } from 'hono';
import { visibilityOf } from '../../../access/visibility.ts';
import type { AuthContext } from '../../../auth/context.ts';
import { annotateRecord, createRecords } from '../../../dataset/curation.ts';
import { listDisputed, mapPending, pendingGroups, pendingTraits } from '../../../dataset/queues.ts';
import { getRecord, listRecords } from '../../../dataset/records.ts';
import { resolveSourceRef, resolveSources } from '../../../dataset/sources.ts';
import { forgetCached } from '../../../redis/cache.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { currentPermissions, requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';
import { validate } from '../../validate.ts';

/**
 * @rfc RFC-63 R8, R9
 * @rfc RFC-65 R1, R2, R3, R4
 * @rfc RFC-65 R7-R9
 * @rfc RFC-70 R1-R6
 * @rfc RFC-33 R2-R5
 */
export function recordRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .post(
      '/',
      requirePermission(ctx, 'records.create'),
      validate('json', createRecordBodySchema),
      async (c) => {
        const body = c.req.valid('json');
        const actor = currentUser(c);
        const visibility = await visibilityOf(ctx, c);
        const referenceIds = await resolveSources(
          { db: ctx.db, doi: ctx.doi },
          actor.id,
          body.sources,
        );
        const result = await createRecords(ctx.db, visibility, {
          speciesId: body.speciesId,
          traitId: body.traitId,
          value: body.value,
          referenceIds,
          intent: body.intent,
          respondsToRecordId: body.respondsToRecordId,
          rawValue: body.rawValue,
          note: body.note,
          secondaryReferenceId: body.secondaryReferenceId,
          actorId: actor.id,
        });
        // After the transaction, never inside the service: the dashboard's
        // contributor section counts what was just written, and the services
        // stay free of Redis (RFC-72 R1).
        await forgetCached(ctx.redis, `dashboard:${actor.id}`);
        return c.json({ data: result }, 201);
      },
    )
    .post(
      '/:id/annotations',
      requirePermission(ctx, 'records.annotate'),
      validate('param', idParamSchema),
      validate('json', annotateRecordBodySchema),
      async (c) => {
        const body = c.req.valid('json');
        const actor = currentUser(c);
        const visibility = await visibilityOf(ctx, c);
        const referenceId = body.reference
          ? await resolveSourceRef(
              { db: ctx.db, doi: ctx.doi },
              actor.id,
              body.reference,
              'reference',
            )
          : undefined;
        const record = await annotateRecord(ctx.db, visibility, {
          recordId: c.req.valid('param').id,
          kind: body.kind,
          note: body.note,
          referenceId,
          actorId: actor.id,
          canWithdrawAny: currentPermissions(c).has('records.withdraw'),
          canReview: currentPermissions(c).has('records.review'),
        });
        await forgetCached(ctx.redis, `dashboard:${actor.id}`);
        return c.json({ data: record }, 201);
      },
    )
    .get(
      '/',
      requirePermission(ctx, 'dataset.read'),
      validate('query', listRecordsQuerySchema),
      async (c) => {
        const q = c.req.valid('query');
        const visibility = await visibilityOf(ctx, c);
        const { data, nextCursor } = await listRecords(ctx.db, visibility, {
          speciesId: q.speciesId,
          traitId: q.traitId,
          referenceId: q.referenceId,
          cursor: q.cursor,
          limit: q.limit,
        });
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .get('/pending/traits', requirePermission(ctx, 'records.review'), async (c) => {
      const visibility = await visibilityOf(ctx, c);
      return c.json({ data: await pendingTraits(ctx.db, visibility) });
    })
    .get(
      '/pending',
      requirePermission(ctx, 'records.review'),
      validate('query', pendingGroupsQuerySchema),
      async (c) => {
        const q = c.req.valid('query');
        const visibility = await visibilityOf(ctx, c);
        const { data, nextCursor } = await pendingGroups(ctx.db, visibility, {
          traitId: q.traitId,
          cursor: q.cursor,
          limit: q.limit,
        });
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .post(
      '/pending/map',
      requirePermission(ctx, 'records.review'),
      validate('json', mapPendingBodySchema),
      async (c) => {
        const visibility = await visibilityOf(ctx, c);
        const result = await mapPending(ctx.db, visibility, {
          ...c.req.valid('json'),
          actorId: currentUser(c).id,
        });
        return c.json({ data: result });
      },
    )
    .get(
      '/disputed',
      requirePermission(ctx, 'records.review'),
      validate('query', listDisputedQuerySchema),
      async (c) => {
        const q = c.req.valid('query');
        const visibility = await visibilityOf(ctx, c);
        const { data, nextCursor } = await listDisputed(ctx.db, visibility, {
          cursor: q.cursor,
          limit: q.limit,
          intent: q.intent,
        });
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .get(
      '/:id',
      requirePermission(ctx, 'dataset.read'),
      validate('param', idParamSchema),
      async (c) => {
        const visibility = await visibilityOf(ctx, c);
        const found = await getRecord(ctx.db, visibility, c.req.valid('param').id);
        if (!found) throw new AppError('RECORD_NOT_FOUND', 'Record not found');
        return c.json({ data: found });
      },
    );
}
