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
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}

/**
 * Why a contribution form will not send while a DOI row is unresolved — a
 * check that failed, or one still in flight. Not a message under one field:
 * which row is unresolved the rows say themselves, and a check still running
 * belongs to no row at all. Shared so both forms refuse in the same words.
 * @rfc RFC-80 R4
 */
export const SOURCES_NOT_READY = 'Each DOI must resolve before the record can be added.';
