import { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from './error-codes.ts';
import { type ListMeta, listMetaSchema } from './pagination.ts';

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

/** @rfc RFC-11 R2 */
export function dataEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({ data, meta: listMetaSchema.optional() });
}

/**
 * A list response: `data` is the page's items and `meta.nextCursor` is
 * always present, `null` on the last page.
 * @rfc RFC-11 R2
 */
export function listEnvelopeSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({ data: z.array(item), meta: listMetaSchema });
}

/**
 * The payload of a request that has nothing to return, `{ status: "ok" }`
 * (RFC-22 R9): the API never answers 204, so a web fetcher that reads
 * nothing still parses this.
 * @rfc RFC-11 R2
 * @rfc RFC-22 R9
 */
export const okStatusSchema = z.strictObject({ status: z.literal('ok') });

export type ErrorDetail = z.infer<typeof errorDetailSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type DataEnvelope<T> = { data: T; meta?: ListMeta };
export type ListEnvelope<T> = { data: T[]; meta: ListMeta };
