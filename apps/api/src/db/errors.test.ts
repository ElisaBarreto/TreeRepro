import { describe, expect, it } from 'vitest';
import { isCheckViolation, isForeignKeyViolation, isUniqueViolation } from './errors.ts';

function wrapped(code: string): Error {
  const pg = Object.assign(new Error('pg'), { code });
  return new Error('query failed', { cause: new Error('drizzle', { cause: pg }) });
}

describe('RFC-20 R3 database error classification', () => {
  it('finds the SQLSTATE anywhere in the cause chain', () => {
    expect(isUniqueViolation(wrapped('23505'))).toBe(true);
    expect(isForeignKeyViolation(wrapped('23503'))).toBe(true);
    expect(isCheckViolation(wrapped('23514'))).toBe(true);
    expect(isUniqueViolation(wrapped('42501'))).toBe(false);
    expect(isUniqueViolation(new Error('plain'))).toBe(false);
    expect(isUniqueViolation('not an error')).toBe(false);
  });
});
