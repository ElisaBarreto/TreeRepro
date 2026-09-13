import { ApiError } from '../../api/client.ts';
import { pageErrorMessage } from '../../lib/errors.ts';

/** @rfc RFC-13 R6 */
export function userErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'USER_INVALID_STATUS':
        return "This action does not apply to the user's current status. Reload the page.";
      case 'ROLE_LAST_ADMIN':
        return 'This is the last active administrator.';
      case 'ROLE_NOT_FOUND':
        return 'One of the roles no longer exists. Reload the page.';
      case 'MAIL_SEND_FAILED':
        return 'The invitation email could not be sent. Try again later.';
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}
