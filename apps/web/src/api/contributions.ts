import type {
  ContributionAnnotation,
  ContributionKind,
  ContributionRecord,
  ContributionSummary,
  DataEnvelope,
  RecordIntent,
  ReviewStatus,
} from '@treerepro/contracts';
import { apiFetch } from './client.ts';
import type { Page } from './dataset.ts';
import { type QueryParams, withQuery } from './query.ts';

/** One row of a contributions page: a record (R2) or an annotation (R3). */
export type ContributionItem = ContributionRecord | ContributionAnnotation;

/**
 * The query of RFC-71 R1 as the web app sends it: `kind` decides which of
 * the two row shapes comes back, every other key is a filter on the record
 * — on the annotated record when `kind` is `annotations` (R3).
 */
export type ContributionsQuery = {
  kind: ContributionKind;
  traitId?: string;
  speciesId?: string;
  review?: ReviewStatus;
  intent?: RecordIntent | 'none';
  /** Inclusive day bounds in UTC, as `YYYY-MM-DD`. */
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
};

/**
 * Query keys of the contributions page. They sit under the `records` prefix
 * so `invalidateAfterRecordWrite` refreshes the lists and the tiles too: an
 * annotation written from the record drawer changes both.
 * @rfc RFC-71 R1, R4, R5
 * @rfc RFC-13 R6
 */
export const contributionKeys = {
  mine: (params: QueryParams) => ['records', 'contributions', 'me', params] as const,
  mySummary: ['records', 'contributions', 'me', 'summary'] as const,
  user: (userId: string, params: QueryParams) =>
    ['records', 'contributions', userId, params] as const,
  userSummary: (userId: string) => ['records', 'contributions', userId, 'summary'] as const,
};

/** @rfc RFC-71 R1, R2, R3 */
export function fetchMyContributions(params: ContributionsQuery): Promise<Page<ContributionItem>> {
  return apiFetch<Page<ContributionItem>>(withQuery('/me/contributions', params));
}

/** @rfc RFC-71 R4 */
export async function fetchMySummary(): Promise<ContributionSummary> {
  return (await apiFetch<DataEnvelope<ContributionSummary>>('/me/contributions/summary')).data;
}

/** @rfc RFC-71 R5 */
export function fetchUserContributions(
  userId: string,
  params: ContributionsQuery,
): Promise<Page<ContributionItem>> {
  return apiFetch<Page<ContributionItem>>(
    withQuery(`/admin/users/${userId}/contributions`, params),
  );
}

/** @rfc RFC-71 R5 */
export async function fetchUserSummary(userId: string): Promise<ContributionSummary> {
  return (
    await apiFetch<DataEnvelope<ContributionSummary>>(
      `/admin/users/${userId}/contributions/summary`,
    )
  ).data;
}

/**
 * An annotation row carries the record it is on; a record row is one. The
 * page asks for one kind at a time, so exactly one of the two guards matches
 * every row of a page.
 * @rfc RFC-71 R3
 */
export function isContributionAnnotation(item: ContributionItem): item is ContributionAnnotation {
  return 'record' in item;
}

/** @rfc RFC-71 R2 */
export function isContributionRecord(item: ContributionItem): item is ContributionRecord {
  return !('record' in item);
}
