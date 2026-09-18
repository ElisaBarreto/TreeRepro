import { describe, expect, it } from 'vitest';
import {
  annotateRecordBodySchema,
  createLevelBodySchema,
  createRecordBodySchema,
  createReferenceBodySchema,
  disputedRecordSchema,
  listDisputedQuerySchema,
  mapPendingBodySchema,
  pendingGroupsQuerySchema,
  resolveDoiResultSchema,
  setAcceptedBodySchema,
  updateGenusBodySchema,
  updateReferenceBodySchema,
  updateTraitBodySchema,
} from './curation.ts';
import { cursorQuerySchema } from './pagination.ts';

const uuid = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e';
const other = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9f';

const record = {
  id: uuid,
  speciesId: uuid,
  species: { id: uuid, canonicalName: 'Testus specimen' },
  trait: { id: uuid, key: 'flower_color', valueType: 'categorical', unit: null },
  valueText: 'blue',
  level: { id: uuid, key: 'blue' },
  numericValue: null,
  harmonisation: 'harmonised',
  review: 'disputed',
  primaryReference: null,
  secondaryReference: null,
  origin: 'manual',
  createdAt: '2026-09-13T00:00:00.000Z',
  createdBy: { id: uuid, name: 'Ada' },
  intent: null,
  respondsTo: null,
};

describe('RFC-65 R1 createRecordBodySchema', () => {
  const base = { speciesId: uuid, traitId: uuid, sources: { references: [{ id: uuid }] } };
  it('accepts a level or a finite number below 1e308; trims rawValue and note', () => {
    expect(
      createRecordBodySchema.parse({ ...base, value: { levelId: uuid }, rawValue: ' Aug ' }),
    ).toMatchObject({
      value: { levelId: uuid },
      rawValue: 'Aug',
    });
    expect(createRecordBodySchema.safeParse({ ...base, value: { numeric: 12.5 } }).success).toBe(
      true,
    );
    expect(createRecordBodySchema.safeParse({ ...base, value: { numeric: 1e308 } }).success).toBe(
      false,
    );
    expect(
      createRecordBodySchema.safeParse({ ...base, value: { numeric: Number.NaN } }).success,
    ).toBe(false);
    expect(createRecordBodySchema.safeParse({ ...base, value: { text: 'red' } }).success).toBe(
      false,
    );
    expect(
      createRecordBodySchema.safeParse({ ...base, value: { levelId: uuid, numeric: 1 } }).success,
    ).toBe(false);
    expect(
      createRecordBodySchema.safeParse({
        ...base,
        value: { levelId: uuid },
        note: 'x'.repeat(2001),
      }).success,
    ).toBe(false);
    expect(
      createRecordBodySchema.safeParse({ ...base, value: { levelId: uuid }, extra: 1 }).success,
    ).toBe(false);
  });

  it('refuses intent without respondsToRecordId', () => {
    expect(
      createRecordBodySchema.safeParse({ ...base, value: { numeric: 1 }, intent: 'contest' })
        .success,
    ).toBe(false);
    expect(
      createRecordBodySchema.safeParse({ ...base, value: { numeric: 1 }, respondsToRecordId: uuid })
        .success,
    ).toBe(false);
    expect(
      createRecordBodySchema.safeParse({
        ...base,
        value: { numeric: 1 },
        intent: 'contest',
        respondsToRecordId: uuid,
      }).success,
    ).toBe(true);
  });

  it('refuses 11 references; accepts { personalObservation: true }', () => {
    expect(
      createRecordBodySchema.safeParse({
        ...base,
        value: { numeric: 1 },
        sources: { references: Array(11).fill({ id: uuid }) },
      }).success,
    ).toBe(false);
    expect(
      createRecordBodySchema.safeParse({
        ...base,
        value: { numeric: 1 },
        sources: { personalObservation: true },
      }).success,
    ).toBe(true);
  });
});

