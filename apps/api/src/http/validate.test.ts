import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { captureLogger } from '../../test/helpers/logger.ts';
import type { AppEnv } from './env.ts';
import { createErrorHandler } from './errors.ts';
import { validate, validatorSchema } from './validate.ts';

const bodySchema = z.strictObject({ name: z.string().min(1), age: z.number().int() });
const querySchema = z.strictObject({ limit: z.coerce.number().int().max(200).optional() });

function app() {
  const a = new Hono<AppEnv>();
  a.onError(createErrorHandler(captureLogger().logger));
  a.post('/things', validate('json', bodySchema), (c) => c.json({ data: c.req.valid('json') }));
  a.get('/things', validate('query', querySchema), (c) => c.json({ data: c.req.valid('query') }));
  return a;
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('RFC-02 R2 strict validation', () => {
  it('passes a valid body through to the handler', async () => {
    const res = await app().request('/things', json({ name: 'a', age: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { name: 'a', age: 1 } });
  });

  it('rejects unknown fields with 400 VALIDATION_FAILED and never echoes values', async () => {
    const res = await app().request('/things', json({ name: 'a', age: 1, extra: 'SECRET_VALUE' }));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain('SECRET_VALUE');
    const body = JSON.parse(text);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.some((d: { message: string }) => /extra/.test(d.message))).toBe(true);
  });

  it('reports the failing field path', async () => {
    const res = await app().request('/things', json({ name: 'a', age: 'x' }));
    const body = await res.json();
    expect(body.error.details.map((d: { path: string }) => d.path)).toContain('age');
  });

  it('RFC-11 R7 malformed JSON answers VALIDATION_INVALID_JSON', async () => {
    const res = await app().request('/things', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_INVALID_JSON');
  });

  it('RFC-11 R7 a non-JSON content type fails validation', async () => {
    const res = await app().request('/things', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'name=a',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual([{ path: '', message: 'Expected application/json' }]);
  });

  it('validates query strings', async () => {
    expect((await app().request('/things?limit=10')).status).toBe(200);
    const res = await app().request('/things?limit=999');
    expect(res.status).toBe(400);
    expect((await res.json()).error.details[0].path).toBe('limit');
  });
});

describe('RFC-82 R16 validatorSchema', () => {
  it('returns the target and schema a validate() middleware was built with', () => {
    const schema = z.strictObject({ id: z.string() });
    expect(validatorSchema(validate('param', schema))).toEqual({ target: 'param', schema });
    expect(validatorSchema(validate('json', schema))).toEqual({ target: 'json', schema });
  });

  it('returns undefined for any other function', () => {
    expect(validatorSchema(() => undefined)).toBeUndefined();
    expect(validatorSchema('x')).toBeUndefined();
  });
});
