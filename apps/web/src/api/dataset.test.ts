import { describe, expect, it, vi } from 'vitest';
import { installFetchMock, lastRequest, mockJson } from '../test/fetch.ts';
import {
  datasetKeys,
  fetchFamilies,
  fetchGenera,
  fetchImports,
  fetchRecords,
  fetchSpecies,
  searchSpecies,
} from './dataset.ts';

installFetchMock();

const FAMILY = { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d01', name: 'Fabaceae' };
const GENUS = { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d02', name: 'Adenanthera', family: FAMILY };
const SPECIES = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d03',
  canonicalName: 'Adenanthera pavonina',
  nameSource: 'wcvp',
  active: true,
  genus: { id: GENUS.id, name: GENUS.name },
  family: FAMILY,
  matchedName: null,
  unresolvedTaxon: false,
};

describe('RFC-60 R6 searchSpecies', () => {
  it('serialises the filters and sends unresolved only when true', async () => {
    mockJson(200, { data: [SPECIES], meta: { nextCursor: null } });
    const page = await searchSpecies({ q: 'ad', unresolved: true });
    expect(lastRequest().url).toBe('/api/species?q=ad&unresolved=true');
    expect(page.data).toEqual([SPECIES]);
    expect(page.meta.nextCursor).toBeNull();

    mockJson(200, { data: [], meta: { nextCursor: null } });
    await searchSpecies({
      q: 'ad',
      unresolved: false,
      familyId: FAMILY.id,
      cursor: 'c1',
      limit: 50,
    });
    expect(lastRequest().url).toBe(`/api/species?q=ad&familyId=${FAMILY.id}&cursor=c1&limit=50`);
  });

  it('drops empty and undefined parameters', async () => {
    mockJson(200, { data: [], meta: { nextCursor: null } });
    await searchSpecies({ q: '', familyId: undefined });
    expect(lastRequest().url).toBe('/api/species');
  });

  it('RFC-33 R7 sends the status filter', async () => {
    mockJson(200, { data: [], meta: { nextCursor: null } });
    await searchSpecies({ status: 'inactive' });
    expect(lastRequest().url).toBe('/api/species?status=inactive');
  });
});

describe('RFC-60 R7 fetchSpecies', () => {
  it('unwraps the data envelope', async () => {
    mockJson(200, { data: { ...SPECIES, names: [], recordCount: 0, traitCount: 0 } });
    const species = await fetchSpecies(SPECIES.id);
    expect(lastRequest().url).toBe(`/api/species/${SPECIES.id}`);
    expect(species.canonicalName).toBe('Adenanthera pavonina');
  });
});

describe('RFC-63 R9 fetchRecords', () => {
  it('builds the species + trait query', async () => {
    mockJson(200, { data: [], meta: { nextCursor: null } });
    await fetchRecords({ speciesId: SPECIES.id, traitId: GENUS.id });
    expect(lastRequest().url).toBe(`/api/records?speciesId=${SPECIES.id}&traitId=${GENUS.id}`);
  });
});

describe('RFC-60 R8 fetchFamilies and fetchGenera', () => {
  it('fetchFamilies follows nextCursor across pages and concatenates', async () => {
    const other = { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d04', name: 'Myrtaceae' };
    mockJson(200, { data: [FAMILY], meta: { nextCursor: 'c1' } });
    mockJson(200, { data: [other], meta: { nextCursor: null } });
    const families = await fetchFamilies();
    expect(families).toEqual([FAMILY, other]);
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(['/api/families?limit=200', '/api/families?cursor=c1&limit=200']);
  });

  it('fetchGenera passes the family and the prefix', async () => {
    mockJson(200, { data: [GENUS], meta: { nextCursor: null } });
    const page = await fetchGenera({ familyId: FAMILY.id, q: 'Ad', limit: 20 });
    expect(lastRequest().url).toBe(`/api/genera?familyId=${FAMILY.id}&q=Ad&limit=20`);
    expect(page.data[0]?.family).toEqual(FAMILY);
  });
});

describe('RFC-68 R7 fetchImports', () => {
  it('sends the kind filter', async () => {
    mockJson(200, { data: [], meta: { nextCursor: null } });
    await fetchImports({ kind: 'species_status' });
    expect(lastRequest().url).toBe('/api/imports?kind=species_status');
  });
});

describe('RFC-60 R6 datasetKeys', () => {
  it('keys lists by their parameters and details by id', () => {
    expect(datasetKeys.species({ q: 'ad' })).toEqual(['species', { q: 'ad' }]);
    expect(datasetKeys.speciesDetail('x')).toEqual(['species', 'x']);
    expect(datasetKeys.speciesTraits('x')).toEqual(['species', 'x', 'traits']);
    expect(datasetKeys.families).toEqual(['families']);
    expect(datasetKeys.importRejects('b')).toEqual(['imports', 'b', 'rejects']);
    expect(datasetKeys.imports({ kind: 'species_status' })).toEqual([
      'imports',
      { kind: 'species_status' },
    ]);
  });
});
