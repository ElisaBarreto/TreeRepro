import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  FAMILY,
  GENUS,
  REFERENCE_DETAIL,
  SEXUAL_SYSTEM_TRAIT,
  SPECIES,
} from '../test/dataset-fixtures.ts';
import { installFetchMock, lastRequest, mockJson } from '../test/fetch.ts';
import {
  addSpeciesName,
  createFamily,
  createGenus,
  createLevel,
  createReference,
  createSpecies,
  createTrait,
  invalidateAfterCatalogWrite,
  updateFamily,
  updateGenus,
  updateLevel,
  updateReference,
  updateSpecies,
  updateTrait,
} from './catalog.ts';

installFetchMock();

const body = () => JSON.parse(String(lastRequest().init?.body));

describe('RFC-60 R9 taxa writes', () => {
  it('createFamily / updateFamily post and patch /families', async () => {
    mockJson(201, { data: FAMILY });
    expect(await createFamily({ name: 'Fabaceae' })).toEqual(FAMILY);
    expect(lastRequest()).toMatchObject({ url: '/api/families', init: { method: 'POST' } });
    mockJson(200, { data: FAMILY });
    await updateFamily(FAMILY.id, { name: 'Fabaceae' });
    expect(lastRequest()).toMatchObject({
      url: `/api/families/${FAMILY.id}`,
      init: { method: 'PATCH' },
    });
    expect(body()).toEqual({ name: 'Fabaceae' });
  });
  it('createGenus / updateGenus post and patch /genera; null familyId is sent', async () => {
    mockJson(201, { data: { ...GENUS, family: FAMILY } });
    await createGenus({ name: 'Adenanthera', familyId: FAMILY.id });
    expect(lastRequest()).toMatchObject({ url: '/api/genera', init: { method: 'POST' } });
    mockJson(200, { data: { ...GENUS, family: null } });
    await updateGenus(GENUS.id, { familyId: null });
    expect(lastRequest().url).toBe(`/api/genera/${GENUS.id}`);
    expect(body()).toEqual({ familyId: null });
  });
  it('createSpecies / updateSpecies / addSpeciesName use the species paths', async () => {
    mockJson(201, { data: SPECIES });
    await createSpecies({
      canonicalName: 'Adenanthera pavonina',
      nameSource: 'wcvp',
      genusId: GENUS.id,
    });
    expect(lastRequest()).toMatchObject({ url: '/api/species', init: { method: 'POST' } });
    mockJson(200, { data: SPECIES });
    await updateSpecies(SPECIES.id, { nameSource: 'original' });
    expect(lastRequest()).toMatchObject({
      url: `/api/species/${SPECIES.id}`,
      init: { method: 'PATCH' },
    });
    mockJson(201, { data: SPECIES });
    await addSpeciesName(SPECIES.id, {
      name: 'Adenanthera gersenii',
      nameType: 'gbif',
      gbifUsageKey: '2969393',
    });
    expect(lastRequest()).toMatchObject({
      url: `/api/species/${SPECIES.id}/names`,
      init: { method: 'POST' },
    });
  });
});

describe('RFC-61 R6 reference writes', () => {
  it('createReference posts, updateReference patches with nulls kept', async () => {
    mockJson(201, { data: REFERENCE_DETAIL });
    expect(await createReference({ citationKey: 'Smith2001' })).toEqual(REFERENCE_DETAIL);
    expect(lastRequest()).toMatchObject({ url: '/api/references', init: { method: 'POST' } });
    mockJson(200, { data: REFERENCE_DETAIL });
    await updateReference(REFERENCE_DETAIL.id, { title: null, year: 2002 });
    expect(lastRequest()).toMatchObject({
      url: `/api/references/${REFERENCE_DETAIL.id}`,
      init: { method: 'PATCH' },
    });
    expect(body()).toEqual({ title: null, year: 2002 });
  });
});

describe('RFC-62 R6 trait and level writes', () => {
  it('createTrait / updateTrait / createLevel / updateLevel use the trait paths and unwrap the trait', async () => {
    mockJson(201, { data: SEXUAL_SYSTEM_TRAIT });
    await createTrait({
      key: 'sexual_system',
      categoryKey: 'reproductive_system',
      valueType: 'categorical',
    });
    expect(lastRequest()).toMatchObject({ url: '/api/traits', init: { method: 'POST' } });
    mockJson(200, { data: SEXUAL_SYSTEM_TRAIT });
    await updateTrait(SEXUAL_SYSTEM_TRAIT.id, { active: false });
    expect(lastRequest()).toMatchObject({
      url: `/api/traits/${SEXUAL_SYSTEM_TRAIT.id}`,
      init: { method: 'PATCH' },
    });
    mockJson(201, { data: SEXUAL_SYSTEM_TRAIT });
    const trait = await createLevel(SEXUAL_SYSTEM_TRAIT.id, { key: 'monoecious' });
    expect(trait.id).toBe(SEXUAL_SYSTEM_TRAIT.id);
    expect(lastRequest()).toMatchObject({
      url: `/api/traits/${SEXUAL_SYSTEM_TRAIT.id}/levels`,
      init: { method: 'POST' },
    });
    const level = SEXUAL_SYSTEM_TRAIT.levels[0];
    mockJson(200, { data: SEXUAL_SYSTEM_TRAIT });
    await updateLevel(SEXUAL_SYSTEM_TRAIT.id, level?.id ?? '', { sortOrder: 3 });
    expect(lastRequest().url).toBe(`/api/traits/${SEXUAL_SYSTEM_TRAIT.id}/levels/${level?.id}`);
    expect(body()).toEqual({ sortOrder: 3 });
  });
});

describe('RFC-13 R6 invalidateAfterCatalogWrite', () => {
  it('invalidates the prefixes of each area', async () => {
    const queryClient = new QueryClient();
    const seen = (key: readonly unknown[]) =>
      queryClient.getQueryState(key)?.isInvalidated === true;
    for (const key of [
      ['families'],
      ['genera', {}],
      ['species', 'x'],
      ['records', 'y'],
      ['references', 'z'],
      ['traits'],
    ]) {
      queryClient.setQueryData(key, {});
    }
    await invalidateAfterCatalogWrite(queryClient, 'taxa');
    expect([
      seen(['families']),
      seen(['genera', {}]),
      seen(['species', 'x']),
      seen(['records', 'y']),
    ]).toEqual([true, true, true, true]);
    expect(seen(['references', 'z'])).toBe(false);
    expect(seen(['traits'])).toBe(false);
    await invalidateAfterCatalogWrite(queryClient, 'references');
    expect(seen(['references', 'z'])).toBe(true);
    await invalidateAfterCatalogWrite(queryClient, 'traits');
    expect(seen(['traits'])).toBe(true);
  });
});
