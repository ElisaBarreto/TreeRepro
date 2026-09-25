import { z } from 'zod';
import { emailSchema, USER_STATUSES } from './auth.ts';
import { cursorQuerySchema } from './pagination.ts';
import { plotRefSchema } from './plots.ts';

/** @rfc RFC-50 R1 */
export const nameSchema = z.string().trim().min(1).max(120);

/** @rfc RFC-50 R1 */
export const userRoleRefSchema = z.strictObject({ id: z.uuid(), name: z.string() });

/**
 * @rfc RFC-50 R1
 * @rfc RFC-67 R6
 */
export const userSchema = z.strictObject({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  status: z.enum(USER_STATUSES),
  totpEnabled: z.boolean(),
  roles: z.array(userRoleRefSchema),
  plots: z.array(plotRefSchema),
  restrictToAssignedPlots: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  suspendedAt: z.iso.datetime().nullable(),
});

/** @rfc RFC-50 R4 */
export const userIdParamSchema = z.strictObject({ id: z.uuid() });

/** @rfc RFC-50 R2 */
export const listUsersQuerySchema = cursorQuerySchema.extend({
  status: z.enum(USER_STATUSES).optional(),
});

/** @rfc RFC-50 R3 */
export const createUserBodySchema = z.strictObject({
  email: emailSchema,
  name: nameSchema,
  roles: z.array(z.uuid()).min(1).max(100),
});

/** @rfc RFC-50 R5 */
export const updateUserBodySchema = z
  .strictObject({
    name: nameSchema.optional(),
    roles: z.array(z.uuid()).max(100).optional(),
  })
  .refine((body) => body.name !== undefined || body.roles !== undefined, {
    message: 'At least one of name and roles is required',
  });

/**
 * @rfc RFC-50 R13
 * @rfc RFC-67 R6
 */
export const setUserPlotsBodySchema = z
  .strictObject({
    plotIds: z.array(z.uuid()).max(100),
    restrictToAssignedPlots: z.boolean(),
  })
  .refine((b) => !b.restrictToAssignedPlots || b.plotIds.length > 0, {
    path: ['plotIds'],
    message: 'A restricted user needs at least one plot',
  });

/** @rfc RFC-50 R11 */
export const updateMeBodySchema = z.strictObject({ name: nameSchema });

export type User = z.infer<typeof userSchema>;
export type UserRoleRef = z.infer<typeof userRoleRefSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type CreateUserBody = z.infer<typeof createUserBodySchema>;
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;
export type SetUserPlotsBody = z.infer<typeof setUserPlotsBodySchema>;
export type UpdateMeBody = z.infer<typeof updateMeBodySchema>;
