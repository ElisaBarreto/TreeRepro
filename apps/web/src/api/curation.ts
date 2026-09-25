import type { QueryClient } from '@tanstack/react-query';
import {
  type AnnotateRecordBody,
  type CreateRecordBody,
  type CreateRecordsResult,
  createRecordsResultSchema,
  dataEnvelopeSchema,
  disputedRecordSchema,
  listEnvelopeSchema,
  type MapPendingBody,
  type MapResult,
  mapResultSchema,
  type PendingTrait,
  pendingGroupSchema,
  pendingTraitSchema,
  type RecordDetail,
  type ResolveDoiResult,
  recordDetailSchema,
  resolveDoiResultSchema,
} from '@treerepro/contracts';
import { z } from 'zod';
import { apiFetch } from './client.ts';
import { withQuery } from './query.ts';

/**
 * Query keys of the curation screens, nested under the dataset prefixes so
 * one invalidation covers both. `disputed` takes the filters (RFC-65 R10
 * amended by plan 11b: `intent`) so switching `?intent=contest` on and off
 * is its own cache entry and its own page-1 reset, the same as every other
 * filtered list in the app.
 * @rfc RFC-65 R8, R10
 */
export const curationKeys = {
  pendingTraits: ['records', 'pending', 'traits'] as const,
  pendingGroups: (traitId: string) => ['records', 'pending', 'groups', traitId] as const,
  disputed: (params: { intent?: 'contest' }) => ['records', 'disputed', params] as const,
};

/** The file download of RFC-66; a plain link, the session cookie authenticates it. @rfc RFC-66 R1 */
export const EXPORT_ACCEPTED_URL = '/api/export/accepted.csv';

/** @rfc RFC-70 R1, R3 */
export async function createRecords(body: CreateRecordBody): Promise<CreateRecordsResult> {
  return (
    await apiFetch('/records', dataEnvelopeSchema(createRecordsResultSchema), {
      method: 'POST',
      json: body,
    })
  ).data;
}
/** @rfc RFC-80 R4 */
export async function resolveDoi(doi: string): Promise<ResolveDoiResult> {
  return (
    await apiFetch(
      withQuery('/references/resolve', { doi }),
      dataEnvelopeSchema(resolveDoiResultSchema),
    )
  ).data;
}
/** @rfc RFC-65 R3 */
export async function annotateRecord(id: string, body: AnnotateRecordBody): Promise<RecordDetail> {
  return (
    await apiFetch(`/records/${id}/annotations`, dataEnvelopeSchema(recordDetailSchema), {
      method: 'POST',
      json: body,
    })
  ).data;
}
/** @rfc RFC-65 R8 */
export async function fetchPendingTraits(): Promise<PendingTrait[]> {
  return (
    await apiFetch('/records/pending/traits', dataEnvelopeSchema(z.array(pendingTraitSchema)))
  ).data;
}
/** @rfc RFC-65 R8 */
export function fetchPendingGroups(params: { traitId: string; cursor?: string; limit?: number }) {
  return apiFetch(withQuery('/records/pending', params), listEnvelopeSchema(pendingGroupSchema));
}
/** @rfc RFC-65 R9 */
export async function mapPending(body: MapPendingBody): Promise<MapResult> {
  return (
    await apiFetch('/records/pending/map', dataEnvelopeSchema(mapResultSchema), {
      method: 'POST',
      json: body,
    })
  ).data;
}
/** `intent: 'contest'` narrows the queue to disputes a contest generated. @rfc RFC-65 R10 */
export function fetchDisputed(params: { cursor?: string; limit?: number; intent?: 'contest' }) {
  return apiFetch(withQuery('/records/disputed', params), listEnvelopeSchema(disputedRecordSchema));
}

/**
 * After a record, annotation or mapping write: every record list,
 * detail and queue (`['records', …]`) and the species' summary and detail
 * (`['species', id, …]`) are stale. Without a species id (bulk mapping) every
 * species query is.
 * @rfc RFC-13 R6
 */
export async function invalidateAfterRecordWrite(
  queryClient: QueryClient,
  speciesId?: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['records'] }),
    queryClient.invalidateQueries({ queryKey: speciesId ? ['species', speciesId] : ['species'] }),
  ]);
}
