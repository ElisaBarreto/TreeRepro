import {
  createRoleBodySchema,
  roleIdParamSchema,
  updateRoleBodySchema,
} from '@treerepro/contracts';
import { Hono } from 'hono';
import { createRole, deleteRole, getRole, listRoles, updateRole } from '../../../access/roles.ts';
import type { AuthContext } from '../../../auth/context.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';
import { validate } from '../../validate.ts';

/** HTTP over the RFC-31 services. @rfc RFC-50 R10 */
export function adminRoleRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get('/', requirePermission(ctx, 'roles.read'), async (c) =>
      c.json({ data: await listRoles(ctx.db) }),
    )
    .post(
      '/',
      requirePermission(ctx, 'roles.manage'),
      validate('json', createRoleBodySchema),
      async (c) => {
        const role = await createRole(ctx, {
          ...c.req.valid('json'),
          actorUserId: currentUser(c).id,
        });
        return c.json({ data: role }, 201);
      },
    )
    .get(
      '/:id',
      requirePermission(ctx, 'roles.read'),
      validate('param', roleIdParamSchema),
      async (c) => {
        const role = await getRole(ctx.db, c.req.valid('param').id);
        if (!role) throw new AppError('ROLE_NOT_FOUND', 'Role not found');
        return c.json({ data: role });
      },
    )
    .patch(
      '/:id',
      requirePermission(ctx, 'roles.manage'),
      validate('param', roleIdParamSchema),
      validate('json', updateRoleBodySchema),
      async (c) => {
        const role = await updateRole(ctx, {
          id: c.req.valid('param').id,
          ...c.req.valid('json'),
          actorUserId: currentUser(c).id,
        });
        return c.json({ data: role });
      },
    )
    .delete(
      '/:id',
      requirePermission(ctx, 'roles.manage'),
      validate('param', roleIdParamSchema),
      async (c) => {
        await deleteRole(ctx, { id: c.req.valid('param').id, actorUserId: currentUser(c).id });
        return c.json({ data: { status: 'ok' as const } });
      },
    );
}
