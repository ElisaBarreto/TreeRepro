import {
  type AuthUser,
  type ChangePasswordBody,
  dataEnvelopeSchema,
  type ForgotPasswordBody,
  forgotPasswordResponseSchema,
  type InviteAcceptBody,
  inviteAcceptResponseSchema,
  type LoginBody,
  type LoginResponse,
  type LoginTotpBody,
  loginResponseSchema,
  type MeResponse,
  meResponseSchema,
  okStatusSchema,
  type ResetPasswordBody,
  type SignedIn,
  signedInSchema,
  type TotpConfirmBody,
  type TotpDisableBody,
  type TotpSetupBody,
  type TotpSetupResponse,
  totpConfirmResponseSchema,
  totpSetupResponseSchema,
} from '@treerepro/contracts';
import { apiFetch } from './client.ts';

const SIX_DIGITS = /^\d{6}$/;

const signedInEnvelope = dataEnvelopeSchema(signedInSchema);
const okEnvelope = dataEnvelopeSchema(okStatusSchema);

/** @rfc RFC-22 R2-R3 */
export async function login(body: LoginBody): Promise<LoginResponse> {
  const { data } = await apiFetch('/auth/login', dataEnvelopeSchema(loginResponseSchema), {
    method: 'POST',
    json: body,
  });
  return data;
}

/**
 * Second login step. Six digits are a TOTP code; anything else is treated as a
 * recovery code so the user needs a single field for both.
 * @rfc RFC-23 R6
 */
export async function loginTotp(codeOrRecoveryCode: string): Promise<SignedIn> {
  const value = codeOrRecoveryCode.trim();
  const body: LoginTotpBody = SIX_DIGITS.test(value) ? { code: value } : { recoveryCode: value };
  const { data } = await apiFetch('/auth/login/totp', signedInEnvelope, {
    method: 'POST',
    json: body,
  });
  return data;
}

/** @rfc RFC-22 R10 */
export async function fetchMe(): Promise<MeResponse> {
  const { data } = await apiFetch('/auth/me', dataEnvelopeSchema(meResponseSchema));
  return data;
}

/** @rfc RFC-22 R9 */
export async function logout(): Promise<void> {
  await apiFetch('/auth/logout', okEnvelope, { method: 'POST' });
}

/** @rfc RFC-20 R6 */
export async function acceptInvite(token: string, password: string): Promise<AuthUser> {
  const body: InviteAcceptBody = { token, password };
  const { data } = await apiFetch(
    '/auth/invite/accept',
    dataEnvelopeSchema(inviteAcceptResponseSchema),
    { method: 'POST', json: body },
  );
  return data.user;
}

/** @rfc RFC-21 R5 */
export async function forgotPassword(email: string): Promise<void> {
  const body: ForgotPasswordBody = { email };
  await apiFetch('/auth/password/forgot', dataEnvelopeSchema(forgotPasswordResponseSchema), {
    method: 'POST',
    json: body,
  });
}

/** @rfc RFC-21 R6 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const body: ResetPasswordBody = { token, newPassword };
  await apiFetch('/auth/password/reset', okEnvelope, { method: 'POST', json: body });
}

/** @rfc RFC-21 R7 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const body: ChangePasswordBody = { currentPassword, newPassword };
  await apiFetch('/auth/password/change', okEnvelope, { method: 'POST', json: body });
}

/** @rfc RFC-23 R2 */
export async function totpSetup(password: string): Promise<TotpSetupResponse> {
  const body: TotpSetupBody = { password };
  const { data } = await apiFetch('/auth/totp/setup', dataEnvelopeSchema(totpSetupResponseSchema), {
    method: 'POST',
    json: body,
  });
  return data;
}

/** Returns the ten recovery codes, shown once. @rfc RFC-23 R3, R5 */
export async function totpConfirm(code: string): Promise<string[]> {
  const body: TotpConfirmBody = { code };
  const { data } = await apiFetch(
    '/auth/totp/confirm',
    dataEnvelopeSchema(totpConfirmResponseSchema),
    { method: 'POST', json: body },
  );
  return data.recoveryCodes;
}

/** @rfc RFC-23 R7 */
export async function totpDisable(body: TotpDisableBody): Promise<void> {
  await apiFetch('/auth/totp/disable', okEnvelope, { method: 'POST', json: body });
}

/** @rfc RFC-22 R9 */
export async function logoutAll(): Promise<void> {
  await apiFetch('/auth/logout-all', okEnvelope, { method: 'POST' });
}
