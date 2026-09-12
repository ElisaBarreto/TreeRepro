import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.ts';
import { AppError } from './errors.ts';

const ID = '019a0000-0000-7000-8000-000000000001';

describe('RFC-11 R6 opaque keyset cursor', () => {
  it('round-trips a uuid through base64url without padding or the raw id', () => {
    const token = encodeCursor(ID);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain(ID);
    expect(decodeCursor(token)).toBe(ID);
  });

  it('rejects a malformed token with VALIDATION_FAILED at path cursor', () => {
    for (const bad of [
      '',
      'not base64!',
      Buffer.from('nope').toString('base64url'),
      encodeCursor(ID).slice(1),
    ]) {
      let caught: unknown;
      try {
        decodeCursor(bad);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).code).toBe('VALIDATION_FAILED');
      expect((caught as AppError).details).toEqual([{ path: 'cursor', message: 'Invalid cursor' }]);
    }
  });
});
