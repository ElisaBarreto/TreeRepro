import type { QueryClient } from '@tanstack/react-query';
import type {
  ApproveProposalBody,
  CreateProposalBody,
  DataEnvelope,
  Lookup,
  Proposal,
  ProposalStatus,
  RejectProposalBody,
} from '@treerepro/contracts';
import { apiFetch } from './client.ts';
import type { Page } from './dataset.ts';
import { withQuery } from './query.ts';

/**
 * Query keys of the proposal screens. The queue and the viewer's own list
 * share the `proposals` prefix, so one invalidation after a write covers
 * both — an approval removes a row from the queue and changes its status in
 * My contributions at the same moment.
 * @rfc RFC-75 R3, R5
 */
export const proposalKeys = {
  all: ['proposals'] as const,
  list: (params: { status?: ProposalStatus }) => ['proposals', 'queue', params] as const,
  mine: ['proposals', 'me'] as const,
};

/** @rfc RFC-75 R2 */
export async function createProposal(body: CreateProposalBody): Promise<Proposal> {
  return (
    await apiFetch<DataEnvelope<Proposal>>('/species/proposals', { method: 'POST', json: body })
  ).data;
}

/** @rfc RFC-75 R3 */
export function fetchProposals(params: {
  status?: ProposalStatus;
  cursor?: string;
  limit?: number;
}): Promise<Page<Proposal>> {
  return apiFetch<Page<Proposal>>(withQuery('/species/proposals', params));
}

/** @rfc RFC-75 R5 */
export function fetchMyProposals(params: {
  cursor?: string;
  limit?: number;
}): Promise<Page<Proposal>> {
  return apiFetch<Page<Proposal>>(withQuery('/me/proposals', params));
}

/** @rfc RFC-75 R4 */
export async function approveProposal(id: string, body: ApproveProposalBody): Promise<Proposal> {
  return (
    await apiFetch<DataEnvelope<Proposal>>(`/species/proposals/${id}/approve`, {
      method: 'POST',
      json: body,
    })
  ).data;
}

/** @rfc RFC-75 R4 */
export async function rejectProposal(id: string, body: RejectProposalBody): Promise<Proposal> {
  return (
    await apiFetch<DataEnvelope<Proposal>>(`/species/proposals/${id}/reject`, {
      method: 'POST',
      json: body,
    })
  ).data;
}

/**
 * The direct taxonomy lookup behind the species dialog's **Look up** button.
 * It never writes; a source that did not answer comes back `null` and a
 * lookup that could not be completed at all is a 502 the caller reports.
 * @rfc RFC-81 R4
 */
export async function matchTaxon(name: string): Promise<Lookup> {
  return (await apiFetch<DataEnvelope<Lookup>>(withQuery('/taxonomy/match', { name }))).data;
}

/**
 * What a decision or a new proposal makes stale: both proposal lists and the
 * dashboard, whose `queues.proposals` counts the open ones (RFC-75 R7). The
 * species catalog is invalidated by the catalog helper instead, since an
 * approval creates a species through the same write path.
 * @rfc RFC-13 R6
 * @rfc RFC-75 R7
 */
export async function invalidateAfterProposalWrite(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    [proposalKeys.all, ['dashboard']].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}
