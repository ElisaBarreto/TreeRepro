import {
  createHelpSectionBodySchema,
  createHelpTopicBodySchema,
  helpSlugParamSchema,
  idParamSchema,
  updateHelpSectionBodySchema,
  updateHelpTopicBodySchema,
} from '@treerepro/contracts';
import { Hono } from 'hono';
import type { AuthContext } from '../../auth/context.ts';
import {
  createHelpSection,
  createHelpTopic,
  deleteHelpSection,
  deleteHelpTopic,
  getHelpTopic,
  listHelpTopics,
  updateHelpSection,
  updateHelpTopic,
} from '../../help/help.ts';
import type { AppEnv } from '../env.ts';
import { requirePermission } from '../middleware/require-permission.ts';
import { currentUser, requireSession } from '../middleware/session.ts';
import { validate } from '../validate.ts';

/**
 * The help pages: read by every signed-in user, written by `help.edit`
 * holders. The `/sections/:id` routes are declared before `/:id` so the
 * router never reads `sections` as a topic id.
 * @rfc RFC-73 R6
 * @rfc RFC-32 R5
 */
export function helpRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get('/', requireSession, async (c) => c.json({ data: await listHelpTopics(ctx.db) }))
    .get('/:slug', requireSession, validate('param', helpSlugParamSchema), async (c) =>
      c.json({ data: await getHelpTopic(ctx.db, c.req.valid('param').slug) }),
    )
    .post(
      '/',
      requirePermission(ctx, 'help.edit'),
      validate('json', createHelpTopicBodySchema),
      async (c) =>
        c.json(
          {
            data: await createHelpTopic(ctx.db, {
              ...c.req.valid('json'),
              actorId: currentUser(c).id,
            }),
          },
          201,
        ),
    )
    .patch(
      '/sections/:id',
      requirePermission(ctx, 'help.edit'),
      validate('param', idParamSchema),
      validate('json', updateHelpSectionBodySchema),
      async (c) =>
        c.json({
          data: await updateHelpSection(ctx.db, {
            ...c.req.valid('json'),
            id: c.req.valid('param').id,
            actorId: currentUser(c).id,
          }),
        }),
    )
    .delete(
      '/sections/:id',
      requirePermission(ctx, 'help.edit'),
      validate('param', idParamSchema),
      async (c) => {
        await deleteHelpSection(ctx.db, {
          id: c.req.valid('param').id,
          actorId: currentUser(c).id,
        });
        return c.json({ data: { status: 'ok' as const } });
      },
    )
    .post(
      '/:id/sections',
      requirePermission(ctx, 'help.edit'),
      validate('param', idParamSchema),
      validate('json', createHelpSectionBodySchema),
      async (c) =>
        c.json(
          {
            data: await createHelpSection(ctx.db, {
              ...c.req.valid('json'),
              topicId: c.req.valid('param').id,
              actorId: currentUser(c).id,
            }),
          },
          201,
        ),
    )
    .patch(
      '/:id',
      requirePermission(ctx, 'help.edit'),
      validate('param', idParamSchema),
      validate('json', updateHelpTopicBodySchema),
      async (c) =>
        c.json({
          data: await updateHelpTopic(ctx.db, {
            ...c.req.valid('json'),
            id: c.req.valid('param').id,
            actorId: currentUser(c).id,
          }),
        }),
    )
    .delete(
      '/:id',
      requirePermission(ctx, 'help.edit'),
      validate('param', idParamSchema),
      async (c) => {
        await deleteHelpTopic(ctx.db, { id: c.req.valid('param').id, actorId: currentUser(c).id });
        return c.json({ data: { status: 'ok' as const } });
      },
    );
}
