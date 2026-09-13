import { ApiError } from '../api/client.ts';

/** @rfc RFC-13 R6 */
export const GENERIC_MESSAGE = 'Something went wrong. Try again.';

const CODES_WITH_DETAILS = new Set(['VALIDATION_FAILED', 'AUTH_PASSWORD_WEAK']);

/** @rfc RFC-13 R6 */
export function isValidationError(error: unknown): boolean {
  return error instanceof ApiError && CODES_WITH_DETAILS.has(error.code);
}

/**
 * Field-level messages from an API validation answer, keyed by the detail's
 * `path`; a detail without a path lands under `form`.
 * @rfc RFC-13 R6
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!isValidationError(error) || !(error instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const detail of error.details ?? []) out[detail.path || 'form'] = detail.message;
  return out;
}

/**
 * The sentence a page shows for an API failure it has no mapping of its own
 * for: a 403 is the permission sentence, anything else the generic one.
 * @rfc RFC-13 R4, R6
 */
export function pageErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return 'You do not have permission to do this.';
  }
  return GENERIC_MESSAGE;
}

/**
 * The sentence a detail page (`/app/<kind>/$id`) shows for a failed lookup:
 * `notFoundCode` and a rejected id (400 `VALIDATION_FAILED` — the only input a
 * detail GET has is the id in the URL) both read as `notFoundSentence`; the
 * rest falls through to {@link pageErrorMessage}.
 * @rfc RFC-13 R4, R6
 */
export function detailErrorMessage(
  error: unknown,
  notFoundCode: string,
  notFoundSentence: string,
): string {
  if (
    error instanceof ApiError &&
    (error.code === notFoundCode || error.code === 'VALIDATION_FAILED')
  ) {
    return notFoundSentence;
  }
  return pageErrorMessage(error);
}