describe('RFC-65 R3 annotateRecordBodySchema', () => {
  it('requires a note for dispute and withdraw only', () => {
    expect(annotateRecordBodySchema.safeParse({ kind: 'confirm' }).success).toBe(true);
    expect(annotateRecordBodySchema.safeParse({ kind: 'neutral' }).success).toBe(true);
    expect(annotateRecordBodySchema.safeParse({ kind: 'dispute' }).success).toBe(false);
    expect(annotateRecordBodySchema.safeParse({ kind: 'withdraw', note: '  ' }).success).toBe(
      false,
    );
    expect(
      annotateRecordBodySchema.safeParse({ kind: 'dispute', note: 'Table 2 says otherwise' })
        .success,
    ).toBe(true);
    const missing = annotateRecordBodySchema.safeParse({ kind: 'dispute' });
    expect(missing.success ? [] : missing.error.issues.map((i) => i.path.join('.'))).toContain(
      'note',
    );
  });

  it('refuses reference with kind: dispute', () => {
    expect(
      annotateRecordBodySchema.safeParse({
        kind: 'dispute',
        note: 'Wrong',
        reference: { id: uuid },
      }).success,
    ).toBe(false);
    expect(
      annotateRecordBodySchema.safeParse({ kind: 'confirm', reference: { id: uuid } }).success,
    ).toBe(true);
  });
});

describe('RFC-80 resolveDoiResultSchema', () => {
  it('parses each variant', () => {
    expect(resolveDoiResultSchema.safeParse({ status: 'not_found', reference: null }).success).toBe(
      true,
    );
    expect(
      resolveDoiResultSchema.safeParse({
        status: 'resolvable',
        reference: null,
        preview: { title: 'T', authors: 'A', year: 2020, journal: 'J' },
      }).success,
    ).toBe(true);
    expect(
      resolveDoiResultSchema.safeParse({
        status: 'known',
        reference: {
          id: uuid,
          citationKey: 'K',
          kind: 'publication',
          createdAt: new Date().toISOString(),
          primaryCount: 0,
          secondaryCount: 0,
          title: null,
          authors: null,
          year: null,
          journal: null,
          doi: null,
          url: null,
          observer: null,
        },
      }).success,
    ).toBe(true);
  });
});

describe('RFC-65 R6 setAcceptedBodySchema', () => {
  it('accepts a record or a cleared decision with a note', () => {
    expect(setAcceptedBodySchema.safeParse({ decision: 'accepted', recordId: uuid }).success).toBe(
      true,
    );
    expect(
      setAcceptedBodySchema.safeParse({ decision: 'cleared', note: 'Sources disagree' }).success,
    ).toBe(true);
    expect(setAcceptedBodySchema.safeParse({ decision: 'cleared' }).success).toBe(false);
    expect(setAcceptedBodySchema.safeParse({ decision: 'accepted' }).success).toBe(false);
    expect(setAcceptedBodySchema.safeParse({ recordId: uuid }).success).toBe(false);
  });
});

describe('RFC-65 R8, R9 pending queue', () => {
  it('pendingGroupsQuerySchema requires traitId; cursors may be long', () => {
    expect(pendingGroupsQuerySchema.safeParse({}).success).toBe(false);
    expect(pendingGroupsQuerySchema.parse({ traitId: uuid, limit: '5' })).toEqual({
      traitId: uuid,
      limit: 5,
    });
    expect(cursorQuerySchema.safeParse({ cursor: 'a'.repeat(3000) }).success).toBe(true);
    expect(cursorQuerySchema.safeParse({ cursor: 'a'.repeat(5000) }).success).toBe(false);
  });

  it('mapPendingBodySchema takes 1–20 distinct levels or one number', () => {
    const base = { traitId: uuid, valueText: 'reds' };
    expect(mapPendingBodySchema.safeParse({ ...base, value: { levelIds: [uuid] } }).success).toBe(
      true,
    );
    expect(
      mapPendingBodySchema.safeParse({ ...base, value: { levelIds: [uuid, other] } }).success,
    ).toBe(true);
    expect(mapPendingBodySchema.safeParse({ ...base, value: { levelIds: [] } }).success).toBe(
      false,
    );
    expect(
      mapPendingBodySchema.safeParse({ ...base, value: { levelIds: [uuid, uuid] } }).success,
    ).toBe(false);
    expect(
      mapPendingBodySchema.safeParse({
        ...base,
        value: {
          levelIds: Array(21)
            .fill(uuid)
            .map((u, i) => u.slice(0, -2) + String(i).padStart(2, '0')),
        },
      }).success,
    ).toBe(false);
    expect(mapPendingBodySchema.safeParse({ ...base, value: { numeric: 3 } }).success).toBe(true);
    expect(
      mapPendingBodySchema.safeParse({ traitId: uuid, valueText: '', value: { numeric: 3 } })
        .success,
    ).toBe(false);
  });
});

