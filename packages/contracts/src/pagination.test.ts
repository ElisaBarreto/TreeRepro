import { describe, expect, it } from 'vitest';
import { cursorQuerySchema, listMetaSchema } from './pagination.ts';

describe('RFC-11 R6 cursor pagination query', () => {
  it('defaults limit to 50, coerces the string from the query, and caps at 200', () => {
    expect(cursorQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(cursorQuerySchema.parse({ limit: '25', cursor: 'abc' })).toEqual({
      limit: 25,
      cursor: 'abc',
    });
    expect(cursorQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(cursorQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(cursorQuerySchema.safeParse({ limit: '1.5' }).success).toBe(false);
    expect(cursorQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
    expect(cursorQuerySchema.safeParse({ page: '2' }).success).toBe(false);
  });

  it('R2 list meta carries nextCursor as string or null', () => {
    expect(listMetaSchema.safeParse({ nextCursor: null }).success).toBe(true);
    expect(listMetaSchema.safeParse({ nextCursor: 'x' }).success).toBe(true);
    expect(listMetaSchema.safeParse({}).success).toBe(false);
  });
});
