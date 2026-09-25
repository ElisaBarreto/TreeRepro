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
};

// Named separately (not indexed out of the array below) so the strictness
// cases can reference them directly: noUncheckedIndexedAccess makes
// `array[0]` possibly undefined even when the array literal is right there.
const scopePlot = { id: uuid, code: 'P1', name: 'Plot One', speciesCount: 12 };
const topTraitWithData = {
  trait: { id: uuid, key: 'flower_color', valueType: 'categorical', unit: null },
  category: { key: 'flower', label: 'Flower' },
  speciesCount: 7,
};

const dashboard = {
  dataset: {
    speciesCount: 120,
    referenceCount: 40,
    primaryReferenceCount: 35,
    secondaryReferenceCount: 9,
    recordCount: 900,
    computedAt: '2026-09-18T00:00:00.000Z',
  },
  scope: {
    plots: [scopePlot],
    speciesCount: 12,
    restricted: false,
  },
  contributor: {
    missingCells: 5,
    awaitingValidation: { count: 1, records: [record] },
    topTraitsWithData: [topTraitWithData],
    summary,
  },
  curation: {
    coverage: {
      cells: 100,
      withData: 60,
      validated: 40,
      percentWithData: 60,
      percentValidated: 40,
    },
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

  it('requires the primary and the secondary reference counts', () => {
    for (const field of ['primaryReferenceCount', 'secondaryReferenceCount']) {
      expect(
        dashboardSchema.safeParse({
          ...dashboard,
          dataset: { ...dashboard.dataset, [field]: undefined },
        }).success,
      ).toBe(false);
    }
  });

  it('rejects the retired topMissingTraits key', () => {
    expect(
      dashboardSchema.safeParse({
        ...dashboard,
        contributor: { ...dashboard.contributor, topMissingTraits: [] },
      }).success,
    ).toBe(false);
  });
});

// [path, mutate]: each `mutate` returns `dashboard` with an unrecognised
// `extra` key spliced into exactly one nested strictObject, so a future edit
// that swaps one of these builders for `z.object` (losing strictness) is
// caught at the right path, not just as "some parse failed somewhere".
const NESTED_STRICT_OBJECT_CASES: [path: string, mutate: () => unknown][] = [
  ['scope', () => ({ ...dashboard, scope: { ...dashboard.scope, extra: 1 } })],
  [
    'scope.plots.0',
    () => ({
      ...dashboard,
      scope: { ...dashboard.scope, plots: [{ ...scopePlot, extra: 1 }] },
    }),
  ],
  ['contributor', () => ({ ...dashboard, contributor: { ...dashboard.contributor, extra: 1 } })],
  [
    'contributor.awaitingValidation',
    () => ({
      ...dashboard,
      contributor: {
        ...dashboard.contributor,
        awaitingValidation: { ...dashboard.contributor.awaitingValidation, extra: 1 },
      },
    }),
  ],
  [
    'contributor.topTraitsWithData.0',
    () => ({
      ...dashboard,
      contributor: {
        ...dashboard.contributor,
        topTraitsWithData: [{ ...topTraitWithData, extra: 1 }],
      },
    }),
  ],
  [
    'contributor.topTraitsWithData.0.category',
    () => ({
      ...dashboard,
      contributor: {
        ...dashboard.contributor,
        topTraitsWithData: [
          { ...topTraitWithData, category: { ...topTraitWithData.category, extra: 1 } },
        ],
      },
    }),
  ],
  [
    'curation.coverage',
    () => ({
      ...dashboard,
      curation: { ...dashboard.curation, coverage: { ...dashboard.curation.coverage, extra: 1 } },
    }),
  ],
  [
    'curation.queues',
    () => ({
      ...dashboard,
      curation: { ...dashboard.curation, queues: { ...dashboard.curation.queues, extra: 1 } },
    }),
  ],
];

describe('RFC-72 R1 dashboardSchema — every nested strictObject rejects an unknown key', () => {
  for (const [path, mutate] of NESTED_STRICT_OBJECT_CASES) {
    it(`rejects an unknown key at ${path}`, () => {
      // zod's unrecognized_keys issue is reported at the offending object's
      // own path (the key name lands in `issue.keys`, not appended to the
      // path), so pinning `path` here is what proves *this* strictObject
      // rejected it, not merely that something in the payload failed.
      const result = dashboardSchema.safeParse(mutate());
      const issuePaths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
      expect(issuePaths).toContain(path);
    });
  }
});
