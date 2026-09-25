import { z } from 'zod';
import { cursorQuerySchema } from './pagination.ts';
import { plotRefSchema, SPECIES_SCOPES } from './plots.ts';

/** @rfc RFC-60 R1, R3 */
export const NAME_SOURCES = ['wcvp', 'gbif', 'original'] as const;
export type NameSource = (typeof NAME_SOURCES)[number];

/** An alternative name is a GBIF name, a synonym or a common name. @rfc RFC-60 R1, R4 */
export const NAME_TYPES = ['gbif', 'synonym', 'common'] as const;
export type NameType = (typeof NAME_TYPES)[number];

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

/** How a batch treated what earlier imports had loaded. @rfc RFC-64 R12 */
export const IMPORT_BATCH_MODES = ['append', 'replace'] as const;
export type ImportBatchMode = (typeof IMPORT_BATCH_MODES)[number];
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

/**
 * @rfc RFC-64 R7
 * @rfc RFC-68 R4
 */
export const IMPORT_REJECT_REASONS = [
  'no_species_name',
  'unknown_trait',
  'no_reference',
  'unknown_species',
  'unknown_plot',
  'unknown_user',
  'unknown_reference',
  'doi_taken',
  'invalid_value',
] as const;
export type ImportRejectReason = (typeof IMPORT_REJECT_REASONS)[number];

/** @rfc RFC-68 R1 */
export const IMPORT_BATCH_KINDS = [
  'records',
  'species_status',
  'plots',
  'plot_species',
  'user_plots',
  'synonyms',
  'references',
  'distribution',
] as const;
export type ImportBatchKind = (typeof IMPORT_BATCH_KINDS)[number];

/**
 * @rfc RFC-60 R6
 * @rfc RFC-33 R7
 */
export const SPECIES_STATUSES = ['active', 'inactive', 'all'] as const;
export type SpeciesStatus = (typeof SPECIES_STATUSES)[number];

