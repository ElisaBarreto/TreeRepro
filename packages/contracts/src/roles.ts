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
