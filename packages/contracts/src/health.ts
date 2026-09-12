import { z } from 'zod';

/** @rfc RFC-10 R10 */
export const healthResponseSchema = z.strictObject({ ok: z.literal(true) });

export type HealthResponse = z.infer<typeof healthResponseSchema>;
