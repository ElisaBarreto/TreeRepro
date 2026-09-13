import type { QueryClient } from '@tanstack/react-query';
import type {
  AcceptedState,
  AnnotateRecordBody,
  CreateRecordBody,
  CreateReferenceBody,
  DataEnvelope,
  DisputedRecord,
  MapPendingBody,
  MapResult,
  PendingGroup,
  PendingTrait,
  RecordDetail,
  ReferenceDetail,
  SetAcceptedBody,
} from '@treerepro/contracts';
import { apiFetch } from './client.ts';
import type { Page } from './dataset.ts';

type Params = Record<string, string | number | undefined>;

function withQuery(path: string, params: Params): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Query keys of the curation screens, nested under the dataset prefixes so one invalidation covers both. @rfc RFC-65 R6, R8, R10 */
export const curationKeys = {
  accepted: (speciesId: string, traitId: string) =>
    ['species', speciesId, 'traits', traitId, 'accepted'] as const,
  pendingTraits: ['records', 'pending', 'traits'] as const,
  pendingGroups: (traitId: string) => ['records', 'pending', 'groups', traitId] as const,
  disputed: ['records', 'disputed'] as const,
};

/** The file download of RFC-66; a plain link, the session cookie authenticates it. @rfc RFC-66 R1 */
export const EXPORT_ACCEPTED_URL = '/api/export/accepted.csv';

/** @rfc RFC-65 R1 */
export async function createRecord(body: CreateRecordBody): Promise<RecordDetail> {
  return (await apiFetch<DataEnvelope<RecordDetail>>('/records', { method: 'POST', json: body }))
    .data;
}
/** @rfc RFC-65 R3 */
export async function annotateRecord(id: string, body: AnnotateRecordBody): Promise<RecordDetail> {
  return (
    await apiFetch<DataEnvelope<RecordDetail>>(`/records/${id}/annotations`, {
      method: 'POST',
      json: body,
    })
  ).data;
}
/** @rfc RFC-65 R6 */
export async function fetchAccepted(speciesId: string, traitId: string): Promise<AcceptedState> {
  return (
    await apiFetch<DataEnvelope<AcceptedState>>(`/species/${speciesId}/traits/${traitId}/accepted`)
  ).data;
}
/** @rfc RFC-65 R6 */
export async function setAccepted(
  speciesId: string,
  traitId: string,
  body: SetAcceptedBody,
): Promise<AcceptedState> {
  return (
    await apiFetch<DataEnvelope<AcceptedState>>(
      `/species/${speciesId}/traits/${traitId}/accepted`,
      {
        method: 'PUT',
        json: body,
      },
    )
  ).data;
}
/** @rfc RFC-65 R8 */
export async function fetchPendingTraits(): Promise<PendingTrait[]> {
  return (await apiFetch<DataEnvelope<PendingTrait[]>>('/records/pending/traits')).data;
}
/** @rfc RFC-65 R8 */
export function fetchPendingGroups(params: { traitId: string; cursor?: string; limit?: number }) {
  return apiFetch<Page<PendingGroup>>(withQuery('/records/pending', params));
}
/** @rfc RFC-65 R9 */
export async function mapPending(body: MapPendingBody): Promise<MapResult> {
  return (
    await apiFetch<DataEnvelope<MapResult>>('/records/pending/map', { method: 'POST', json: body })
  ).data;
}
/** @rfc RFC-65 R10 */
export function fetchDisputed(params: { cursor?: string; limit?: number }) {
  return apiFetch<Page<DisputedRecord>>(withQuery('/records/disputed', params));
}
/** @rfc RFC-61 R6 */
export async function createReference(body: CreateReferenceBody): Promise<ReferenceDetail> {
  return (
    await apiFetch<DataEnvelope<ReferenceDetail>>('/references', { method: 'POST', json: body })
  ).data;
}

/**
 * After a record, annotation, accepted or mapping write: every record list,
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
