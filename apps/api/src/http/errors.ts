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
 * `code` off an error or its cause, kept only when it is a string. Every
 * producer we read sets a fixed token — Postgres' SQLSTATE (`23505`),
 * nodemailer's `EAUTH` / `ETIMEDOUT` / `EENVELOPE` — never a value derived
 * from the data, so a code cannot carry an address or a query parameter.
 */
function stringCode(err: Error | undefined): string | undefined {
  const code = (err as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * `responseCode` off an error or its cause: the integer status of the SMTP
 * reply nodemailer rejected on (550, 421, 535). Address-free by construction,
 * exactly as `stringCode`.
 */
function numericResponseCode(err: Error | undefined): number | undefined {
  const code = (err as { responseCode?: unknown } | undefined)?.responseCode;
  return typeof code === 'number' && Number.isFinite(code) ? code : undefined;
}

/**
 * The parts of an error that are safe to log. Query errors (Drizzle's
 * DrizzleQueryError) carry the SQL text and its parameters as own properties
 * and in `message`; parameters can hold hashes, tokens and blind indexes, so
 * the SQL and its bound values are dropped and what is kept is the driver's
 * own message and code. That message is not itself value-free — Postgres
 * quotes the offending literal in some primary messages (22P02, `invalid
 * input syntax for type uuid: "…"`) — which is the exposure RFC-02 R7 accepts
 * for a log line.
 *
 * `code` and `responseCode` are read from the cause FIRST and from the error
 * itself second. Drizzle wraps the driver error as a cause; nodemailer does
 * not wrap at all — `createMailer` awaits `sendMail` directly, so an SMTP
 * failure arrives with its `code` and `responseCode` set on the error itself
 * and no cause. Reading the cause alone left both `undefined` for every mail
 * failure there is.
 * @rfc RFC-02 R7
 */
export function sanitizeError(err: Error): {
  name: string;
  message: string;
  code: string | undefined;
  responseCode: number | undefined;
  stack: string | undefined;
} {
  const cause = err.cause instanceof Error ? err.cause : undefined;
  return {
    name: err.name,
    message: cause ? cause.message : err.message,
    code: stringCode(cause) ?? stringCode(err),
    responseCode: numericResponseCode(cause) ?? numericResponseCode(err),
    // The stack starts with the raw message (several lines for a query error:
    // "Failed query: …\nparams: …"); only the frame lines are kept.
    stack: err.stack
      ?.split('\n')
      .filter((line) => /^\s+at\s/.test(line))
      .join('\n'),
  };
}

/** One identifier: an error class name, a SQLSTATE, an errno, an SMTP reply code. */
const TOKEN = /^[A-Za-z0-9_]{1,64}$/;

/**
 * What `job_runs.error` may hold: one to three `TOKEN`s separated by single
 * spaces. The column's `job_runs_error_check` states the same grammar in SQL,
 * so a value that escaped this function could not be stored either.
 * @rfc RFC-74 R1
 */
export const FAILURE_CODE_PATTERN = /^[A-Za-z0-9_]{1,64}( [A-Za-z0-9_]{1,64}){0,2}$/;

/**
 * The identifiers of a failure and nothing else — `<name> [<code>]
 * [<responseCode>]`, e.g. `Error 23505`, `Error ETIMEDOUT 421`, `RangeError`
 * — for a column that is durable, plaintext at rest and published to an
 * administrator's browser by the health page of RFC-52: `job_runs.error`.
 *
 * The message never survives, not even its first line. A Drizzle query error
 * puts the SQL and its bound values there — over the encrypted `users.name` /
 * `users.email` columns when `digestRecipients` fails — and the driver's own
 * one-line message can quote an offending literal (Postgres 22P02, `invalid
 * input syntax for type uuid: "…"`). That is the exposure RFC-02 R7 accepts
 * for a log line and RFC-74 R1 refuses for this column. Nothing is lost for
 * diagnosis: both writers rethrow, so the full sanitized error, message and
 * stack included, still reaches the log.
 *
 * Each part is kept only when it is a single token (`TOKEN`), so free text
 * cannot ride in on an unusual `name` or `code`; a name that is not one
 * reads `Error`. The result therefore always matches `FAILURE_CODE_PATTERN`.
 * @rfc RFC-74 R1
 */
export function failureCode(err: Error): string {
  const { name, code, responseCode } = sanitizeError(err);
  const token = (part: string | undefined): string | undefined =>
    part !== undefined && TOKEN.test(part) ? part : undefined;
  return [
    token(name) ?? 'Error',
    token(code),
    token(responseCode === undefined ? undefined : String(responseCode)),
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');
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
