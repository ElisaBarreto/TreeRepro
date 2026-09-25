import {
  type CreateHelpSectionBody,
  type CreateHelpTopicBody,
  dataEnvelopeSchema,
  type HelpSection,
  type HelpTopic,
  type HelpTopicSummary,
  helpSectionSchema,
  helpTopicSchema,
  helpTopicSummarySchema,
  okStatusSchema,
  type UpdateHelpSectionBody,
  type UpdateHelpTopicBody,
} from '@treerepro/contracts';
import { z } from 'zod';
import { apiFetch } from './client.ts';

/** Query keys of the help pages; every write invalidates `['help']`. @rfc RFC-73 R6 */
export const helpKeys = {
  all: ['help'] as const,
  index: () => ['help', 'index'] as const,
  topic: (slug: string) => ['help', 'topic', slug] as const,
};

/** @rfc RFC-73 R6 */
export async function fetchHelpTopics(): Promise<HelpTopicSummary[]> {
  return (await apiFetch('/help', dataEnvelopeSchema(z.array(helpTopicSummarySchema)))).data;
}

/** @rfc RFC-73 R6 */
export async function fetchHelpTopic(slug: string): Promise<HelpTopic> {
  return (await apiFetch(`/help/${encodeURIComponent(slug)}`, dataEnvelopeSchema(helpTopicSchema)))
    .data;
}

/** @rfc RFC-73 R6 */
export async function createHelpTopic(body: CreateHelpTopicBody): Promise<HelpTopic> {
  return (
    await apiFetch('/help', dataEnvelopeSchema(helpTopicSchema), { method: 'POST', json: body })
  ).data;
}

/** @rfc RFC-73 R6 */
export async function updateHelpTopic(id: string, body: UpdateHelpTopicBody): Promise<HelpTopic> {
  return (
    await apiFetch(`/help/${id}`, dataEnvelopeSchema(helpTopicSchema), {
      method: 'PATCH',
      json: body,
    })
  ).data;
}

/** @rfc RFC-73 R6 */
export async function deleteHelpTopic(id: string): Promise<void> {
  await apiFetch(`/help/${id}`, dataEnvelopeSchema(okStatusSchema), { method: 'DELETE' });
}

/** @rfc RFC-73 R6 */
export async function createHelpSection(
  topicId: string,
  body: CreateHelpSectionBody,
): Promise<HelpSection> {
  return (
    await apiFetch(`/help/${topicId}/sections`, dataEnvelopeSchema(helpSectionSchema), {
      method: 'POST',
      json: body,
    })
  ).data;
}

/** @rfc RFC-73 R6 */
export async function updateHelpSection(
  id: string,
  body: UpdateHelpSectionBody,
): Promise<HelpSection> {
  return (
    await apiFetch(`/help/sections/${id}`, dataEnvelopeSchema(helpSectionSchema), {
      method: 'PATCH',
      json: body,
    })
  ).data;
}

/** @rfc RFC-73 R6 */
export async function deleteHelpSection(id: string): Promise<void> {
  await apiFetch(`/help/sections/${id}`, dataEnvelopeSchema(okStatusSchema), { method: 'DELETE' });
}
