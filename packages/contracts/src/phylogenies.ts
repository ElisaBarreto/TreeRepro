import { z } from 'zod';

/**
 * One phylogeny figure a viewer may see: `key` is the trait's key or
 * `coverage` (with `traitId` null); `version` is the PNG's mtime in ms.
 * @rfc RFC-79 R2
 */
export const phylogenyFigureSchema = z.strictObject({
  key: z.string(),
  traitId: z.uuid().nullable(),
  version: z.string(),
});
/** @rfc RFC-79 R2 */
export type PhylogenyFigure = z.infer<typeof phylogenyFigureSchema>;

/** `GET /api/phylogenies`: coverage first, then by trait key. @rfc RFC-79 R2 */
export const phylogeniesResponseSchema = z.array(phylogenyFigureSchema);

/** `GET /api/phylogenies/files/:key`: a key, never a path. @rfc RFC-79 R3 */
export const phylogenyFileParamSchema = z.strictObject({ key: z.string().regex(/^[a-z0-9_]+$/) });

/** @rfc RFC-79 R3 */
export const phylogenyFileQuerySchema = z.strictObject({
  size: z.enum(['display', 'full']),
  v: z.string().optional(),
});