/** @rfc RFC-63 R6 */
export const REVIEW_STATUSES = ['unreviewed', 'confirmed', 'disputed', 'withdrawn'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Path parameter of every dataset detail route. @rfc RFC-60 R7 */
export const idParamSchema = z.strictObject({ id: z.uuid() });

/** Substring search term. @rfc RFC-60 R6 */
export const searchTermSchema = z.string().trim().min(2).max(100);

/** @rfc RFC-60 R1 */
export const taxonRefSchema = z.strictObject({ id: z.uuid(), name: z.string() });

/** `traitData=with` keeps species with a coverage row; `missing` keeps species with none. @rfc RFC-60 R6 */
export const TRAIT_DATA_MODES = ['with', 'missing'] as const;
export type TraitDataMode = (typeof TRAIT_DATA_MODES)[number];

/** `completeness` orders by `trait_count asc, canonical_name asc, id asc`. @rfc RFC-60 R6 */
export const SPECIES_SORTS = ['name', 'completeness'] as const;
export type SpeciesSort = (typeof SPECIES_SORTS)[number];

/**
 * `traitData` without `traitId` or `categoryKey` is still accepted here; the
 * API decides what to do with it (it ignores it).
 * @rfc RFC-60 R6
 * @rfc RFC-33 R6, R7
 */
export const listSpeciesQuerySchema = cursorQuerySchema.extend({
  q: searchTermSchema.optional(),
  familyId: z.uuid().optional(),
  genusId: z.uuid().optional(),
  unresolved: z.enum(['true', 'false']).optional(),
  status: z.enum(SPECIES_STATUSES).optional(),
  scope: z.enum(SPECIES_SCOPES).optional(),
  plotId: z.uuid().optional(),
  categoryKey: z.string().trim().min(1).max(100).optional(),
  traitId: z.uuid().optional(),
  traitData: z.enum(TRAIT_DATA_MODES).optional(),
  sort: z.enum(SPECIES_SORTS).optional(),
});

/**
 * `traitRecordCount` is `null` when no `traitId` filter was given, `0` in
 * missing mode, and the coverage row's `record_count` otherwise.
 * `matchedNameType` is the type of the alternative name that matched
 * (`matchedName`), else `null`.
 * @rfc RFC-60 R3, R6
 * @rfc RFC-33 R7
 * @rfc RFC-69 R1
 */
export const speciesListItemSchema = z.strictObject({
  id: z.uuid(),
  canonicalName: z.string(),
  nameSource: z.enum(NAME_SOURCES),
  active: z.boolean(),
  genus: taxonRefSchema.nullable(),
  family: taxonRefSchema.nullable(),
  matchedName: z.string().nullable(),
  matchedNameType: z.enum(NAME_TYPES).nullable(),
  unresolvedTaxon: z.boolean(),
  traitCount: z.number().int().nonnegative(),
  traitRecordCount: z.number().int().nonnegative().nullable(),
});

/** An alternative name of a species: type, language (common names only) and source. @rfc RFC-60 R1, R4, R7 */
export const speciesNameSchema = z.strictObject({
  name: z.string(),
  nameType: z.enum(NAME_TYPES),
  language: z.string().length(2).nullable(),
  source: z.string(),
  gbifUsageKey: z.string().nullable(),
});

/**
 * `traitRecordCount` is omitted: it answers "how many records for the one
 * filtered trait", which only makes sense on the list (RFC-60 R6); the
 * detail route takes no `traitId` and keeps only `traitCount` (inherited).
 * @rfc RFC-60 R7
 * @rfc RFC-67 R8
 */
export const speciesSchema = speciesListItemSchema.omit({ traitRecordCount: true }).extend({
  names: z.array(speciesNameSchema),
  plots: z.array(plotRefSchema),
  recordCount: z.number().int().nonnegative(),
});

/** @rfc RFC-60 R8 */
export const listGeneraQuerySchema = cursorQuerySchema.extend({
  familyId: z.uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

/** @rfc RFC-60 R8 */
export const genusSchema = taxonRefSchema.extend({ family: taxonRefSchema.nullable() });

/** @rfc RFC-63 R8 */
export const userRefSchema = z.strictObject({ id: z.uuid(), name: z.string() });

/** @rfc RFC-61 R7 */
export const REFERENCE_KINDS = ['publication', 'personal_observation'] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

/** @rfc RFC-70 R1 */
export const RECORD_INTENTS = ['contest', 'complement'] as const;
export type RecordIntent = (typeof RECORD_INTENTS)[number];

/** @rfc RFC-62 R5 */
export const traitRefSchema = z.strictObject({
  id: z.uuid(),
  key: z.string(),
  valueType: z.enum(TRAIT_VALUE_TYPES),
  unit: z.string().nullable(),
});

/**
 * `observer` is the personal-observation owner (RFC-61 R7): present only
 * when the reference is one, and left `null` otherwise exactly as
 * `toReference` decides it for the full {@link referenceSchema} — the API
 * never widens exposure beyond that rule for this shorter shape.
 * @rfc RFC-61 R1, R4, R7
 */
export const referenceRefSchema = z.strictObject({
  id: z.uuid(),
  citationKey: z.string(),
  kind: z.enum(REFERENCE_KINDS),
  observer: userRefSchema.nullable(),
  shortCitation: z.string().nullable(),
});

/**
 * `primaryCount` / `secondaryCount`: records naming the reference in that
 * role; a record naming the same reference in both roles counts once in each.
 * `shortCitation` and `fullCitation` are a derived or written display
 * citation (R6, R8).
 * @rfc RFC-61 R1, R4
 */
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
  primaryCount: z.number().int().nonnegative(),
  secondaryCount: z.number().int().nonnegative(),
  kind: z.enum(REFERENCE_KINDS),
  observer: userRefSchema.nullable(),
  shortCitation: z.string().nullable(),
  fullCitation: z.string().nullable(),
});

/**
 * `recordCount`: records naming the reference in either role, counted once;
 * visibility-blind like `primaryCount` and `secondaryCount`. `traits`: the
 * reference's usage by trait (R9's counters), visible traits only, ordered
 * by count — so for a restricted viewer they need not add up to `recordCount`.
 * @rfc RFC-61 R4, R9
 */
export const referenceDetailSchema = referenceSchema.extend({
  recordCount: z.number().int().nonnegative(),
  traits: z.array(
    z.strictObject({ trait: traitRefSchema, recordCount: z.number().int().nonnegative() }),
  ),
});

/** @rfc RFC-61 R4 */
export const listReferencesQuerySchema = cursorQuerySchema.extend({
  q: searchTermSchema.optional(),
  kind: z.enum([...REFERENCE_KINDS, 'all']).optional(),
  traitId: z.uuid().optional(),
  categoryKey: z.string().trim().min(1).max(100).optional(),
});

/** `GET /api/traits` filters, applied server-side. @rfc RFC-62 R5 */
export const listTraitsQuerySchema = z.strictObject({
  categoryKey: z.string().trim().min(1).max(100).optional(),
  valueType: z.enum(TRAIT_VALUE_TYPES).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

/** @rfc RFC-62 R5 */
export const traitLevelSchema = z.strictObject({
  id: z.uuid(),
  key: z.string(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});

/**
 * `speciesCount`: visible species with a coverage row for the trait — a
 * global summary, plot-blind like RFC-62 R7's distribution and RFC-60 R6's
 * `traitCount` (a plot-bound viewer's number still counts species outside
 * their plots). On `GET /api/traits` it is cached 10 minutes per viewer
 * class; on the `POST`/`PATCH /api/traits` responses (and any other route
 * that reads a single trait) it is a live, uncached read of the same
 * number (RFC-62 R5).
 * @rfc RFC-62 R5
 */
export const traitSchema = traitRefSchema.extend({
  description: z.string(),
  active: z.boolean(),
  levels: z.array(traitLevelSchema),
  speciesCount: z.number().int().nonnegative(),
});

/** @rfc RFC-62 R5 */
export const dictionarySchema = z.array(
  z.strictObject({ key: z.string(), label: z.string(), traits: z.array(traitSchema) }),
);

/**
 * `GET /api/traits/:id`: the trait entry plus its category, the species
 * counted with and without a value, the accepted-value count, and the
 * distribution over harmonised records — `levels` for a categorical trait,
 * `numeric` (nullable, no harmonised records yet) for a quantitative one.
 * @rfc RFC-62 R7
 */
export const traitDetailSchema = traitSchema.extend({
  category: z.strictObject({ key: z.string(), label: z.string() }),
  speciesWithData: z.number().int().nonnegative(),
  speciesMissing: z.number().int().nonnegative(),
  acceptedCount: z.number().int().nonnegative(),
  distribution: z.union([
    z.strictObject({
      levels: z.array(
        z.strictObject({
          level: z.strictObject({ id: z.uuid(), key: z.string() }),
          speciesCount: z.number().int().nonnegative(),
          recordCount: z.number().int().nonnegative(),
        }),
      ),
    }),
    z.strictObject({
      numeric: z
        .strictObject({
          min: z.number(),
          median: z.number(),
          max: z.number(),
          speciesCount: z.number().int(),
        })
        .nullable(),
    }),
  ]),
  computedAt: z.iso.datetime(),
});

/** `mode=with` keeps species with a value on the trait; `missing` keeps the rest. @rfc RFC-62 R8 */
export const TRAIT_SPECIES_MODES = ['with', 'missing'] as const;
export type TraitSpeciesMode = (typeof TRAIT_SPECIES_MODES)[number];

/** `GET /api/traits/:id/species` query: species list filters plus `mode`. @rfc RFC-62 R8 */
export const listTraitSpeciesQuerySchema = cursorQuerySchema.extend({
  mode: z.enum(TRAIT_SPECIES_MODES).optional(),
  q: searchTermSchema.optional(),
  familyId: z.uuid().optional(),
  genusId: z.uuid().optional(),
  scope: z.enum(SPECIES_SCOPES).optional(),
  plotId: z.uuid().optional(),
});

/**
 * A species row of `GET /api/traits/:id/species`: the species list item plus,
 * in `with` mode, the accepted value (its reference, which carries
 * `shortCitation` itself, RFC-61 R1) and a per-species summary of its
 * records on the trait — `levels` for a categorical trait, `numeric` for a
 * quantitative one. `missing` mode leaves all three `null`.
 * @rfc RFC-62 R8
 */
export const traitSpeciesItemSchema = speciesListItemSchema.extend({
  recordCount: z.number().int().nonnegative().nullable(),
  accepted: z
    .strictObject({
      recordId: z.uuid(),
      valueText: z.string(),
      reference: referenceRefSchema,
    })
    .nullable(),
  summary: z
    .union([
      z.strictObject({
        levels: z.array(z.strictObject({ key: z.string(), count: z.number().int().nonnegative() })),
      }),
      z.strictObject({ numeric: z.strictObject({ min: z.number(), max: z.number() }) }),
    ])
    .nullable(),
});

/** @rfc RFC-63 R8 */
export const recordSchema = z.strictObject({
  id: z.uuid(),
  speciesId: z.uuid(),
  species: z.strictObject({ id: z.uuid(), canonicalName: z.string() }),
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
  intent: z.enum(RECORD_INTENTS).nullable(),
  respondsTo: z.strictObject({ id: z.uuid() }).nullable(),
});

/** @rfc RFC-63 R8 */
export const annotationSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(ANNOTATION_KINDS),
  note: z.string().nullable(),
  actor: userRefSchema,
  createdAt: z.iso.datetime(),
  reference: referenceRefSchema.nullable(),
  generated: z.boolean(),
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
  supersedes: z.strictObject({ id: z.uuid() }).nullable(),
  supersededBy: z.array(z.strictObject({ id: z.uuid() })),
  responses: z.array(
    z.strictObject({
      id: z.uuid(),
      intent: z.enum(RECORD_INTENTS),
      createdBy: userRefSchema.nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
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
    .array(
      z.strictObject({ levelId: z.uuid(), key: z.string(), count: z.number().int().nonnegative() }),
    )
    .nullable(),
  numeric: z
    .strictObject({
      min: z.number(),
      median: z.number(),
      max: z.number(),
      count: z.number().int().nonnegative(),
    })
    .nullable(),
  accepted: z
    .strictObject({ recordId: z.uuid(), valueText: z.string(), decidedAt: z.iso.datetime() })
    .nullable(),
});

/** @rfc RFC-70 R7 */
export const speciesTraitsQuerySchema = z.strictObject({
  includeMissing: z.enum(['true', 'false']).optional(),
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
  count: z.number().int().nonnegative(),
});

/**
 * @rfc RFC-64 R11
 * @rfc RFC-68 R1
 */
export const importBatchSchema = z.strictObject({
  id: z.uuid(),
  fileName: z.string(),
  fileSha256: z.string(),
  kind: z.enum(IMPORT_BATCH_KINDS),
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

/** @rfc RFC-68 R7 */
export const listImportsQuerySchema = cursorQuerySchema.extend({
  kind: z.enum(IMPORT_BATCH_KINDS).optional(),
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
export type ListTraitsQuery = z.infer<typeof listTraitsQuerySchema>;
export type TraitRef = z.infer<typeof traitRefSchema>;
export type TraitLevel = z.infer<typeof traitLevelSchema>;
export type Trait = z.infer<typeof traitSchema>;
export type Dictionary = z.infer<typeof dictionarySchema>;
export type TraitDetail = z.infer<typeof traitDetailSchema>;
export type ListTraitSpeciesQuery = z.infer<typeof listTraitSpeciesQuerySchema>;
export type TraitSpeciesItem = z.infer<typeof traitSpeciesItemSchema>;
export type UserRef = z.infer<typeof userRefSchema>;
export type RecordItem = z.infer<typeof recordSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type RecordDetail = z.infer<typeof recordDetailSchema>;
export type ListRecordsQuery = z.infer<typeof listRecordsQuerySchema>;
export type HarmonisationCounts = z.infer<typeof harmonisationCountsSchema>;
export type TraitSummary = z.infer<typeof traitSummarySchema>;
export type SpeciesTraits = z.infer<typeof speciesTraitsSchema>;
export type UnknownLevel = z.infer<typeof unknownLevelSchema>;
export type ImportBatch = z.infer<typeof importBatchSchema>;
export type ImportReject = z.infer<typeof importRejectSchema>;
export type ListImportsQuery = z.infer<typeof listImportsQuerySchema>;
