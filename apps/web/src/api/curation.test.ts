import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  CONTESTED_ITEM,
  MAP_RESULT,
  PENDING_GROUPS,
  PENDING_RECORD,
  PENDING_TRAITS,
  RECORD,
  RECORD_DETAIL,
  REFERENCE,
  SEXUAL_SYSTEM,
  SPECIES,
} from '../test/dataset-fixtures.ts';
import { installFetchMock, lastRequest, mockJson } from '../test/fetch.ts';
import {
  annotateRecord,
  createRecords,
  curationKeys,
  EXPORT_RECORDS_URL,
  fetchDisputed,
  fetchPendingGroups,
  fetchPendingTraits,
  invalidateAfterRecordWrite,
  mapPending,
  resolveContest,
  resolveDoi,
  withdrawContest,
  withdrawLevel,
} from './curation.ts';

installFetchMock();

const body = () => JSON.parse(String(lastRequest().init?.body));

describe('RFC-70 R1, R3 createRecords', () => {
  it('posts the body and unwraps the created records', async () => {
    const validated = [{ recordId: PENDING_RECORD.id, recordCode: PENDING_RECORD.recordCode }];
    mockJson(201, { data: { created: [RECORD], validated, duplicates: [] } });
    const result = await createRecords({
      speciesId: SPECIES.id,
      traitId: SEXUAL_SYSTEM.id,
      value: { levelIds: [RECORD_DETAIL.level?.id ?? ''] },
      sources: { references: [{ id: RECORD_DETAIL.primaryReference?.id ?? '' }] },
    });
    expect(lastRequest().url).toBe('/api/records');
    expect(lastRequest().init?.method).toBe('POST');
    expect(body().value).toEqual({ levelIds: [RECORD_DETAIL.level?.id] });
    expect(body().sources).toEqual({
      references: [{ id: RECORD_DETAIL.primaryReference?.id }],
    });
    expect(result.created[0]?.id).toBe(RECORD.id);
    expect(result.validated).toEqual(validated);
    expect(result.duplicates).toEqual([]);
  });
});

describe('RFC-80 R4 resolveDoi', () => {
  it('sends the DOI as a query param and returns the resolution', async () => {
    mockJson(200, { data: { status: 'known', reference: REFERENCE } });
    const result = await resolveDoi('10.1234/example');
    expect(lastRequest().url).toBe('/api/references/resolve?doi=10.1234%2Fexample');
    expect(lastRequest().init?.method ?? 'GET').toBe('GET');
    expect(result).toEqual({ status: 'known', reference: REFERENCE });
  });
});

describe('RFC-65 R3, RFC-70 R4 annotateRecord', () => {
  it('posts to the record and unwraps the detail', async () => {
    mockJson(201, { data: RECORD_DETAIL });
    await annotateRecord(RECORD_DETAIL.id, {
      kind: 'confirm',
      referenceSource: { id: REFERENCE.id },
    });
    expect(lastRequest().url).toBe(`/api/records/${RECORD_DETAIL.id}/annotations`);
    expect(body()).toEqual({ kind: 'confirm', referenceSource: { id: REFERENCE.id } });
  });

  it('RFC-33 R2 a withdraw answers 200 { data: null }, which unwraps to null', async () => {
    mockJson(200, { data: null });
    const result = await annotateRecord(RECORD_DETAIL.id, { kind: 'withdraw' });
    expect(lastRequest().url).toBe(`/api/records/${RECORD_DETAIL.id}/annotations`);
    expect(result).toBeNull();
  });
});

describe('RFC-65 R8–R10 queues', () => {
  it('pending traits, pending groups with cursor, mapping and the contested queue', async () => {
    mockJson(200, { data: PENDING_TRAITS });
    expect(await fetchPendingTraits()).toEqual(PENDING_TRAITS);
    expect(lastRequest().url).toBe('/api/records/pending/traits');
    mockJson(200, { data: PENDING_GROUPS, meta: { nextCursor: 'c2' } });
    const groups = await fetchPendingGroups({ traitId: SEXUAL_SYSTEM.id, cursor: 'c1', limit: 25 });
    expect(lastRequest().url).toBe(
      `/api/records/pending?traitId=${SEXUAL_SYSTEM.id}&cursor=c1&limit=25`,
    );
    expect(groups.meta.nextCursor).toBe('c2');
    mockJson(200, { data: MAP_RESULT });
    const result = await mapPending({
      traitId: SEXUAL_SYSTEM.id,
      valueText: 'dioecious ',
      value: { levelIds: ['018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e12'] },
    });
    expect(lastRequest().url).toBe('/api/records/pending/map');
    expect(result).toEqual(MAP_RESULT);
    mockJson(200, { data: [CONTESTED_ITEM], meta: { nextCursor: null } });
    const contested = await fetchDisputed({ limit: 50 });
    expect(lastRequest().url).toBe('/api/records/disputed?limit=50');
    expect(contested.data).toEqual([CONTESTED_ITEM]);
  });
});

describe('query keys and invalidation', () => {
  it('curationKeys nest under the dataset prefixes; invalidateAfterRecordWrite marks records and the species stale', async () => {
    expect(curationKeys.pendingGroups('t')).toEqual(['records', 'pending', 'groups', 't']);
    expect(EXPORT_RECORDS_URL).toBe('/api/export/records.csv');
    const client = new QueryClient();
    client.setQueryData(['records', { speciesId: 's' }], { data: [], meta: { nextCursor: null } });
    client.setQueryData(['records', 'r1'], RECORD_DETAIL);
    client.setQueryData(['species', 's', 'traits'], []);
    client.setQueryData(['species', 'other'], SPECIES);
    await invalidateAfterRecordWrite(client, 's');
    expect(client.getQueryState(['records', { speciesId: 's' }])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['records', 'r1'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['species', 's', 'traits'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['species', 'other'])?.isInvalidated).toBe(false);
  });
});

describe('RFC-65 R14 withdrawLevel', () => {
  it('posts to the level and unwraps { withdrawn, remaining }', async () => {
    const ref = { recordId: RECORD.id, recordCode: RECORD.recordCode };
    mockJson(201, { data: { withdrawn: [ref], remaining: [] } });
    const levelId = RECORD_DETAIL.level?.id ?? '';
    const result = await withdrawLevel(SPECIES.id, SEXUAL_SYSTEM.id, levelId);
    expect(lastRequest().url).toBe(
      `/api/species/${SPECIES.id}/traits/${SEXUAL_SYSTEM.id}/levels/${levelId}/withdraw`,
    );
    expect(lastRequest().init?.method).toBe('POST');
    expect(result).toEqual({ withdrawn: [ref], remaining: [] });
  });
});

describe('RFC-65 R16 contest actions', () => {
  it('resolveContest and withdrawContest post to the contest and answer nothing', async () => {
    mockJson(200, { data: null });
    await expect(resolveContest(RECORD.id)).resolves.toBeUndefined();
    expect(lastRequest().url).toBe(`/api/contests/${RECORD.id}/resolve`);
    expect(lastRequest().init?.method).toBe('POST');
    mockJson(200, { data: null });
    await expect(withdrawContest(RECORD.id)).resolves.toBeUndefined();
    expect(lastRequest().url).toBe(`/api/contests/${RECORD.id}/withdraw`);
    expect(lastRequest().init?.method).toBe('POST');
  });
});
