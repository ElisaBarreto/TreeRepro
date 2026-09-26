import type { QueryClient } from '@tanstack/react-query';
import {
  type AnnotateRecordBody,
  type CreateRecordBody,
  type CreateRecordsResult,
  contestedQueueItemSchema,
  createRecordsResultSchema,
  dataEnvelopeSchema,
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
  type WithdrawLevelResult,
  withdrawLevelResultSchema,
} from '@treerepro/contracts';
import { z } from 'zod';
import { apiFetch } from './client.ts';
import { withQuery } from './query.ts';

/**
 * Query keys of the curation screens, nested under the dataset prefixes so
 * one invalidation (`invalidateAfterRecordWrite`'s `['records']`) covers all
 * of them.
 * @rfc RFC-65 R8, R10
 */
export const curationKeys = {
  pendingTraits: ['records', 'pending', 'traits'] as const,
  pendingGroups: (traitId: string) => ['records', 'pending', 'groups', traitId] as const,
  contested: ['records', 'contested'] as const,
};

/** The file download of RFC-66; a plain link, the session cookie authenticates it. @rfc RFC-66 R8 */
export const EXPORT_RECORDS_URL = '/api/export/records.csv';

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
/**
 * `null` when the annotation withdrew the record: a withdrawn record is
 * visible to no viewer (RFC-33 R2), so the API answers `200 { data: null }`
 * rather than a detail (plan 13g amendment 2).
 * @rfc RFC-65 R3, R4
 * @rfc RFC-33 R2
 */
export async function annotateRecord(
  id: string,
  body: AnnotateRecordBody,
): Promise<RecordDetail | null> {
  return (
    await apiFetch(
      `/records/${id}/annotations`,
      dataEnvelopeSchema(recordDetailSchema.nullable()),
      {
        method: 'POST',
        json: body,
      },
    )
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
/** The open contests, newest first (the path predates them). @rfc RFC-65 R10 */
export function fetchContested(params: { cursor?: string; limit?: number }) {
  return apiFetch(
    withQuery('/records/disputed', params),
    listEnvelopeSchema(contestedQueueItemSchema),
  );
}

/**
 * Withdraw a level; `remaining` lists the records the actor may not withdraw.
 * @rfc RFC-65 R14
 */
export async function withdrawLevel(
  speciesId: string,
  traitId: string,
  levelId: string,
): Promise<WithdrawLevelResult> {
  return (
    await apiFetch(
      `/species/${speciesId}/traits/${traitId}/levels/${levelId}/withdraw`,
      dataEnvelopeSchema(withdrawLevelResultSchema),
      { method: 'POST' },
    )
  ).data;
}
/** Keep both. @rfc RFC-65 R16 */
export async function resolveContest(id: string): Promise<void> {
  await apiFetch(`/contests/${id}/resolve`, dataEnvelopeSchema(z.null()), { method: 'POST' });
}
/** Withdraw contest. @rfc RFC-65 R16 */
export async function withdrawContest(id: string): Promise<void> {
  await apiFetch(`/contests/${id}/withdraw`, dataEnvelopeSchema(z.null()), { method: 'POST' });
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