describe('RFC-65 R10 listDisputedQuerySchema', () => {
  it('accepts intent: contest, accepts its absence, and rejects any other value', () => {
    expect(listDisputedQuerySchema.safeParse({ intent: 'contest' }).success).toBe(true);
    expect(listDisputedQuerySchema.safeParse({}).success).toBe(true);
    expect(listDisputedQuerySchema.safeParse({ intent: 'complement' }).success).toBe(false);
    expect(listDisputedQuerySchema.safeParse({ intent: 'none' }).success).toBe(false);
  });
});

describe('RFC-65 R10 disputedRecordSchema contestedBy', () => {
  const latestDispute = {
    id: uuid,
    actor: { id: uuid, name: 'Ada' },
    note: 'Wrong',
    createdAt: '2026-09-13T00:00:00.000Z',
  };
  const contestingRecord = { id: other, valueText: 'red', createdBy: { id: uuid, name: 'Ada' } };
  const withContests = {
    ...record,
    latestDispute,
    contestedBy: [contestingRecord],
  };

  it('parses a populated contestedBy and an empty one, and requires the field', () => {
    expect(disputedRecordSchema.safeParse(withContests).success).toBe(true);
    expect(disputedRecordSchema.safeParse({ ...withContests, contestedBy: [] }).success).toBe(true);
    const { contestedBy: _contestedBy, ...missingContestedBy } = withContests;
    expect(disputedRecordSchema.safeParse(missingContestedBy).success).toBe(false);
    expect(
      disputedRecordSchema.safeParse({
        ...withContests,
        contestedBy: [{ id: other, valueText: 'red', createdBy: null }],
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown key in a contestedBy entry', () => {
    const result = disputedRecordSchema.safeParse({
      ...withContests,
      contestedBy: [{ ...contestingRecord, extra: 1 }],
    });
    // zod reports unrecognized_keys at the offending object's own path.
    const issuePaths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(issuePaths).toContain('contestedBy.0');
  });
});

describe('RFC-60 R9, RFC-61 R6, RFC-62 R6 catalog bodies', () => {
  it('updates need at least one field; null clears reference metadata but never the citation key', () => {
    expect(updateGenusBodySchema.safeParse({}).success).toBe(false);
    expect(updateGenusBodySchema.safeParse({ familyId: null }).success).toBe(true);
    expect(updateTraitBodySchema.safeParse({ active: false }).success).toBe(true);
    expect(updateTraitBodySchema.safeParse({ key: 'renamed' }).success).toBe(false);
    expect(updateReferenceBodySchema.safeParse({ doi: null }).success).toBe(true);
    expect(updateReferenceBodySchema.safeParse({ citationKey: null }).success).toBe(false);
    expect(createReferenceBodySchema.safeParse({ citationKey: 'K', year: 1200 }).success).toBe(
      false,
    );
    expect(createReferenceBodySchema.parse({ citationKey: ' Key_2020 ' })).toEqual({
      citationKey: 'Key_2020',
    });
  });

  it('createLevelBodySchema rejects a sortOrder outside the integer column range', () => {
    expect(createLevelBodySchema.safeParse({ key: 'a', sortOrder: -1 }).success).toBe(false);
    expect(createLevelBodySchema.safeParse({ key: 'a', sortOrder: 2147483647 }).success).toBe(true);
    expect(createLevelBodySchema.safeParse({ key: 'a', sortOrder: 2147483648 }).success).toBe(
      false,
    );
  });
});
