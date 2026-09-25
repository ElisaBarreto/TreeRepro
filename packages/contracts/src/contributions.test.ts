import { describe, expect, it } from 'vitest';
import {
  CONTRIBUTION_KINDS,
  contributionAnnotationSchema,
  contributionRecordSchema,
  contributionSummarySchema,
  listContributionsQuerySchema,
} from './contributions.ts';

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

describe('RFC-71 R1 listContributionsQuerySchema', () => {
  it('requires kind', () => {
    const failed = listContributionsQuerySchema.safeParse({});
    expect(failed.success).toBe(false);
    expect(failed.success ? [] : failed.error.issues.map((i) => i.path.join('.'))).toEqual([
      'kind',
    ]);
  });

  it('accepts a `to` earlier than `from`: the API answers an empty page, not a validation error', () => {
    expect(
      listContributionsQuerySchema.safeParse({
        kind: 'records',
        from: '2026-09-18',
        to: '2026-01-01',
      }).success,
    ).toBe(true);
  });

  it('accepts every filter and coerces limit like every other cursor query', () => {
    expect(
      listContributionsQuerySchema.parse({
        kind: 'annotations',
        traitId: uuid,
        speciesId: uuid,
        review: 'confirmed',
        intent: 'contest',
        from: '2026-01-01',
        to: '2026-09-18',
        limit: '10',
      }),
    ).toEqual({
      kind: 'annotations',
      traitId: uuid,
      speciesId: uuid,
      review: 'confirmed',
      intent: 'contest',
      from: '2026-01-01',
      to: '2026-09-18',
      limit: 10,
    });
  });

  it('intent additionally allows `none`, beyond RECORD_INTENTS', () => {
    expect(
      listContributionsQuerySchema.safeParse({ kind: 'records', intent: 'none' }).success,
    ).toBe(true);
    expect(
      listContributionsQuerySchema.safeParse({ kind: 'records', intent: 'complement' }).success,
    ).toBe(true);
    expect(
      listContributionsQuerySchema.safeParse({ kind: 'records', intent: 'nope' }).success,
    ).toBe(false);
  });

  it('rejects a kind outside CONTRIBUTION_KINDS and unknown query keys', () => {
    expect(listContributionsQuerySchema.safeParse({ kind: 'trees' }).success).toBe(false);
    expect(listContributionsQuerySchema.safeParse({ kind: 'records', extra: 1 }).success).toBe(
      false,
    );
  });

  it('CONTRIBUTION_KINDS matches the RFC', () => {
    expect(CONTRIBUTION_KINDS).toEqual(['records', 'annotations']);
  });
});

describe('RFC-71 R2 contributionRecordSchema', () => {
  it('is a record item plus responseCount', () => {
    const contribution = { ...record, responseCount: 2 };
    expect(contributionRecordSchema.parse(contribution)).toEqual(contribution);
    expect(contributionRecordSchema.safeParse(record).success).toBe(false);
    expect(contributionRecordSchema.safeParse({ ...contribution, isAccepted: true }).success).toBe(
      false,
    );
    expect(contributionRecordSchema.safeParse({ ...contribution, responseCount: -1 }).success).toBe(
      false,
    );
    expect(contributionRecordSchema.safeParse({ ...contribution, extra: 1 }).success).toBe(false);
  });
});

describe('RFC-71 R3 contributionAnnotationSchema', () => {
  it('carries the annotation plus its full record, and generated stays exposed', () => {
    const annotation = {
      id: uuid,
      kind: 'confirm',
      note: null,
      reference: null,
      generated: false,
      createdAt: '2026-09-13T00:00:00.000Z',
      record,
    };
    expect(contributionAnnotationSchema.parse(annotation)).toEqual(annotation);
    expect(contributionAnnotationSchema.safeParse({ ...annotation, kind: 'weird' }).success).toBe(
      false,
    );
    expect(
      contributionAnnotationSchema.safeParse({ ...annotation, generated: undefined }).success,
    ).toBe(false);
    expect(contributionAnnotationSchema.safeParse({ ...annotation, extra: 1 }).success).toBe(false);
  });
});

describe('RFC-71 R4 contributionSummarySchema', () => {
  it('is six non-negative integer counts, and no longer accepted', () => {
    const summary = {
      records: 3,
      contests: 1,
      complements: 0,
      validations: 2,
      disputes: 0,
      withdrawn: 1,
    };
    expect(contributionSummarySchema.parse(summary)).toEqual(summary);
    expect(contributionSummarySchema.safeParse({ ...summary, records: -1 }).success).toBe(false);
    expect(contributionSummarySchema.safeParse({ ...summary, records: 1.5 }).success).toBe(false);
    expect(contributionSummarySchema.safeParse({ ...summary, extra: 1 }).success).toBe(false);
    expect(contributionSummarySchema.safeParse({ ...summary, accepted: 2 }).success).toBe(false);
    const { records: _records, ...missingRecords } = summary;
    expect(contributionSummarySchema.safeParse(missingRecords).success).toBe(false);
  });
});
