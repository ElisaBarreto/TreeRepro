import { describe, expect, it } from 'vitest';
import {
  annotateRecordBodySchema,
  contestedQueueItemSchema,
  contestParamSchema,
  createLevelBodySchema,
  createRecordBodySchema,
  createRecordsResultSchema,
  createReferenceBodySchema,
  levelActionParamSchema,
  mapPendingBodySchema,
  pendingGroupsQuerySchema,
  resolveDoiResultSchema,
  sourceRefSchema,
  sourcesSchema,
  speciesNameBodySchema,
  updateGenusBodySchema,
  updateReferenceBodySchema,
  updateTraitBodySchema,
  validateLevelBodySchema,
  validateLevelResultSchema,
  withdrawLevelResultSchema,
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
  review: 'contested',
  primaryReference: null,
  secondaryReference: null,
  origin: 'manual',
  createdAt: '2026-09-13T00:00:00.000Z',
  createdBy: { id: uuid, name: 'Ada' },
  intent: null,
  respondsTo: null,
  validationCount: 0,
  contestCount: 0,
  contested: false,
  recordCode: 'EB_1',
  quantitative: null,
  references: [],
};

describe('RFC-65 R1 createRecordBodySchema', () => {
  const base = { speciesId: uuid, traitId: uuid, sources: { references: [{ id: uuid }] } };
  it('accepts a level or a finite number below 1e308; trims rawValue and note', () => {
    expect(
      createRecordBodySchema.parse({ ...base, value: { levelIds: [uuid] }, rawValue: ' Aug ' }),
    ).toMatchObject({
      value: { levelIds: [uuid] },
      rawValue: 'Aug',
    });
    expect(
      createRecordBodySchema.safeParse({ ...base, value: { quantitative: { single: 12.5 } } })
        .success,
    ).toBe(true);
    expect(
      createRecordBodySchema.safeParse({ ...base, value: { quantitative: { single: 1e308 } } })
        .success,
    ).toBe(false);
    expect(
      createRecordBodySchema.safeParse({ ...base, value: { quantitative: { single: Number.NaN } } })
        .success,
    ).toBe(false);
    expect(createRecordBodySchema.safeParse({ ...base, value: { text: 'red' } }).success).toBe(
      false,
    );
    expect(
      createRecordBodySchema.safeParse({
        ...base,
        value: { levelIds: [uuid], quantitative: { single: 1 } },
      }).success,
    ).toBe(false);
    expect(
      createRecordBodySchema.safeParse({
        ...base,
        value: { levelIds: [uuid] },
        note: 'x'.repeat(2001),
      }).success,
    ).toBe(false);
    expect(
      createRecordBodySchema.safeParse({ ...base, value: { levelIds: [uuid] }, extra: 1 }).success,
    ).toBe(false);
  });

  it("RFC-70 R1 takes contestedLevelIds (at most 100, distinct); the intent combination is the server's, once the trait is known", () => {
    const q = { quantitative: { single: 1 } };
    // A categorical contest names no responded record.
    expect(
      createRecordBodySchema.safeParse({
        ...base,
        value: { levelIds: [uuid] },
        intent: 'contest',
        contestedLevelIds: [other],
      }).success,
    ).toBe(true);
    expect(createRecordBodySchema.safeParse({ ...base, value: q, intent: 'contest' }).success).toBe(
      true,
    );
    expect(
      createRecordBodySchema.safeParse({ ...base, value: q, contestedLevelIds: [uuid, uuid] })
        .success,
    ).toBe(false);
    const many = Array.from(
      { length: 101 },
      (_, i) => `018f6a5e-7c3d-7a2b-9c1e-${String(i).padStart(12, '0')}`,
    );
    expect(
      createRecordBodySchema.safeParse({ ...base, value: q, contestedLevelIds: many }).success,
    ).toBe(false);
    expect(
      createRecordBodySchema.safeParse({
        ...base,
        value: q,
        contestedLevelIds: many.slice(0, 100),
      }).success,
    ).toBe(true);
  });

  it('RFC-65 R1 value.levelIds takes one to twenty distinct levels; a single levelId is gone', () => {
    const v = (value: unknown) => createRecordBodySchema.safeParse({ ...base, value }).success;
    expect(v({ levelIds: [uuid, other] })).toBe(true);
    expect(v({ levelIds: [] })).toBe(false);
    expect(v({ levelIds: [uuid, uuid] })).toBe(false);
    expect(v({ levelId: uuid })).toBe(false);
    const ids = Array.from(
      { length: 21 },
      (_, i) => `018f6a5e-7c3d-7a2b-9c1e-${String(i).padStart(12, '0')}`,
    );
    expect(v({ levelIds: ids })).toBe(false);
    expect(v({ levelIds: ids.slice(0, 20) })).toBe(true);
  });

  it('RFC-70 R3 createRecordsResultSchema is { created, validated, duplicates }', () => {
    const ref = { recordId: uuid, recordCode: 'TR_1' };
    expect(
      createRecordsResultSchema.safeParse({
        created: [record],
        validated: [ref],
        duplicates: [ref],
      }).success,
    ).toBe(true);
    expect(createRecordsResultSchema.safeParse({ created: [], duplicates: [] }).success).toBe(
      false,
    );
  });

  it('refuses 11 references; accepts { personalObservation: true }', () => {
    expect(
      createRecordBodySchema.safeParse({
        ...base,
        value: { quantitative: { single: 1 } },
        sources: { references: Array(11).fill({ id: uuid }) },
      }).success,
    ).toBe(false);
    expect(
      createRecordBodySchema.safeParse({
        ...base,
        value: { quantitative: { single: 1 } },
        sources: { personalObservation: true },
      }).success,
    ).toBe(true);
  });

  it('spec R-5 takes the six quantitative fields and refuses min > max', () => {
    expect(
      createRecordBodySchema.safeParse({
        ...base,
        value: { quantitative: { min: 2, max: 8, mean: 4.5, sd: 0.5, n: 12 } },
      }).success,
    ).toBe(true);
    expect(
      createRecordBodySchema.safeParse({ ...base, value: { quantitative: { min: 8, max: 2 } } })
        .success,
    ).toBe(false);
    expect(createRecordBodySchema.safeParse({ ...base, value: { numeric: 1 } }).success).toBe(
      false,
    );
  });
});

