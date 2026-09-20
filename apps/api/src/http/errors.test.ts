import { errorEnvelopeSchema } from '@treerepro/contracts';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../test/helpers/logger.ts';
import type { AppEnv } from './env.ts';
import {
  AppError,
  createErrorHandler,
  errorBody,
  FAILURE_CODE_PATTERN,
  failureCode,
  RateLimitedError,
  sanitizeError,
} from './errors.ts';

describe('RFC-11 R3-R4 AppError and errorBody', () => {
  it('derives the HTTP status from the code', () => {
    const err = new AppError('NOT_FOUND', 'Nope');
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Nope');
  });

  it('omits details when absent and includes them when present', () => {
    expect(errorBody('NOT_FOUND', 'x')).toEqual({ error: { code: 'NOT_FOUND', message: 'x' } });
    const withDetails = errorBody('VALIDATION_FAILED', 'x', [{ path: 'a', message: 'b' }]);
    expect(withDetails.error.details).toEqual([{ path: 'a', message: 'b' }]);
    expect(errorEnvelopeSchema.safeParse(withDetails).success).toBe(true);
  });
});

describe('RFC-02 R9 error handler', () => {
  function app() {
    const { logger, lines } = captureLogger();
    const a = new Hono<AppEnv>();
    a.use(requestId());
    a.onError(createErrorHandler(logger));
    a.get('/app-error', () => {
      throw new AppError('RATE_LIMITED', 'Slow down');
    });
    a.get('/http-413', () => {
      throw new HTTPException(413, { message: 'too big' });
    });
    a.get('/http-400', () => {
      throw new HTTPException(400, { message: 'Malformed JSON in request body' });
    });
    a.get('/http-400-other', () => {
      throw new HTTPException(400, { message: 'other' });
    });
    a.get('/http-418', () => {
      throw new HTTPException(418, { message: 'teapot' });
    });
    a.get('/boom', () => {
      throw new Error('secret internal detail');
    });
    a.get('/limited', () => {
      throw new RateLimitedError(17);
    });
    a.get('/query-error', () => {
      // The real Drizzle class: query text and params as own properties and in
      // the two-line message ("Failed query: …\nparams: …"), driver error on `cause`.
      const cause = Object.assign(new Error('boom'), { code: '23505' });
      throw new DrizzleQueryError('insert into users values ($1)', ['secret-value'], cause);
    });
    return { a, lines };
  }

  it('maps AppError to its code and status', async () => {
    const res = await app().a.request('/app-error');
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: 'RATE_LIMITED', message: 'Slow down' } });
  });

  it('RFC-24 R2 RateLimitedError answers 429 with Retry-After', async () => {
    const { a } = app();
    const res = await a.request('/limited');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('17');
    expect((await res.json()).error.code).toBe('RATE_LIMITED');
  });

  it('maps HTTPException 413 and 400 to catalog codes', async () => {
    const { a } = app();
    const r413 = await a.request('/http-413');
    expect(r413.status).toBe(413);
    expect((await r413.json()).error.code).toBe('REQUEST_TOO_LARGE');
    const r400 = await a.request('/http-400');
    expect(r400.status).toBe(400);
    expect((await r400.json()).error.code).toBe('VALIDATION_INVALID_JSON');
  });

  it('maps an HTTPException 400 with another message to INTERNAL_ERROR (M4)', async () => {
    const { a, lines } = app();
    const res = await a.request('/http-400-other');
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('INTERNAL_ERROR');
    expect(lines.some((l) => (l as { msg: string }).msg === 'unmapped http exception')).toBe(true);
  });

  it('maps any other HTTPException to INTERNAL_ERROR without leaking its message', async () => {
    const res = await app().a.request('/http-418');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('teapot');
    expect(JSON.parse(text).error.code).toBe('INTERNAL_ERROR');
  });

  it('hides unexpected errors and logs them with the request id', async () => {
    const { a, lines } = app();
    const res = await a.request('/boom', { headers: { 'x-request-id': 'req-123' } });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret internal detail');
    expect(JSON.parse(text)).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
    const logged = lines.find((l) => (l as { msg: string }).msg === 'unhandled error') as {
      requestId: string;
      err: { message: string };
    };
    expect(logged.requestId).toBe('req-123');
    expect(logged.err.message).toBe('secret internal detail');
  });

  it('RFC-02 R7 logs a sanitized error: cause message and code, never query or params', async () => {
    const { a, lines } = app();
    const res = await a.request('/query-error');
    expect(res.status).toBe(500);
    const logged = lines.find((l) => (l as { msg: string }).msg === 'unhandled error') as {
      err: { message: string; code?: string; stack?: string };
    };
    expect(logged.err).toMatchObject({ message: 'boom', code: '23505' });
    // Only frame lines survive; the message lines (query and params) do not.
    expect(logged.err.stack).toMatch(/^\s+at /);
    const line = JSON.stringify(logged);
    expect(line).not.toContain('secret-value');
    expect(line).not.toContain('params:');
    expect(line).not.toContain('insert into users');
  });
});

