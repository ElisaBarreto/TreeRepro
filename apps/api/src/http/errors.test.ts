import { errorEnvelopeSchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../test/helpers/logger.ts';
import type { AppEnv } from './env.ts';
import { AppError, createErrorHandler, errorBody } from './errors.ts';

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
    a.get('/query-error', () => {
      // Shaped like Drizzle's DrizzleQueryError: query text and params as own
      // properties and in the message, the driver error on `cause`.
      const cause = Object.assign(new Error('duplicate key value'), { code: '23505' });
      throw Object.assign(
        new Error('Failed query: insert into users values ($1) params: secret-value', { cause }),
        {
          name: 'DrizzleQueryError',
          query: 'insert into users values ($1)',
          params: ['secret-value'],
        },
      );
    });
    return { a, lines };
  }

  it('maps AppError to its code and status', async () => {
    const res = await app().a.request('/app-error');
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: 'RATE_LIMITED', message: 'Slow down' } });
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
      err: { name: string; message: string; code?: string; stack?: string };
    };
    expect(logged.err).toMatchObject({
      name: 'DrizzleQueryError',
      message: 'duplicate key value',
      code: '23505',
    });
    // The stack keeps the frames but drops its first line (the raw message).
    expect(logged.err.stack).toMatch(/^\s+at /);
    expect(JSON.stringify(logged)).not.toContain('secret-value');
    expect(JSON.stringify(logged)).not.toContain('insert into users');
  });
});
