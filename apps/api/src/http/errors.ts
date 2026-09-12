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

/** @rfc RFC-24 R2 */
export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('RATE_LIMITED', 'Too many requests; try again later');
    this.name = 'RateLimitedError';
    this.retryAfterSeconds = retryAfterSeconds;
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

// The message Hono's validator throws when the JSON body cannot be parsed.
const MALFORMED_JSON_MESSAGE = 'Malformed JSON in request body';

/**
 * The parts of an error that are safe to log. Query errors (Drizzle's
 * DrizzleQueryError) carry the SQL text and its parameters as own properties
 * and in `message`; parameters can hold hashes, tokens and blind indexes, so
 * only the driver's own message and code are kept.
 * @rfc RFC-02 R7
 */
export function sanitizeError(err: Error): {
  name: string;
  message: string;
  code: string | undefined;
  stack: string | undefined;
} {
  const cause = err.cause instanceof Error ? err.cause : undefined;
  const code = (cause as { code?: unknown } | undefined)?.code;
  return {
    name: err.name,
    message: cause ? cause.message : err.message,
    code: typeof code === 'string' ? code : undefined,
    // The stack starts with the raw message (several lines for a query error:
    // "Failed query: …\nparams: …"); only the frame lines are kept.
    stack: err.stack
      ?.split('\n')
      .filter((line) => /^\s+at\s/.test(line))
      .join('\n'),
  };
}

/**
 * @rfc RFC-11 R3-R4
 * @rfc RFC-02 R7, R9
 */
export function createErrorHandler(logger: Logger): ErrorHandler<AppEnv> {
  return (err, c) => {
    // The request logger is bound by middleware (RFC-10 R12); the fallback
    // covers errors thrown before it ran.
    const log = c.get('logger') ?? logger.child({ requestId: c.get('requestId') });
    if (err instanceof RateLimitedError) c.header('Retry-After', String(err.retryAfterSeconds));
    if (err instanceof AppError) {
      return c.json(errorBody(err.code, err.message, err.details), err.status);
    }
    if (err instanceof HTTPException) {
      if (err.status === 413) {
        return c.json(errorBody('REQUEST_TOO_LARGE', 'Request body exceeds 1 MiB'), 413);
      }
      if (err.status === 400 && err.message === MALFORMED_JSON_MESSAGE) {
        return c.json(errorBody('VALIDATION_INVALID_JSON', 'Request body is not valid JSON'), 400);
      }
      log.warn({ status: err.status }, 'unmapped http exception');
      return c.json(INTERNAL, 500);
    }
    log.error({ err: sanitizeError(err) }, 'unhandled error');
    return c.json(INTERNAL, 500);
  };
}
