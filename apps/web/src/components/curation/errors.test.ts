import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { contributionErrorMessage } from './errors.ts';

describe('contributionErrorMessage', () => {
  it('RFC-13 R6 maps the contribution codes', () => {
    expect(contributionErrorMessage(new ApiError(502, 'DOI_LOOKUP_FAILED', 'x'))).toBe(
      'The DOI registry could not be reached. Try again in a moment.',
    );
    expect(contributionErrorMessage(new ApiError(400, 'VALIDATION_FAILED', 'x'))).toBe(
      'Check the highlighted fields.',
    );
    expect(contributionErrorMessage(new Error('boom'))).toBe('Something went wrong. Try again.');
  });
});
