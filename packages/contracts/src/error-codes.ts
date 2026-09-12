/**
 * Error code → HTTP status. Mirrors the catalog table in RFC-12.
 * @rfc RFC-12 R1-R4
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  VALIDATION_INVALID_JSON: 400,
  SECURITY_INVALID_ORIGIN: 403,
  NOT_FOUND: 404,
  REQUEST_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
