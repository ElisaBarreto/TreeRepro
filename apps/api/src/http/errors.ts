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

/** How much of a failure `safeErrorSummary` keeps. @rfc RFC-02 R7 */
export const ERROR_SUMMARY_MAX = 200;

/** The first line Drizzle gives a query error; the parameters follow on the next one. */
const QUERY_ERROR_PREFIX = 'Failed query:';

/**
 * A one-line summary of a failure, narrowed for a column that is durable and
 * not only for a log line: `job_runs.error` is plaintext at rest (unlike the
 * encrypted user columns a failing query may name) and read straight back out
 * by the health page of RFC-52, so a raw `error.message` there would park a
 * Drizzle "Failed query: … params: …" — SQL over `users.name` / `users.email`
 * and its bound values — in front of every operator for a year.
 *
 * What it guarantees is exactly that: no SQL text and no bound-parameter list.
 * It is NOT a promise that no value can appear. `name` and the codes always
 * survive, and so does the driver's own one-line message, which may itself
 * quote an offending literal (Postgres 22P02: `invalid input syntax for type
 * uuid: "…"`). That is the same exposure RFC-02 R7 already accepts for the
 * log. It is unreachable at both call sites today — `audit_log_purge()` binds
 * nothing, and `digestRecipients` binds a permission key and the admin role
 * name, both constants — but a call site that bound user input would put that
 * input here too, truncated.
 *
 * The message survives only when it is the driver's own (`sanitizeError`
 * replaces it with the cause's) and does not open with Drizzle's query
 * preamble, which is what a query error carrying no cause still looks like.
 * The full sanitized error, message and stack included, still reaches the log,
 * so nothing is lost for diagnosis — only the durable column is narrowed.
 * @rfc RFC-02 R7
 * @rfc RFC-74 R1
 */
export function safeErrorSummary(err: Error): string {
  const { name, message, code, responseCode } = sanitizeError(err);
  const head = [name, code, responseCode === undefined ? undefined : String(responseCode)]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' ');
  const firstLine = message.split('\n')[0]?.trim() ?? '';
  const detail = firstLine === '' || firstLine.startsWith(QUERY_ERROR_PREFIX) ? '' : firstLine;
  return (detail === '' ? head : `${head}: ${detail}`).slice(0, ERROR_SUMMARY_MAX);
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
