import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_STATE,
  DISPUTED_RECORD,
  MAP_RESULT,
  PENDING_GROUPS,
  PENDING_TRAITS,
  RECORD_DETAIL,
  REFERENCE_DETAIL,
  SEXUAL_SYSTEM,
  SPECIES,
} from '../test/dataset-fixtures.ts';
import { installFetchMock, lastRequest, mockJson } from '../test/fetch.ts';
import {
  annotateRecord,
  createRecord,
  createReference,
  curationKeys,
  EXPORT_ACCEPTED_URL,
  fetchAccepted,
  fetchDisputed,
  fetchPendingGroups,
  fetchPendingTraits,
  invalidateAfterRecordWrite,
  mapPending,
  setAccepted,
} from './curation.ts';

installFetchMock();

const body = () => JSON.parse(String(lastRequest().init?.body));

describe('RFC-65 R1 createRecord', () => {
  it('posts the body and unwraps the detail', async () => {
    mockJson(201, { data: RECORD_DETAIL });
    const record = await createRecord({
      speciesId: SPECIES.id,
      traitId: SEXUAL_SYSTEM.id,
      value: { levelId: RECORD_DETAIL.level?.id ?? '' },
      primaryReferenceId: RECORD_DETAIL.primaryReference?.id ?? '',
    });
    expect(lastRequest().url).toBe('/api/records');
    expect(lastRequest().init?.method).toBe('POST');
    expect(body().value).toEqual({ levelId: RECORD_DETAIL.level?.id });
    expect(record.id).toBe(RECORD_DETAIL.id);
  });
});

describe('RFC-65 R3 annotateRecord', () => {
  it('posts to the record and unwraps the detail', async () => {
    mockJson(201, { data: RECORD_DETAIL });
    await annotateRecord(RECORD_DETAIL.id, { kind: 'dispute', note: 'No.' });
    expect(lastRequest().url).toBe(`/api/records/${RECORD_DETAIL.id}/annotations`);
    expect(body()).toEqual({ kind: 'dispute', note: 'No.' });
  });
});

describe('RFC-65 R6 accepted value', () => {
  it('fetchAccepted and setAccepted use the species×trait path', async () => {
    mockJson(200, { data: ACCEPTED_STATE });
    const state = await fetchAccepted(SPECIES.id, SEXUAL_SYSTEM.id);
    expect(lastRequest().url).toBe(
      `/api/species/${SPECIES.id}/traits/${SEXUAL_SYSTEM.id}/accepted`,
    );
    expect(state.current?.recordId).toBe(ACCEPTED_STATE.current?.recordId);
    mockJson(200, { data: ACCEPTED_STATE });
    await setAccepted(SPECIES.id, SEXUAL_SYSTEM.id, {
      decision: 'cleared',
      note: 'Sources disagree',
    });
    expect(lastRequest().init?.method).toBe('PUT');
    expect(body()).toEqual({ decision: 'cleared', note: 'Sources disagree' });
  });
});

describe('RFC-65 R8–R10 queues', () => {
  it('pending traits, pending groups with cursor, mapping and the disputed list', async () => {
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
    mockJson(200, { data: [DISPUTED_RECORD], meta: { nextCursor: null } });
    const disputed = await fetchDisputed({ limit: 50 });
    expect(lastRequest().url).toBe('/api/records/disputed?limit=50');
    expect(disputed.data[0]?.latestDispute.actor.name).toBe(
      DISPUTED_RECORD.latestDispute.actor.name,
    );
  });
});

describe('RFC-61 R6 createReference', () => {
  it('posts and unwraps the detail', async () => {
    mockJson(201, { data: REFERENCE_DETAIL });
    const ref = await createReference({ citationKey: 'New_2026' });
    expect(lastRequest().url).toBe('/api/references');
    expect(ref.id).toBe(REFERENCE_DETAIL.id);
  });
});

describe('query keys and invalidation', () => {
  it('curationKeys nest under the dataset prefixes; invalidateAfterRecordWrite marks records and the species stale', async () => {
    expect(curationKeys.accepted('s', 't')).toEqual(['species', 's', 'traits', 't', 'accepted']);
    expect(curationKeys.pendingGroups('t')).toEqual(['records', 'pending', 'groups', 't']);
    expect(EXPORT_ACCEPTED_URL).toBe('/api/export/accepted.csv');
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
