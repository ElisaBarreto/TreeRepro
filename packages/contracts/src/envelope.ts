import { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from './error-codes.ts';

const errorCodes = Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]];

/** @rfc RFC-11 R3 */
export const errorDetailSchema = z.strictObject({
  path: z.string(),
  message: z.string(),
});

/** @rfc RFC-11 R3 */
export const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(errorCodes),
    message: z.string().min(1),
    details: z.array(errorDetailSchema).optional(),
  }),
});

/** @rfc RFC-11 R2, R6 */
export const listMetaSchema = z.strictObject({
  nextCursor: z.string().nullable(),
});

/** @rfc RFC-11 R2 */
export function dataEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({ data, meta: listMetaSchema.optional() });
}

export type ErrorDetail = z.infer<typeof errorDetailSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type ListMeta = z.infer<typeof listMetaSchema>;
export type DataEnvelope<T> = { data: T; meta?: ListMeta };
