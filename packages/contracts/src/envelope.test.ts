import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { dataEnvelopeSchema, errorEnvelopeSchema } from './envelope.ts';

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
