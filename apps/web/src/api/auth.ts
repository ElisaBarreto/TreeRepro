import type {
  AuthUser,
  DataEnvelope,
  LoginBody,
  LoginResponse,
  LoginTotpBody,
  MeResponse,
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
