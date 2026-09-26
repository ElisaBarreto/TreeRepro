import {
  type ApiEndpoint,
  type ApiKeyList,
  apiEndpointListSchema,
  apiKeyListSchema,
  type CreateApiKeyBody,
  type CreateApiKeyResponse,
  createApiKeyResponseSchema,
  dataEnvelopeSchema,
  okStatusSchema,
  type SessionSummary,
  sessionSummarySchema,
  type UpdateMeBody,
  type User,
  userSchema,
} from '@treerepro/contracts';
import { z } from 'zod';
import { apiFetch } from './client.ts';

/** @rfc RFC-50 R11 */
export async function updateName(name: string): Promise<User> {
  const body: UpdateMeBody = { name };
  const { data } = await apiFetch('/me', dataEnvelopeSchema(userSchema), {
    method: 'PATCH',
    json: body,
  });
  return data;
}

/** @rfc RFC-22 R11 */
export async function listSessions(): Promise<SessionSummary[]> {
  const { data } = await apiFetch(
    '/me/sessions',
    dataEnvelopeSchema(z.array(sessionSummarySchema)),
  );
  return data;
}

/** @rfc RFC-22 R11 */
export async function revokeSession(id: string): Promise<void> {
  await apiFetch(`/me/sessions/${id}`, dataEnvelopeSchema(okStatusSchema), { method: 'DELETE' });
}

/** @rfc RFC-82 R7 */
export async function listApiKeys(): Promise<ApiKeyList> {
  const { data } = await apiFetch('/me/api-keys', dataEnvelopeSchema(apiKeyListSchema));
  return data;
}

/** @rfc RFC-82 R22 */
export async function listApiKeyEndpoints(): Promise<ApiEndpoint[]> {
  const { data } = await apiFetch(
    '/me/api-keys/endpoints',
    dataEnvelopeSchema(apiEndpointListSchema),
  );
  return data;
}

/** @rfc RFC-82 R2 */
export async function createApiKey(body: CreateApiKeyBody): Promise<CreateApiKeyResponse> {
  const { data } = await apiFetch('/me/api-keys', dataEnvelopeSchema(createApiKeyResponseSchema), {
    method: 'POST',
    json: body,
  });
  return data;
}

/** @rfc RFC-82 R7 */
export async function revokeApiKey(id: string): Promise<void> {
  await apiFetch(`/me/api-keys/${id}`, dataEnvelopeSchema(okStatusSchema), { method: 'DELETE' });
}
