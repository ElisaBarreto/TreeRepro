import {
  createLevelBodySchema,
  createTraitBodySchema,
  idParamSchema,
  traitLevelParamSchema,
  updateLevelBodySchema,
  updateTraitBodySchema,
} from '@treerepro/contracts';
import { Hono } from 'hono';
import { visibilityOf } from '../../../access/visibility.ts';
import type { AuthContext } from '../../../auth/context.ts';
import { createLevel, createTrait, updateLevel, updateTrait } from '../../../dataset/catalog.ts';
import { getDictionary } from '../../../dataset/dictionary.ts';
import type { AppEnv } from '../../env.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';
import { validate } from '../../validate.ts';

/**
 * @rfc RFC-62 R5, R6
 * @rfc RFC-33 R2, R3
 */
export function traitRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get('/', requirePermission(ctx, 'dataset.read'), async (c) => {
      const visibility = await visibilityOf(ctx, c);
      return c.json({ data: await getDictionary(ctx.db, visibility) });
    })
    .post(
      '/',
      requirePermission(ctx, 'traits.manage'),
      validate('json', createTraitBodySchema),
      async (c) =>
        c.json(
          {
            data: await createTrait(ctx.db, { ...c.req.valid('json'), actorId: currentUser(c).id }),
          },
          201,
        ),
    )
    .patch(
      '/:id',
      requirePermission(ctx, 'traits.manage'),
      validate('param', idParamSchema),
      validate('json', updateTraitBodySchema),
      async (c) =>
        c.json({
          data: await updateTrait(ctx.db, {
            id: c.req.valid('param').id,
            ...c.req.valid('json'),
            actorId: currentUser(c).id,
          }),
        }),
    )
    .post(
      '/:id/levels',
      requirePermission(ctx, 'traits.manage'),
      validate('param', idParamSchema),
      validate('json', createLevelBodySchema),
      async (c) =>
        c.json(
          {
            data: await createLevel(ctx.db, {
              traitId: c.req.valid('param').id,
              ...c.req.valid('json'),
              actorId: currentUser(c).id,
            }),
          },
          201,
        ),
    )
    .patch(
      '/:id/levels/:levelId',
      requirePermission(ctx, 'traits.manage'),
      validate('param', traitLevelParamSchema),
      validate('json', updateLevelBodySchema),
      async (c) => {
        const { id, levelId } = c.req.valid('param');
        return c.json({
          data: await updateLevel(ctx.db, {
            traitId: id,
            levelId,
            ...c.req.valid('json'),
            actorId: currentUser(c).id,
          }),
        });
      },
    );
}
