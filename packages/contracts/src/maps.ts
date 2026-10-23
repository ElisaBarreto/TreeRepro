import { z } from 'zod';

/**
 * The kinds of map, in page order (RFC-76 R1): completeness for any trait, the
 * statistics of the species medians for a quantitative one, and the prevalence
 * of each state for a categorical one.
 * @rfc RFC-76 R1
 */
export const MAP_KINDS = [
  'completeness',
  'mean',
  'median',
  'sd',
  'cv',
  'min',
  'max',
  'prevalence',
] as const;
/** @rfc RFC-76 R1 */
export type MapKind = (typeof MAP_KINDS)[number];

/**
 * One map a viewer may see: `levelId` is null except for `prevalence`;
 * `regions` counts the regions with a value; `computedAt` dates the snapshot.
 * @rfc RFC-76 R5
 */
export const mapEntrySchema = z.strictObject({
  traitId: z.uuid(),
  kind: z.enum(MAP_KINDS),
  levelId: z.uuid().nullable(),
  regions: z.number().int().positive(),
  computedAt: z.iso.datetime({ offset: true }),
});
/** @rfc RFC-76 R5 */
export type MapEntry = z.infer<typeof mapEntrySchema>;

/** `GET /api/maps`, by trait key, kind and state. @rfc RFC-76 R5 */
export const mapsResponseSchema = z.array(mapEntrySchema);

/** `GET /api/maps/values`: `levelId` with `prevalence` and only with it. @rfc RFC-76 R6 */
export const mapValuesQuerySchema = z
  .strictObject({
    traitId: z.uuid(),
    kind: z.enum(MAP_KINDS),
    levelId: z.uuid().optional(),
  })
  .refine((q) => (q.kind === 'prevalence') === (q.levelId !== undefined), {
    message: 'levelId goes with kind=prevalence, and only with it',
    path: ['levelId'],
  });
/** @rfc RFC-76 R6 */
export type MapValuesQuery = z.infer<typeof mapValuesQuerySchema>;

/** A colour as the maps write it (RFC-76 R4). */
const hex = z.string().regex(/^#[0-9A-F]{6}$/);

/** One map's regions and legend (RFC-76 R6). @rfc RFC-76 R6 */
export const mapValuesSchema = z.strictObject({
  regions: z.array(
    z.strictObject({
      code: z.string(),
      name: z.string(),
      value: z.number().nullable(),
      nSpecies: z.number().int().nonnegative(),
      fill: hex,
    }),
  ),
  legend: z.strictObject({
    stops: z.array(hex).length(6),
    limits: z.tuple([z.number(), z.number()]),
    log: z.boolean(),
    percent: z.boolean(),
    label: z.string(),
    unit: z.string().nullable(),
  }),
  computedAt: z.iso.datetime({ offset: true }),
});
/** @rfc RFC-76 R6 */
export type MapValues = z.infer<typeof mapValuesSchema>;
