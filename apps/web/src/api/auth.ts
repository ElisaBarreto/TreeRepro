import type {
  AuthUser,
  ChangePasswordBody,
  DataEnvelope,
  ForgotPasswordBody,
  InviteAcceptBody,
  LoginBody,
  LoginResponse,
  LoginTotpBody,
  MeResponse,
  ResetPasswordBody,
} from '@treerepro/contracts';
import { apiFetch } from './client.ts';

const SIX_DIGITS = /^\d{6}$/;

/** @rfc RFC-22 R2-R3 */
export async function login(body: LoginBody): Promise<LoginResponse> {
  const { data } = await apiFetch<DataEnvelope<LoginResponse>>('/auth/login', {
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
export async function loginTotp(
  codeOrRecoveryCode: string,
): Promise<{ status: 'ok'; user: AuthUser }> {
  const value = codeOrRecoveryCode.trim();
  const body: LoginTotpBody = SIX_DIGITS.test(value) ? { code: value } : { recoveryCode: value };
  const { data } = await apiFetch<DataEnvelope<{ status: 'ok'; user: AuthUser }>>(
    '/auth/login/totp',
    { method: 'POST', json: body },
  );
  return data;
}

/** @rfc RFC-22 R10 */
export async function fetchMe(): Promise<MeResponse> {
  const { data } = await apiFetch<DataEnvelope<MeResponse>>('/auth/me');
  return data;
}

/** @rfc RFC-22 R9 */
export async function logout(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' });
}

/** @rfc RFC-20 R6 */
export async function acceptInvite(token: string, password: string): Promise<AuthUser> {
  const body: InviteAcceptBody = { token, password };
  const { data } = await apiFetch<DataEnvelope<{ status: 'ok'; user: AuthUser }>>(
    '/auth/invite/accept',
    { method: 'POST', json: body },
  );
  return data.user;
}

/** @rfc RFC-21 R5 */
export async function forgotPassword(email: string): Promise<void> {
  const body: ForgotPasswordBody = { email };
  await apiFetch('/auth/password/forgot', { method: 'POST', json: body });
}

/** @rfc RFC-21 R6 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const body: ResetPasswordBody = { token, newPassword };
  await apiFetch('/auth/password/reset', { method: 'POST', json: body });
}

/** @rfc RFC-21 R7 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const body: ChangePasswordBody = { currentPassword, newPassword };
  await apiFetch('/auth/password/change', { method: 'POST', json: body });
}
