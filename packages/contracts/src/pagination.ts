import { z } from 'zod';

/** Query string form: `limit` arrives as text. @rfc RFC-11 R6 */
export const cursorQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** @rfc RFC-11 R2 */
export const listMetaSchema = z.strictObject({ nextCursor: z.string().nullable() });

export type CursorQuery = z.infer<typeof cursorQuerySchema>;
export type ListMeta = z.infer<typeof listMetaSchema>;
