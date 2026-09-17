import { z } from 'zod';
import {
  ANNOTATION_KINDS,
  acceptedDecisionSchema,
  HARMONISATION_STATUSES,
  NAME_SOURCES,
  RECORD_INTENTS,
  recordDetailSchema,
  recordSchema,
  referenceSchema,
  TRAIT_VALUE_TYPES,
  traitRefSchema,
  userRefSchema,
} from './dataset.ts';
import { cursorQuerySchema } from './pagination.ts';

/** Free text attached to a write: 1–2,000 characters, trimmed. @rfc RFC-65 R1 */
export const curationNoteSchema = z.string().trim().min(1).max(2000);

/** A catalog name or key: 1–200 characters, trimmed. @rfc RFC-60 R9 */
export const catalogNameSchema = z.string().trim().min(1).max(200);

/** Largest magnitude a manual number may have (RFC-64 R6). @rfc RFC-64 R6 */
export const NUMERIC_VALUE_LIMIT = 1e308;

/** @rfc RFC-65 R1 */
export const numericValueSchema = z
  .number()
  .finite()
  .refine((n) => Math.abs(n) < NUMERIC_VALUE_LIMIT, { message: 'Number is out of range' });

/** A level for a categorical trait, or a number for a quantitative one. @rfc RFC-65 R1 */
export const recordValueSchema = z.union([
  z.strictObject({ levelId: z.uuid() }),
  z.strictObject({ numeric: numericValueSchema }),
]);

export const doiSchema = z.string().trim().min(7).max(300);
export const sourceRefSchema = z.union([z.strictObject({ id: z.uuid() }), z.strictObject({ doi: doiSchema })]);
export const sourcesSchema = z.union([
  z.strictObject({ personalObservation: z.literal(true) }),
  z.strictObject({ references: z.array(sourceRefSchema).min(1).max(10) }),
]);

/** @rfc RFC-65 R1 */
export const createRecordBodySchema = z.strictObject({
  speciesId: z.uuid(),
  traitId: z.uuid(),
  value: recordValueSchema,
  sources: sourcesSchema,
  intent: z.enum(RECORD_INTENTS).optional(),
  respondsToRecordId: z.uuid().optional(),
  rawValue: curationNoteSchema.optional(),
  note: curationNoteSchema.optional(),
  secondaryReferenceId: z.uuid().optional(),
}).refine((b) => (b.intent === undefined) === (b.respondsToRecordId === undefined), { path: ['intent'], message: 'intent and respondsToRecordId come together' });

export const createRecordsResultSchema = z.strictObject({
  created: z.array(recordDetailSchema),
  duplicates: z.array(z.strictObject({ recordId: z.uuid(), referenceId: z.uuid() })),
});

/** @rfc RFC-65 R3 */
export const annotateRecordBodySchema = z
  .strictObject({ kind: z.enum(ANNOTATION_KINDS), note: curationNoteSchema.optional(), reference: sourceRefSchema.optional() })
  .refine((b) => b.note !== undefined || (b.kind !== 'dispute' && b.kind !== 'withdraw'), {
    message: 'A note is required to dispute or withdraw',
    path: ['note'],
  })
  .refine((b) => b.reference === undefined || b.kind === 'confirm', { path: ['reference'], message: 'Only a confirmation carries a reference' });

export const resolveDoiQuerySchema = z.strictObject({ doi: doiSchema });

export const resolveDoiResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('known'), reference: referenceSchema }),
  z.strictObject({
    status: z.literal('resolvable'),
    reference: z.null(),
    preview: z.strictObject({
      title: z.string().nullable(),
      authors: z.string().nullable(),
      year: z.number().int().nullable(),
      journal: z.string().nullable(),
    }).nullable(),
  }),
  z.strictObject({ status: z.literal('not_found'), reference: z.null() }),
]);

/** @rfc RFC-65 R6 */
export const setAcceptedBodySchema = z.discriminatedUnion('decision', [
  z.strictObject({
    decision: z.literal('accepted'),
    recordId: z.uuid(),
    note: curationNoteSchema.optional(),
  }),
  z.strictObject({ decision: z.literal('cleared'), note: curationNoteSchema }),
]);

/** @rfc RFC-65 R6 */
export const speciesTraitParamSchema = z.strictObject({ id: z.uuid(), traitId: z.uuid() });

/** @rfc RFC-62 R6 */
export const traitLevelParamSchema = z.strictObject({ id: z.uuid(), levelId: z.uuid() });

/** @rfc RFC-65 R11 */
export const acceptedCurrentSchema = z.strictObject({
  id: z.uuid(),
  recordId: z.uuid(),
  valueText: z.string(),
  actor: userRefSchema,
  note: z.string().nullable(),
  decidedAt: z.iso.datetime(),
});

/** @rfc RFC-65 R11 */
export const acceptedHistoryEntrySchema = acceptedDecisionSchema.extend({
  valueText: z.string().nullable(),
});

/** @rfc RFC-65 R11 */
export const acceptedStateSchema = z.strictObject({
  current: acceptedCurrentSchema.nullable(),
  history: z.array(acceptedHistoryEntrySchema),
});

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

/** @rfc RFC-65 R10 */
export const disputedRecordSchema = recordSchema.extend({
  latestDispute: z.strictObject({
    id: z.uuid(),
    actor: userRefSchema,
    note: z.string().nullable(),
    createdAt: z.iso.datetime(),
  }),
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
/** @rfc RFC-60 R9 */
export const speciesNameBodySchema = z.strictObject({
  name: catalogNameSchema,
  gbifUsageKey: z.string().trim().min(1).max(64).optional(),
});

const text = (max: number) => z.string().trim().min(1).max(max);

/** @rfc RFC-61 R6 */
export const createReferenceBodySchema = z.strictObject({
  citationKey: text(2000),
  title: text(1000).optional(),
  authors: text(1000).optional(),
  year: z.number().int().min(1500).max(2100).optional(),
  journal: text(1000).optional(),
  doi: text(500).optional(),
  url: text(500).optional(),
});
/** @rfc RFC-61 R6 */
export const updateReferenceBodySchema = nonEmpty(
  {
    citationKey: text(2000).optional(),
    title: text(1000).nullable().optional(),
    authors: text(1000).nullable().optional(),
    year: z.number().int().min(1500).max(2100).nullable().optional(),
    journal: text(1000).nullable().optional(),
    doi: text(500).nullable().optional(),
    url: text(500).nullable().optional(),
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
export type AnnotateRecordBody = z.infer<typeof annotateRecordBodySchema>;
export type ResolveDoiQuery = z.infer<typeof resolveDoiQuerySchema>;
export type ResolveDoiResult = z.infer<typeof resolveDoiResultSchema>;
export type SetAcceptedBody = z.infer<typeof setAcceptedBodySchema>;
export type AcceptedCurrent = z.infer<typeof acceptedCurrentSchema>;
export type AcceptedHistoryEntry = z.infer<typeof acceptedHistoryEntrySchema>;
export type AcceptedState = z.infer<typeof acceptedStateSchema>;
export type PendingTrait = z.infer<typeof pendingTraitSchema>;
export type PendingGroupsQuery = z.infer<typeof pendingGroupsQuerySchema>;
export type PendingGroup = z.infer<typeof pendingGroupSchema>;
export type MapPendingBody = z.infer<typeof mapPendingBodySchema>;
export type MapResult = z.infer<typeof mapResultSchema>;
export type DisputedRecord = z.infer<typeof disputedRecordSchema>;
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
