import { describe, expect, it } from 'vitest';
import {
  HARMONISATION_STATUSES,
  IMPORT_BATCH_KINDS,
  importBatchSchema,
  listGeneraQuerySchema,
  listRecordsQuerySchema,
  listSpeciesQuerySchema,
  listTraitSpeciesQuerySchema,
  listTraitsQuerySchema,
  NAME_TYPES,
  REVIEW_STATUSES,
  recordSchema,
  referenceDetailSchema,
  referenceSchema,
  SPECIES_SORTS,
  speciesListItemSchema,
  speciesNameSchema,
  speciesTraitsSchema,
  TRAIT_DATA_MODES,
  TRAIT_SPECIES_MODES,
  traitDetailSchema,
  traitSchema,
  traitSpeciesItemSchema,
} from './dataset.ts';

const uuid = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e';

describe('RFC-60 R6 listSpeciesQuerySchema', () => {
  it('accepts filters and coerces limit; q needs two characters', () => {
    expect(listSpeciesQuerySchema.parse({ q: 'ad', limit: '10', unresolved: 'true' })).toEqual({
      q: 'ad',
      limit: 10,
      unresolved: 'true',
    });
    expect(listSpeciesQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(listSpeciesQuerySchema.safeParse({ familyId: 'nope' }).success).toBe(false);
    expect(listSpeciesQuerySchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});

describe('RFC-60 R8 listGeneraQuerySchema', () => {
  it('q is a prefix of one to one hundred characters', () => {
    expect(listGeneraQuerySchema.parse({ q: 'A' }).q).toBe('A');
    expect(listGeneraQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
  });
});

describe('RFC-63 R9 listRecordsQuerySchema', () => {
  it('requires speciesId with traitId, or referenceId alone', () => {
    expect(listRecordsQuerySchema.safeParse({ speciesId: uuid, traitId: uuid }).success).toBe(true);
    expect(listRecordsQuerySchema.safeParse({ referenceId: uuid }).success).toBe(true);
    expect(listRecordsQuerySchema.safeParse({ speciesId: uuid }).success).toBe(false);
    expect(listRecordsQuerySchema.safeParse({ referenceId: uuid, traitId: uuid }).success).toBe(
      false,
    );
    expect(listRecordsQuerySchema.safeParse({}).success).toBe(false);
    const failed = listRecordsQuerySchema.safeParse({ speciesId: uuid });
    expect(failed.success ? [] : failed.error.issues.map((i) => i.path.join('.'))).toEqual([
      'speciesId',
    ]);
  });
});

describe('RFC-63 R8 recordSchema', () => {
  it('is strict and keeps nullable fields explicit', () => {
    const record = {
      id: uuid,
      speciesId: uuid,
      species: { id: uuid, canonicalName: 'Testus specimen' },
      trait: { id: uuid, key: 'flower_color', valueType: 'categorical', unit: null },
      valueText: 'blue',
      level: { id: uuid, key: 'blue' },
      numericValue: null,
      harmonisation: 'harmonised',
      review: 'unreviewed',
      primaryReference: { id: uuid, citationKey: 'A_2020', kind: 'publication' },
      secondaryReference: null,
      origin: 'import',
      createdAt: '2026-09-13T00:00:00.000Z',
      createdBy: null,
      intent: null,
      respondsTo: null,
    };
    expect(recordSchema.parse(record)).toEqual(record);
    expect(recordSchema.safeParse({ ...record, extra: true }).success).toBe(false);
    expect(recordSchema.safeParse({ ...record, harmonisation: 'weird' }).success).toBe(false);
    expect(recordSchema.safeParse({ ...record, species: undefined }).success).toBe(false);
  });

  it('enumerations match the RFC', () => {
    expect(HARMONISATION_STATUSES).toEqual([
      'harmonised',
      'unknown_level',
      'multi_value',
      'not_numeric',
      'empty',
    ]);
    expect(REVIEW_STATUSES).toEqual(['unreviewed', 'confirmed', 'disputed', 'withdrawn']);
  });
});

describe('RFC-63 R10 speciesTraitsSchema', () => {
  it('accepts categorical and quantitative summaries', () => {
    const payload = [
      {
        category: { key: 'flower_color', label: 'Flower color' },
        traits: [
          {
            trait: { id: uuid, key: 'flower_color', valueType: 'categorical', unit: null },
            recordCount: 3,
            harmonisationCounts: {
              harmonised: 2,
              unknownLevel: 1,
              multiValue: 0,
              notNumeric: 0,
              empty: 0,
            },
            levels: [{ levelId: uuid, key: 'blue', count: 2 }],
            numeric: null,
            accepted: null,
          },
          {
            trait: { id: uuid, key: 'petal_length', valueType: 'quantitative', unit: 'mm' },
            recordCount: 2,
            harmonisationCounts: {
              harmonised: 2,
              unknownLevel: 0,
              multiValue: 0,
              notNumeric: 0,
              empty: 0,
            },
            levels: null,
            numeric: { min: 1.5, median: 2, max: 2.5, count: 2 },
            accepted: { recordId: uuid, valueText: '2', decidedAt: '2026-09-13T00:00:00.000Z' },
          },
        ],
      },
    ];
    expect(speciesTraitsSchema.parse(payload)).toEqual(payload);
  });
});

describe('RFC-61 R4 referenceSchema', () => {
  const reference = {
    id: uuid,
    citationKey: 'Smith2001',
    title: null,
    authors: null,
    year: null,
    journal: null,
    doi: null,
    url: null,
    createdAt: '2026-09-13T00:00:00.000Z',
    primaryCount: 2,
    secondaryCount: 0,
    kind: 'publication',
    observer: null,
  };

  it('every item carries its usage per role as non-negative integers', () => {
    expect(referenceSchema.parse(reference)).toEqual(reference);
    const { primaryCount: _p, ...withoutPrimary } = reference;
    expect(referenceSchema.safeParse(withoutPrimary).success).toBe(false);
    expect(referenceSchema.safeParse({ ...reference, secondaryCount: -1 }).success).toBe(false);
    expect(referenceSchema.safeParse({ ...reference, primaryCount: 1.5 }).success).toBe(false);
  });

  it('the detail adds recordCount on top of the per-role counts', () => {
    const detail = { ...reference, recordCount: 2 };
    expect(referenceDetailSchema.parse(detail)).toEqual(detail);
    expect(referenceDetailSchema.safeParse(reference).success).toBe(false);
  });
});

describe('RFC-60 R1, R4, R7 speciesNameSchema, NAME_TYPES', () => {
  it('lists the three name types and requires nameType, language and source', () => {
    expect(NAME_TYPES).toEqual(['gbif', 'synonym', 'common']);
    const gbifName = {
      name: 'Adenanthera gersenii',
      nameType: 'gbif',
      language: null,
      source: 'gbif',
      gbifUsageKey: '2969393',
    };
    expect(speciesNameSchema.parse(gbifName)).toEqual(gbifName);
    const commonName = {
      name: 'Coralwood',
      nameType: 'common',
      language: 'en',
      source: 'manual',
      gbifUsageKey: null,
    };
    expect(speciesNameSchema.parse(commonName)).toEqual(commonName);
    const { nameType: _nt, ...withoutType } = gbifName;
    expect(speciesNameSchema.safeParse(withoutType).success).toBe(false);
    expect(speciesNameSchema.safeParse({ ...commonName, language: 'eng' }).success).toBe(false);
  });
});

describe('RFC-64 R11 importBatchSchema', () => {
  it('parses a completed batch', () => {
    const batch = {
      id: uuid,
      fileName: 'sample.csv',
      fileSha256: 'a'.repeat(64),
      status: 'completed',
      kind: 'records',
      runBy: { id: uuid, name: 'Ada' },
      startedAt: '2026-09-13T00:00:00.000Z',
      finishedAt: '2026-09-13T00:01:00.000Z',
      rowsTotal: 10,
      rowsInserted: 8,
      rowsDuplicate: 1,
      rowsRejected: 1,
      rowsPending: 2,
      unknownLevels: [{ trait: 'pollinator_group', value: 'bees', count: 2 }],
      error: null,
    };
    expect(importBatchSchema.parse(batch)).toEqual(batch);
  });
});

describe('RFC-68 R1 import batch kinds', () => {
  it('lists every kind of RFC-68 and the batch schema requires one', () => {
    const BATCH = {
      id: uuid,
      fileName: 'sample.csv',
      fileSha256: 'a'.repeat(64),
      status: 'completed',
      kind: 'records',
      runBy: { id: uuid, name: 'Ada' },
      startedAt: '2026-09-13T00:00:00.000Z',
      finishedAt: '2026-09-13T00:01:00.000Z',
      rowsTotal: 10,
      rowsInserted: 8,
      rowsDuplicate: 1,
      rowsRejected: 1,
      rowsPending: 2,
      unknownLevels: [{ trait: 'pollinator_group', value: 'bees', count: 2 }],
      error: null,
    };
    expect(IMPORT_BATCH_KINDS).toEqual([
      'records',
      'species_status',
      'plots',
      'plot_species',
      'user_plots',
      'synonyms',
      'references',
      'distribution',
    ]);
    expect(importBatchSchema.safeParse({ ...BATCH, kind: 'species_status' }).success).toBe(true);
    expect(importBatchSchema.safeParse({ ...BATCH, kind: 'nope' }).success).toBe(false);
  });
});

describe('RFC-60 R6 species item carries active; status filter', () => {
  it('requires active and accepts status=inactive', () => {
    const ITEM = {
      id: uuid,
      canonicalName: 'Adenanthera pavonina',
      nameSource: 'wcvp',
      genus: null,
      family: null,
      matchedName: null,
      matchedNameType: null,
      unresolvedTaxon: false,
      active: true,
      traitCount: 3,
      traitRecordCount: null,
    };
    expect(speciesListItemSchema.safeParse({ ...ITEM, active: false }).success).toBe(true);
    const { active: _a, ...without } = { ...ITEM, active: true };
    expect(speciesListItemSchema.safeParse(without).success).toBe(false);
    expect(listSpeciesQuerySchema.safeParse({ status: 'inactive' }).success).toBe(true);
    expect(listSpeciesQuerySchema.safeParse({ status: 'x' }).success).toBe(false);
  });
});

describe('RFC-60 R6 species trait filters on listSpeciesQuerySchema', () => {
  it('accepts categoryKey, traitId, traitData, sort; traitData alone is accepted (the API decides what to do)', () => {
    expect(
      listSpeciesQuerySchema.safeParse({
        categoryKey: 'leaf',
        traitId: uuid,
        traitData: 'with',
        sort: 'completeness',
      }).success,
    ).toBe(true);
    // No traitId and no categoryKey: the schema still accepts traitData, the API decides what to do.
    expect(listSpeciesQuerySchema.safeParse({ traitData: 'missing' }).success).toBe(true);
    expect(listSpeciesQuerySchema.safeParse({ sort: 'name' }).success).toBe(true);
    expect(listSpeciesQuerySchema.safeParse({ sort: 'nope' }).success).toBe(false);
    expect(listSpeciesQuerySchema.safeParse({ traitData: 'nope' }).success).toBe(false);
    expect(listSpeciesQuerySchema.safeParse({ categoryKey: '' }).success).toBe(false);
    expect(TRAIT_DATA_MODES).toEqual(['with', 'missing']);
    expect(SPECIES_SORTS).toEqual(['name', 'completeness']);
  });
});

describe('RFC-60 R6, RFC-69 R1 speciesListItemSchema trait coverage fields', () => {
  it('requires traitCount and nullable traitRecordCount', () => {
    const ITEM = {
      id: uuid,
      canonicalName: 'Adenanthera pavonina',
      nameSource: 'wcvp',
      active: true,
      genus: null,
      family: null,
      matchedName: null,
      matchedNameType: null,
      unresolvedTaxon: false,
      traitCount: 3,
      traitRecordCount: null,
    };
    expect(speciesListItemSchema.parse(ITEM)).toEqual(ITEM);
    expect(speciesListItemSchema.safeParse({ ...ITEM, traitRecordCount: 5 }).success).toBe(true);
    expect(speciesListItemSchema.safeParse({ ...ITEM, traitRecordCount: -1 }).success).toBe(false);
    const { traitCount: _tc, ...withoutTraitCount } = ITEM;
    expect(speciesListItemSchema.safeParse(withoutTraitCount).success).toBe(false);
    const { traitRecordCount: _trc, ...withoutTraitRecordCount } = ITEM;
    expect(speciesListItemSchema.safeParse(withoutTraitRecordCount).success).toBe(false);
  });
});

const BASE_TRAIT = {
  id: uuid,
  key: 'sexual_system',
  valueType: 'categorical' as const,
  unit: null,
  description: 'Distribution of male and female function among individuals.',
  active: true,
  levels: [],
  speciesCount: 5,
};

describe('RFC-62 R5 traitSchema carries speciesCount', () => {
  it('requires a non-negative integer speciesCount', () => {
    expect(traitSchema.parse(BASE_TRAIT)).toEqual(BASE_TRAIT);
    expect(traitSchema.safeParse({ ...BASE_TRAIT, speciesCount: -1 }).success).toBe(false);
    expect(traitSchema.safeParse({ ...BASE_TRAIT, speciesCount: 1.5 }).success).toBe(false);
    const { speciesCount: _sc, ...withoutSpeciesCount } = BASE_TRAIT;
    expect(traitSchema.safeParse(withoutSpeciesCount).success).toBe(false);
  });
});

describe('RFC-62 R5 listTraitsQuerySchema', () => {
  it('filters are optional and bounded; valueType matches the vocabulary', () => {
    expect(listTraitsQuerySchema.parse({})).toEqual({});
    expect(
      listTraitsQuerySchema.parse({ categoryKey: 'seed', valueType: 'quantitative', q: 'mass' }),
    ).toEqual({ categoryKey: 'seed', valueType: 'quantitative', q: 'mass' });
    expect(listTraitsQuerySchema.safeParse({ valueType: 'nope' }).success).toBe(false);
    expect(listTraitsQuerySchema.safeParse({ categoryKey: '' }).success).toBe(false);
    expect(listTraitsQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(listTraitsQuerySchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});

describe('RFC-62 R7 traitDetailSchema distribution union', () => {
  const DETAIL_BASE = {
    ...BASE_TRAIT,
    category: { key: 'reproductive_system', label: 'Reproductive system' },
    speciesWithData: 10,
    speciesMissing: 2,
    acceptedCount: 8,
    computedAt: '2026-09-18T00:00:00.000Z',
  };

  it('accepts a categorical distribution (levels)', () => {
    const detail = {
      ...DETAIL_BASE,
      distribution: {
        levels: [{ level: { id: uuid, key: 'dioecious' }, speciesCount: 4, recordCount: 6 }],
      },
    };
    expect(traitDetailSchema.parse(detail)).toEqual(detail);
  });

  it('accepts a quantitative distribution (numeric, possibly null)', () => {
    const detail = {
      ...DETAIL_BASE,
      distribution: { numeric: { min: 0.5, median: 1.25, max: 3, speciesCount: 3 } },
    };
    expect(traitDetailSchema.parse(detail)).toEqual(detail);
    expect(
      traitDetailSchema.safeParse({ ...DETAIL_BASE, distribution: { numeric: null } }).success,
    ).toBe(true);
  });

  it('rejects a distribution that matches neither union member', () => {
    expect(
      traitDetailSchema.safeParse({ ...DETAIL_BASE, distribution: { levels: [], numeric: null } })
        .success,
    ).toBe(false);
    expect(
      traitDetailSchema.safeParse({ ...DETAIL_BASE, distribution: { foo: 'bar' } }).success,
    ).toBe(false);
  });

  it('rejects a negative speciesMissing', () => {
    expect(
      traitDetailSchema.safeParse({
        ...DETAIL_BASE,
        speciesMissing: -1,
        distribution: { numeric: null },
      }).success,
    ).toBe(false);
  });

  it('rejects a negative speciesCount or recordCount in a distribution level', () => {
    const level = { level: { id: uuid, key: 'dioecious' }, speciesCount: 4, recordCount: 6 };
    expect(
      traitDetailSchema.safeParse({
        ...DETAIL_BASE,
        distribution: { levels: [{ ...level, speciesCount: -1 }] },
      }).success,
    ).toBe(false);
    expect(
      traitDetailSchema.safeParse({
        ...DETAIL_BASE,
        distribution: { levels: [{ ...level, recordCount: -1 }] },
      }).success,
    ).toBe(false);
  });
});

describe('RFC-62 R8 listTraitSpeciesQuerySchema', () => {
  it('mode is with|missing; filters follow the species list', () => {
    expect(TRAIT_SPECIES_MODES).toEqual(['with', 'missing']);
    expect(listTraitSpeciesQuerySchema.parse({ mode: 'with' }).mode).toBe('with');
    expect(listTraitSpeciesQuerySchema.safeParse({ mode: 'nope' }).success).toBe(false);
    expect(
      listTraitSpeciesQuerySchema.safeParse({
        mode: 'missing',
        q: 'ad',
        familyId: uuid,
        genusId: uuid,
        scope: 'plots',
        plotId: uuid,
      }).success,
    ).toBe(true);
    expect(listTraitSpeciesQuerySchema.safeParse({ scope: 'nope' }).success).toBe(false);
    expect(listTraitSpeciesQuerySchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});

describe('RFC-62 R8 traitSpeciesItemSchema', () => {
  const ITEM_BASE = {
    id: uuid,
    canonicalName: 'Adenanthera pavonina',
    nameSource: 'wcvp',
    active: true,
    genus: null,
    family: null,
    matchedName: null,
    matchedNameType: null,
    unresolvedTaxon: false,
    traitCount: 3,
    traitRecordCount: null,
  };

  it('accepted carries a reference with shortCitation; everything is nullable for missing mode', () => {
    const item = {
      ...ITEM_BASE,
      recordCount: 2,
      accepted: {
        recordId: uuid,
        valueText: 'dioecious',
        reference: {
          id: uuid,
          citationKey: 'Smith2001',
          kind: 'publication',
          shortCitation: null,
        },
      },
      summary: { levels: [{ key: 'dioecious', count: 2 }] },
    };
    expect(traitSpeciesItemSchema.parse(item)).toEqual(item);
    expect(
      traitSpeciesItemSchema.safeParse({
        ...item,
        recordCount: null,
        accepted: null,
        summary: null,
      }).success,
    ).toBe(true);
  });

  it('summary is either levels or numeric, never both; recordCount is non-negative', () => {
    const numericItem = {
      ...ITEM_BASE,
      recordCount: 1,
      accepted: null,
      summary: { numeric: { min: 1, max: 3 } },
    };
    expect(traitSpeciesItemSchema.parse(numericItem)).toEqual(numericItem);
    expect(
      traitSpeciesItemSchema.safeParse({
        ...numericItem,
        summary: { levels: [], numeric: { min: 1, max: 3 } },
      }).success,
    ).toBe(false);
    expect(traitSpeciesItemSchema.safeParse({ ...numericItem, recordCount: -1 }).success).toBe(
      false,
    );
  });

  it('rejects a negative count in a summary level', () => {
    const item = {
      ...ITEM_BASE,
      recordCount: 2,
      accepted: null,
      summary: { levels: [{ key: 'dioecious', count: -1 }] },
    };
    expect(traitSpeciesItemSchema.safeParse(item).success).toBe(false);
  });

  it('rejects an unknown key (strict)', () => {
    expect(
      traitSpeciesItemSchema.safeParse({
        ...ITEM_BASE,
        recordCount: null,
        accepted: null,
        summary: null,
        extra: 1,
      }).success,
    ).toBe(false);
  });
});
