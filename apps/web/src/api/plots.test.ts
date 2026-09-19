import { describe, expect, it, vi } from 'vitest';
import { installFetchMock, lastRequest, mockJson } from '../test/fetch.ts';
import { fetchAllPlots, listPlots } from './plots.ts';

installFetchMock();

const PLOT = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e01',
  code: 'RIV-01',
  name: 'Riverside plot',
};
const OTHER = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e02',
  code: 'HIL-02',
  name: 'Hillside plot',
};

describe('RFC-67 R3 listPlots', () => {
  it('serialises the query it is given', async () => {
    mockJson(200, { data: [PLOT], meta: { nextCursor: null } });
    const page = await listPlots({ q: 'riv', limit: 20 });
    expect(lastRequest().url).toBe('/api/plots?q=riv&limit=20');
    expect(page.data).toEqual([PLOT]);
  });
});

describe('RFC-67 R3 fetchAllPlots', () => {
  it('follows nextCursor across pages and concatenates, so a select holds every plot', async () => {
    mockJson(200, { data: [PLOT], meta: { nextCursor: 'c1' } });
    mockJson(200, { data: [OTHER], meta: { nextCursor: null } });
    expect(await fetchAllPlots()).toEqual([PLOT, OTHER]);
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(['/api/plots?limit=200', '/api/plots?cursor=c1&limit=200']);
  });

  it('stops at the first page when there is no next cursor', async () => {
    mockJson(200, { data: [PLOT], meta: { nextCursor: null } });
    expect(await fetchAllPlots()).toEqual([PLOT]);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });
});
