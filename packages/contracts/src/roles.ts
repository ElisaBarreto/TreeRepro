import { z } from 'zod';
import { PERMISSION_KEYS } from './permissions.ts';

const permissionKeySchema = z.enum(PERMISSION_KEYS as [string, ...string[]]);

/** @rfc RFC-31 R3 */
export const roleNameSchema = z.string().trim().min(1).max(64);

/** @rfc RFC-31 R1 */
export const roleSchema = z.strictObject({
  id: z.uuid(),
  name: roleNameSchema,
  description: z.string(),
  isSystem: z.boolean(),
  permissions: z.array(permissionKeySchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** @rfc RFC-30 R5 */
export const permissionEntrySchema = z.strictObject({
  key: permissionKeySchema,
  description: z.string().min(1),
});

export type Role = z.infer<typeof roleSchema>;
export type PermissionEntry = z.infer<typeof permissionEntrySchema>;

/** Keys are validated against the catalog by the service (RFC-31 R3). */
const permissionListSchema = z.array(z.string().min(1).max(64)).max(100);

/** @rfc RFC-50 R10 */
export const roleIdParamSchema = z.strictObject({ id: z.uuid() });

/** @rfc RFC-50 R10 */
export const createRoleBodySchema = z.strictObject({
  name: roleNameSchema,
  description: z.string().max(500).default(''),
  permissions: permissionListSchema,
});

/** @rfc RFC-50 R10 */
export const updateRoleBodySchema = z
  .strictObject({
    name: roleNameSchema.optional(),
    description: z.string().max(500).optional(),
    permissions: permissionListSchema.optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined || body.description !== undefined || body.permissions !== undefined,
    { message: 'At least one field is required' },
  );

export type CreateRoleBody = z.infer<typeof createRoleBodySchema>;
export type UpdateRoleBody = z.infer<typeof updateRoleBodySchema>;
