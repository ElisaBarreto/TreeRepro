import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  dataEnvelopeSchema,
  errorEnvelopeSchema,
  listEnvelopeSchema,
  okStatusSchema,
} from './envelope.ts';

describe('RFC-11 R3 error envelope', () => {
  it('accepts a known code with message and optional details', () => {
    const ok = errorEnvelopeSchema.safeParse({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: [{ path: 'email', message: 'Invalid email' }],
      },
    });
    expect(ok.success).toBe(true);
  });

  it('rejects an unknown code', () => {
    const bad = errorEnvelopeSchema.safeParse({ error: { code: 'NOPE', message: 'x' } });
    expect(bad.success).toBe(false);
  });

  it('rejects extra fields', () => {
    const bad = errorEnvelopeSchema.safeParse({
      error: { code: 'NOT_FOUND', message: 'x', stack: 'leak' },
    });
    expect(bad.success).toBe(false);
  });
});

describe('RFC-11 R2 data envelope', () => {
  const schema = dataEnvelopeSchema(z.array(z.string()));

  it('accepts data with optional meta.nextCursor', () => {
    expect(schema.safeParse({ data: ['a'] }).success).toBe(true);
    expect(schema.safeParse({ data: ['a'], meta: { nextCursor: null } }).success).toBe(true);
    expect(schema.safeParse({ data: ['a'], meta: { nextCursor: 'abc' } }).success).toBe(true);
  });

  it('rejects extra top-level fields', () => {
    expect(schema.safeParse({ data: [], extra: 1 }).success).toBe(false);
  });
});

describe('RFC-11 R2 list envelope', () => {
  const schema = listEnvelopeSchema(z.string());

  it('accepts an array of items with a required meta.nextCursor', () => {
    expect(schema.safeParse({ data: ['a'], meta: { nextCursor: null } }).success).toBe(true);
    expect(schema.safeParse({ data: [], meta: { nextCursor: 'abc' } }).success).toBe(true);
  });

  it('rejects a page without meta, a non-array data, or extra fields', () => {
    expect(schema.safeParse({ data: ['a'] }).success).toBe(false);
    expect(schema.safeParse({ data: 'a', meta: { nextCursor: null } }).success).toBe(false);
    expect(schema.safeParse({ data: [], meta: { nextCursor: null }, extra: 1 }).success).toBe(
      false,
    );
  });
});

describe('RFC-22 R9 acknowledgement', () => {
  it('is exactly { status: "ok" }', () => {
    expect(okStatusSchema.safeParse({ status: 'ok' }).success).toBe(true);
    expect(okStatusSchema.safeParse({ status: 'done' }).success).toBe(false);
    expect(okStatusSchema.safeParse({ status: 'ok', user: {} }).success).toBe(false);
  });
});
