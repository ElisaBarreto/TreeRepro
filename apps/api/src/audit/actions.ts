/** @rfc RFC-41 R3 */
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
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
