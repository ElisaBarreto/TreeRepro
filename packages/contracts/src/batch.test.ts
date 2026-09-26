import { describe, expect, it } from 'vitest';
import { BATCH_MAX_OPS, batchBodySchema } from './batch.ts';

const op = { method: 'GET', path: '/api/families' } as const;

describe('RFC-82 R10 batch body', () => {
  it('takes 1 to 500 operations', () => {
    expect(batchBodySchema.safeParse({ ops: [] }).success).toBe(false);
    expect(batchBodySchema.safeParse({ ops: [op] }).success).toBe(true);
    expect(batchBodySchema.safeParse({ ops: Array(BATCH_MAX_OPS).fill(op) }).success).toBe(true);
    expect(batchBodySchema.safeParse({ ops: Array(BATCH_MAX_OPS + 1).fill(op) }).success).toBe(
      false,
    );
  });

  it('accepts ref and any JSON body, refuses unknown fields and methods', () => {
    expect(
      batchBodySchema.safeParse({
        ops: [{ ref: 'row-1', method: 'POST', path: '/api/families', body: { name: 'X' } }],
      }).success,
    ).toBe(true);
    expect(batchBodySchema.safeParse({ ops: [{ ...op, extra: 1 }] }).success).toBe(false);
    expect(batchBodySchema.safeParse({ ops: [{ ...op, method: 'HEAD' }] }).success).toBe(false);
    expect(batchBodySchema.safeParse({ ops: [op], extra: 1 }).success).toBe(false);
    expect(batchBodySchema.safeParse({ ops: [{ ...op, ref: '' }] }).success).toBe(false);
    expect(batchBodySchema.safeParse({ ops: [{ ...op, path: '' }] }).success).toBe(false);
  });
});
