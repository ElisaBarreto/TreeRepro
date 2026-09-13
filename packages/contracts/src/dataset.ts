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
