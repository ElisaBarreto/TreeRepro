import {
  ERROR_CODES,
  type ErrorCode,
  type ErrorDetail,
  type ErrorEnvelope,
} from '@treerepro/contracts';
import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Logger } from '../logger.ts';
import type { AppEnv } from './env.ts';

/** @rfc RFC-11 R3-R4 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ContentfulStatusCode;
  readonly details: ErrorDetail[] | undefined;

  constructor(code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code] as ContentfulStatusCode;
    this.details = details;
  }
}

/** @rfc RFC-11 R3 */
export function errorBody(
  code: ErrorCode,
  message: string,
  details?: ErrorDetail[],
): ErrorEnvelope {
  return { error: details ? { code, message, details } : { code, message } };
}

const INTERNAL = errorBody('INTERNAL_ERROR', 'An unexpected error occurred');

/**
 * @rfc RFC-11 R3-R4
 * @rfc RFC-02 R9
 */
export function createErrorHandler(logger: Logger): ErrorHandler<AppEnv> {
  return (err, c) => {
    const requestId = c.get('requestId');
    if (err instanceof AppError) {
      return c.json(errorBody(err.code, err.message, err.details), err.status);
    }
    if (err instanceof HTTPException) {
      if (err.status === 413) {
        return c.json(errorBody('REQUEST_TOO_LARGE', 'Request body exceeds 1 MiB'), 413);
      }
      if (err.status === 400) {
        return c.json(errorBody('VALIDATION_INVALID_JSON', 'Request body is not valid JSON'), 400);
      }
      logger.warn({ requestId, status: err.status }, 'unmapped http exception');
      return c.json(INTERNAL, 500);
    }
    logger.error({ requestId, err }, 'unhandled error');
    return c.json(INTERNAL, 500);
  };
}
