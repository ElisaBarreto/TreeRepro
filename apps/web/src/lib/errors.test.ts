import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client.ts';
import {
  detailErrorMessage,
  fieldErrors,
  GENERIC_MESSAGE,
  isValidationError,
  pageErrorMessage,
} from './errors.ts';

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

describe('RFC-13 R4 pageErrorMessage', () => {
  it('names the permission problem on a 403 and stays generic otherwise', () => {
    expect(pageErrorMessage(new ApiError(403, 'PERMISSION_DENIED', 'x'))).toBe(
      'You do not have permission to do this.',
    );
    expect(pageErrorMessage(new ApiError(500, 'INTERNAL_ERROR', 'x'))).toBe(GENERIC_MESSAGE);
    expect(pageErrorMessage(new Error('boom'))).toBe(GENERIC_MESSAGE);
  });
});

describe('RFC-13 R4, R6 detailErrorMessage', () => {
  it('reads the not-found code and a rejected id (VALIDATION_FAILED) as the not-found sentence', () => {
    const sentence = 'This species does not exist.';
    expect(
      detailErrorMessage(
        new ApiError(404, 'SPECIES_NOT_FOUND', 'x'),
        'SPECIES_NOT_FOUND',
        sentence,
      ),
    ).toBe(sentence);
    // `/app/species/not-a-uuid`: the API refuses the id before looking it up.
    expect(
      detailErrorMessage(
        new ApiError(400, 'VALIDATION_FAILED', 'x', [{ path: 'id', message: 'Invalid uuid' }]),
        'SPECIES_NOT_FOUND',
        sentence,
      ),
    ).toBe(sentence);
    expect(
      detailErrorMessage(
        new ApiError(403, 'PERMISSION_DENIED', 'x'),
        'SPECIES_NOT_FOUND',
        sentence,
      ),
    ).toBe('You do not have permission to do this.');
    expect(
      detailErrorMessage(new ApiError(404, 'RECORD_NOT_FOUND', 'x'), 'SPECIES_NOT_FOUND', sentence),
    ).toBe(GENERIC_MESSAGE);
    expect(detailErrorMessage(new Error('boom'), 'SPECIES_NOT_FOUND', sentence)).toBe(
      GENERIC_MESSAGE,
    );
  });
});
