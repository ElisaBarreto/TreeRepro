import { describe, expect, it } from 'vitest';
import {
  coverageQuerySchema,
  coverageRowSchema,
  coverageSchema,
  coverageTopQuerySchema,
  coverageTraitRowSchema,
} from './coverage.ts';

const uuid = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e';

const trait = { id: uuid, key: 'flower_color', valueType: 'categorical', unit: null };
const category = { key: 'flower', label: 'Flower' };

const traitRow = {
  cells: 12,
  withData: 9,
  accepted: 6,
  percentWithData: 75,
  percentAccepted: 50,
  trait,
  category,
  species: 9,
};

const categoryRow = {
  cells: 24,
  withData: 18,
  accepted: 12,
  percentWithData: 75,
  percentAccepted: 50,
  category,
  traits: 2,
};

const coverage = {
  species: 12,
  traits: 2,
  cells: 24,
  withData: 18,
  accepted: 12,
  percentWithData: 75,
  percentAccepted: 50,
  byCategory: [categoryRow],
  byTrait: [traitRow],
  computedAt: '2026-09-18T00:00:00.000Z',
};

describe('RFC-69 R5 coverageQuerySchema', () => {
  it('parses filters, all of them optional', () => {
    expect(coverageQuerySchema.parse({})).toEqual({});
    expect(
      coverageQuerySchema.parse({ familyId: uuid, categoryKey: 'flower', plotId: uuid }),
    ).toEqual({ familyId: uuid, categoryKey: 'flower', plotId: uuid });
  });

  it('rejects a non-uuid familyId', () => {
    expect(coverageQuerySchema.safeParse({ familyId: 'nope' }).success).toBe(false);
  });

  it('rejects an unknown key', () => {
    expect(coverageQuerySchema.safeParse({ scope: 'plots' }).success).toBe(false);
  });
});

describe('RFC-69 R5 coverageRowSchema — percentages share one definition', () => {
  it('parses a row with percentWithData = withData/cells and percentAccepted = accepted/cells, both rounded', () => {
    expect(
      coverageRowSchema.parse({
        cells: 24,
        withData: 18,
        accepted: 12,
        percentWithData: 75,
        percentAccepted: 50,
      }),
    ).toEqual({ cells: 24, withData: 18, accepted: 12, percentWithData: 75, percentAccepted: 50 });
  });

  it('rejects a percentage above 100', () => {
    expect(
      coverageRowSchema.safeParse({
        cells: 1,
        withData: 1,
        accepted: 1,
        percentWithData: 101,
        percentAccepted: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects a negative count', () => {
    expect(
      coverageRowSchema.safeParse({
        cells: -1,
        withData: 0,
        accepted: 0,
        percentWithData: 0,
        percentAccepted: 0,
      }).success,
    ).toBe(false);
  });
});

describe('RFC-69 R5 coverageTraitRowSchema — cells is the species count, species equals withData', () => {
  it('parses a byTrait row', () => {
    expect(coverageTraitRowSchema.parse(traitRow)).toEqual(traitRow);
  });

  it('accepts species equal to withData (the row is one trait: species counted is the same count as withData)', () => {
    expect(
      coverageTraitRowSchema.safeParse({ ...traitRow, species: traitRow.withData }).success,
    ).toBe(true);
  });

  it('rejects an unknown key', () => {
    expect(coverageTraitRowSchema.safeParse({ ...traitRow, extra: 1 }).success).toBe(false);
  });
});

describe('RFC-69 R5 coverageSchema', () => {
  it('parses a full valid coverage payload', () => {
    expect(coverageSchema.parse(coverage)).toEqual(coverage);
  });

  it('rejects an unknown top-level key', () => {
    expect(coverageSchema.safeParse({ ...coverage, extra: 1 }).success).toBe(false);
  });

  it('rejects an unknown key in a byCategory row', () => {
    const result = coverageSchema.safeParse({
      ...coverage,
      byCategory: [{ ...categoryRow, extra: 1 }],
    });
    const issuePaths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(issuePaths).toContain('byCategory.0');
  });

  it('rejects an unknown key in a byTrait row', () => {
    const result = coverageSchema.safeParse({
      ...coverage,
      byTrait: [{ ...traitRow, extra: 1 }],
    });
    const issuePaths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(issuePaths).toContain('byTrait.0');
  });

  it('rejects an unknown key in a byTrait row category', () => {
    const result = coverageSchema.safeParse({
      ...coverage,
      byTrait: [{ ...traitRow, category: { ...category, extra: 1 } }],
    });
    const issuePaths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(issuePaths).toContain('byTrait.0.category');
  });

  it('rejects a non-datetime computedAt', () => {
    expect(coverageSchema.safeParse({ ...coverage, computedAt: '2026-09-18' }).success).toBe(false);
  });
});

describe('RFC-69 R7 coverageTopQuerySchema', () => {
  it('parses mode and limit, both optional', () => {
    expect(coverageTopQuerySchema.parse({})).toEqual({});
    expect(coverageTopQuerySchema.parse({ mode: 'missing', limit: 10 })).toEqual({
      mode: 'missing',
      limit: 10,
    });
  });

  it('coerces a string limit (query params arrive as strings)', () => {
    expect(coverageTopQuerySchema.parse({ limit: '5' })).toEqual({ limit: 5 });
  });

  it('rejects a limit above 50', () => {
    expect(coverageTopQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
  });

  it('rejects a limit below 1', () => {
    expect(coverageTopQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('rejects an unknown mode', () => {
    expect(coverageTopQuerySchema.safeParse({ mode: 'everything' }).success).toBe(false);
  });
});
