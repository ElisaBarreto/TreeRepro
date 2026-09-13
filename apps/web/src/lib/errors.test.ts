import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client.ts';
import { fieldErrors, GENERIC_MESSAGE, isValidationError } from './errors.ts';

describe('RFC-13 R6 field errors', () => {
  it('maps VALIDATION_FAILED and AUTH_PASSWORD_WEAK details by path, an empty path to form', () => {
    const error = new ApiError(400, 'VALIDATION_FAILED', 'Request validation failed', [
      { path: 'email', message: 'Invalid email address' },
      { path: '', message: 'Expected application/json' },
    ]);
    expect(fieldErrors(error)).toEqual({
      email: 'Invalid email address',
      form: 'Expected application/json',
    });
    expect(isValidationError(error)).toBe(true);
    const weak = new ApiError(400, 'AUTH_PASSWORD_WEAK', 'Password too weak', [
      { path: 'password', message: 'Use at least 12 characters' },
    ]);
    expect(fieldErrors(weak)).toEqual({ password: 'Use at least 12 characters' });
    expect(isValidationError(weak)).toBe(true);
  });

  it('is empty for other errors and exposes the generic sentence', () => {
    expect(fieldErrors(new ApiError(404, 'NOT_FOUND', 'x'))).toEqual({});
    expect(fieldErrors(new Error('boom'))).toEqual({});
    expect(isValidationError(new Error('boom'))).toBe(false);
    expect(GENERIC_MESSAGE).toBe('Something went wrong. Try again.');
  });
});