describe('RFC-65 R3, RFC-70 R4 annotateRecordBodySchema (spec R-6, R-11, R-12)', () => {
  it('takes confirm (with an optional source) and withdraw only; no note; neutral, dispute and resolve are gone', () => {
    expect(annotateRecordBodySchema.safeParse({ kind: 'confirm' }).success).toBe(true);
    expect(
      annotateRecordBodySchema.safeParse({
        kind: 'confirm',
        referenceSource: { doi: '10.1111/geb.13000' },
      }).success,
    ).toBe(true);
    expect(annotateRecordBodySchema.safeParse({ kind: 'withdraw' }).success).toBe(true);
    for (const bad of [
      { kind: 'neutral' },
      { kind: 'dispute', note: 'x' },
      { kind: 'withdraw', note: 'x' },
      { kind: 'resolve' },
      { kind: 'confirm', reference: { doi: '10.1111/geb.13000' } },
    ]) {
      expect(annotateRecordBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('answers path kind for resolve, neutral and dispute (Keep both moves to the contest routes)', () => {
    for (const kind of ['resolve', 'neutral', 'dispute']) {
      const parsed = annotateRecordBodySchema.safeParse({ kind });
      expect(parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'))).toEqual([
        'kind',
      ]);
    }
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
          shortCitation: null,
          fullCitation: null,
          isbn: null,
        },
      }).success,
    ).toBe(true);
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

describe('RFC-65 R10 contestedQueueItemSchema', () => {
  const item = {
    id: other,
    species: { id: uuid, canonicalName: 'Testus specimen' },
    trait: { id: uuid, key: 'flower_color' },
    createdBy: { id: uuid, name: 'Ada' },
    createdAt: '2026-09-13T00:00:00.000Z',
    levels: [{ levelId: uuid, key: 'blue', contested: true }],
    target: null,
    records: [],
  };

  it('parses a categorical item with no record and a quantitative one with a target', () => {
    expect(contestedQueueItemSchema.safeParse(item).success).toBe(true);
    expect(
      contestedQueueItemSchema.safeParse({
        ...item,
        levels: null,
        target: record,
        records: [record],
      }).success,
    ).toBe(true);
  });

  it('is strict: the trait ref is { id, key } and every field is required', () => {
    expect(contestedQueueItemSchema.safeParse({ ...item, trait: record.trait }).success).toBe(
      false,
    );
    const { records: _records, ...missing } = item;
    expect(contestedQueueItemSchema.safeParse(missing).success).toBe(false);
    expect(
      contestedQueueItemSchema.safeParse({ ...item, levels: [{ levelId: uuid, key: 'blue' }] })
        .success,
    ).toBe(false);
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

  it('accepts shortCitation and fullCitation on create; null clears them on update', () => {
    expect(
      createReferenceBodySchema.safeParse({ citationKey: 'K', shortCitation: 'Smith (2001)' })
        .success,
    ).toBe(true);
    expect(
      createReferenceBodySchema.safeParse({ citationKey: 'K', shortCitation: '' }).success,
    ).toBe(false);
    expect(updateReferenceBodySchema.safeParse({ shortCitation: null }).success).toBe(true);
    expect(updateReferenceBodySchema.safeParse({ fullCitation: null }).success).toBe(true);
  });

  it('RFC-61 R6, R10 takes an ISBN on create and update, never null, always well-formed', () => {
    const book = { citationKey: 'K', isbn: '0-306-40615-2', fullCitation: 'Doe (2001).' };
    expect(createReferenceBodySchema.safeParse(book).success).toBe(true);
    expect(createReferenceBodySchema.safeParse({ ...book, isbn: '0-306-40615-3' }).success).toBe(
      false,
    );
    expect(updateReferenceBodySchema.safeParse({ isbn: '9780306406157' }).success).toBe(true);
    expect(updateReferenceBodySchema.safeParse({ isbn: null }).success).toBe(false);
  });
});

describe('RFC-60 R4, R9 speciesNameBodySchema', () => {
  it('a common name needs a language and no other type may carry one', () => {
    expect(
      speciesNameBodySchema.safeParse({ name: 'Coralwood', nameType: 'common', language: 'en' })
        .success,
    ).toBe(true);
    const missingLanguage = speciesNameBodySchema.safeParse({
      name: 'Coralwood',
      nameType: 'common',
    });
    expect(missingLanguage.success).toBe(false);
    if (!missingLanguage.success) {
      expect(missingLanguage.error.issues[0]?.path).toEqual(['language']);
    }
    const strayLanguage = speciesNameBodySchema.safeParse({
      name: 'Sinonimo',
      nameType: 'synonym',
      language: 'pt',
    });
    expect(strayLanguage.success).toBe(false);
    if (!strayLanguage.success) {
      expect(strayLanguage.error.issues[0]?.path).toEqual(['language']);
    }
  });

  it('only a GBIF name carries a usage key', () => {
    expect(
      speciesNameBodySchema.safeParse({
        name: 'Adenanthera gersenii',
        nameType: 'gbif',
        gbifUsageKey: '2969393',
      }).success,
    ).toBe(true);
    const strayKey = speciesNameBodySchema.safeParse({
      name: 'Sinonimo',
      nameType: 'synonym',
      gbifUsageKey: '2969393',
    });
    expect(strayKey.success).toBe(false);
    if (!strayKey.success) {
      expect(strayKey.error.issues[0]?.path).toEqual(['gbifUsageKey']);
    }
  });
});

describe('RFC-61 R10, RFC-80 R5 a book among the sources', () => {
  const citation = 'Doe, J. (2001). Seeds of the tropics.';

  it('takes an ISBN-10 or ISBN-13 with its citation, beside a DOI', () => {
    expect(
      sourcesSchema.safeParse({
        references: [{ doi: '10.1111/geb.13000' }, { isbn: '0-306-40615-2', citation }],
      }).success,
    ).toBe(true);
    expect(sourceRefSchema.safeParse({ isbn: '978 0 306 40615 7', citation }).success).toBe(true);
  });

  it('refuses a bad check digit, a missing, blank or over-long citation, and a citation alone', () => {
    for (const source of [
      { isbn: '0-306-40615-3', citation },
      { isbn: '9780306406157' },
      { isbn: '9780306406157', citation: '   ' },
      { isbn: '9780306406157', citation: 'x'.repeat(2001) },
      { citation },
      { isbn: '9780306406157', citation, doi: '10.1111/geb.13000' },
    ]) {
      expect(sourceRefSchema.safeParse(source).success).toBe(false);
    }
  });

  it('a confirmation may name a book as its supporting reference', () => {
    expect(
      annotateRecordBodySchema.safeParse({
        kind: 'confirm',
        referenceSource: { isbn: '9780306406157', citation },
      }).success,
    ).toBe(true);
    });
  });

describe('RFC-65 R13, R14, R16 level and contest actions', () => {
  it('levelActionParamSchema takes three uuids; contestParamSchema one', () => {
    expect(
      levelActionParamSchema.safeParse({ id: uuid, traitId: uuid, levelId: other }).success,
    ).toBe(true);
    expect(
      levelActionParamSchema.safeParse({ id: uuid, traitId: uuid, levelId: 'x' }).success,
    ).toBe(false);
    expect(contestParamSchema.safeParse({ id: uuid }).success).toBe(true);
    expect(contestParamSchema.safeParse({ id: 'x' }).success).toBe(false);
  });

  it('validateLevelBodySchema takes an optional referenceSource and nothing else', () => {
    expect(validateLevelBodySchema.safeParse({}).success).toBe(true);
    expect(validateLevelBodySchema.safeParse({ referenceSource: { id: uuid } }).success).toBe(true);
    expect(validateLevelBodySchema.safeParse({ note: 'x' }).success).toBe(false);
  });

  it('the results list record code refs; withdraw adds remaining', () => {
    const ref = { recordId: uuid, recordCode: 'TR_1' };
    expect(validateLevelResultSchema.safeParse({ validated: [ref] }).success).toBe(true);
    expect(withdrawLevelResultSchema.safeParse({ withdrawn: [ref], remaining: [] }).success).toBe(
      true,
    );
    expect(withdrawLevelResultSchema.safeParse({ withdrawn: [ref] }).success).toBe(false);
  });
});
