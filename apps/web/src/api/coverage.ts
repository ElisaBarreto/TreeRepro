import {
  type Coverage,
  type CoverageTopQuery,
  type CoverageTraitRow,
  coverageSchema,
  coverageTraitRowSchema,
  dataEnvelopeSchema,
} from '@treerepro/contracts';
import { z } from 'zod';
import { apiFetch } from './client.ts';
import { type QueryParams, withQuery } from './query.ts';

/**
 * Query keys of the coverage page (plan 11c); every fetcher below owns one.
 * @rfc RFC-69 R5, R7
 */
export const coverageKeys = {
  detail: (params: QueryParams) => ['coverage', 'detail', params] as const,
  top: (params: QueryParams) => ['coverage', 'top', params] as const,
};

/**
 * `GET /api/coverage?familyId=&categoryKey=&plotId=`: the visible active
 * species × visible active traits, filtered and broken down by category and
 * by trait.
 * @rfc RFC-69 R5
 */
export async function fetchCoverage(params: {
  familyId?: string;
  categoryKey?: string;
  plotId?: string;
}): Promise<Coverage> {
  return (await apiFetch(withQuery('/coverage', params), dataEnvelopeSchema(coverageSchema))).data;
}

/**
 * `GET /api/coverage/top?mode=&limit=`: the traits with the most visible
 * species lacking a record, or the lowest validated share, over the full
 * unfiltered visible grid.
 * @rfc RFC-69 R7
 */
export async function fetchCoverageTop(params: CoverageTopQuery = {}): Promise<CoverageTraitRow[]> {
  const { data } = await apiFetch(
    withQuery('/coverage/top', params),
    dataEnvelopeSchema(z.array(coverageTraitRowSchema)),
  );
  return data;
}
