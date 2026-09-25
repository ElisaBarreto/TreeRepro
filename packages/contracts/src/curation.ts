import { z } from 'zod';
import {
  HARMONISATION_STATUSES,
  NAME_SOURCES,
  NAME_TYPES,
  numericValueSchema,
  quantitativeValueSchema,
  RECORD_INTENTS,
  recordSchema,
  referenceSchema,
  TRAIT_VALUE_TYPES,
  traitRefSchema,
  userRefSchema,
} from './dataset.ts';
import { isValidIsbn } from './isbn.ts';
import { cursorQuerySchema } from './pagination.ts';

/** Free text attached to a write: 1–2,000 characters, trimmed. @rfc RFC-65 R1 */
export const curationNoteSchema = z.string().trim().min(1).max(2000);

/** A catalog name or key: 1–200 characters, trimmed. @rfc RFC-60 R9 */
export const catalogNameSchema = z.string().trim().min(1).max(200);

/** 1–N distinct ids. */
const distinctIds = (max: number) =>
  z
    .array(z.uuid())
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Ids must be distinct' });

/**
 * One to twenty levels for a categorical trait — one record each — or a
 * quantitative value for a quantitative one.
 * @rfc RFC-65 R1
 * @rfc RFC-70 R3
 */
export const recordValueSchema = z.union([
  z.strictObject({ levelIds: distinctIds(20).min(1) }),
  z.strictObject({ quantitative: quantitativeValueSchema }),
]);

/** @rfc RFC-80 R1 */
export const doiSchema = z.string().trim().min(7).max(300);
/** An ISBN-10 or ISBN-13 as typed, hyphens and spaces allowed, with a valid check digit. @rfc RFC-61 R10 */
export const isbnSchema = z
  .string()
  .trim()
  .min(10)
  .max(20)
  .refine((isbn) => isValidIsbn(isbn) !== null, { message: 'Invalid ISBN' });
/** The citation a book is recorded under: authors, year, title. @rfc RFC-61 R10 */
export const bookCitationSchema = z.string().trim().min(1).max(2000);
/**
 * One source of a claim: a local reference, a DOI to resolve, or a book by
 * ISBN with its citation (never looked up).
 * @rfc RFC-80 R5
 * @rfc RFC-61 R10
 */
export const sourceRefSchema = z.union([
  z.strictObject({ id: z.uuid() }),
  z.strictObject({ doi: doiSchema }),
  z.strictObject({ isbn: isbnSchema, citation: bookCitationSchema }),
]);
/** @rfc RFC-70 R1 */
export const sourcesSchema = z.union([
  z.strictObject({ personalObservation: z.literal(true) }),
  z.strictObject({ references: z.array(sourceRefSchema).min(1).max(10) }),
]);

/**
 * The intent combination of RFC-70 R1 depends on the trait's value type, so
 * the service checks it once the trait is known.
 * @rfc RFC-65 R1
 * @rfc RFC-70 R1
 */
export const createRecordBodySchema = z.strictObject({
  speciesId: z.uuid(),
  traitId: z.uuid(),
  value: recordValueSchema,
  sources: sourcesSchema,
  intent: z.enum(RECORD_INTENTS).optional(),
  respondsToRecordId: z.uuid().optional(),
  contestedLevelIds: distinctIds(100).optional(),
  rawValue: curationNoteSchema.optional(),
  note: curationNoteSchema.optional(),
  secondaryReferenceId: z.uuid().optional(),
});

/** A record named by id and code. @rfc RFC-70 R3 */
export const recordCodeRefSchema = z.strictObject({ recordId: z.uuid(), recordCode: z.string() });

/**
 * `created`: the new records. `validated`: existing records the entry
 * matched, now carrying the actor's validation. `duplicates`: matches that
 * are the actor's own records, or a claim-key collision with a visible record.
 * @rfc RFC-70 R3
 */
export const createRecordsResultSchema = z.strictObject({
  created: z.array(recordSchema),
  validated: z.array(recordCodeRefSchema),
  duplicates: z.array(recordCodeRefSchema),
});

