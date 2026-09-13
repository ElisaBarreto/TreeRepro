import { describe, expect, it } from 'vitest';
import {
  decodeCompositeCursor,
  decodeCursor,
  encodeCompositeCursor,
  encodeCursor,
  isDigits,
  isUuid,
} from './cursor.ts';
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

describe('RFC-11 R6 composite cursor', () => {
  it('round-trips an ordered list of strings, opaque to clients', () => {
    const token = encodeCompositeCursor([
      'Adesmia glutinosa',
      '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e',
    ]);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCompositeCursor(token, 2)).toEqual([
      'Adesmia glutinosa',
      '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e',
    ]);
  });

  it('keeps unicode and separators intact', () => {
    const parts = ['Kühn, I., W. Durka; 2004', '42'];
    expect(decodeCompositeCursor(encodeCompositeCursor(parts), 2)).toEqual(parts);
  });

  it('rejects the wrong arity, non-JSON, non-string parts and padding tricks with VALIDATION_FAILED on cursor', () => {
    const token = encodeCompositeCursor(['a', 'b']);
    for (const bad of [
      () => decodeCompositeCursor(token, 3),
      () => decodeCompositeCursor('not-base64-json', 2),
      () => decodeCompositeCursor(Buffer.from('[1,2]').toString('base64url'), 2),
      () => decodeCompositeCursor(Buffer.from('{"a":1}').toString('base64url'), 1),
      () => decodeCompositeCursor(`${token}=`, 2),
    ]) {
      expect(bad).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
      try {
        bad();
      } catch (err) {
        expect((err as { details?: unknown }).details).toEqual([
          { path: 'cursor', message: 'Invalid cursor' },
        ]);
      }
    }
  });

  it('rejects a part that fails its validator with VALIDATION_FAILED at path cursor', () => {
    const token = encodeCompositeCursor(['x', 'y']);
    let caught: unknown;
    try {
      decodeCompositeCursor(token, 2, [() => true, isUuid]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('VALIDATION_FAILED');
    expect((caught as AppError).details).toEqual([{ path: 'cursor', message: 'Invalid cursor' }]);
  });

  it('passes a token whose parts satisfy every validator', () => {
    const id = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e';
    const token = encodeCompositeCursor(['free text', id]);
    expect(decodeCompositeCursor(token, 2, [() => true, isUuid])).toEqual(['free text', id]);
  });

  it('isDigits accepts only ASCII digit strings', () => {
    expect(isDigits('0')).toBe(true);
    expect(isDigits('12345')).toBe(true);
    expect(isDigits('')).toBe(false);
    expect(isDigits('12.3')).toBe(false);
    expect(isDigits('-1')).toBe(false);
    expect(isDigits('1a')).toBe(false);
  });
});
