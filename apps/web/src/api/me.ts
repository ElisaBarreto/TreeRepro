import {
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
