import { ApiError } from '../../api/client.ts';
import { pageErrorMessage } from '../../lib/errors.ts';

/**
 * The sentence a contribution screen shows for an API failure: the
 * contribution-specific codes of RFC-70 and RFC-80 R4, falling back to
 * {@link pageErrorMessage} for everything else.
 * @rfc RFC-13 R6
 */
export function contributionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'DOI_LOOKUP_FAILED':
        return 'The DOI registry could not be reached. Try again in a moment.';
      case 'RECORD_DUPLICATE':
        return 'Every reference already supports this exact claim. Validate the existing record instead.';
      case 'RECORD_WITHDRAWN':
        return 'This record is withdrawn; it cannot be contested.';
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}
