import { z } from 'zod';
import {
  ANNOTATION_KINDS,
  RECORD_INTENTS,
  REVIEW_STATUSES,
  recordSchema,
  referenceRefSchema,
} from './dataset.ts';
import { cursorQuerySchema } from './pagination.ts';

/** @rfc RFC-71 R1 */
export const CONTRIBUTION_KINDS = ['records', 'annotations'] as const;
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

/**
 * `from` / `to` are ISO dates, inclusive day bounds in UTC; a `to` earlier
 * than `from` is accepted here and answered with an empty page, not rejected.
 * @rfc RFC-71 R1
 */
export const listContributionsQuerySchema = cursorQuerySchema.extend({
  kind: z.enum(CONTRIBUTION_KINDS),
  traitId: z.uuid().optional(),
  speciesId: z.uuid().optional(),
  review: z.enum(REVIEW_STATUSES).optional(),
  intent: z.enum([...RECORD_INTENTS, 'none']).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

/** A viewer's own manual record, plus its standing. @rfc RFC-71 R2 */
export const contributionRecordSchema = recordSchema.extend({
  responseCount: z.number().int().nonnegative(),
});

/**
 * `generated` is kept even though it mirrors `annotationSchema`
 * (`dataset.ts`): the web page renders it as "automatic". `record` is null
 * for a Keep-both resolution (`kind: 'resolve'`) whose contest created no
 * record, or created one the viewer cannot see (RFC-65 R16).
 * @rfc RFC-71 R3
 */
export const contributionAnnotationSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(ANNOTATION_KINDS),
  note: z.string().nullable(),
  reference: referenceRefSchema.nullable(),
  generated: z.boolean(),
  createdAt: z.iso.datetime(),
  record: recordSchema.nullable(),
});

/**
 * `contests` counts the viewer's contests that are not withdrawn (RFC-63
 * R14), one per contest, whether or not it created a record — not the
 * viewer's records with `intent = 'contest'`. `disputes` and `withdrawn` are
 * gone: `dispute` is retired (RFC-63 R7) and a withdrawn record leaves the
 * dataset (RFC-63 R13), so neither is a standing to report.
 * @rfc RFC-71 R4
 */
export const contributionSummarySchema = z.strictObject({
  records: z.number().int().nonnegative(),
  contests: z.number().int().nonnegative(),
  complements: z.number().int().nonnegative(),
  validations: z.number().int().nonnegative(),
});

export type ListContributionsQuery = z.infer<typeof listContributionsQuerySchema>;
export type ContributionRecord = z.infer<typeof contributionRecordSchema>;
export type ContributionAnnotation = z.infer<typeof contributionAnnotationSchema>;
export type ContributionSummary = z.infer<typeof contributionSummarySchema>;
