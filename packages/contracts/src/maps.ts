import { z } from 'zod';

/**
 * The kinds of map a manifest row may name (RFC-76 R1).
 * @rfc RFC-76 R1
 */
export const MAP_KINDS = ['completeness', 'prevalence', 'mean', 'min', 'max', 'sd'] as const;
/** @rfc RFC-76 R1 */
export type MapKind = (typeof MAP_KINDS)[number];

/**
 * One map a viewer may see: `levelId` is null except for `prevalence`.
 * @rfc RFC-76 R4
 */
export const mapEntrySchema = z.strictObject({
  traitId: z.uuid(),
  kind: z.enum(MAP_KINDS),
  levelId: z.uuid().nullable(),
  file: z.string(),
  dataVersion: z.iso.date(),
});
/** @rfc RFC-76 R4 */
export type MapEntry = z.infer<typeof mapEntrySchema>;

/** `GET /api/maps`, in manifest order. @rfc RFC-76 R4 */
export const mapsResponseSchema = z.array(mapEntrySchema);

/**
 * `GET /api/maps/files/:name`. No pattern: any name the manifest does not list
 * answers 404 `MAP_NOT_FOUND`, never 400.
 * @rfc RFC-76 R5
 */
export const mapFileParamSchema = z.strictObject({ name: z.string() });
