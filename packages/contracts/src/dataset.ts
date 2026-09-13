import { z } from 'zod';
import { cursorQuerySchema } from './pagination.ts';

/** @rfc RFC-60 R1, R3 */
export const NAME_SOURCES = ['wcvp', 'gbif', 'original'] as const;
export type NameSource = (typeof NAME_SOURCES)[number];

/** @rfc RFC-62 R1 */
export const TRAIT_VALUE_TYPES = ['categorical', 'quantitative'] as const;
export type TraitValueType = (typeof TRAIT_VALUE_TYPES)[number];

/** @rfc RFC-63 R5 */
export const HARMONISATION_STATUSES = [
  'harmonised',
  'unknown_level',
  'multi_value',
  'not_numeric',
  'empty',
] as const;
export type HarmonisationStatus = (typeof HARMONISATION_STATUSES)[number];

/** @rfc RFC-63 R1 */
export const RECORD_ORIGINS = ['import', 'manual'] as const;
export type RecordOrigin = (typeof RECORD_ORIGINS)[number];

/** @rfc RFC-63 R7 */
export const ANNOTATION_KINDS = ['confirm', 'dispute', 'neutral', 'withdraw'] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

/** @rfc RFC-63 R7 */
export const ACCEPTED_DECISIONS = ['accepted', 'cleared'] as const;
export type AcceptedDecision = (typeof ACCEPTED_DECISIONS)[number];

/** @rfc RFC-64 R3 */
export const IMPORT_BATCH_STATUSES = ['running', 'completed', 'failed'] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

/** @rfc RFC-64 R7 */
export const IMPORT_REJECT_REASONS = ['no_species_name', 'unknown_trait', 'no_reference'] as const;
export type ImportRejectReason = (typeof IMPORT_REJECT_REASONS)[number];

