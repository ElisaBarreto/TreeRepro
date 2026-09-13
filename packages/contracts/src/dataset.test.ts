import { describe, expect, it } from 'vitest';
import {
  HARMONISATION_STATUSES,
  importBatchSchema,
  listGeneraQuerySchema,
  listRecordsQuerySchema,
  listSpeciesQuerySchema,
  REVIEW_STATUSES,
  recordSchema,
  speciesTraitsSchema,
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
      trait: { id: uuid, key: 'flower_color', valueType: 'categorical', unit: null },
      valueText: 'blue',
      level: { id: uuid, key: 'blue' },
      numericValue: null,
      harmonisation: 'harmonised',
      review: 'unreviewed',
      primaryReference: { id: uuid, citationKey: 'A_2020' },
      secondaryReference: null,
      origin: 'import',
      createdAt: '2026-09-13T00:00:00.000Z',
      createdBy: null,
    };
    expect(recordSchema.parse(record)).toEqual(record);
    expect(recordSchema.safeParse({ ...record, extra: true }).success).toBe(false);
    expect(recordSchema.safeParse({ ...record, harmonisation: 'weird' }).success).toBe(false);
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

describe('RFC-64 R11 importBatchSchema', () => {
  it('parses a completed batch', () => {
    const batch = {
      id: uuid,
      fileName: 'sample.csv',
      fileSha256: 'a'.repeat(64),
      status: 'completed',
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
