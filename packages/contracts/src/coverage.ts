import { z } from 'zod';
import { traitRefSchema } from './dataset.ts';

const n = z.number().int().nonnegative();
const pct = z.number().int().min(0).max(100);

/** `GET /api/coverage` filters, all optional. @rfc RFC-69 R5 */
export const coverageQuerySchema = z.strictObject({
  familyId: z.uuid().optional(),
  categoryKey: z.string().trim().min(1).max(100).optional(),
  plotId: z.uuid().optional(),
});

/**
 * A coverage grid and how much of it is filled. Every row of a coverage
 * answer — the totals, each `byCategory` entry, each `byTrait` entry — shares
 * one definition: `percentWithData = withData / cells`, `percentAccepted =
 * accepted / cells`, both integers 0–100 rounded half up (`percentHalfUp`),
 * and `0` for an empty grid.
 * @rfc RFC-69 R5
 */
export const coverageRowSchema = z.strictObject({
  cells: n,
  withData: n,
  accepted: n,
  percentWithData: pct,
  percentAccepted: pct,
});

/**
 * One `byTrait` row of {@link coverageSchema}: the row is a single trait, not
 * a species × trait grid, so `cells` is the selected species count (not
 * multiplied by a trait count); `species` is the number of selected species
 * that have data for this trait — the same count as this row's `withData`.
 * Percentages follow {@link coverageRowSchema}'s shared definition.
 * @rfc RFC-69 R5
 */
export const coverageTraitRowSchema = coverageRowSchema.extend({
  trait: traitRefSchema,
  category: z.strictObject({ key: z.string(), label: z.string() }),
  species: n,
});

/**
 * `GET /api/coverage` answer: the visible active species (restricted by
 * `familyId` or `plotId` when given) × visible active traits (restricted by
 * `categoryKey` when given), broken down by category and by trait.
 * `computedAt` is when the (possibly cached, R6) answer was computed.
 * @rfc RFC-69 R5
 */
export const coverageSchema = coverageRowSchema.extend({
  species: n,
  traits: n,
  byCategory: z.array(
    coverageRowSchema.extend({
      category: z.strictObject({ key: z.string(), label: z.string() }),
      traits: n,
    }),
  ),
  byTrait: z.array(coverageTraitRowSchema),
  computedAt: z.iso.datetime(),
});

/**
 * `GET /api/coverage/top` query: the traits with the most visible species
 * lacking data (`mode=missing`, the default) or the lowest accepted share
 * (`mode=least_accepted`), over the full unfiltered visible grid.
 * @rfc RFC-69 R7
 */
export const coverageTopQuerySchema = z.strictObject({
  mode: z.enum(['missing', 'least_accepted']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export type CoverageQuery = z.infer<typeof coverageQuerySchema>;
export type CoverageRow = z.infer<typeof coverageRowSchema>;
export type CoverageTraitRow = z.infer<typeof coverageTraitRowSchema>;
export type Coverage = z.infer<typeof coverageSchema>;
export type CoverageTopQuery = z.infer<typeof coverageTopQuerySchema>;
