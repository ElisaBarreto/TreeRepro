import { z } from 'zod';
import { totpCodeSchema } from './auth.ts';

/** @rfc RFC-82 R7 */
export const API_KEY_STATES = ['active', 'expired', 'revoked'] as const;

/** @rfc RFC-82 R7 */
export const apiKeySummarySchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string().length(8),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  state: z.enum(API_KEY_STATES),
});

/** @rfc RFC-82 R7 */
export const apiKeyListSchema = z.strictObject({
  eligible: z.boolean(),
  keys: z.array(apiKeySummarySchema),
});

/** @rfc RFC-82 R1, R2 */
export const createApiKeyBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  password: z.string().min(1).max(128),
  code: totpCodeSchema,
});

/** @rfc RFC-82 R1, R7 */
export const createApiKeyResponseSchema = z.strictObject({
  key: apiKeySummarySchema,
  secret: z.string(),
});

export type ApiKeySummary = z.infer<typeof apiKeySummarySchema>;
export type ApiKeyList = z.infer<typeof apiKeyListSchema>;
export type CreateApiKeyBody = z.infer<typeof createApiKeyBodySchema>;
export type CreateApiKeyResponse = z.infer<typeof createApiKeyResponseSchema>;