/** @rfc RFC-63 R6 */
export const REVIEW_STATUSES = ['unreviewed', 'confirmed', 'disputed', 'withdrawn'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Path parameter of every dataset detail route. @rfc RFC-60 R7 */
export const idParamSchema = z.strictObject({ id: z.uuid() });

/** Substring search term. @rfc RFC-60 R6 */
export const searchTermSchema = z.string().trim().min(2).max(100);

/** @rfc RFC-60 R1 */
export const taxonRefSchema = z.strictObject({ id: z.uuid(), name: z.string() });

/** @rfc RFC-60 R6 */
export const listSpeciesQuerySchema = cursorQuerySchema.extend({
  q: searchTermSchema.optional(),
  familyId: z.uuid().optional(),
  genusId: z.uuid().optional(),
  unresolved: z.enum(['true', 'false']).optional(),
});

/** @rfc RFC-60 R6 */
export const speciesListItemSchema = z.strictObject({
  id: z.uuid(),
  canonicalName: z.string(),
  nameSource: z.enum(NAME_SOURCES),
  genus: taxonRefSchema.nullable(),
  family: taxonRefSchema.nullable(),
  matchedName: z.string().nullable(),
});

/** @rfc RFC-60 R4, R7 */
export const speciesNameSchema = z.strictObject({
  name: z.string(),
  source: z.literal('gbif'),
  gbifUsageKey: z.string().nullable(),
});

/** @rfc RFC-60 R7 */
export const speciesSchema = speciesListItemSchema.extend({
  names: z.array(speciesNameSchema),
  recordCount: z.number().int().nonnegative(),
  traitCount: z.number().int().nonnegative(),
  unresolvedTaxon: z.boolean(),
});

/** @rfc RFC-60 R8 */
export const listGeneraQuerySchema = cursorQuerySchema.extend({
  familyId: z.uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

/** @rfc RFC-60 R8 */
export const genusSchema = taxonRefSchema.extend({ family: taxonRefSchema.nullable() });

/** @rfc RFC-61 R4 */
export const referenceRefSchema = z.strictObject({ id: z.uuid(), citationKey: z.string() });

/** @rfc RFC-61 R4 */
export const referenceSchema = z.strictObject({
  id: z.uuid(),
  citationKey: z.string(),
  title: z.string().nullable(),
  authors: z.string().nullable(),
  year: z.number().int().nullable(),
  journal: z.string().nullable(),
  doi: z.string().nullable(),
  url: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

/** @rfc RFC-61 R4 */
export const referenceDetailSchema = referenceSchema.extend({
  recordCount: z.number().int().nonnegative(),
});

/** @rfc RFC-61 R4 */
export const listReferencesQuerySchema = cursorQuerySchema.extend({
  q: searchTermSchema.optional(),
});

/** @rfc RFC-62 R5 */
export const traitRefSchema = z.strictObject({
  id: z.uuid(),
  key: z.string(),
  valueType: z.enum(TRAIT_VALUE_TYPES),
  unit: z.string().nullable(),
});

/** @rfc RFC-62 R5 */
export const traitLevelSchema = z.strictObject({
  id: z.uuid(),
  key: z.string(),
  active: z.boolean(),
});

/** @rfc RFC-62 R5 */
export const traitSchema = traitRefSchema.extend({
  description: z.string(),
  active: z.boolean(),
  levels: z.array(traitLevelSchema),
});

/** @rfc RFC-62 R5 */
export const dictionarySchema = z.array(
  z.strictObject({ key: z.string(), label: z.string(), traits: z.array(traitSchema) }),
);

/** @rfc RFC-63 R8 */
export const userRefSchema = z.strictObject({ id: z.uuid(), name: z.string() });

/** @rfc RFC-63 R8 */
export const recordSchema = z.strictObject({
  id: z.uuid(),
  speciesId: z.uuid(),
  trait: traitRefSchema,
  valueText: z.string(),
  level: z.strictObject({ id: z.uuid(), key: z.string() }).nullable(),
  numericValue: z.number().nullable(),
  harmonisation: z.enum(HARMONISATION_STATUSES),
  review: z.enum(REVIEW_STATUSES),
  primaryReference: referenceRefSchema.nullable(),
  secondaryReference: referenceRefSchema.nullable(),
  origin: z.enum(RECORD_ORIGINS),
  createdAt: z.iso.datetime(),
  createdBy: userRefSchema.nullable(),
});

/** @rfc RFC-63 R8 */
export const annotationSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(ANNOTATION_KINDS),
  note: z.string().nullable(),
  actor: userRefSchema,
  createdAt: z.iso.datetime(),
});

/** @rfc RFC-63 R8 */
export const acceptedDecisionSchema = z.strictObject({
  id: z.uuid(),
  decision: z.enum(ACCEPTED_DECISIONS),
  recordId: z.uuid().nullable(),
  actor: userRefSchema,
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

/** @rfc RFC-63 R8 */
export const recordDetailSchema = recordSchema.extend({
  rawValue: z.string().nullable(),
  originalTraitName: z.string().nullable(),
  originalSpeciesName: z.string().nullable(),
  secondarySourceSpeciesName: z.string().nullable(),
  rawCategory: z.string().nullable(),
  note: z.string().nullable(),
  importBatch: z
    .strictObject({ id: z.uuid(), fileName: z.string(), startedAt: z.iso.datetime() })
    .nullable(),
  importRowNo: z.number().int().nullable(),
  annotations: z.array(annotationSchema),
  acceptedHistory: z.array(acceptedDecisionSchema),
});

/** @rfc RFC-63 R9 */
export const listRecordsQuerySchema = cursorQuerySchema
  .extend({
    speciesId: z.uuid().optional(),
    traitId: z.uuid().optional(),
    referenceId: z.uuid().optional(),
  })
  .refine(
    (q) =>
      (q.speciesId !== undefined && q.traitId !== undefined && q.referenceId === undefined) ||
      (q.referenceId !== undefined && q.speciesId === undefined && q.traitId === undefined),
    { message: 'Filter by speciesId and traitId together, or by referenceId', path: ['speciesId'] },
  );

/** @rfc RFC-63 R10 */
export const harmonisationCountsSchema = z.strictObject({
  harmonised: z.number().int().nonnegative(),
  unknownLevel: z.number().int().nonnegative(),
  multiValue: z.number().int().nonnegative(),
  notNumeric: z.number().int().nonnegative(),
  empty: z.number().int().nonnegative(),
});

/** @rfc RFC-63 R10 */
export const traitSummarySchema = z.strictObject({
  trait: traitRefSchema,
  recordCount: z.number().int().nonnegative(),
  harmonisationCounts: harmonisationCountsSchema,
  levels: z
    .array(z.strictObject({ levelId: z.uuid(), key: z.string(), count: z.number().int() }))
    .nullable(),
  numeric: z
    .strictObject({ min: z.number(), median: z.number(), max: z.number(), count: z.number().int() })
    .nullable(),
  accepted: z
    .strictObject({ recordId: z.uuid(), valueText: z.string(), decidedAt: z.iso.datetime() })
    .nullable(),
});

/** @rfc RFC-63 R10 */
export const speciesTraitsSchema = z.array(
  z.strictObject({
    category: z.strictObject({ key: z.string(), label: z.string() }),
    traits: z.array(traitSummarySchema),
  }),
);

/** @rfc RFC-64 R8, R11 */
export const unknownLevelSchema = z.strictObject({
  trait: z.string(),
  value: z.string(),
  count: z.number().int(),
});

/** @rfc RFC-64 R11 */
export const importBatchSchema = z.strictObject({
  id: z.uuid(),
  fileName: z.string(),
  fileSha256: z.string(),
  status: z.enum(IMPORT_BATCH_STATUSES),
  runBy: userRefSchema.nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  rowsTotal: z.number().int().nonnegative(),
  rowsInserted: z.number().int().nonnegative(),
  rowsDuplicate: z.number().int().nonnegative(),
  rowsRejected: z.number().int().nonnegative(),
  rowsPending: z.number().int().nonnegative(),
  unknownLevels: z.array(unknownLevelSchema),
  error: z.string().nullable(),
});

/** @rfc RFC-64 R11 */
export const importRejectSchema = z.strictObject({
  id: z.uuid(),
  rowNo: z.number().int(),
  reason: z.enum(IMPORT_REJECT_REASONS),
  rawRow: z.record(z.string(), z.string()),
});

export type TaxonRef = z.infer<typeof taxonRefSchema>;
export type ListSpeciesQuery = z.infer<typeof listSpeciesQuerySchema>;
export type SpeciesListItem = z.infer<typeof speciesListItemSchema>;
export type SpeciesName = z.infer<typeof speciesNameSchema>;
export type Species = z.infer<typeof speciesSchema>;
export type ListGeneraQuery = z.infer<typeof listGeneraQuerySchema>;
export type Genus = z.infer<typeof genusSchema>;
export type ReferenceRef = z.infer<typeof referenceRefSchema>;
export type Reference = z.infer<typeof referenceSchema>;
export type ReferenceDetail = z.infer<typeof referenceDetailSchema>;
export type ListReferencesQuery = z.infer<typeof listReferencesQuerySchema>;
export type TraitRef = z.infer<typeof traitRefSchema>;
export type TraitLevel = z.infer<typeof traitLevelSchema>;
export type Trait = z.infer<typeof traitSchema>;
export type Dictionary = z.infer<typeof dictionarySchema>;
export type UserRef = z.infer<typeof userRefSchema>;
export type RecordItem = z.infer<typeof recordSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type AcceptedDecisionEntry = z.infer<typeof acceptedDecisionSchema>;
export type RecordDetail = z.infer<typeof recordDetailSchema>;
export type ListRecordsQuery = z.infer<typeof listRecordsQuerySchema>;
export type HarmonisationCounts = z.infer<typeof harmonisationCountsSchema>;
export type TraitSummary = z.infer<typeof traitSummarySchema>;
export type SpeciesTraits = z.infer<typeof speciesTraitsSchema>;
export type UnknownLevel = z.infer<typeof unknownLevelSchema>;
export type ImportBatch = z.infer<typeof importBatchSchema>;
export type ImportReject = z.infer<typeof importRejectSchema>;
