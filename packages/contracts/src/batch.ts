import { z } from 'zod';

/** @rfc RFC-82 R10 */
export const BATCH_MAX_OPS = 500;

/** @rfc RFC-82 R10 */
export const BATCH_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** @rfc RFC-82 R10 */
export const batchOpSchema = z.strictObject({
  ref: z.string().min(1).max(200).optional(),
  method: z.enum(BATCH_METHODS),
  path: z.string().min(1).max(2048),
  body: z.unknown().optional(),
});

/** @rfc RFC-82 R10 */
export const batchBodySchema = z.strictObject({
  ops: z.array(batchOpSchema).min(1).max(BATCH_MAX_OPS),
});

/** @rfc RFC-82 R13 */
export const batchResultSchema = z.strictObject({
  ref: z.string().nullable(),
  status: z.number().int(),
  body: z.unknown(),
});

/** @rfc RFC-82 R13 */
export const batchResponseSchema = z.strictObject({
  summary: z.strictObject({
    ok: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  results: z.array(batchResultSchema),
});

export type BatchOp = z.infer<typeof batchOpSchema>;
export type BatchResult = z.infer<typeof batchResultSchema>;
export type BatchResponse = z.infer<typeof batchResponseSchema>;