/**
 * A validation (with an optional supporting source) or a withdrawal. No note
 * on either; `neutral`, `dispute` and `resolve` are refused (400 path
 * `kind`) — Keep both moves to the contest routes (spec R-6, R-10, R-11,
 * R-12).
 * @rfc RFC-70 R4
 * @rfc RFC-65 R3, R4, R10
 */
export const annotateRecordBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('confirm'), referenceSource: sourceRefSchema.optional() }),
  z.strictObject({ kind: z.literal('withdraw') }),
]);

/** A level of one species × trait, for the level actions. @rfc RFC-65 R13, R14 */
export const levelActionParamSchema = z.strictObject({
  id: z.uuid(),
  traitId: z.uuid(),
  levelId: z.uuid(),
});
/** Validate a level: an optional supporting reference, as in RFC-65 R3. @rfc RFC-65 R13 */
export const validateLevelBodySchema = z.strictObject({
  referenceSource: sourceRefSchema.optional(),
});
/** The records newly validated; empty when all already were. @rfc RFC-65 R13 */
export const validateLevelResultSchema = z.strictObject({
  validated: z.array(recordCodeRefSchema),
});
/**
 * `withdrawn`: the records withdrawn. `remaining`: the visible records of the
 * level the actor may not withdraw (RFC-65 R4).
 * @rfc RFC-65 R14
 */
export const withdrawLevelResultSchema = z.strictObject({
  withdrawn: z.array(recordCodeRefSchema),
  remaining: z.array(recordCodeRefSchema),
});
/** A contest, by the `id` of the contested queue. @rfc RFC-65 R16 */
export const contestParamSchema = z.strictObject({ id: z.uuid() });

/** @rfc RFC-80 R4 */
export const resolveDoiQuerySchema = z.strictObject({ doi: doiSchema });

/** @rfc RFC-80 R4 */
export const resolveDoiResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('known'), reference: referenceSchema }),
  z.strictObject({
    status: z.literal('resolvable'),
    reference: z.null(),
    preview: z
      .strictObject({
        title: z.string().nullable(),
        authors: z.string().nullable(),
        year: z.number().int().nullable(),
        journal: z.string().nullable(),
      })
      .nullable(),
  }),
  z.strictObject({ status: z.literal('not_found'), reference: z.null() }),
]);

/** @rfc RFC-62 R6 */
export const traitLevelParamSchema = z.strictObject({ id: z.uuid(), levelId: z.uuid() });

/** @rfc RFC-65 R8 */
export const pendingTraitSchema = z.strictObject({
  trait: traitRefSchema,
  count: z.number().int().nonnegative(),
});

/** @rfc RFC-65 R8 */
export const pendingGroupsQuerySchema = cursorQuerySchema.extend({ traitId: z.uuid() });

/** @rfc RFC-65 R8 */
export const pendingGroupSchema = z.strictObject({
  valueText: z.string(),
  harmonisation: z.enum(HARMONISATION_STATUSES),
  count: z.number().int().nonnegative(),
  sampleRecordId: z.uuid(),
});

/** @rfc RFC-65 R9 */
export const mapPendingBodySchema = z.strictObject({
  traitId: z.uuid(),
  valueText: z.string().min(1).max(4000),
  value: z.union([
    z.strictObject({
      levelIds: z
        .array(z.uuid())
        .min(1)
        .max(20)
        .refine((ids) => new Set(ids).size === ids.length, { message: 'Levels must be distinct' }),
    }),
    z.strictObject({ numeric: numericValueSchema }),
  ]),
  note: curationNoteSchema.optional(),
});

