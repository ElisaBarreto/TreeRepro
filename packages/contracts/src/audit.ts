import { z } from 'zod';
import { cursorQuerySchema } from './pagination.ts';

/**
 * The RFC-41 catalog, in the table's order.
 * @rfc RFC-41 R3
 * @rfc RFC-74 R5
 */
export const AUDIT_ACTIONS = [
  'auth.login.success',
  'auth.login.failure',
  'auth.login.totp_failure',
  'auth.logout',
  'auth.logout_all',
  'auth.session.revoked',
  'auth.invite.created',
  'auth.invite.accepted',
  'auth.password.reset_requested',
  'auth.password.reset',
  'auth.password.changed',
  'auth.totp.enabled',
  'auth.totp.disabled',
  'auth.totp.recovery_used',
  'users.created',
  'users.updated',
  'users.roles_changed',
  'users.suspended',
  'users.reactivated',
  'roles.created',
  'roles.updated',
  'roles.deleted',
  'sessions.revoked',
  'admin.accessed',
  'taxa.created',
  'taxa.updated',
  'references.created',
  'references.updated',
  'traits.created',
  'traits.updated',
  'dataset.exported',
  'imports.completed',
  'plots.created',
  'plots.updated',
  'plots.species_added',
  'plots.species_removed',
  'users.plots_changed',
  'digest.sent',
  'proposals.created',
  'proposals.decided',
  'roles.delegation_refused',
  'help.created',
  'help.updated',
  'help.deleted',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const actionSet: ReadonlySet<string> = new Set(AUDIT_ACTIONS);

/** @rfc RFC-41 R3 */
export function isAuditAction(value: string): value is AuditAction {
  return actionSet.has(value);
}

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
