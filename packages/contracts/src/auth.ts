import { z } from 'zod';

/** @rfc RFC-20 R2 */
export const USER_STATUSES = ['invited', 'active', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** @rfc RFC-20 R3 */
export const emailSchema = z.email().max(254);

/**
 * Length cap only; the minimum length and the breach check are policy
 * (RFC-21 R2) and answer AUTH_PASSWORD_WEAK from the API.
 * @rfc RFC-21 R2
 */
export const passwordSchema = z.string().max(128);

/** 32 random bytes in base64url. @rfc RFC-20 R5 */
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** @rfc RFC-23 R1 */
export const totpCodeSchema = z.string().regex(/^\d{6}$/);

/** @rfc RFC-23 R5 */
export const recoveryCodeSchema = z.string().regex(/^[A-Za-z2-7]{5}-?[A-Za-z2-7]{5}$/);

/** @rfc RFC-22 R2 */
export const loginBodySchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

/** @rfc RFC-23 R6 */
export const loginTotpBodySchema = z.union([
  z.strictObject({ code: totpCodeSchema }),
  z.strictObject({ recoveryCode: recoveryCodeSchema }),
]);

/** @rfc RFC-20 R6 */
export const inviteAcceptBodySchema = z.strictObject({
  token: tokenSchema,
  password: passwordSchema,
});

/** @rfc RFC-21 R5 */
export const forgotPasswordBodySchema = z.strictObject({ email: emailSchema });

/** @rfc RFC-21 R6 */
export const resetPasswordBodySchema = z.strictObject({
  token: tokenSchema,
  newPassword: passwordSchema,
});

/** @rfc RFC-21 R7 */
export const changePasswordBodySchema = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

/** @rfc RFC-23 R3 */
export const totpConfirmBodySchema = z.strictObject({ code: totpCodeSchema });

/** @rfc RFC-23 R7 */
export const totpDisableBodySchema = z.union([
  z.strictObject({ password: z.string().min(1).max(128), code: totpCodeSchema }),
  z.strictObject({ password: z.string().min(1).max(128), recoveryCode: recoveryCodeSchema }),
]);

/** @rfc RFC-22 R10 */
export const authUserSchema = z.strictObject({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  status: z.enum(USER_STATUSES),
  totpEnabled: z.boolean(),
  createdAt: z.iso.datetime(),
});

/** @rfc RFC-22 R3 */
export const loginResponseSchema = z.union([
  z.strictObject({ status: z.literal('ok'), user: authUserSchema }),
  z.strictObject({ status: z.literal('totp_required') }),
]);

/** @rfc RFC-22 R10 */
export const meResponseSchema = z.strictObject({
  user: authUserSchema,
  permissions: z.array(z.string()),
});

/** @rfc RFC-22 R11 */
export const sessionSummarySchema = z.strictObject({
  id: z.string(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  ip: z.string(),
  userAgent: z.string(),
  current: z.boolean(),
});

/** @rfc RFC-23 R2 */
export const totpSetupResponseSchema = z.strictObject({
  secret: z.string(),
  otpauthUri: z.string(),
});

/** @rfc RFC-23 R3 */
export const totpConfirmResponseSchema = z.strictObject({
  recoveryCodes: z.array(z.string()).length(10),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
export type LoginTotpBody = z.infer<typeof loginTotpBodySchema>;
export type InviteAcceptBody = z.infer<typeof inviteAcceptBodySchema>;
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;
export type TotpConfirmBody = z.infer<typeof totpConfirmBodySchema>;
export type TotpDisableBody = z.infer<typeof totpDisableBodySchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type TotpSetupResponse = z.infer<typeof totpSetupResponseSchema>;
export type TotpConfirmResponse = z.infer<typeof totpConfirmResponseSchema>;
