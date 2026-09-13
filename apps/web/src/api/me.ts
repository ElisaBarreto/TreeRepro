import type { DataEnvelope, SessionSummary, UpdateMeBody, User } from '@treerepro/contracts';
import { apiFetch } from './client.ts';

/** @rfc RFC-50 R11 */
export async function updateName(name: string): Promise<User> {
  const body: UpdateMeBody = { name };
  const { data } = await apiFetch<DataEnvelope<User>>('/me', { method: 'PATCH', json: body });
  return data;
}

/** @rfc RFC-22 R11 */
export async function listSessions(): Promise<SessionSummary[]> {
  const { data } = await apiFetch<DataEnvelope<SessionSummary[]>>('/me/sessions');
  return data;
}

/** @rfc RFC-22 R11 */
export async function revokeSession(id: string): Promise<void> {
  await apiFetch(`/me/sessions/${id}`, { method: 'DELETE' });
}