describe('RFC-02 R7 sanitizeError reads the codes an unwrapped driver sets', () => {
  it('takes code and responseCode off the error itself when there is no cause', () => {
    // nodemailer never wraps: `createMailer` awaits `transport.sendMail`, so a
    // rejection arrives with its own `code` and `responseCode` and no cause.
    // Reading only through the cause left both `undefined` for every mail
    // failure in production.
    const err = Object.assign(new Error('Invalid login: 535 5.7.8'), {
      code: 'EAUTH',
      responseCode: 535,
    });
    expect(sanitizeError(err)).toMatchObject({ code: 'EAUTH', responseCode: 535 });
  });

  it('still prefers the cause of a wrapped query error', () => {
    const cause = Object.assign(new Error('boom'), { code: '23505' });
    const err = new DrizzleQueryError('insert into users values ($1)', ['secret-value'], cause);
    // Drizzle leaves `name` at the base class's 'Error': the class name is not
    // available to identify a query error by, which is why the guard in
    // `failureCode` cannot tell one from an ordinary error by name.
    expect(sanitizeError(err)).toMatchObject({ name: 'Error', message: 'boom', code: '23505' });
  });

  it('ignores a code of the wrong type rather than stringifying it', () => {
    const err = Object.assign(new Error('x'), { code: 7, responseCode: '550' });
    expect(sanitizeError(err)).toMatchObject({ code: undefined, responseCode: undefined });
  });
});

describe('RFC-74 R1 failureCode', () => {
  it('keeps the name and the driver code of a query error, never the SQL, the params or the message', () => {
    const cause = Object.assign(new Error('boom'), { code: '23505' });
    const code = failureCode(
      new DrizzleQueryError('insert into users values ($1)', ['secret-value'], cause),
    );
    expect(code).toBe('Error 23505');
    expect(code).not.toContain('secret-value');
    expect(code).not.toContain('boom');
  });

  it('drops a driver message that quotes the offending literal', () => {
    // Postgres 22P02 puts the bad value in its primary message; the SQLSTATE
    // alone says what went wrong.
    const cause = Object.assign(new Error('invalid input syntax for type uuid: "ada@x.org"'), {
      code: '22P02',
    });
    const code = failureCode(new DrizzleQueryError('select 1', [], cause));
    expect(code).toBe('Error 22P02');
    expect(code).not.toContain('ada@x.org');
  });

  it('keeps the SMTP code and response code of a mail failure', () => {
    const smtp = Object.assign(new Error('Greeting never received'), {
      code: 'ETIMEDOUT',
      responseCode: 421,
    });
    expect(failureCode(smtp)).toBe('Error ETIMEDOUT 421');
  });

  it('reduces an error with no code to its name', () => {
    expect(failureCode(new Error('db down'))).toBe('Error');
    expect(failureCode(new RangeError('too deep'))).toBe('RangeError');
  });

  it('keeps only token-shaped identifiers, so free text cannot ride in on a name or a code', () => {
    const err = Object.assign(new Error('Failed query: select * from users where email = $1'), {
      code: 'boom: ada@x.org',
      responseCode: 4.5,
    });
    err.name = 'Failed query: select 1';
    expect(failureCode(err)).toBe('Error');
  });

  it('FAILURE_CODE_PATTERN is the grammar of RFC-74 R1: one to three tokens, single spaces', () => {
    for (const ok of ['Error', 'Error 23505', 'Error ETIMEDOUT 421', 'RangeError']) {
      expect(ok).toMatch(FAILURE_CODE_PATTERN);
    }
    for (const bad of [
      'Error  23505',
      ' Error',
      'Error ETIMEDOUT 421 extra',
      'Error: db down',
      '',
      'x'.repeat(65),
    ]) {
      expect(bad).not.toMatch(FAILURE_CODE_PATTERN);
    }
  });

  it('always fits the column pattern, whatever the error carries', () => {
    const err = Object.assign(new Error('x'.repeat(5_000)), { code: 'E'.repeat(5_000) });
    err.name = 'N'.repeat(5_000);
    expect(failureCode(err)).toMatch(FAILURE_CODE_PATTERN);
  });
});
