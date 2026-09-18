import { describe, expect, it } from 'vitest';
import { dashboardSchema } from './dashboard.ts';

const uuid = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e';

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
  primaryReference: null,
  secondaryReference: null,
  origin: 'manual',
  createdAt: '2026-09-13T00:00:00.000Z',
  createdBy: { id: uuid, name: 'Ada' },
  intent: null,
  respondsTo: null,
};

const summary = {
  records: 3,
  contests: 1,
  complements: 0,
  validations: 2,
  disputes: 0,
  withdrawn: 1,
  accepted: 2,
};

const dashboard = {
  dataset: {
    speciesCount: 120,
    referenceCount: 40,
    recordCount: 900,
    computedAt: '2026-09-18T00:00:00.000Z',
  },
  scope: {
    plots: [{ id: uuid, code: 'P1', name: 'Plot One', speciesCount: 12 }],
    speciesCount: 12,
    restricted: false,
  },
  contributor: {
    missingCells: 5,
    awaitingValidation: { count: 1, records: [record] },
    topMissingTraits: [
      {
        trait: { id: uuid, key: 'flower_color', valueType: 'categorical', unit: null },
        category: { key: 'flower', label: 'Flower' },
        missingSpeciesCount: 3,
      },
    ],
    summary,
  },
  curation: {
    coverage: { cells: 100, withData: 60, accepted: 40, percentWithData: 60, percentAccepted: 40 },
    queues: { pendingGroups: 2, disputed: 1, contested: 0, proposals: 0 },
  },
};

describe('RFC-72 R1 dashboardSchema', () => {
  it('parses a full valid dashboard payload', () => {
    expect(dashboardSchema.parse(dashboard)).toEqual(dashboard);
  });

  it('accepts scope: null for a viewer with no plots', () => {
    expect(dashboardSchema.safeParse({ ...dashboard, scope: null }).success).toBe(true);
  });

  it('accepts curation: null for a viewer without records.review', () => {
    expect(dashboardSchema.safeParse({ ...dashboard, curation: null }).success).toBe(true);
  });

  it('accepts contributor.missingCells and awaitingValidation as null for a viewer without plots', () => {
    expect(
      dashboardSchema.safeParse({
        ...dashboard,
        contributor: { ...dashboard.contributor, missingCells: null, awaitingValidation: null },
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown top-level key', () => {
    expect(dashboardSchema.safeParse({ ...dashboard, extra: 1 }).success).toBe(false);
  });

  it('rejects an unknown key in a nested strict object', () => {
    expect(
      dashboardSchema.safeParse({
        ...dashboard,
        dataset: { ...dashboard.dataset, extra: 1 },
      }).success,
    ).toBe(false);
    expect(
      dashboardSchema.safeParse({
        ...dashboard,
        curation: { ...dashboard.curation, extra: 1 },
      }).success,
    ).toBe(false);
  });
});
