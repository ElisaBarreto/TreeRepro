import {
  approveProposalBodySchema,
  createProposalBodySchema,
  cursorQuerySchema,
  idParamSchema,
  listProposalsQuerySchema,
  rejectProposalBodySchema,
} from '@treerepro/contracts';
import { Hono } from 'hono';
import { visibilityOf } from '../../../access/visibility.ts';
import type { AuthContext } from '../../../auth/context.ts';
import {
  approveProposal,
  createProposal,
  getProposal,
  listMyProposals,
  listProposals,
  rejectProposal,
} from '../../../dataset/proposals.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';
import { validate } from '../../validate.ts';

/**
 * Mounted inside `speciesRoutes` as `/proposals`, ahead of its `/:id`
 * handlers: RFC-75 R2 and R3 name `/api/species/proposals`, so the router has
 * to sit under `/api/species` and the literal segment has to be registered
 * before the parameter that would otherwise read it as a species id.
 * @rfc RFC-75 R2, R3, R4
 */
export function proposalRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .post(
      '/',
      requirePermission(ctx, 'taxa.propose'),
      validate('json', createProposalBodySchema),
      async (c) => {
        const body = c.req.valid('json');
        const data = await createProposal(
          { db: ctx.db, taxonomy: ctx.taxonomy },
          await visibilityOf(ctx, c),
          { name: body.name, note: body.note, proposerId: currentUser(c).id },
        );
        return c.json({ data }, 201);
      },
    )
    .get(
      '/',
      requirePermission(ctx, 'taxa.manage'),
      validate('query', listProposalsQuerySchema),
      async (c) => {
        const q = c.req.valid('query');
        // RFC-75 R3: the queue is the open proposals unless another status is
        // asked for. The schema leaves the default to the route, as
        // `curation.ts` does for its own list.
        const { data, nextCursor } = await listProposals(ctx.db, {
          status: q.status ?? 'open',
          cursor: q.cursor,
          limit: q.limit,
        });
        return c.json({ data, meta: { nextCursor } });
      },
    )
    .get(
      '/:id',
      requirePermission(ctx, 'taxa.manage'),
      validate('param', idParamSchema),
      async (c) => {
        const found = await getProposal(ctx.db, c.req.valid('param').id);
        if (!found) throw new AppError('PROPOSAL_NOT_FOUND', 'Proposal not found');
        return c.json({ data: found });
      },
    )
    .post(
      '/:id/approve',
      requirePermission(ctx, 'taxa.manage'),
      validate('param', idParamSchema),
      validate('json', approveProposalBodySchema),
      async (c) =>
        c.json({
          data: await approveProposal(ctx.db, {
            id: c.req.valid('param').id,
            body: c.req.valid('json'),
            actorId: currentUser(c).id,
          }),
        }),
    )
    .post(
      '/:id/reject',
      requirePermission(ctx, 'taxa.manage'),
      validate('param', idParamSchema),
      validate('json', rejectProposalBodySchema),
      async (c) =>
        c.json({
          data: await rejectProposal(ctx.db, {
            id: c.req.valid('param').id,
            note: c.req.valid('json').note,
            actorId: currentUser(c).id,
          }),
        }),
    );
}

/**
 * `GET /api/me/proposals`. It lives beside the proposals router rather than
 * in `meRoutes` for the reason the contributions router does: it carries a
 * permission (`taxa.propose`), which makes it a dataset read and not
 * self-service (RFC-32 R5).
 * @rfc RFC-75 R5
 */
export function myProposalRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>().get(
    '/proposals',
    requirePermission(ctx, 'taxa.propose'),
    validate('query', cursorQuerySchema),
    async (c) => {
      const q = c.req.valid('query');
      const { data, nextCursor } = await listMyProposals(ctx.db, currentUser(c).id, {
        cursor: q.cursor,
        limit: q.limit,
      });
      return c.json({ data, meta: { nextCursor } });
    },
  );
}
