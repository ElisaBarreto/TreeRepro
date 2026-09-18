import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  CONTRIBUTION_ANNOTATION,
  CONTRIBUTION_RECORD,
  CONTRIBUTION_SUMMARY,
} from '../test/dataset-fixtures.ts';
import { installFetchMock, lastRequest, mockJson } from '../test/fetch.ts';
import {
  contributionKeys,
  fetchMyContributions,
  fetchMySummary,
  fetchUserContributions,
  fetchUserSummary,
  isContributionAnnotation,
  isContributionRecord,
} from './contributions.ts';

installFetchMock();

const USER_ID = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9f';

describe('RFC-71 R1, R2 fetchMyContributions', () => {
  it('sends every filter as a query param and unwraps the page', async () => {
    mockJson(200, { data: [CONTRIBUTION_RECORD], meta: { nextCursor: 'c1' } });
    const page = await fetchMyContributions({
      kind: 'records',
      traitId: CONTRIBUTION_RECORD.trait.id,
      speciesId: CONTRIBUTION_RECORD.species.id,
      review: 'disputed',
      intent: 'none',
      from: '2026-09-01',
      to: '2026-09-30',
      cursor: 'c0',
      limit: 25,
    });
    const url = new URL(lastRequest().url, 'http://localhost');
    expect(url.pathname).toBe('/api/me/contributions');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: 'records',
      traitId: CONTRIBUTION_RECORD.trait.id,
      speciesId: CONTRIBUTION_RECORD.species.id,
      review: 'disputed',
      intent: 'none',
      from: '2026-09-01',
      to: '2026-09-30',
      cursor: 'c0',
      limit: '25',
    });
    expect(page.data).toEqual([CONTRIBUTION_RECORD]);
    expect(page.meta.nextCursor).toBe('c1');
  });

  it('leaves out the filters nobody set', async () => {
    mockJson(200, { data: [CONTRIBUTION_ANNOTATION], meta: { nextCursor: null } });
    await fetchMyContributions({ kind: 'annotations' });
    expect(lastRequest().url).toBe('/api/me/contributions?kind=annotations');
  });
});

describe('RFC-71 R4 fetchMySummary', () => {
  it('unwraps the seven counts', async () => {
    mockJson(200, { data: CONTRIBUTION_SUMMARY });
    expect(await fetchMySummary()).toEqual(CONTRIBUTION_SUMMARY);
    expect(lastRequest().url).toBe('/api/me/contributions/summary');
  });
});

describe("RFC-71 R5 another user's contributions", () => {
  it('calls the admin route with the user id', async () => {
    mockJson(200, { data: [CONTRIBUTION_RECORD], meta: { nextCursor: null } });
    const page = await fetchUserContributions(USER_ID, { kind: 'records', limit: 50 });
    expect(lastRequest().url).toBe(
      `/api/admin/users/${USER_ID}/contributions?kind=records&limit=50`,
    );
    expect(page.data).toEqual([CONTRIBUTION_RECORD]);

    mockJson(200, { data: CONTRIBUTION_SUMMARY });
    expect(await fetchUserSummary(USER_ID)).toEqual(CONTRIBUTION_SUMMARY);
    expect(lastRequest().url).toBe(`/api/admin/users/${USER_ID}/contributions/summary`);
  });
});

describe('RFC-13 R6 contributionKeys', () => {
  it('sit under the records prefix, so a record write invalidates them', async () => {
    const queryClient = new QueryClient();
    const keys = [
      contributionKeys.mine({ kind: 'records' }),
      contributionKeys.mySummary,
      contributionKeys.user(USER_ID, { kind: 'annotations' }),
      contributionKeys.userSummary(USER_ID),
    ];
    for (const key of keys) queryClient.setQueryData(key, 'cached');
    await queryClient.invalidateQueries({ queryKey: ['records'] });
    for (const key of keys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it('keeps one user apart from another and from the viewer', () => {
    expect(contributionKeys.mine({ kind: 'records' })).not.toEqual(
      contributionKeys.user(USER_ID, { kind: 'records' }),
    );
    expect(contributionKeys.mySummary).not.toEqual(contributionKeys.userSummary(USER_ID));
  });
});

describe('RFC-71 R2, R3 the two row shapes', () => {
  it('tells a record row from an annotation row', () => {
    expect(isContributionRecord(CONTRIBUTION_RECORD)).toBe(true);
    expect(isContributionRecord(CONTRIBUTION_ANNOTATION)).toBe(false);
    expect(isContributionAnnotation(CONTRIBUTION_ANNOTATION)).toBe(true);
    expect(isContributionAnnotation(CONTRIBUTION_RECORD)).toBe(false);
  });
});
