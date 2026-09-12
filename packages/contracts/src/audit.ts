import { z } from 'zod';
import { cursorQuerySchema } from './pagination.ts';

/** `<domain>.<event>` (RFC-41 R3); membership in the catalog is checked by the API. */
const actionKeySchema = z.string().regex(/^[a-z_]+(?:\.[a-z_]+)+$/);

/** @rfc RFC-51 R2 */
export const auditLogEntrySchema = z.strictObject({
  id: z.uuid(),
  at: z.iso.datetime(),
  actorUserId: z.uuid().nullable(),
  action: actionKeySchema,
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

/** @rfc RFC-51 R1, R4 */
export const auditQuerySchema = cursorQuerySchema
  .extend({
    actor: z.uuid().optional(),
    action: actionKeySchema.optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to), {
    message: 'from must not be later than to',
    path: ['from'],
  });

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;
