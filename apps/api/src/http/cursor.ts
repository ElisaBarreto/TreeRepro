import { AppError } from './errors.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Keyset cursor over a UUID v7 primary key (RFC-02 R8): the last id of a page,
 * base64url so clients treat it as opaque.
 * @rfc RFC-11 R6
 */
export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

/** @rfc RFC-11 R6 */
export function decodeCursor(token: string): string {
  const id = Buffer.from(token, 'base64url').toString('utf8');
  if (!UUID.test(id) || encodeCursor(id) !== token) {
    throw new AppError('VALIDATION_FAILED', 'Request validation failed', [
      { path: 'cursor', message: 'Invalid cursor' },
    ]);
  }
  return id;
}
