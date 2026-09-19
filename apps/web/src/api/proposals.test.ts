import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  APPROVED_PROPOSAL,
  LOOKUP_EXACT,
  PROPOSAL,
  REJECTED_PROPOSAL,
} from '../test/dataset-fixtures.ts';
import { installFetchMock, lastRequest, mockJson } from '../test/fetch.ts';
import {
  approveProposal,
  createProposal,
  fetchMyProposals,
  fetchProposals,
  invalidateAfterProposalWrite,
  matchTaxon,
  proposalKeys,
  rejectProposal,
} from './proposals.ts';

installFetchMock();

const body = () => JSON.parse(String(lastRequest().init?.body));

describe('RFC-75 R2 createProposal', () => {
  it('posts name and note to /api/species/proposals and unwraps the proposal', async () => {
    mockJson(201, { data: PROPOSAL });
    const created = await createProposal({ name: 'Quercus robur', note: 'Seen on plot A12.' });
    expect(lastRequest().url).toBe('/api/species/proposals');
    expect(lastRequest().init?.method).toBe('POST');
    expect(body()).toEqual({ name: 'Quercus robur', note: 'Seen on plot A12.' });
    expect(created.id).toBe(PROPOSAL.id);
  });
});

describe('RFC-75 R3 fetchProposals', () => {
  it('sends status, cursor and limit as query params', async () => {
    mockJson(200, { data: [PROPOSAL], meta: { nextCursor: null } });
    const page = await fetchProposals({ status: 'approved', cursor: 'c1', limit: 25 });
    expect(lastRequest().url).toBe('/api/species/proposals?status=approved&cursor=c1&limit=25');
    expect(page.data[0]?.id).toBe(PROPOSAL.id);
  });
});

describe('RFC-75 R5 fetchMyProposals', () => {
  it('reads /api/me/proposals', async () => {
    mockJson(200, { data: [PROPOSAL], meta: { nextCursor: null } });
    await fetchMyProposals({ limit: 50 });
    expect(lastRequest().url).toBe('/api/me/proposals?limit=50');
  });
});

describe('RFC-75 R4 decisions', () => {
  it('approveProposal posts the species fields to the proposal it approves', async () => {
    mockJson(200, { data: APPROVED_PROPOSAL });
    const decided = await approveProposal(PROPOSAL.id, {
      canonicalName: 'Quercus robur',
      nameSource: 'wcvp',
      genusName: 'Quercus',
      familyName: 'Fagaceae',
    });
    expect(lastRequest().url).toBe(`/api/species/proposals/${PROPOSAL.id}/approve`);
    expect(lastRequest().init?.method).toBe('POST');
    expect(body()).toEqual({
      canonicalName: 'Quercus robur',
      nameSource: 'wcvp',
      genusName: 'Quercus',
      familyName: 'Fagaceae',
    });
    expect(decided.status).toBe('approved');
  });

  it('rejectProposal posts the note', async () => {
    mockJson(200, { data: REJECTED_PROPOSAL });
    const decided = await rejectProposal(PROPOSAL.id, { note: 'No such taxon.' });
    expect(lastRequest().url).toBe(`/api/species/proposals/${PROPOSAL.id}/reject`);
    expect(body()).toEqual({ note: 'No such taxon.' });
    expect(decided.status).toBe('rejected');
  });
});

describe('RFC-81 R4 matchTaxon', () => {
  it('sends the name to /api/taxonomy/match and unwraps the lookup', async () => {
    mockJson(200, { data: LOOKUP_EXACT });
    const lookup = await matchTaxon('Quercus robur');
    expect(lastRequest().url).toBe('/api/taxonomy/match?name=Quercus+robur');
    expect(lookup.verdict).toBe('exact');
  });
});

describe('RFC-13 R6 invalidateAfterProposalWrite', () => {
  it('invalidates the queue, the viewer’s own list and the dashboard', async () => {
    const queryClient = new QueryClient();
    const invalidated: unknown[] = [];
    queryClient.invalidateQueries = async (filters?: { queryKey?: unknown }) => {
      invalidated.push(filters?.queryKey);
    };
    await invalidateAfterProposalWrite(queryClient);
    expect(invalidated).toContainEqual(proposalKeys.all);
    expect(invalidated).toContainEqual(['dashboard']);
  });
});