/** @rfc RFC-65 R9 */
export const mapResultSchema = z.strictObject({
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

/** `?intent=contest` keeps records whose standing dispute was generated by a contest. @rfc RFC-65 R10 */
export const listDisputedQuerySchema = cursorQuerySchema.extend({
  intent: z.enum(['contest']).optional(),
});

/**
 * `contestedBy` (RFC-65 R10 amended by plan 11b) holds the non-withdrawn
 * records with `intent = 'contest'` that respond to the disputed record,
 * newest first. It is empty when nothing contests that record, which is the
 * ordinary case for a dispute raised by hand — but not a guarantee: the
 * query filters on the responded record, the intent and the withdrawal, and
 * never on whether the standing dispute was generated. A record that carries
 * both a hand-raised dispute and a live contest therefore arrives with a
 * non-empty array whichever of the two is standing, which is the rule's own
 * reading: the array answers "what value is being offered instead", not "who
 * raised the dispute".
 * @rfc RFC-65 R10
 */
export const disputedRecordSchema = recordSchema.extend({
  latestDispute: z.strictObject({
    id: z.uuid(),
    actor: userRefSchema,
    note: z.string().nullable(),
    createdAt: z.iso.datetime(),
  }),
  contestedBy: z.array(
    z.strictObject({
      id: z.uuid(),
      valueText: z.string(),
      createdBy: userRefSchema.nullable(),
    }),
  ),
});

const nonEmpty = <T extends z.ZodRawShape>(shape: T, first: keyof T & string) =>
  z.strictObject(shape).refine((b) => Object.keys(b).length > 0, {
    message: 'Nothing to change',
    path: [first],
  });

/** @rfc RFC-60 R9 */
export const familyBodySchema = z.strictObject({ name: catalogNameSchema });
/** @rfc RFC-60 R9 */
export const createGenusBodySchema = z.strictObject({
  name: catalogNameSchema,
  familyId: z.uuid().optional(),
});
/** @rfc RFC-60 R9 */
export const updateGenusBodySchema = nonEmpty(
  { name: catalogNameSchema.optional(), familyId: z.uuid().nullable().optional() },
  'name',
);
/** @rfc RFC-60 R9 */
export const createSpeciesBodySchema = z.strictObject({
  canonicalName: catalogNameSchema,
  nameSource: z.enum(NAME_SOURCES),
  genusId: z.uuid().optional(),
});
/** @rfc RFC-60 R9 */
export const updateSpeciesBodySchema = nonEmpty(
  {
    canonicalName: catalogNameSchema.optional(),
    nameSource: z.enum(NAME_SOURCES).optional(),
    genusId: z.uuid().nullable().optional(),
    active: z.boolean().optional(),
  },
  'canonicalName',
);
/**
 * `POST /api/species/:id/names`. A common name needs a `language`; every
 * other type takes none; only a `gbif` name carries `gbifUsageKey`.
 * @rfc RFC-60 R4, R9
 */
export const speciesNameBodySchema = z
  .strictObject({
    name: catalogNameSchema,
    nameType: z.enum(NAME_TYPES),
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional(),
    source: z.string().trim().min(1).max(200).optional(),
    gbifUsageKey: z.string().trim().min(1).max(64).optional(),
  })
  .refine((b) => (b.nameType === 'common') === (b.language !== undefined), {
    path: ['language'],
    message: 'A common name needs a language; other names take none',
  })
  .refine((b) => b.gbifUsageKey === undefined || b.nameType === 'gbif', {
    path: ['gbifUsageKey'],
    message: 'Only a GBIF name carries a usage key',
  });

const text = (max: number) => z.string().trim().min(1).max(max);

/** @rfc RFC-61 R6, R10 */
export const createReferenceBodySchema = z.strictObject({
  citationKey: text(2000),
  title: text(1000).optional(),
  authors: text(1000).optional(),
  year: z.number().int().min(1500).max(2100).optional(),
  journal: text(1000).optional(),
  doi: text(500).optional(),
  url: text(500).optional(),
  isbn: isbnSchema.optional(),
  shortCitation: text(200).optional(),
  fullCitation: text(2000).optional(),
});
/** @rfc RFC-61 R6, R10 */
export const updateReferenceBodySchema = nonEmpty(
  {
    citationKey: text(2000).optional(),
    title: text(1000).nullable().optional(),
    authors: text(1000).nullable().optional(),
    year: z.number().int().min(1500).max(2100).nullable().optional(),
    journal: text(1000).nullable().optional(),
    doi: text(500).nullable().optional(),
    url: text(500).nullable().optional(),
    // Never null: a book keeps its ISBN (RFC-61 R10).
    isbn: isbnSchema.optional(),
    shortCitation: text(200).nullable().optional(),
    fullCitation: text(2000).nullable().optional(),
  },
  'citationKey',
);

/** @rfc RFC-62 R6 */
export const createTraitBodySchema = z.strictObject({
  key: catalogNameSchema,
  categoryKey: text(100),
  valueType: z.enum(TRAIT_VALUE_TYPES),
  unit: text(32).optional(),
  description: z.string().trim().max(2000).optional(),
});
/** @rfc RFC-62 R6 */
export const updateTraitBodySchema = nonEmpty(
  {
    categoryKey: text(100).optional(),
    description: z.string().trim().max(2000).optional(),
    active: z.boolean().optional(),
  },
  'categoryKey',
);
/** @rfc RFC-62 R6 */
export const createLevelBodySchema = z.strictObject({
  key: catalogNameSchema,
  sortOrder: z.number().int().min(0).max(2147483647).optional(),
});
/** @rfc RFC-62 R6 */
export const updateLevelBodySchema = nonEmpty(
  {
    key: catalogNameSchema.optional(),
    sortOrder: z.number().int().min(0).max(2147483647).optional(),
    active: z.boolean().optional(),
  },
  'key',
);

export type Doi = z.infer<typeof doiSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type Sources = z.infer<typeof sourcesSchema>;
export type RecordValue = z.infer<typeof recordValueSchema>;
export type CreateRecordBody = z.infer<typeof createRecordBodySchema>;
export type CreateRecordsResult = z.infer<typeof createRecordsResultSchema>;
export type RecordCodeRef = z.infer<typeof recordCodeRefSchema>;
export type AnnotateRecordBody = z.infer<typeof annotateRecordBodySchema>;
export type ValidateLevelBody = z.infer<typeof validateLevelBodySchema>;
export type ValidateLevelResult = z.infer<typeof validateLevelResultSchema>;
export type WithdrawLevelResult = z.infer<typeof withdrawLevelResultSchema>;
export type ResolveDoiQuery = z.infer<typeof resolveDoiQuerySchema>;
export type ResolveDoiResult = z.infer<typeof resolveDoiResultSchema>;
export type PendingTrait = z.infer<typeof pendingTraitSchema>;
export type PendingGroupsQuery = z.infer<typeof pendingGroupsQuerySchema>;
export type PendingGroup = z.infer<typeof pendingGroupSchema>;
export type MapPendingBody = z.infer<typeof mapPendingBodySchema>;
export type MapResult = z.infer<typeof mapResultSchema>;
export type DisputedRecord = z.infer<typeof disputedRecordSchema>;
export type ListDisputedQuery = z.infer<typeof listDisputedQuerySchema>;
export type FamilyBody = z.infer<typeof familyBodySchema>;
export type CreateGenusBody = z.infer<typeof createGenusBodySchema>;
export type UpdateGenusBody = z.infer<typeof updateGenusBodySchema>;
export type CreateSpeciesBody = z.infer<typeof createSpeciesBodySchema>;
export type UpdateSpeciesBody = z.infer<typeof updateSpeciesBodySchema>;
export type SpeciesNameBody = z.infer<typeof speciesNameBodySchema>;
export type CreateReferenceBody = z.infer<typeof createReferenceBodySchema>;
export type UpdateReferenceBody = z.infer<typeof updateReferenceBodySchema>;
export type CreateTraitBody = z.infer<typeof createTraitBodySchema>;
export type UpdateTraitBody = z.infer<typeof updateTraitBodySchema>;
export type CreateLevelBody = z.infer<typeof createLevelBodySchema>;
export type UpdateLevelBody = z.infer<typeof updateLevelBodySchema>;
